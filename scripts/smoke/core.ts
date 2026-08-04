/*
 * Shared infrastructure for the smoke suites: options/state types, logging,
 * subprocess plumbing (incl. rate-limit retry), assertions, capability
 * detection, app create/upload/delete helpers, and teardown.
 *
 * Flow-specific steps live in ./private-app.ts and ./public-app.ts so either
 * lifecycle can be run on its own.
 */

import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { ChildProcess, spawn, spawnSync } from 'node:child_process';
import * as http from 'node:http';
import * as net from 'node:net';

export interface Options {
  skipAuth: boolean;
  verbose: boolean;
  port: number;
  portExplicit: boolean;
  reportPath: string | null;
  ci: boolean;
  against: 'local' | 'published';
  // Which suite modules to run, in order. See SUITES in the runner.
  suites: string[];
}

export interface StepResult {
  name: string;
  ok: boolean;
  skipped?: boolean;
  durationMs: number;
  error?: string;
  detail?: string;
}

// An app this run created, and the project directory `brevo app create` wrote
// for it. Both are needed for cleanup; the directory is also where `upload`,
// `scaffold`, `start` and `submit` must run from (they read app-config.json
// from the cwd).
export interface SmokeApp {
  appId: string;
  name: string;
  distribution: 'private' | 'public';
  projectDir: string;
  redirectUri: string;
}

// What the public lifecycle actually observed. Recorded rather than asserted
// where the backend — not the CLI — owns the value (review state, form link),
// so a run's report explains what happened without the script pretending to
// control it.
export interface PublicObservations {
  stateBeforeSubmit?: string;
  formUrl?: string;
  stateAfterSubmit?: string;
  withdrawn?: boolean;
  withdrawReason?: string;
  stateAfterWithdraw?: string;
}

export interface State {
  opts: Options;
  logFile: string;
  logFd: number;
  // Root tmp dir that every `brevo app create` runs from, so the `./<slug>`
  // directory it creates lands somewhere disposable.
  workRoot: string | null;
  // Every tmp dir the run created, removed by removeTmpDirs.
  tmpDirs: string[];
  mainApp: SmokeApp | null;
  publicApp: SmokeApp | null;
  initAppId: string | null;
  linked: boolean;
  caps: Record<string, boolean> | null;
  startChild: ChildProcess | null;
  stepResults: StepResult[];
  publicObs: PublicObservations;
  // How many times a call was retried after a rate limit — a slow run is then
  // explicable from the report rather than looking like a hang.
  rateLimitWaits: number;
  // Apps the cleanup could not delete. Non-empty means a real leak.
  orphanedAppIds: string[];
  // Absolute path to the CLI under test, resolved once in stepReinstall.
  brevoBin: string | null;
}

// ──────────────────────────── logging ────────────────────────────

// Strip values that look like Brevo secrets before any line hits the log file,
// since this log is what gets uploaded as a CI artefact.
export function redact(s: string): string {
  return (
    s
      .replaceAll(/xkeysib-[A-Za-z0-9_-]+/g, 'xkeysib-***REDACTED***')
      .replaceAll(/xsmtpsib-[A-Za-z0-9_-]+/g, 'xsmtpsib-***REDACTED***')
      .replaceAll(/"clientSecret"\s*:\s*"[^"]+"/g, '"clientSecret":"***REDACTED***"')
      .replaceAll(/"client_secret"\s*:\s*"[^"]+"/g, '"client_secret":"***REDACTED***"')
      // .env / .env.local lines the scaffold writes, in case a step ever cats them.
      .replaceAll(/\b(CLIENT_SECRET|BREVO_API_KEY)=\S+/g, '$1=***REDACTED***')
  );
}

export function logToFile(state: State, line: string): void {
  appendFileSync(state.logFd, `${new Date().toISOString()} ${redact(line)}\n`);
}

export function announce(state: State, n: number, title: string): void {
  const line = `\n▶ Step ${n}: ${title}`;
  process.stdout.write(line + '\n');
  logToFile(state, line);
}

export type StepOutcome = 'ok' | 'failed' | 'skipped';

export const OUTCOME_DISPLAY: Record<StepOutcome, { icon: string; word: string }> = {
  ok: { icon: '✓', word: 'ok' },
  skipped: { icon: '⊘', word: 'skipped' },
  failed: { icon: '✗', word: 'FAILED' },
};

