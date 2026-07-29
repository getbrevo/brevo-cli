#!/usr/bin/env node
/*
 * Smoke test for @getbrevo/cli.
 *
 * Exercises two lifecycles against a real backend:
 *
 *   private app: create → credentials → upload → verify rename → scaffold →
 *                start → delete
 *   public app:  create → upload → status → submit → status → withdraw →
 *                status → delete
 *
 * plus negative probes for the mapped error messages and exit codes.
 *
 * Every app the run creates is tracked on `State` so the trap/cleanup paths
 * (`trapDeleteApps`, `bestEffortCleanup`) tear it down on success, on failure,
 * and on SIGINT/SIGTERM. Every directory it writes lives under a tmp dir that
 * is likewise tracked and removed — `brevo app create` creates `./<slug>` in
 * the cwd, so creates must never run from the repo root.
 */

import { randomUUID } from 'node:crypto';
import { spawn, spawnSync, ChildProcess } from 'node:child_process';
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import * as http from 'node:http';
import * as net from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

// ──────────────────────────── options ────────────────────────────

interface Options {
  skipAuth: boolean;
  verbose: boolean;
  port: number;
  portExplicit: boolean;
  reportPath: string | null;
  ci: boolean;
  against: 'local' | 'published';
  withInit: boolean;
  withPublic: boolean;
}

function parsePortValue(arg: string): number {
  const n = Number.parseInt(arg.slice('--port='.length), 10);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) {
    throw new Error(`invalid --port value: ${arg}`);
  }
  return n;
}

function parseAgainstValue(arg: string): 'local' | 'published' {
  const v = arg.slice('--against='.length);
  if (v !== 'local' && v !== 'published') {
    throw new Error(`--against must be 'local' or 'published', got: ${v}`);
  }
  return v;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    skipAuth: false,
    verbose: false,
    port: 3009,
    portExplicit: false,
    reportPath: null,
    ci: false,
    against: 'local',
    withInit: false,
    withPublic: true,
  };
  for (const arg of argv) {
    if (arg === '--skip-auth') opts.skipAuth = true;
    else if (arg === '--verbose') opts.verbose = true;
    else if (arg === '--with-init') opts.withInit = true;
    else if (arg === '--skip-public') opts.withPublic = false;
    else if (arg === '--with-public') opts.withPublic = true;
    else if (arg === '--ci') {
      opts.ci = true;
      opts.verbose = true;
    } else if (arg.startsWith('--port=')) {
      opts.port = parsePortValue(arg);
      opts.portExplicit = true;
    } else if (arg.startsWith('--report=')) {
      opts.reportPath = arg.slice('--report='.length);
    } else if (arg.startsWith('--against=')) {
      opts.against = parseAgainstValue(arg);
    } else if (arg === '-h' || arg === '--help') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`unknown flag: ${arg}`);
    }
  }
  if (opts.ci && !opts.skipAuth && !process.env.BREVO_API_KEY) {
    throw new Error('--ci requires BREVO_API_KEY in env (or pair with --skip-auth)');
  }
  return opts;
}

function printHelp(): void {
  process.stdout.write(`Usage: yarn smoke [flags]

Flags:
  --skip-auth                  Assume already logged in; skip login step.
  --verbose                    Stream subprocess output to terminal.
  --port=<n>                   OAuth server port for the start step (default 3009).
  --report=<path>              Write JSON run summary to <path>.
  --ci                         CI mode: API-key auth via BREVO_API_KEY (instead of browser).
  --against=local|published    Install strategy (default local).
  --with-init                  Also exercise the 'brevo app init' wizard (skipped by default).
  --with-public                Run the public-app lifecycle (default; opposite of --skip-public).
  --skip-public                Skip the public-app lifecycle steps entirely.
  -h, --help                   Show this help.

Steps that need a command the installed CLI doesn't have (notably
--against=published, where 'app submit' / 'app status' / 'app withdraw' /
'app upload' may not be released yet) are auto-detected and reported as
skipped rather than failed.
`);
}

// ──────────────────────────── state ────────────────────────────