export function stepDone(state: State, outcome: StepOutcome, detail: string, ms: number) {
  const { icon, word } = OUTCOME_DISPLAY[outcome];
  const line = `  ${icon} ${detail} — ${word} (${formatMs(ms)})`;
  process.stdout.write(line + '\n');
  logToFile(state, line);
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function formatMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

// ──────────────────────────── colour ────────────────────────────

// Honour NO_COLOR and non-TTY stdout so CI logs stay clean.
export const COLOR_ENABLED = !process.env.NO_COLOR && Boolean(process.stdout.isTTY);

export const COLOR = {
  reset: COLOR_ENABLED ? '\x1b[0m' : '',
  bold: COLOR_ENABLED ? '\x1b[1m' : '',
  dim: COLOR_ENABLED ? '\x1b[2m' : '',
  red: COLOR_ENABLED ? '\x1b[31m' : '',
  green: COLOR_ENABLED ? '\x1b[32m' : '',
  yellow: COLOR_ENABLED ? '\x1b[33m' : '',
  cyan: COLOR_ENABLED ? '\x1b[36m' : '',
};

// ──────────────────────────── subprocess helpers ────────────────────────────

export interface ExecOptions {
  cwd?: string;
  input?: string;
  inherit?: boolean;
  // Hard cap, used by the trap paths so cleanup can't hang on a signal.
  timeoutMs?: number;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// The API rate-limits a busy account (a full run makes ~40 calls, and the CLI's
// own retry gives up after one attempt). A 429 is an environment condition, not
// a CLI defect: without this, every step after the limiter kicks in fails, and
// the negative probes fail for the *wrong* reason — asserting a mapped message
// against "Rate limited. Retrying in 5 seconds...". Retried centrally so no step
// has to think about it, and only when the failure actually looks like a limit.
export const RATE_LIMIT_RE = /rate limit|429|too many requests/i;

export const RATE_LIMIT_BACKOFF_MS = [5000, 15_000, 30_000];

// exec() is spawnSync-based and several steps are plain sync functions, so an
// async sleep can't be awaited here.
export function sleepSync(ms: number): void {
  spawnSync(process.execPath, [
    '-e',
    `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${ms})`,
  ]);
}

// Every `brevo` call goes through the absolute path resolved once in
// stepReinstall rather than the bare name. Searching PATH per call is a security
// smell (Sonar S4036 — a writable PATH entry could shadow the binary), but the
// practical reason is sharper: an unrelated `brevo` earlier on PATH silently
// makes the entire run exercise the wrong build. A live run came close to
// passing against a stale `@dtsl/brevo-cli` install for exactly that reason.
//
// The bare name is only a fallback for the trap paths, which can fire before
// stepReinstall has resolved anything.
export const BREVO_CMD_FALLBACK = 'brevo';

// Toolchain commands. Named once so no call site embeds a bare command literal.
export const PKG_YARN = 'yarn';
export const PKG_NPM = 'npm';
export const PACKAGE_NAME = '@getbrevo/cli';
export const CMD_WHICH = 'which';

export function brevoCmd(state: State): string {
  return state.brevoBin ?? BREVO_CMD_FALLBACK;
}

export function execOnce(cmd: string, args: string[], state: State, opts: ExecOptions): ExecResult {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd,
    input: opts.input,
    encoding: 'utf8',
    env: process.env,
    ...(opts.timeoutMs ? { timeout: opts.timeoutMs } : {}),
    stdio: opts.inherit ? 'inherit' : ['pipe', 'pipe', 'pipe'],
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.status ?? -1,
  };
}

// `inherit` leaves no captured output to classify, so such a call is never
// treated as rate-limited.
export function looksRateLimited(r: ExecResult, opts: ExecOptions): boolean {
  if (r.exitCode === 0 || opts.inherit) return false;
  return RATE_LIMIT_RE.test(r.stderr + r.stdout);
}

export function execWithRateLimitRetry(
  cmd: string,
  args: string[],
  state: State,
  opts: ExecOptions,
): ExecResult {
  let r = execOnce(cmd, args, state, opts);
  for (let attempt = 0; attempt < RATE_LIMIT_BACKOFF_MS.length; attempt++) {
    if (!looksRateLimited(r, opts)) break;
    const wait = RATE_LIMIT_BACKOFF_MS[attempt] ?? 30_000;
    const of = RATE_LIMIT_BACKOFF_MS.length + 1;
    state.rateLimitWaits++;
    const note = `rate limited — waiting ${formatMs(wait)} and retrying (attempt ${attempt + 2}/${of})`;
    logToFile(state, note);
    process.stdout.write(`  ${COLOR.yellow}⏳ ${note}${COLOR.reset}\n`);
    sleepSync(wait);
    r = execOnce(cmd, args, state, opts);
  }
  return r;
}

export function exec(
  cmd: string,
  args: string[],
  state: State,
  opts: ExecOptions = {},
): ExecResult {
  const pretty = `$ ${cmd} ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`;
  logToFile(state, pretty);
  if (state.opts.verbose) process.stdout.write(`  ${pretty}\n`);

  const r = execWithRateLimitRetry(cmd, args, state, opts);

  if (!opts.inherit) {
    if (r.stdout) logToFile(state, r.stdout.trimEnd());
    if (r.stderr) logToFile(state, '[stderr] ' + r.stderr.trimEnd());
    if (state.opts.verbose) {
      if (r.stdout) process.stdout.write(r.stdout);
      if (r.stderr) process.stderr.write(r.stderr);
    }
  }
  return r;
}

export function execOrThrow(
  cmd: string,
  args: string[],
  state: State,
  opts: ExecOptions = {},
): ExecResult {
  const r = exec(cmd, args, state, opts);
  if (r.exitCode !== 0) {
    throw new Error(
      `${cmd} ${args.join(' ')} exited ${r.exitCode}: ${(r.stderr || r.stdout).trim().split('\n')[0]}`,
    );
  }
  return r;
}

// Drive a child process by writing scripted answers to its stdin with a small
// delay between lines. `spawnSync` with `input:` closes stdin as soon as the
// buffer is written, which trips up readline-based prompt libraries (inquirer
// in particular) — they see EOF before the first prompt is rendered and fall
// back to defaults. Paced writes give the prompt loop time to read each line.
export async function execScriptedStdin(
  cmd: string,
  args: string[],
  state: State,
  opts: { cwd?: string; answers: string[]; interLineDelayMs?: number },
): Promise<{ stdout: string; exitCode: number }> {
  const pretty = `$ ${cmd} ${args.join(' ')}  (scripted stdin)`;
  logToFile(state, pretty);
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });
    let buf = '';
    const onData = (d: Buffer) => {
      const s = d.toString();
      buf += s;
      logToFile(state, s.trimEnd());
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', reject);
    child.on('exit', (code) => resolve({ stdout: buf, exitCode: code ?? -1 }));
    const delay = opts.interLineDelayMs ?? 250;
    (async () => {
      for (const line of opts.answers) {
        await sleep(delay);
        if (!child.stdin || child.stdin.destroyed) break;
        child.stdin.write(line + '\n');
      }
      await sleep(delay);
      child.stdin?.end();
    })().catch((e) => logToFile(state, `stdin writer error: ${e}`));
  });
}

// Run a child process while letting the user see (and respond to) its output
// in real time. stdin is inherited so the user can answer interactive prompts;
// stdout/stderr are tee'd to terminal AND captured into a buffer for parsing
// (e.g. extracting "App ID: <uuid>" from the init wizard).
export function execStreaming(
  cmd: string,
  args: string[],
  state: State,
  opts: { cwd?: string } = {},
): Promise<{ stdout: string; exitCode: number }> {
  const pretty = `$ ${cmd} ${args.join(' ')}`;
  logToFile(state, pretty);
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      stdio: ['inherit', 'pipe', 'pipe'],
      env: process.env,
    });
    let buf = '';
    const onData = (d: Buffer) => {
      const s = d.toString();
      buf += s;
      process.stdout.write(s);
      logToFile(state, s.trimEnd());
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', reject);
    child.on('exit', (code) => resolve({ stdout: buf, exitCode: code ?? -1 }));
  });
}

// The app list endpoint is eventually consistent with create/delete
// (documented in src/commands/app/list.ts). Poll a few times before deciding
// an app is missing or still present.
export async function findAppInList(
  state: State,
  expectedId: string,
  shouldBePresent: boolean,
  attempts = 4,
): Promise<boolean> {
  const backoff = [500, 1000, 2000, 4000];
  for (let i = 0; i < attempts; i++) {
    const r = execOrThrow(brevoCmd(state), ['app', 'list', '--json'], state);
    const ids = collectAppIds(parseJson(r.stdout));
    if (ids.has(expectedId) === shouldBePresent) return true;
    if (i < attempts - 1) await sleep(backoff[i] ?? 4000);
  }
  return false;
}