interface StepResult {
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
interface SmokeApp {
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
interface PublicObservations {
  stateBeforeSubmit?: string;
  formUrl?: string;
  stateAfterSubmit?: string;
  withdrawn?: boolean;
  withdrawReason?: string;
  stateAfterWithdraw?: string;
}

interface State {
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
}

// ──────────────────────────── logging ────────────────────────────

// Strip values that look like Brevo secrets before any line hits the log file,
// since this log is what gets uploaded as a CI artefact.
function redact(s: string): string {
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

function logToFile(state: State, line: string): void {
  appendFileSync(state.logFd, `${new Date().toISOString()} ${redact(line)}\n`);
}

function announce(state: State, n: number, title: string): void {
  const line = `\n▶ Step ${n}: ${title}`;
  process.stdout.write(line + '\n');
  logToFile(state, line);
}

function stepDone(state: State, outcome: 'ok' | 'failed' | 'skipped', detail: string, ms: number) {
  const icon = outcome === 'ok' ? '✓' : outcome === 'skipped' ? '⊘' : '✗';
  const word = outcome === 'ok' ? 'ok' : outcome === 'skipped' ? 'skipped' : 'FAILED';
  const line = `  ${icon} ${detail} — ${word} (${formatMs(ms)})`;
  process.stdout.write(line + '\n');
  logToFile(state, line);
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function formatMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

// ──────────────────────────── colour ────────────────────────────

// Honour NO_COLOR and non-TTY stdout so CI logs stay clean.
const COLOR_ENABLED = !process.env.NO_COLOR && Boolean(process.stdout.isTTY);

const COLOR = {
  reset: COLOR_ENABLED ? '\x1b[0m' : '',
  bold: COLOR_ENABLED ? '\x1b[1m' : '',
  dim: COLOR_ENABLED ? '\x1b[2m' : '',
  red: COLOR_ENABLED ? '\x1b[31m' : '',
  green: COLOR_ENABLED ? '\x1b[32m' : '',
  yellow: COLOR_ENABLED ? '\x1b[33m' : '',
  cyan: COLOR_ENABLED ? '\x1b[36m' : '',
};

// ──────────────────────────── subprocess helpers ────────────────────────────

interface ExecOptions {
  cwd?: string;
  input?: string;
  inherit?: boolean;
}

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function exec(cmd: string, args: string[], state: State, opts: ExecOptions = {}): ExecResult {
  const pretty = `$ ${cmd} ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`;
  logToFile(state, pretty);
  if (state.opts.verbose) process.stdout.write(`  ${pretty}\n`);

  const result = spawnSync(cmd, args, {
    cwd: opts.cwd,
    input: opts.input,
    encoding: 'utf8',
    env: process.env,
    stdio: opts.inherit ? 'inherit' : ['pipe', 'pipe', 'pipe'],
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const exitCode = result.status ?? -1;

  if (!opts.inherit) {
    if (stdout) logToFile(state, stdout.trimEnd());
    if (stderr) logToFile(state, '[stderr] ' + stderr.trimEnd());
    if (state.opts.verbose) {
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
    }
  }
  return { stdout, stderr, exitCode };
}

function execOrThrow(
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
async function execScriptedStdin(
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
function execStreaming(
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
async function findAppInList(
  state: State,
  expectedId: string,
  shouldBePresent: boolean,
  attempts = 4,
): Promise<boolean> {
  const backoff = [500, 1000, 2000, 4000];
  for (let i = 0; i < attempts; i++) {
    const r = execOrThrow('brevo', ['app', 'list', '--json'], state);
    const ids = collectAppIds(parseJson(r.stdout));
    if (ids.has(expectedId) === shouldBePresent) return true;
    if (i < attempts - 1) await sleep(backoff[i] ?? 4000);
  }
  return false;
}

function parseJson<T = unknown>(stdout: string): T {
  // brevo sometimes prints a spinner/banner before --json output, so scan to the first { or [.
  const idx = stdout.search(/[{[]/);
  if (idx < 0) throw new Error(`no JSON in output: ${stdout.slice(0, 200)}`);
  return JSON.parse(stdout.slice(idx));
}

function readJsonFile<T = Record<string, unknown>>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

// `brevo app list --json` returns `app_id` (snake_case, per src/types.ts).
// `brevo app create --json` returns `appId` (camelCase). Some endpoints use
// plain `id`. We accept all three so comparisons work across boundaries.
function pickId(obj: Record<string, unknown>): string {
  const raw = obj.app_id ?? obj.appId ?? obj.id;
  return typeof raw === 'string' || typeof raw === 'number' ? String(raw) : '';
}

function listItems(listJson: unknown): Array<Record<string, unknown>> {
  const items = Array.isArray(listJson)
    ? listJson
    : ((listJson as { apps?: unknown[]; data?: unknown[] })?.apps ??
      (listJson as { data?: unknown[] })?.data ??
      []);
  return items as Array<Record<string, unknown>>;
}

function collectAppIds(listJson: unknown): Set<string> {
  const ids = new Set<string>();
  for (const item of listItems(listJson)) {
    const id = pickId(item);
    if (id) ids.add(id);
  }
  return ids;
}

function findAppByName(listJson: unknown, name: string): string | null {
  for (const item of listItems(listJson)) {
    if (item.name === name) {
      const id = pickId(item);
      if (id) return id;
    }
  }
  return null;
}

// ──────────────────────────── assertions ────────────────────────────

function must(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function asStringArray(value: unknown, what: string): string[] {
  if (!Array.isArray(value))
    throw new TypeError(`${what} is not an array: ${JSON.stringify(value)}`);
  return value.map(String);
}

function sameSet(a: string[], b: string[]): boolean {
  return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
}

function firstLine(text: string): string {
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return (line ?? '(no output)').slice(0, 200);
}

// A raw stack frame in user-facing output means the error escaped the CliError
// / ApiError mapping in src/lib/errors.ts.
const STACK_FRAME_RE = /\n\s+at .+:\d+:\d+/;

interface FailureExpectation {
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
function assertMappedFailure(r: ExecResult, exp: FailureExpectation): string {
  const text = `${r.stderr}\n${r.stdout}`;
  must(r.exitCode !== 0, `${exp.what}: expected a non-zero exit, got 0 — ${firstLine(text)}`);
  must(
    exp.exitCodes.includes(r.exitCode),
    `${exp.what}: exit ${r.exitCode} not in expected ${exp.exitCodes.join('|')} — ${firstLine(text)}`,
  );
  must(!STACK_FRAME_RE.test(text), `${exp.what}: output contains a raw stack trace`);
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
const GATED_COMMANDS = ['upload', 'submit', 'status', 'withdraw'] as const;
type GatedCommand = (typeof GATED_COMMANDS)[number];

function listedInHelp(helpText: string, command: string): boolean {
  return new RegExp(String.raw`brevo app ${command}\b`).test(helpText);
}

// Detection is help-text only, on purpose. `brevo app <unknown> --help` exits 0
// (commander falls back to printing the root help), so probing a subcommand
// can't tell present from absent — and running it for real isn't an option
// since these commands mutate or prompt.
function detectCapabilities(state: State): Record<string, boolean> {
  const help = exec('brevo', ['--help'], state);
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

class SkippedStep extends Error {}

function skip(reason: string): never {
  throw new SkippedStep(reason);
}

function requireCommand(state: State, name: GatedCommand): void {
  if (state.caps?.[name] === false) {
    skip(`brevo app ${name} not available in this build (--against=${state.opts.against})`);
  }
}

// ──────────────────────────── port helpers ────────────────────────────

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port);
  });
}

async function assertPortFree(port: number): Promise<void> {
  if (!(await isPortFree(port))) throw new Error(`port ${port} already in use`);
}

async function pickFreePort(start: number, range = 50): Promise<number> {
  for (let port = start; port < start + range; port++) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(`no free port found in [${start}, ${start + range})`);
}

function probeHttp(port: number): Promise<boolean> {
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
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

type StepFn = (state: State) => Promise<string> | string;

async function runStep(n: number, name: string, fn: StepFn, state: State): Promise<boolean> {
  announce(state, n, name);
  const t0 = Date.now();
  try {
    const detail = (await fn(state)) || 'done';
    const ms = Date.now() - t0;
    state.stepResults.push({ name, ok: true, durationMs: ms, detail });
    stepDone(state, 'ok', detail, ms);
    return true;
  } catch (err) {
    const ms = Date.now() - t0;
    const message = errMsg(err);
    if (err instanceof SkippedStep) {
      state.stepResults.push({ name, ok: true, skipped: true, durationMs: ms, detail: message });
      stepDone(state, 'skipped', message, ms);
      return true;
    }
    state.stepResults.push({ name, ok: false, durationMs: ms, error: message });
    stepDone(state, 'failed', (message.split('\n')[0] ?? message).slice(0, 200), ms);
    logToFile(state, message);
    return false;
  }
}

function stepPreflight(state: State): string {
  const node = execOrThrow('node', ['-v'], state).stdout.trim();
  const yarn = execOrThrow('yarn', ['-v'], state).stdout.trim();
  return `node ${node}, yarn ${yarn}, against=${state.opts.against}, ci=${state.opts.ci}`;
}

function stepReinstall(state: State): string {
  // Tolerate errors here — prior installations may not exist.
  exec('yarn', ['unlink'], state);
  exec('npm', ['uninstall', '-g', '@getbrevo/cli'], state);

  if (state.opts.against === 'local') {
    execOrThrow('yarn', ['build'], state);
    execOrThrow('yarn', ['link'], state);
  } else {
    execOrThrow('npm', ['install', '-g', '@getbrevo/cli@latest'], state);
  }
  state.linked = true;

  const which = execOrThrow('which', ['brevo'], state).stdout.trim();
  const version = execOrThrow('brevo', ['--version'], state).stdout.trim();

  const caps = detectCapabilities(state);
  const missing = GATED_COMMANDS.filter((c) => !caps[c]);
  const capNote = missing.length > 0 ? `, missing: ${missing.join(', ')}` : '';
  return `brevo ${version} at ${which}${capNote}`;
}

async function stepAuth(state: State): Promise<string> {
  if (state.opts.skipAuth) {
    const r = execOrThrow('brevo', ['whoami', '--json'], state);
    parseJson(r.stdout);
    return 'already authenticated (--skip-auth)';
  }

  exec('brevo', ['logout', '--force', '--json'], state);

  if (state.opts.ci) {
    // brevo login picks up BREVO_API_KEY from env automatically.
    execOrThrow('brevo', ['login', '--json'], state);
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
    const r = await execStreaming('brevo', ['login', '--json'], state);
    if (r.exitCode !== 0) throw new Error('brevo login failed');
  }

  const whoami = execOrThrow('brevo', ['whoami', '--json'], state);
  parseJson(whoami.stdout);
  return 'logged in';
}

// Readable, traceable name. Concurrent CI runs are namespaced by GH run id.
// The `brevo-cli-smoke` prefix is what printOrphanWarning flags as a leak, so
// every app this script creates must keep it.
function stampedName(state: State, label: string): string {
  const stamp = state.opts.ci
    ? `${process.env.GITHUB_RUN_ID || Date.now()}-${process.env.GITHUB_RUN_ATTEMPT || '1'}`
    : String(Date.now());
  return `brevo-cli-smoke-${label}-${stamp}`;
}

function trackTmpDir(state: State, prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  state.tmpDirs.push(dir);
  return dir;
}

// `brevo app create` creates `./<slug>` under the cwd (BEX-255), so it must
// never run from the repo root. One disposable root is shared by both creates.
function ensureWorkRoot(state: State): string {
  const root = state.workRoot ?? trackTmpDir(state, 'brevo-smoke-work-');
  state.workRoot = root;
  return root;
}

// Render an optional string field for a step detail line without leaking
// "undefined" into the summary.
function optStr(value: unknown): string {
  return typeof value === 'string' && value ? value : '(none)';
}

// Mirrors computeSlug() in src/commands/app/scaffold.ts — the default project
// directory name is `./<slug of app name>`, and asserting on it is how the
// smoke covers create's default-directory behaviour.
function computeSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'my-app'
  );
}

const BASE_SCAFFOLD_FILES = [
  'app-config.json',
  '.gitignore',
  'AGENTS.md',
  'CLAUDE.md',
  'README.md',
];

interface CreateSmokeAppOptions {
  label: string;
  distribution: 'private' | 'public';
  logoUri?: string;
}

// Shared create path for both lifecycles: runs `brevo app create --json` from
// the disposable work root and asserts the whole create contract — response
// fields, the default `./<slug>` directory, the base project files, and the
// app-config.json written into it (BEX-255) — before returning the tracked app.
async function createSmokeApp(state: State, opts: CreateSmokeAppOptions): Promise<SmokeApp> {
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
    execOrThrow('brevo', args, state, { cwd: workRoot }).stdout,
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
  must(cfg.permittedUrls && cfg.support, 'app-config.json is missing permittedUrls/support blocks');
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

async function stepAppCreate(state: State): Promise<string> {
  const app = await createSmokeApp(state, { label: 'test', distribution: 'private' });
  return `private app ${app.appId} created in ${app.projectDir}, listed`;
}

function requireApp(app: SmokeApp | null, which: string): SmokeApp {
  if (!app) throw new Error(`no ${which} app from the create step`);
  return app;
}

// upload / scaffold / start all read app-config.json from the cwd, so they need
// the project directory `brevo app create` writes (BEX-255). Older builds don't
// write one — skip rather than fail.
function requireProjectDir(app: SmokeApp): string {
  if (!app.projectDir) {
    skip("the installed build's `app create` did not create a project directory (pre-BEX-255)");
  }
  return app.projectDir;
}

function stepAppCredentials(state: State): string {
  const app = requireApp(state.mainApp, 'private');
  const creds = execOrThrow(
    'brevo',
    ['app', 'credentials', '--app-id', app.appId, '--reveal-secret', '--json'],
    state,
  );
  const credObj = parseJson<Record<string, unknown>>(creds.stdout);
  if (!credObj.clientId || !credObj.clientSecret) {
    throw new Error('credentials response missing clientId or clientSecret');
  }
  return `clientId + clientSecret returned`;
}

const EXTRA_REDIRECT_URI = 'https://example.com/cb';

function renamedName(app: SmokeApp): string {
  return `${app.name}-renamed`;
}

// `brevo app upload` (BEX-250, replaced `brevo app update`) pushes the local
// app-config.json. Edit the file the way a user would — rename + add a redirect
// URL — then assert the response diff and the config written back.
function uploadApp(state: State, app: SmokeApp): Record<string, unknown> {
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

  const r = execOrThrow('brevo', ['app', 'upload', '--yes', '--json'], state, {
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

function stepAppUpload(state: State): string {
  requireCommand(state, 'upload');
  const app = requireApp(state.mainApp, 'private');
  const res = uploadApp(state, app);
  return `renamed + redirect URL added, version ${optStr(res.version)}`;
}

// Re-running upload with nothing changed must report up-to-date and push
// nothing. The version is the one field the server may bump on its own, so a
// version-only difference is accepted (and reported) rather than failed.
function stepAppUploadNoop(state: State): string {
  requireCommand(state, 'upload');
  const app = requireApp(state.mainApp, 'private');
  const res = parseJson<Record<string, unknown>>(
    execOrThrow('brevo', ['app', 'upload', '--yes', '--json'], state, {
      cwd: requireProjectDir(app),
    }).stdout,
  );
  if (res.upToDate === true) return `up to date at version ${optStr(res.version)}`;

  const current = (res.current ?? {}) as Record<string, unknown>;
  const next = (res.next ?? {}) as Record<string, unknown>;
  must(
    current.name === next.name,
    `second upload changed the name: ${JSON.stringify(current.name)} → ${JSON.stringify(next.name)}`,
  );
  must(
    sameSet(
      asStringArray(current.redirect_uris, 'current.redirect_uris'),
      asStringArray(next.redirect_uris, 'next.redirect_uris'),
    ),
    'second upload changed the redirect URLs',
  );
  return `no-op upload pushed only a version change (${JSON.stringify(current.version)} → ${JSON.stringify(next.version)})`;
}

// Verifies the effect of the upload step, so it shares its gates.
async function stepVerifyRename(state: State): Promise<string> {
  requireCommand(state, 'upload');
  const app = requireApp(state.mainApp, 'private');
  requireProjectDir(app);
  const expected = renamedName(app);

  // Confirm the rename persisted server-side. The list endpoint is eventually
  // consistent (see findAppInList), so poll with backoff before declaring miss.
  const renameBackoff = [500, 1000, 2000, 4000];
  for (let i = 0; i < renameBackoff.length; i++) {
    const r = execOrThrow('brevo', ['app', 'list', '--json'], state);
    if (findAppByName(parseJson(r.stdout), expected) === app.appId) {
      return `rename visible in list as "${expected}"`;
    }
    if (i < renameBackoff.length - 1) await sleep(renameBackoff[i] ?? 4000);
  }
  throw new Error(
    `renamed app ${app.appId} (${expected}) not present in list after upload (after retries)`,
  );
}

const OAUTH_FEATURE_FILES = [
  join('src', 'oauth', 'server.js'),
  join('src', 'oauth', 'handler.js'),
  join('src', 'oauth', 'package.json'),
];

// `brevo app scaffold` adds a feature to the project in the cwd — it has no
// --app-id flag (it reads app-config.json), so it must run inside the directory
// `brevo app create` produced.
function stepScaffold(state: State): string {
  const app = requireApp(state.mainApp, 'private');
  const projectDir = requireProjectDir(app);
  const result = execOrThrow('brevo', ['app', 'scaffold', '--json'], state, {
    cwd: projectDir,
  });
  const parsed = parseJson<Record<string, unknown>>(result.stdout);

  // --json can't answer the "refresh local config?" prompt, so it cancels and
  // reports the drift instead. Right after an upload there should be none —
  // if there is, that's a real local-vs-server bug, so surface the diffs.
  must(
    parsed.cancelled !== true,
    `scaffold cancelled: ${JSON.stringify(parsed.diffs ?? parsed.reason ?? {})}`,
  );
  must(
    typeof parsed.scaffolded === 'number' && parsed.scaffolded > 0,
    `scaffold wrote no files: ${JSON.stringify(parsed)}`,
  );
  const missing = OAUTH_FEATURE_FILES.filter((f) => !existsSync(join(projectDir, f)));
  must(missing.length === 0, `scaffold did not write ${missing.join(', ')}`);
  return `oauth feature scaffolded into ${projectDir} (${String(parsed.scaffolded)} files)`;
}

async function stepStartBriefly(state: State): Promise<string> {
  const app = requireApp(state.mainApp, 'private');
  const dir = requireProjectDir(app);
  await assertPortFree(state.opts.port);

  // The scaffold puts the feature's package.json inside src/oauth/ (see
  // src/templates/index.ts) and there is no root package.json. `brevo app start
  // oauth` rejects with "Dependencies not installed" unless src/oauth/node_modules
  // exists, so install there — and only there.
  const featureDir = join(dir, 'src', 'oauth');
  must(existsSync(join(featureDir, 'package.json')), `no package.json in ${featureDir}`);
  execOrThrow('yarn', ['install'], state, { cwd: featureDir });

  const child = spawn('brevo', ['app', 'start', 'oauth', '--port', String(state.opts.port)], {
    cwd: dir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  state.startChild = child;
  let lastOutput = '';
  let earlyExit: number | null = null;
  child.stdout?.on('data', (d) => {
    lastOutput += d.toString();
    logToFile(state, '[start] ' + d.toString().trimEnd());
  });
  child.stderr?.on('data', (d) => {
    lastOutput += d.toString();
    logToFile(state, '[start-err] ' + d.toString().trimEnd());
  });
  child.on('exit', (code) => {
    earlyExit = code;
  });

  // Poll for the server, but bail out early if the child has already exited
  // (e.g. missing app-config.json, port conflict surfaced inside the child).
  const timeoutMs = state.opts.ci ? 5000 : 10000;
  const deadline = Date.now() + timeoutMs;
  let ok = false;
  while (Date.now() < deadline) {
    if (earlyExit !== null) break;
    if (await probeHttp(state.opts.port)) {
      ok = true;
      break;
    }
    await sleep(250);
  }
  if (earlyExit === null) child.kill('SIGTERM');
  await waitForExit(child, 3000);
  state.startChild = null;

  if (!ok) {
    const tail = lastOutput.trim().split('\n').slice(-3).join(' | ');
    const cause =
      earlyExit === null
        ? `server did not respond on port ${state.opts.port} within ${timeoutMs}ms`
        : `child exited ${earlyExit} before serving: ${tail}`;
    throw new Error(cause);
  }
  return `server booted on port ${state.opts.port}`;
}

// Client-side guardrails: every probe here fails before any API call, so these
// assertions are exact — the mapped message from src/lang/en.ts and the exit
// code from src/lib/exit-codes.ts, with no backend involvement.
function stepNegativeClientGuardrails(state: State): string {
  const workRoot = ensureWorkRoot(state);
  const details: string[] = [];

  details.push(
    assertMappedFailure(
      exec(
        'brevo',
        ['app', 'create', '--name', 'brevo-cli-smoke-invalid', '--distribution', 'bogus', '--json'],
        state,
        { cwd: workRoot },
      ),
      {
        what: 'create --distribution bogus',
        patterns: [/Invalid --distribution "bogus"\. Must be one of: private, public\./],
        exitCodes: [1],
      },
    ),
  );

  if (state.caps?.upload !== false) {
    details.push(
      assertMappedFailure(exec('brevo', ['app', 'upload', '--json'], state, { cwd: workRoot }), {
        what: 'upload with no app-config.json',
        patterns: [/No app-config\.json found in this directory/],
        exitCodes: [1],
      }),
    );
  }

  if (state.caps?.submit !== false) {
    details.push(
      assertMappedFailure(exec('brevo', ['app', 'submit', '--json'], state, { cwd: workRoot }), {
        what: 'submit with no resolvable app',
        patterns: [/Cannot determine which app to submit/],
        exitCodes: [1],
      }),
    );
  }

  return details.join('; ');
}

// Only public apps are eligible for review (BEX-254 mapping). The private app
// from the earlier steps is the natural subject, and this runs from the work
// root so submit can't pick the app up from an app-config.json.
function stepNegativeSubmitPrivate(state: State): string {
  requireCommand(state, 'submit');
  const app = requireApp(state.mainApp, 'private');
  const r = exec('brevo', ['app', 'submit', '--app-id', app.appId, '--json'], state, {
    cwd: ensureWorkRoot(state),
  });
  return assertMappedFailure(r, {
    what: 'submit a private app',
    patterns: [
      // What the CLI would say if it got as far as its own check.
      /is private\. Private apps cannot be submitted for review/,
      // What actually happens today (verified against the live API): submit
      // preflights the review state before checking distribution_type (see
      // checkAppStatus in submit.ts), and the server refuses that read for a
      // private app — so the CLI surfaces the server's shorter string and its
      // own APP_SUBMIT_NOT_PUBLIC copy is never reached. Accepted here rather
      // than failed, because the refusal itself is correct; the message
      // ordering is a CLI issue tracked in TODO.md.
      /not supported for private apps/,
      // A backend with no submission record at all answers 404 on that read,
      // which maps to the not-found message and exit 5.
      /not found\./,
    ],
    exitCodes: [1, 5],
  });
}

// Unknown app IDs must map to the friendly not-found message, not a raw HTTP
// error. Uses a random UUID that cannot exist on the account.
function stepNegativeUnknownApp(state: State): string {
  const fakeId = randomUUID();
  const details: string[] = [];
  const expectation = (what: string): FailureExpectation => ({
    what,
    patterns: [/not found\./i, /don't have access|access denied|not authorized/i],
    // 404 → NOT_FOUND (5). A backend that answers 403 for someone else's app
    // maps to ERROR (1) — see statusToExitCode in src/lib/errors.ts.
    exitCodes: [1, 5],
  });

  if (state.caps?.status !== false) {
    details.push(
      assertMappedFailure(
        exec('brevo', ['app', 'status', '--app-id', fakeId, '--json'], state),
        expectation('status on an unknown app'),
      ),
    );
  }
  if (state.caps?.withdraw !== false) {
    details.push(
      assertMappedFailure(
        exec('brevo', ['app', 'withdraw', '--app-id', fakeId, '--force', '--json'], state),
        expectation('withdraw on an unknown app'),
      ),
    );
  }
  if (details.length === 0) skip('neither app status nor app withdraw is available in this build');
  return details.join('; ');
}

async function deleteSmokeApp(state: State, app: SmokeApp): Promise<string> {
  execOrThrow('brevo', ['app', 'delete', '--app-id', app.appId, '--force', '--json'], state);

  // List lags delete too — retry until the app is gone.
  must(
    await findAppInList(state, app.appId, false),
    `app ${app.appId} still present after delete (after retries)`,
  );
  return `app ${app.appId} deleted`;
}

async function stepDeleteMainApp(state: State): Promise<string> {
  const app = requireApp(state.mainApp, 'private');
  const detail = await deleteSmokeApp(state, app);
  state.mainApp = null;
  return detail;
}

// ──────────────────────────── public-app lifecycle ────────────────────────────

// Every state src/lang/en.ts (APP_STATUS_MESSAGE) has canned copy for, plus the
// 'unknown' sentinel status.ts normalises an empty state to. An unrecognised
// value means the server grew a state the CLI doesn't describe yet.
const KNOWN_REVIEW_STATES = [
  'unknown',
  'configured',
  'submitted',
  'in_review',
  'approved',
  'rejected',
  'changes_requested',
];

const SUBMITTED_STATES = ['submitted', 'in_review'];

const SMOKE_LOGO_URI = 'https://example.com/logo.png';

async function stepPublicAppCreate(state: State): Promise<string> {
  // --distribution public is accepted since BEX-327; the old negative step that
  // asserted the CLI rejected it has been removed. --logo-uri exercises the
  // optional create field from BEX-255 in the same call.
  const app = await createSmokeApp(state, {
    label: 'public',
    distribution: 'public',
    logoUri: SMOKE_LOGO_URI,
  });
  return `public app ${app.appId} created in ${app.projectDir}, listed`;
}

function stepPublicAppUpload(state: State): string {
  requireCommand(state, 'upload');
  const app = requireApp(state.publicApp, 'public');
  const res = uploadApp(state, app);
  const next = (res.next ?? {}) as Record<string, unknown>;
  must(
    next.distribution_type === 'public',
    `upload next.distribution_type ${JSON.stringify(next.distribution_type)} != public`,
  );
  return `public app uploaded, version ${optStr(res.version)}`;
}

// Read the review state through `brevo app status --json`. The state itself is
// the backend's to decide, so it's recorded, not dictated — what's asserted is
// that the CLI returns a state it has copy for, with a message.
function readReviewState(state: State, app: SmokeApp): string {
  const r = execOrThrow('brevo', ['app', 'status', '--app-id', app.appId, '--json'], state);
  const parsed = parseJson<Record<string, unknown>>(r.stdout);
  const reviewState = parsed.state;
  must(
    typeof reviewState === 'string' && reviewState.length > 0,
    `status --json has no state: ${JSON.stringify(parsed)}`,
  );
  must(
    typeof parsed.message === 'string' && parsed.message.length > 0,
    `status --json has no message: ${JSON.stringify(parsed)}`,
  );
  must(
    KNOWN_REVIEW_STATES.includes(reviewState as string),
    `status returned state "${String(reviewState)}", which the CLI has no copy for (known: ${KNOWN_REVIEW_STATES.join(', ')})`,
  );
  return reviewState as string;
}

function stepPublicAppStatus(state: State): string {
  requireCommand(state, 'status');
  const app = requireApp(state.publicApp, 'public');
  const reviewState = readReviewState(state, app);
  state.publicObs.stateBeforeSubmit = reviewState;
  return `pre-submit state: ${reviewState}`;
}

// `brevo app submit` does not itself transition the app — it validates the app
// (public, in sync with app-config.json) and hands back the review form URL;
// the state only moves once the form is submitted. So this asserts everything
// the CLI owns and records the URL.
function stepPublicAppSubmit(state: State): string {
  requireCommand(state, 'submit');
  const app = requireApp(state.publicApp, 'public');
  // Run from the project dir so the local-vs-server drift check is exercised;
  // straight after an upload it must come back clean. Without a project dir
  // (older build) submit still works from --app-id alone, minus the drift check.
  const r = exec('brevo', ['app', 'submit', '--app-id', app.appId, '--json'], state, {
    cwd: app.projectDir || ensureWorkRoot(state),
  });

  if (r.exitCode !== 0) {
    const text = `${r.stderr}\n${r.stdout}`;
    // No review form link on the app means the backend isn't serving one for
    // this account yet (pre-GA) — there's nothing for the CLI to do, so skip
    // loudly instead of reporting a CLI failure. Anything else, including a
    // config mismatch right after a clean upload, is a real failure.
    if (/Review submission is currently unavailable/.test(text)) {
      skip(`backend returned no review form link for app ${app.appId} (${firstLine(text)})`);
    }
    throw new Error(`submit failed with exit ${r.exitCode}: ${firstLine(text)}`);
  }

  const parsed = parseJson<Record<string, unknown>>(r.stdout);
  must(
    String(parsed.app_id) === app.appId,
    `submit returned app_id ${JSON.stringify(parsed.app_id)} != ${app.appId}`,
  );
  const formUrl = parsed.form_url;
  must(
    typeof formUrl === 'string' && /^https?:\/\//.test(formUrl),
    `submit returned no usable form_url: ${JSON.stringify(formUrl)}`,
  );
  state.publicObs.formUrl = formUrl as string;
  return `submit returned a review form URL for app ${app.appId}`;
}

// Submitting the same app twice. The CLI's submit is a form hand-off rather
// than a state transition, so a server-side "already submitted" rejection can't
// be produced from the CLI alone — what's asserted is that the second call is
// either idempotent (same form URL) or refused with the mapped
// already-under-review message, never an unmapped error.
function stepPublicAppSubmitAgain(state: State): string {
  requireCommand(state, 'submit');
  const app = requireApp(state.publicApp, 'public');
  if (!state.publicObs.formUrl) skip('first submit did not run, nothing to repeat');

  const r = exec('brevo', ['app', 'submit', '--app-id', app.appId, '--json'], state, {
    cwd: app.projectDir || ensureWorkRoot(state),
  });
  if (r.exitCode === 0) {
    const parsed = parseJson<Record<string, unknown>>(r.stdout);
    must(
      parsed.form_url === state.publicObs.formUrl,
      `repeat submit returned a different form_url than the first call`,
    );
    return 'repeat submit is idempotent (same form URL, exit 0)';
  }
  return assertMappedFailure(r, {
    what: 'repeat submit',
    patterns: [/Review submission is currently unavailable/],
    exitCodes: [1],
  });
}

function stepPublicAppStatusAfterSubmit(state: State): string {
  requireCommand(state, 'status');
  const app = requireApp(state.publicApp, 'public');
  const reviewState = readReviewState(state, app);
  state.publicObs.stateAfterSubmit = reviewState;
  const before = state.publicObs.stateBeforeSubmit;
  // A transition only happens if the backend moves the app when the review form
  // link is issued — it usually waits for the form itself, so report either way.
  const moved = before && before !== reviewState ? ` (was ${before})` : ' (unchanged)';
  return `post-submit state: ${reviewState}${moved}`;
}

// `brevo app withdraw` has two documented success shapes (src/commands/app/withdraw.ts):
// an actual withdrawal, or the mapped HTTP 422 "not submitted yet" report which
// is informational and deliberately exits 0. Assert whichever applies, then
// re-read the state.
function stepPublicAppWithdraw(state: State): string {
  requireCommand(state, 'withdraw');
  const app = requireApp(state.publicApp, 'public');
  const r = exec('brevo', ['app', 'withdraw', '--app-id', app.appId, '--force', '--json'], state);
  must(
    r.exitCode === 0,
    `withdraw exited ${r.exitCode} (both documented outcomes exit 0): ${firstLine(`${r.stderr}\n${r.stdout}`)}`,
  );
  const parsed = parseJson<Record<string, unknown>>(r.stdout);
  must(
    String(parsed.appId) === app.appId,
    `withdraw returned appId ${JSON.stringify(parsed.appId)} != ${app.appId}`,
  );

  if (parsed.withdrawn === true) {
    state.publicObs.withdrawn = true;
    return `app ${app.appId} withdrawn`;
  }

  must(
    parsed.withdrawn === false,
    `withdraw --json has no boolean "withdrawn": ${JSON.stringify(parsed)}`,
  );
  must(
    parsed.reason === 'NOT_SUBMITTED',
    `withdraw reported withdrawn:false with reason ${JSON.stringify(parsed.reason)}, expected NOT_SUBMITTED`,
  );
  must(
    typeof parsed.message === 'string' && /has not been submitted yet/.test(parsed.message),
    `withdraw NOT_SUBMITTED message is not the mapped one: ${JSON.stringify(parsed.message)}`,
  );
  must(
    typeof parsed.submitCommand === 'string' && parsed.submitCommand.includes('brevo app submit'),
    `withdraw NOT_SUBMITTED did not include the submit hint: ${JSON.stringify(parsed.submitCommand)}`,
  );
  state.publicObs.withdrawn = false;
  state.publicObs.withdrawReason = 'NOT_SUBMITTED';
  return `not-submitted app mapped to NOT_SUBMITTED (exit 0, by design)`;
}

function stepPublicAppStatusAfterWithdraw(state: State): string {
  requireCommand(state, 'status');
  const app = requireApp(state.publicApp, 'public');
  const reviewState = readReviewState(state, app);
  state.publicObs.stateAfterWithdraw = reviewState;
  // Only a real withdrawal implies a state change; a NOT_SUBMITTED no-op must
  // leave the app exactly where it was.
  if (state.publicObs.withdrawn === true) {
    must(
      !SUBMITTED_STATES.includes(reviewState),
      `app is still "${reviewState}" after a successful withdraw`,
    );
  } else if (state.publicObs.stateAfterSubmit) {
    must(
      reviewState === state.publicObs.stateAfterSubmit,
      `no-op withdraw changed the state: ${state.publicObs.stateAfterSubmit} → ${reviewState}`,
    );
  }
  return `post-withdraw state: ${reviewState}`;
}

async function stepDeletePublicApp(state: State): Promise<string> {
  const app = requireApp(state.publicApp, 'public');
  const detail = await deleteSmokeApp(state, app);
  state.publicApp = null;
  return detail;
}

// ──────────────────────────── init wizard ────────────────────────────

// Secondary appId recovery: if our unique name made it through, the app is
// identifiable even without parsing wizard output. Retry to absorb
// list-endpoint propagation lag.
async function findInitAppByName(state: State, expectedName: string): Promise<string | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const after = execOrThrow('brevo', ['app', 'list', '--json'], state);
    const found = findAppByName(parseJson(after.stdout), expectedName);
    if (found) return found;
    if (attempt < 3) await sleep([500, 1000, 2000][attempt] ?? 2000);
  }
  return null;
}

// Tertiary appId recovery: read app-config.json (only present if user
// scaffolded in wizard, which our scripted answers explicitly decline — but
// keep as a safety net in case the wizard flow changes).
function readInitAppIdFromConfig(state: State, tmp: string): string | null {
  const cfgPath = join(tmp, 'app-config.json');
  if (!existsSync(cfgPath)) return null;
  try {
    const cfg = readJsonFile(cfgPath);
    if (cfg.appId) return String(cfg.appId);
  } catch (e) {
    logToFile(state, `app-config.json parse failed: ${errMsg(e)}`);
  }
  return null;
}

async function stepInitWizard(state: State): Promise<string> {
  const tmp = trackTmpDir(state, 'brevo-smoke-init-');

  // Wizard prompts (must stay in sync with `brevo app init` flow):
  //   1. App name          → unique, readable, traceable name
  //   2. Distribution type → '' = accept default (Private)
  //   3. OAuth callback    → '' = accept default
  //   4. Add another?      → n
  //   5. Generate starter? → n (scaffold has its own step)
  const expectedName = stampedName(state, 'init');
  const answers = [expectedName, '', '', 'n', 'n'];

  // Paced writes: spawnSync(input:) closes stdin immediately on EOF and
  // inquirer reads ahead of its prompts before then, defaulting prompts that
  // had no answer yet. Use execScriptedStdin which writes lines one at a time
  // with a short delay so inquirer reads each answer as its prompt renders.
  const r = await execScriptedStdin('brevo', ['app', 'init'], state, {
    cwd: tmp,
    answers,
    interLineDelayMs: 400,
  });
  if (r.exitCode !== 0) throw new Error(`brevo app init exited ${r.exitCode}`);
  const output = r.stdout;

  // Primary: parse "App ID: <uuid>" from wizard output. UUID format only — the
  // wizard prints other ids (Client ID is 32 hex) which we explicitly don't match.
  const uuidPattern = /App ID:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
  let appId: string | null = uuidPattern.exec(output)?.[1] ?? null;

  if (!appId) appId = await findInitAppByName(state, expectedName);
  if (!appId) appId = readInitAppIdFromConfig(state, tmp);

  // NO list-diff fallback. A blind "delete the first new app" path could
  // remove an app a human (or another process) just created on the same
  // account. If we can't identify our app by parsing wizard output, by our
  // exact unique name, or via app-config.json, we refuse to guess — the
  // orphan warning prints the suggested cleanup commands and the step fails.
  if (!appId) {
    printOrphanWarning(state, [], expectedName);
    throw new Error(
      `could not identify init-created app (expected name "${expectedName}"); refusing to guess. See orphan warning above for manual cleanup.`,
    );
  }

  state.initAppId = appId;
  return `init created app ${appId} in ${tmp}`;
}

function printOrphanWarning(state: State, suspectIds: string[], expectedName?: string): void {
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
    const r = execOrThrow('brevo', ['app', 'list', '--json'], state);
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

function stepDeleteInitApp(state: State): string {
  if (!state.initAppId) throw new Error('no initAppId to delete');
  const id = state.initAppId;
  execOrThrow('brevo', ['app', 'delete', '--app-id', id, '--force', '--json'], state);
  state.initAppId = null;
  return `app ${id} deleted`;
}

// ──────────────────────────── teardown ────────────────────────────

function stepLogout(state: State): string {
  execOrThrow('brevo', ['logout', '--force', '--json'], state);
  // whoami may exit non-zero when unauthenticated; accept either as "logged out"
  const r = exec('brevo', ['whoami', '--json'], state);
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

function killStartChild(state: State): void {
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

function removeTmpDirs(state: State, logFailures: boolean): void {
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

function stepFinalCleanup(state: State): string {
  if (state.linked) {
    if (state.opts.against === 'local') exec('yarn', ['unlink'], state);
    else exec('npm', ['uninstall', '-g', '@getbrevo/cli'], state);
    state.linked = false;
  }
  removeTmpDirs(state, true);
  killStartChild(state);
  return 'cleanup done';
}

// ──────────────────────────── trap cleanup ────────────────────────────

function trapDeleteApps(state: State): void {
  for (const appId of [state.mainApp?.appId, state.publicApp?.appId, state.initAppId]) {
    if (!appId) continue;
    try {
      spawnSync('brevo', ['app', 'delete', '--app-id', appId, '--force', '--json'], {
        timeout: 30_000,
      });
      logToFile(state, `trap: deleted app ${appId}`);
    } catch (e) {
      logToFile(state, `trap: failed to delete app ${appId}: ${errMsg(e)}`);
    }
  }
  state.mainApp = null;
  state.publicApp = null;
  state.initAppId = null;
}

function trapUninstallCli(state: State): void {
  if (!state.linked) return;
  try {
    if (state.opts.against === 'local') spawnSync('yarn', ['unlink'], { timeout: 30_000 });
    else spawnSync('npm', ['uninstall', '-g', '@getbrevo/cli'], { timeout: 30_000 });
  } catch {
    // ignore
  }
  state.linked = false;
}

// Best-effort: synchronous-ish, no throws. Runs on SIGINT/SIGTERM/uncaughtException
// and as a final safety net after the run loop. Designed to be idempotent.
function bestEffortCleanup(state: State): void {
  killStartChild(state);
  trapDeleteApps(state);
  removeTmpDirs(state, false);
  trapUninstallCli(state);
}

// ──────────────────────────── report ────────────────────────────

function writeReport(state: State, ok: boolean): void {
  if (!state.opts.reportPath) return;
  const report = {
    ok,
    against: state.opts.against,
    ci: state.opts.ci,
    logFile: state.logFile,
    capabilities: state.caps,
    publicFlow: state.opts.withPublic ? state.publicObs : 'skipped (--skip-public)',
    steps: state.stepResults,
  };
  // Step details/errors quote CLI output, and the report is a CI artefact — run
  // it through the same redaction the log file gets.
  writeFileSync(state.opts.reportPath, redact(JSON.stringify(report, null, 2)));
}

// ──────────────────────────── main ────────────────────────────

function installCleanupTraps(state: State): void {
  let trapped = false;
  const onSignal = (code: number) => {
    if (!trapped) {
      trapped = true;
      bestEffortCleanup(state);
    }
    process.exit(code);
  };
  process.on('SIGINT', () => onSignal(130));
  process.on('SIGTERM', () => onSignal(143));
  process.on('uncaughtException', (err) => {
    logToFile(state, `uncaught: ${err.stack || err.message}`);
    if (!trapped) {
      trapped = true;
      bestEffortCleanup(state);
    }
    process.exit(1);
  });
}

// If --port wasn't explicit, find a free port near the default rather than
// failing later with "port already in use".
async function resolvePort(opts: Options): Promise<void> {
  if (opts.portExplicit) return;
  try {
    const free = await pickFreePort(opts.port);
    if (free !== opts.port) {
      process.stdout.write(
        `${COLOR.dim}port ${opts.port} busy; using ${free} instead${COLOR.reset}\n`,
      );
    }
    opts.port = free;
  } catch (e) {
    process.stderr.write(
      `${COLOR.red}could not find a free port near ${opts.port}: ${errMsg(e)}${COLOR.reset}\n`,
    );
    process.exit(1);
  }
}

function buildSteps(opts: Options): Array<[string, StepFn]> {
  const publicSteps: Array<[string, StepFn]> = [
    ['Public app create', stepPublicAppCreate],
    ['Public app upload', stepPublicAppUpload],
    ['Public app status', stepPublicAppStatus],
    ['Public app submit', stepPublicAppSubmit],
    ['Public app submit (repeat)', stepPublicAppSubmitAgain],
    ['Public app status after submit', stepPublicAppStatusAfterSubmit],
    ['Public app withdraw', stepPublicAppWithdraw],
    ['Public app status after withdraw', stepPublicAppStatusAfterWithdraw],
    ['Negative: unknown app id', stepNegativeUnknownApp],
    ['Delete public test app', stepDeletePublicApp],
  ];
  return [
    ['Pre-flight', stepPreflight],
    ['Reinstall local', stepReinstall],
    ['Auth lifecycle', stepAuth],
    ['App create', stepAppCreate],
    ['App credentials', stepAppCredentials],
    ['App upload', stepAppUpload],
    ['App upload (no-op)', stepAppUploadNoop],
    ['Verify rename', stepVerifyRename],
    ['Scaffold', stepScaffold],
    ['Start briefly', stepStartBriefly],
    ['Negative: client guardrails', stepNegativeClientGuardrails],
    ['Negative: submit a private app', stepNegativeSubmitPrivate],
    ['Delete main test app', stepDeleteMainApp],
    ...(opts.withPublic ? publicSteps : []),
    ...(opts.withInit
      ? ([
          ['brevo app init wizard', stepInitWizard],
          ['Delete init-created app', stepDeleteInitApp],
        ] as Array<[string, StepFn]>)
      : []),
    ['Logout', stepLogout],
    ['Final cleanup', stepFinalCleanup],
  ];
}

async function runSteps(
  steps: Array<[string, StepFn]>,
  state: State,
): Promise<{ allOk: boolean; firstFailed: number }> {
  let allOk = true;
  let firstFailed = -1;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step) continue;
    const [name, fn] = step;
    const ok = await runStep(i + 1, name, fn, state);
    if (!ok) {
      allOk = false;
      if (firstFailed < 0) firstFailed = i + 1;
    }
  }
  return { allOk, firstFailed };
}

function hasLeftoverState(state: State): boolean {
  return Boolean(
    state.mainApp ||
    state.publicApp ||
    state.initAppId ||
    state.tmpDirs.length > 0 ||
    state.linked ||
    state.startChild,
  );
}

async function main(): Promise<void> {
  let opts: Options;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`${errMsg(e)}\n\n`);
    printHelp();
    process.exit(2);
  }

  const logFile = join(tmpdir(), `brevo-smoke-${Date.now()}.log`);
  const logFd = openSync(logFile, 'a');
  const state: State = {
    opts,
    logFile,
    logFd,
    workRoot: null,
    tmpDirs: [],
    mainApp: null,
    publicApp: null,
    initAppId: null,
    linked: false,
    caps: null,
    startChild: null,
    stepResults: [],
    publicObs: {},
  };

  installCleanupTraps(state);

  process.stdout.write(`Brevo smoke test — log: ${logFile}\n`);

  await resolvePort(opts);

  const { allOk, firstFailed } = await runSteps(buildSteps(opts), state);

  // Safety net: if any step left state behind (failed midway), clean it up here too.
  if (hasLeftoverState(state)) {
    bestEffortCleanup(state);
  }

  printColouredSummary(state, allOk, firstFailed);
  writeReport(state, allOk);
  closeSync(logFd);

  process.exit(allOk ? 0 : 1);
}

function printColouredSummary(state: State, allOk: boolean, firstFailed: number): void {
  const width = 60;
  const rule = '═'.repeat(width);
  const thin = '─'.repeat(width);
  const skipped = state.stepResults.filter((s) => s.skipped).length;
  const passed = state.stepResults.filter((s) => s.ok && !s.skipped).length;
  const failed = state.stepResults.filter((s) => !s.ok).length;
  const headerColor = allOk ? COLOR.green : COLOR.red;
  const title = allOk ? '  SMOKE TEST PASSED' : '  SMOKE TEST FAILED';

  process.stdout.write(`\n${headerColor}${rule}${COLOR.reset}\n`);
  process.stdout.write(`${headerColor}${COLOR.bold}${title.padEnd(width)}${COLOR.reset}\n`);
  process.stdout.write(`${headerColor}${rule}${COLOR.reset}\n`);

  state.stepResults.forEach((r, i) => {
    const n = String(i + 1).padStart(2, ' ');
    const name = r.name.padEnd(32, ' ');
    let status: string;
    if (r.skipped) status = `${COLOR.yellow}⊘ SKIP${COLOR.reset}`;
    else if (r.ok) status = `${COLOR.green}✓ PASS${COLOR.reset}`;
    else status = `${COLOR.red}✗ FAIL${COLOR.reset}`;
    const ms = `${COLOR.dim}(${formatMs(r.durationMs)})${COLOR.reset}`;
    let detail = '';
    if (!r.ok) detail = ` ${COLOR.red}— ${r.error?.slice(0, 80) ?? ''}${COLOR.reset}`;
    else if (r.skipped) detail = ` ${COLOR.yellow}— ${r.detail?.slice(0, 80) ?? ''}${COLOR.reset}`;
    process.stdout.write(`  ${n}. ${name} ${status}  ${ms}${detail}\n`);
  });

  process.stdout.write(`${COLOR.dim}${thin}${COLOR.reset}\n`);
  const failedPart = failed > 0 ? `, ${COLOR.red}${failed} failed${COLOR.reset}` : '';
  const skippedPart = skipped > 0 ? `, ${COLOR.yellow}${skipped} skipped${COLOR.reset}` : '';
  const firstFailedPart = allOk
    ? ''
    : `  ${COLOR.dim}(first failure: step ${firstFailed})${COLOR.reset}`;
  const counts = `  ${COLOR.green}${passed} passed${COLOR.reset}${failedPart}${skippedPart}${firstFailedPart}`;
  process.stdout.write(`${counts}\n`);
  process.stdout.write(`  ${COLOR.dim}Log: ${state.logFile}${COLOR.reset}\n`);
  if (state.opts.reportPath) {
    process.stdout.write(`  ${COLOR.dim}Report: ${state.opts.reportPath}${COLOR.reset}\n`);
  }
  process.stdout.write(`${headerColor}${rule}${COLOR.reset}\n`);
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