export function parseJson<T = unknown>(stdout: string): T {
  // brevo sometimes prints a spinner/banner before --json output, so scan to the first { or [.
  const idx = stdout.search(/[{[]/);
  if (idx < 0) throw new Error(`no JSON in output: ${stdout.slice(0, 200)}`);
  return JSON.parse(stdout.slice(idx));
}

export function readJsonFile<T = Record<string, unknown>>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

// `brevo app list --json` returns `app_id` (snake_case, per src/types.ts).
// `brevo app create --json` returns `appId` (camelCase). Some endpoints use
// plain `id`. We accept all three so comparisons work across boundaries.
export function pickId(obj: Record<string, unknown>): string {
  const raw = obj.app_id ?? obj.appId ?? obj.id;
  return typeof raw === 'string' || typeof raw === 'number' ? String(raw) : '';
}

export function listItems(listJson: unknown): Array<Record<string, unknown>> {
  const items = Array.isArray(listJson)
    ? listJson
    : ((listJson as { apps?: unknown[]; data?: unknown[] })?.apps ??
      (listJson as { data?: unknown[] })?.data ??
      []);
  return items as Array<Record<string, unknown>>;
}

export function collectAppIds(listJson: unknown): Set<string> {
  const ids = new Set<string>();
  for (const item of listItems(listJson)) {
    const id = pickId(item);
    if (id) ids.add(id);
  }
  return ids;
}

export function findAppByName(listJson: unknown, name: string): string | null {
  for (const item of listItems(listJson)) {
    if (item.name === name) {
      const id = pickId(item);
      if (id) return id;
    }
  }
  return null;
}

// ──────────────────────────── assertions ────────────────────────────

export function must(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

export function asStringArray(value: unknown, what: string): string[] {
  if (!Array.isArray(value))
    throw new TypeError(`${what} is not an array: ${JSON.stringify(value)}`);
  return value.map(String);
}

export function sameSet(a: string[], b: string[]): boolean {
  return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
}

export function firstLine(text: string): string {
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return (line ?? '(no output)').slice(0, 200);
}

// A raw stack frame in user-facing output means the error escaped the CliError
// / ApiError mapping in src/lib/errors.ts. Checked line by line with two
// anchored patterns rather than one multi-line regex: `\n\s+at .+:\d+:\d+`
// backtracks super-linearly (Sonar S8786), since `\s` also matches the newline
// and `.+` competes with the `:line:col` tail for the same characters.
export const STACK_FRAME_HEAD_RE = /^[ \t]+at \S/;

export const STACK_FRAME_TAIL_RE = /:\d+:\d+\)?$/;

export function hasStackFrame(text: string): boolean {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .some((line) => STACK_FRAME_HEAD_RE.test(line) && STACK_FRAME_TAIL_RE.test(line));
}

export interface FailureExpectation {
  // Human label for the probe, used in the step detail and failure message.
  what: string;
  // At least one must match the command's output.
  patterns: RegExp[];
  // Exit codes from src/lib/exit-codes.ts that are acceptable here.
  exitCodes: number[];
}

// A negative probe must fail the way the CLI documents it: a mapped,
// user-facing message from src/lang/en.ts and a known exit code. Failing with
// an unmapped error (raw stack trace, or an exit code we don't recognise) is a
// regression even though the command did "fail as expected", so assert both.
export function assertMappedFailure(r: ExecResult, exp: FailureExpectation): string {
  const text = `${r.stderr}\n${r.stdout}`;
  must(r.exitCode !== 0, `${exp.what}: expected a non-zero exit, got 0 — ${firstLine(text)}`);
  must(
    exp.exitCodes.includes(r.exitCode),
    `${exp.what}: exit ${r.exitCode} not in expected ${exp.exitCodes.join('|')} — ${firstLine(text)}`,
  );
  must(!hasStackFrame(text), `${exp.what}: output contains a raw stack trace`);
  must(
    exp.patterns.some((p) => p.test(text)),
    `${exp.what}: exit ${r.exitCode} but the message is not the mapped one — ${firstLine(text)}`,
  );
  return `${exp.what} → exit ${r.exitCode}`;
}

// ──────────────────────────── capability detection ────────────────────────────

// Commands whose presence the public-app steps depend on. Each landed in its
// own ticket (BEX-250/251/252/253), and `--against=published` runs whatever
// npm currently serves — so detect instead of assuming.
export const GATED_COMMANDS = ['upload', 'submit', 'status', 'withdraw'] as const;

export type GatedCommand = (typeof GATED_COMMANDS)[number];

export function listedInHelp(helpText: string, command: string): boolean {
  return new RegExp(String.raw`brevo app ${command}\b`).test(helpText);
}

// Detection is help-text only, on purpose. `brevo app <unknown> --help` exits 0
// (commander falls back to printing the root help), so probing a subcommand
// can't tell present from absent — and running it for real isn't an option
// since these commands mutate or prompt.
export function detectCapabilities(state: State): Record<string, boolean> {
  const help = exec(brevoCmd(state), ['--help'], state);
  const helpText = help.stdout + help.stderr;
  const caps: Record<string, boolean> = {};

  // `brevo app create` exists in every version that has ever shipped, so it
  // doubles as a canary for "we can read this help layout". If even that is
  // missing, the layout changed under us — gate nothing rather than silently
  // skipping the whole public lifecycle.
  if (!listedInHelp(helpText, 'create')) {
    logToFile(
      state,
      'capability detection: unrecognised --help layout; assuming all commands present',
    );
    for (const name of GATED_COMMANDS) caps[name] = true;
    state.caps = caps;
    return caps;
  }

  for (const name of GATED_COMMANDS) {
    caps[name] = listedInHelp(helpText, name);
  }
  logToFile(state, `capabilities: ${JSON.stringify(caps)}`);
  state.caps = caps;
  return caps;
}

export class SkippedStep extends Error {}

export function skip(reason: string): never {
  throw new SkippedStep(reason);
}

export function requireCommand(state: State, name: GatedCommand): void {
  if (state.caps?.[name] === false) {
    skip(`brevo app ${name} not available in this build (--against=${state.opts.against})`);
  }
}

// ──────────────────────────── port helpers ────────────────────────────

export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port);
  });
}

export async function assertPortFree(port: number): Promise<void> {
  if (!(await isPortFree(port))) throw new Error(`port ${port} already in use`);
}

export async function pickFreePort(start: number, range = 50): Promise<number> {
  for (let port = start; port < start + range; port++) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(`no free port found in [${start}, ${start + range})`);
}

export function probeHttp(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 1000 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }
    const t = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
      resolve();
    }, timeoutMs);
    child.once('exit', () => {
      clearTimeout(t);
      resolve();
    });
  });
}

// ──────────────────────────── steps ────────────────────────────

export type StepFn = (state: State) => Promise<string> | string;

export function stepPreflight(state: State): string {
  const node = execOrThrow('node', ['-v'], state).stdout.trim();
  const yarn = execOrThrow(PKG_YARN, ['-v'], state).stdout.trim();
  return `node ${node}, yarn ${yarn}, against=${state.opts.against}, ci=${state.opts.ci}`;
}

export function stepReinstall(state: State): string {
  // Tolerate errors here — prior installations may not exist.
  exec(PKG_YARN, ['unlink'], state);
  exec(PKG_NPM, ['uninstall', '-g', PACKAGE_NAME], state);

  if (state.opts.against === 'local') {
    execOrThrow(PKG_YARN, ['build'], state);
    execOrThrow(PKG_YARN, ['link'], state);
  } else {
    execOrThrow(PKG_NPM, ['install', '-g', `${PACKAGE_NAME}@latest`], state);
  }
  state.linked = true;

  // Resolve the binary once, then invoke it by absolute path for the rest of the
  // run (see brevoCmd).
  const which = execOrThrow(CMD_WHICH, [BREVO_CMD_FALLBACK], state).stdout.trim();
  if (!which) throw new Error('could not resolve the `brevo` binary after install');
  state.brevoBin = which;
  const version = execOrThrow(brevoCmd(state), ['--version'], state).stdout.trim();

  const caps = detectCapabilities(state);
  const missing = GATED_COMMANDS.filter((c) => !caps[c]);
  const capNote = missing.length > 0 ? `, missing: ${missing.join(', ')}` : '';
  return `brevo ${version} at ${which}${capNote}`;
}

export async function stepAuth(state: State): Promise<string> {
  if (state.opts.skipAuth) {
    const r = execOrThrow(brevoCmd(state), ['whoami', '--json'], state);
    parseJson(r.stdout);
    return 'already authenticated (--skip-auth)';
  }

  exec(brevoCmd(state), ['logout', '--force', '--json'], state);

  if (state.opts.ci) {
    // brevo login picks up BREVO_API_KEY from env automatically.
    execOrThrow(brevoCmd(state), ['login', '--json'], state);
  } else {
    process.stdout.write(`  ${COLOR.cyan}⏳ waiting for browser login...${COLOR.reset}\n`);
    // --json short-circuits the post-login "Would you like to create an app?"
    // prompt (see src/commands/login.ts) that would otherwise block the smoke
    // run when the account has zero apps. The smoke test creates its own app
    // in stepAppCreate, so that prompt is never useful here.
    //
    // Trade-off: --json also suppresses the browser-fallback URL. If your
    // browser doesn't auto-open, the run will appear to hang. Run the login
    // manually first (`brevo login`) then use `yarn smoke --skip-auth`.
    const r = await execStreaming(brevoCmd(state), ['login', '--json'], state);
    if (r.exitCode !== 0) throw new Error('brevo login failed');
  }

  const whoami = execOrThrow(brevoCmd(state), ['whoami', '--json'], state);
  parseJson(whoami.stdout);
  return 'logged in';
}

// Readable, traceable name. Concurrent CI runs are namespaced by GH run id.
// The `brevo-cli-smoke` prefix is what printOrphanWarning flags as a leak, so
// every app this script creates must keep it.
export function stampedName(state: State, label: string): string {
  const stamp = state.opts.ci
    ? `${process.env.GITHUB_RUN_ID || Date.now()}-${process.env.GITHUB_RUN_ATTEMPT || '1'}`
    : String(Date.now());
  return `brevo-cli-smoke-${label}-${stamp}`;
}

export function trackTmpDir(state: State, prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  state.tmpDirs.push(dir);
  return dir;
}

// `brevo app create` creates `./<slug>` under the cwd (BEX-255), so it must
// never run from the repo root. One disposable root is shared by both creates.
export function ensureWorkRoot(state: State): string {
  const root = state.workRoot ?? trackTmpDir(state, 'brevo-smoke-work-');
  state.workRoot = root;
  return root;
}

// Render an optional string field for a step detail line without leaking
// "undefined" into the summary.
export function optStr(value: unknown): string {
  return typeof value === 'string' && value ? value : '(none)';
}

// Mirrors computeSlug() in src/commands/app/scaffold.ts — the default project
// directory name is `./<slug of app name>`, and asserting on it is how the
// smoke covers create's default-directory behaviour.
export function computeSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'my-app'
  );
}

export const BASE_SCAFFOLD_FILES = [
  'app-config.json',
  '.gitignore',
  'AGENTS.md',
  'CLAUDE.md',
  'README.md',
];

export interface CreateSmokeAppOptions {
  label: string;
  distribution: 'private' | 'public';
  logoUri?: string;
}

// Shared create path for both lifecycles: runs `brevo app create --json` from
// the disposable work root and asserts the whole create contract — response
// fields, the default `./<slug>` directory, the base project files, and the
// app-config.json written into it (BEX-255) — before returning the tracked app.
export async function createSmokeApp(state: State, opts: CreateSmokeAppOptions): Promise<SmokeApp> {
  const workRoot = ensureWorkRoot(state);
  const name = stampedName(state, opts.label);
  const redirectUri = `http://localhost:${state.opts.port}/auth/callback`;

  const args = [
    'app',
    'create',
    '--name',
    name,
    '--distribution',
    opts.distribution,
    '--redirect-uri',
    redirectUri,
    ...(opts.logoUri ? ['--logo-uri', opts.logoUri] : []),
    '--json',
  ];
  const created = parseJson<Record<string, unknown>>(
    execOrThrow(brevoCmd(state), args, state, { cwd: workRoot }).stdout,
  );

  const appId = pickId(created);
  must(appId, `no app id in create output: ${JSON.stringify(created).slice(0, 200)}`);
  // Register the app for cleanup before any further assertion can throw.
  const app: SmokeApp = {
    appId,
    name,
    distribution: opts.distribution,
    projectDir: typeof created.directory === 'string' ? created.directory : '',
    redirectUri,
  };
  if (opts.distribution === 'public') state.publicApp = app;
  else state.mainApp = app;

  must(created.appName === name, `create returned appName ${JSON.stringify(created.appName)}`);
  must(
    asStringArray(created.redirectUri, 'create redirectUri').includes(redirectUri),
    `create response is missing redirect URI ${redirectUri}`,
  );
  if (opts.logoUri) {
    must(
      created.logoUri === opts.logoUri,
      `create returned logoUri ${JSON.stringify(created.logoUri)}`,
    );
  }

  // Default directory: `./<slug>` relative to the cwd create ran in. A build
  // from before BEX-255 doesn't create one — record that and let the steps that
  // need a project directory skip themselves (see requireProjectDir), instead of
  // failing a published-version run for a feature it doesn't have yet.
  if (!app.projectDir) {
    logToFile(
      state,
      `create --json reported no directory for app ${appId}; treating this build as pre-BEX-255`,
    );
    must(
      await findAppInList(state, appId, true),
      `app ${appId} not present in list after create (after retries)`,
    );
    return app;
  }
  must(
    basename(app.projectDir) === computeSlug(name),
    `create directory ${app.projectDir} does not match default slug ${computeSlug(name)}`,
  );
  const missingFiles = BASE_SCAFFOLD_FILES.filter((f) => !existsSync(join(app.projectDir, f)));
  must(
    missingFiles.length === 0,
    `create did not write ${missingFiles.join(', ')} into ${app.projectDir}`,
  );

  // app-config.json is the contract every later command reads. distribution_type
  // and version are round-tripped from the server (see buildTemplateVars in
  // scaffold.ts), so this also proves the create response persisted correctly.
  const cfg = readJsonFile(join(app.projectDir, 'app-config.json'));
  must(
    String(cfg.appId) === appId,
    `app-config.json appId ${JSON.stringify(cfg.appId)} != ${appId}`,
  );
  must(cfg.appName === name, `app-config.json appName ${JSON.stringify(cfg.appName)} != ${name}`);
  must(
    cfg.distribution_type === opts.distribution,
    `app-config.json distribution_type ${JSON.stringify(cfg.distribution_type)} != ${opts.distribution}`,
  );
  must('version' in cfg, 'app-config.json has no version key');
  // permittedUrls/support were dropped from the scaffolded config (nothing ever
  // read them) — their reappearance would mean the template regressed.
  must(
    !('permittedUrls' in cfg) && !('support' in cfg),
    'app-config.json still carries the removed permittedUrls/support blocks',
  );
  if (opts.logoUri) {
    must(cfg.logoUri === opts.logoUri, `app-config.json logoUri ${JSON.stringify(cfg.logoUri)}`);
  }
  const cfgUrls = asStringArray(
    (cfg.auth as Record<string, unknown> | undefined)?.redirectUrls,
    'app-config.json auth.redirectUrls',
  );
  must(cfgUrls.includes(redirectUri), `app-config.json is missing redirect URL ${redirectUri}`);

  // List endpoint lags create — retry with backoff before declaring missing.
  must(
    await findAppInList(state, appId, true),
    `app ${appId} not present in list after create (after retries)`,
  );

  return app;
}

export function requireApp(app: SmokeApp | null, which: string): SmokeApp {
  if (!app) throw new Error(`no ${which} app from the create step`);
  return app;
}

// upload / scaffold / start all read app-config.json from the cwd, so they need
// the project directory `brevo app create` writes (BEX-255). Older builds don't
// write one — skip rather than fail.
export function requireProjectDir(app: SmokeApp): string {
  if (!app.projectDir) {
    skip("the installed build's `app create` did not create a project directory (pre-BEX-255)");
  }
  return app.projectDir;
}

export const EXTRA_REDIRECT_URI = 'https://example.com/cb';

export function renamedName(app: SmokeApp): string {
  return `${app.name}-renamed`;
}

// `brevo app upload` (BEX-250, replaced `brevo app update`) pushes the local
// app-config.json. Edit the file the way a user would — rename + add a redirect
// URL — then assert the response diff and the config written back.
export function uploadApp(state: State, app: SmokeApp): Record<string, unknown> {
  const projectDir = requireProjectDir(app);
  const configPath = join(projectDir, 'app-config.json');
  const cfg = readJsonFile(configPath);
  const auth = (cfg.auth ?? {}) as Record<string, unknown>;
  const nextName = renamedName(app);
  const nextUrls = [
    ...asStringArray(auth.redirectUrls, 'app-config.json auth.redirectUrls'),
    EXTRA_REDIRECT_URI,
  ];
  writeFileSync(
    configPath,
    JSON.stringify(
      { ...cfg, appName: nextName, auth: { ...auth, redirectUrls: nextUrls } },
      null,
      2,
    ),
  );

  const r = execOrThrow(brevoCmd(state), ['app', 'upload', '--yes', '--json'], state, {
    cwd: projectDir,
  });
  const res = parseJson<Record<string, unknown>>(r.stdout);

  must(String(res.appId) === app.appId, `upload returned appId ${JSON.stringify(res.appId)}`);
  must(
    res.name === nextName,
    `upload returned name ${JSON.stringify(res.name)}, expected ${nextName}`,
  );

  const next = (res.next ?? {}) as Record<string, unknown>;
  const current = (res.current ?? {}) as Record<string, unknown>;
  must(next.name === nextName, `upload next.name ${JSON.stringify(next.name)} != ${nextName}`);
  must(
    current.name === app.name,
    `upload current.name ${JSON.stringify(current.name)} != pre-rename ${app.name}`,
  );
  const nextRemoteUrls = asStringArray(next.redirect_uris, 'upload next.redirect_uris');
  must(
    nextRemoteUrls.includes(app.redirectUri),
    `upload dropped the create-time redirect URI ${app.redirectUri}: ${nextRemoteUrls.join(', ')}`,
  );
  must(
    nextRemoteUrls.includes(EXTRA_REDIRECT_URI),
    `upload is missing the added redirect URI ${EXTRA_REDIRECT_URI}: ${nextRemoteUrls.join(', ')}`,
  );

  // Success writes the server-confirmed values back into app-config.json.
  const written = readJsonFile(configPath);
  must(written.appName === nextName, `app-config.json was not rewritten with ${nextName}`);
  must(
    written.version === res.version,
    `app-config.json version ${JSON.stringify(written.version)} != response ${JSON.stringify(res.version)}`,
  );
  const writtenUrls = asStringArray(
    (written.auth as Record<string, unknown> | undefined)?.redirectUrls,
    'app-config.json auth.redirectUrls after upload',
  );
  must(
    writtenUrls.includes(app.redirectUri) && writtenUrls.includes(EXTRA_REDIRECT_URI),
    `app-config.json redirect URLs after upload: ${writtenUrls.join(', ')}`,
  );

  return res;
}

export async function deleteSmokeApp(state: State, app: SmokeApp): Promise<string> {
  execOrThrow(
    brevoCmd(state),
    ['app', 'delete', '--app-id', app.appId, '--force', '--json'],
    state,
  );

  // List lags delete too — retry until the app is gone.
  must(
    await findAppInList(state, app.appId, false),
    `app ${app.appId} still present after delete (after retries)`,
  );
  return `app ${app.appId} deleted`;
}

export function printOrphanWarning(
  state: State,
  suspectIds: string[],
  expectedName?: string,
): void {
  process.stdout.write(`\n${COLOR.yellow}${COLOR.bold}⚠ ORPHAN APP WARNING${COLOR.reset}\n`);
  process.stdout.write(
    `${COLOR.yellow}The init wizard likely created an app but the script could not identify it.${COLOR.reset}\n`,
  );
  if (expectedName) {
    process.stdout.write(
      `${COLOR.yellow}Expected app name: ${COLOR.bold}${expectedName}${COLOR.reset}${COLOR.yellow} (not found in list)${COLOR.reset}\n`,
    );
  }
  if (suspectIds.length > 0) {
    process.stdout.write(
      `${COLOR.yellow}Suspect app ids: ${suspectIds.join(', ')}${COLOR.reset}\n`,
    );
  }
  try {
    const r = execOrThrow(brevoCmd(state), ['app', 'list', '--json'], state);
    process.stdout.write(`${COLOR.yellow}Apps currently on the account:${COLOR.reset}\n`);
    for (const a of listItems(parseJson(r.stdout))) {
      const id = pickId(a) || '?';
      const name = typeof a.name === 'string' ? a.name : '?';
      const flag = name.startsWith('brevo-cli-smoke')
        ? `  ${COLOR.red}← likely smoke leak${COLOR.reset}`
        : '';
      process.stdout.write(`  - ${id}  ${name}${flag}\n`);
    }
    process.stdout.write(
      `${COLOR.yellow}Delete any that look like smoke artifacts with:${COLOR.reset}\n` +
        `  ${COLOR.dim}brevo app delete --app-id <id> --force${COLOR.reset}\n`,
    );
  } catch (e) {
    logToFile(state, `orphan listing failed: ${errMsg(e)}`);
  }
}

// Runs as a normal step, deliberately placed before Logout and Final cleanup.
// Those two steps destroy the two things a delete needs — the credentials and
// the linked `brevo` binary — so the trap-based safety net that runs after them
// can't actually clean anything up. Any app left behind by a delete step that
// failed earlier (a rate limit, a transient 5xx) has to be caught here, while
// the session is still alive.
export function stepDeleteLeftoverApps(state: State): string {
  const leftovers: Array<{ label: string; appId: string; clear: () => void }> = [];
  if (state.mainApp) {
    leftovers.push({
      label: 'private',
      appId: state.mainApp.appId,
      clear: () => (state.mainApp = null),
    });
  }
  if (state.publicApp) {
    leftovers.push({
      label: 'public',
      appId: state.publicApp.appId,
      clear: () => (state.publicApp = null),
    });
  }
  if (state.initAppId) {
    leftovers.push({
      label: 'init',
      appId: state.initAppId,
      clear: () => (state.initAppId = null),
    });
  }
  if (leftovers.length === 0) return 'nothing left behind';

  const deleted: string[] = [];
  const failed: string[] = [];
  for (const { label, appId, clear } of leftovers) {
    // exec() already retries a rate-limited call, which is the most likely
    // reason a delete step failed in the first place.
    const r = exec(
      brevoCmd(state),
      ['app', 'delete', '--app-id', appId, '--force', '--json'],
      state,
    );
    if (r.exitCode === 0) {
      deleted.push(`${label} ${appId}`);
      clear();
    } else {
      failed.push(`${label} ${appId} (exit ${r.exitCode})`);
    }
  }

  if (failed.length > 0) {
    // Leave the ids on State so the trap reports them as orphans too.
    const alsoDeleted = deleted.length > 0 ? `; deleted ${deleted.join(', ')}` : '';
    throw new Error(`could not delete ${failed.join(', ')}${alsoDeleted}`);
  }
  return `recovered leftover app(s): ${deleted.join(', ')}`;
}

export function stepLogout(state: State): string {
  execOrThrow(brevoCmd(state), ['logout', '--force', '--json'], state);
  // whoami may exit non-zero when unauthenticated; accept either as "logged out"
  const r = exec(brevoCmd(state), ['whoami', '--json'], state);
  if (r.exitCode === 0) {
    try {
      const obj = parseJson<Record<string, unknown>>(r.stdout);
      if (obj.authenticated || obj.user || obj.email) {
        throw new Error('still authenticated after logout');
      }
    } catch {
      // unparseable whoami output post-logout is acceptable
    }
  }
  return 'logged out';
}

export function killStartChild(state: State): void {
  if (!state.startChild) return;
  try {
    // `.killed` only means a signal was already sent, not that the process
    // exited — always send SIGKILL (a no-op on a dead pid) and drop the ref.
    state.startChild.kill('SIGKILL');
  } catch {
    // ignore
  }
  state.startChild = null;
}

export function removeTmpDirs(state: State, logFailures: boolean): void {
  for (const dir of state.tmpDirs) {
    if (!existsSync(dir)) continue;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      if (logFailures) {
        logToFile(state, `rm ${dir} failed: ${errMsg(e)}`);
      }
    }
  }
  state.tmpDirs = [];
  state.workRoot = null;
}

export function stepFinalCleanup(state: State): string {
  if (state.linked) {
    if (state.opts.against === 'local') exec(PKG_YARN, ['unlink'], state);
    else exec(PKG_NPM, ['uninstall', '-g', PACKAGE_NAME], state);
    state.linked = false;
  }
  removeTmpDirs(state, true);
  killStartChild(state);
  return 'cleanup done';
}

// ──────────────────────────── trap cleanup ────────────────────────────

// Last-resort deletion. spawnSync does NOT throw on a non-zero exit, so the
// exit status must be checked explicitly — logging "deleted" off the back of a
// try/catch reports success for a delete that 401'd or got rate-limited, which
// is worse than no cleanup at all because nobody goes looking for the orphan.
export function trapDeleteApps(state: State): void {
  const orphans: string[] = [];
  for (const appId of [state.mainApp?.appId, state.publicApp?.appId, state.initAppId]) {
    if (!appId) continue;
    try {
      const r = spawnSync(
        brevoCmd(state),
        ['app', 'delete', '--app-id', appId, '--force', '--json'],
        {
          timeout: 30_000,
          encoding: 'utf8',
        },
      );
      if (r.status === 0) {
        logToFile(state, `trap: deleted app ${appId}`);
        continue;
      }
      orphans.push(appId);
      const why = firstLine(`${r.stderr ?? ''}\n${r.stdout ?? ''}`);
      logToFile(state, `trap: FAILED to delete app ${appId} (exit ${r.status}): ${why}`);
    } catch (e) {
      orphans.push(appId);
      logToFile(state, `trap: FAILED to delete app ${appId}: ${errMsg(e)}`);
    }
  }
  state.mainApp = null;
  state.publicApp = null;
  state.initAppId = null;

  if (orphans.length > 0) {
    state.orphanedAppIds.push(...orphans);
    // Straight to stdout: by this point the run may be logged out and the CLI
    // unlinked, so this is the only record the operator will see.
    process.stdout.write(
      `\n${COLOR.red}${COLOR.bold}⚠ ORPHANED APPS — CLEANUP FAILED${COLOR.reset}\n` +
        `${COLOR.yellow}These apps could not be deleted and are still on the account:${COLOR.reset}\n` +
        orphans.map((id) => `  ${id}\n`).join('') +
        `${COLOR.yellow}Log in and remove them:${COLOR.reset}\n` +
        orphans
          .map((id) => `  ${COLOR.dim}brevo app delete --app-id ${id} --force${COLOR.reset}\n`)
          .join(''),
    );
  }
}

// Goes through exec() rather than a bare spawnSync so the command name isn't a
// literal resolved off PATH at the call site (Sonar S4036), and so the output
// lands in the run log like every other subprocess call.
export function trapUninstallCli(state: State): void {
  if (!state.linked) return;
  const [cmd, args] =
    state.opts.against === 'local'
      ? [PKG_YARN, ['unlink']]
      : [PKG_NPM, ['uninstall', '-g', PACKAGE_NAME]];
  try {
    exec(cmd, args, state, { timeoutMs: 30_000 });
  } catch (e) {
    logToFile(state, `trap: uninstall failed: ${errMsg(e)}`);
  }
  state.linked = false;
}

// Best-effort: synchronous-ish, no throws. Runs on SIGINT/SIGTERM/uncaughtException
// and as a final safety net after the run loop. Designed to be idempotent.
export function bestEffortCleanup(state: State): void {
  killStartChild(state);
  trapDeleteApps(state);
  removeTmpDirs(state, false);
  trapUninstallCli(state);
}

// ──────────────────────────── report ────────────────────────────

// A runnable group of steps. Each suite module exports one, and the runner
// composes whichever the caller selected.
export interface Suite {
  name: string;
  description: string;
  steps: Array<[string, StepFn]>;
}
