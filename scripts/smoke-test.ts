#!/usr/bin/env node
/*
 * Smoke test for @getbrevo/cli.
 */

import { spawn, spawnSync, ChildProcess } from 'node:child_process';
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import * as http from 'node:http';
import * as net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
  };
  for (const arg of argv) {
    if (arg === '--skip-auth') opts.skipAuth = true;
    else if (arg === '--verbose') opts.verbose = true;
    else if (arg === '--with-init') opts.withInit = true;
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
  -h, --help                   Show this help.
`);
}

// ──────────────────────────── state ────────────────────────────

interface StepResult {
  name: string;
  ok: boolean;
  durationMs: number;
  error?: string;
}

interface State {
  opts: Options;
  logFile: string;
  logFd: number;
  mainAppId: string | null;
  initAppId: string | null;
  mainTmpDir: string | null;
  mainScaffoldDir: string | null;
  initTmpDir: string | null;
  linked: boolean;
  startChild: ChildProcess | null;
  stepResults: StepResult[];
}

// ──────────────────────────── logging ────────────────────────────

// Strip values that look like Brevo secrets before any line hits the log file,
// since this log is what gets uploaded as a CI artefact in Phase 2.
function redact(s: string): string {
  return s
    .replaceAll(/xkeysib-[A-Za-z0-9_-]+/g, 'xkeysib-***REDACTED***')
    .replaceAll(/"clientSecret"\s*:\s*"[^"]+"/g, '"clientSecret":"***REDACTED***"')
    .replaceAll(/"client_secret"\s*:\s*"[^"]+"/g, '"client_secret":"***REDACTED***"');
}

function logToFile(state: State, line: string): void {
  appendFileSync(state.logFd, `${new Date().toISOString()} ${redact(line)}\n`);
}

function announce(state: State, n: number, title: string): void {
  const line = `\n▶ Step ${n}: ${title}`;
  process.stdout.write(line + '\n');
  logToFile(state, line);
}

function stepDone(state: State, ok: boolean, detail: string, ms: number): void {
  const icon = ok ? '✓' : '✗';
  const line = `  ${icon} ${detail} — ${ok ? 'ok' : 'FAILED'} (${formatMs(ms)})`;
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

// The /v3/oauth/apps list endpoint is eventually consistent with create/delete
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

function collectAppIds(listJson: unknown): Set<string> {
  const items = Array.isArray(listJson)
    ? listJson
    : ((listJson as { apps?: unknown[]; data?: unknown[] })?.apps ??
      (listJson as { data?: unknown[] })?.data ??
      []);
  const ids = new Set<string>();
  for (const item of items as Array<Record<string, unknown>>) {
    // `brevo app list --json` returns `app_id` (snake_case, per src/types.ts).
    // `brevo app create --json` returns `appId` (camelCase). Some endpoints use
    // plain `id`. We accept all three so comparisons work across boundaries.
    const id = item.app_id ?? item.appId ?? item.id;
    if (typeof id === 'string' || typeof id === 'number') ids.add(String(id));
  }
  return ids;
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
    state.stepResults.push({ name, ok: true, durationMs: ms });
    stepDone(state, true, detail, ms);
    return true;
  } catch (err) {
    const ms = Date.now() - t0;
    const message = err instanceof Error ? err.message : String(err);
    state.stepResults.push({ name, ok: false, durationMs: ms, error: message });
    stepDone(state, false, (message.split('\n')[0] ?? message).slice(0, 200), ms);
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
  return `brevo ${version} at ${which}`;
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
    // in stepAppLifecycle, so that prompt is never useful here.
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

// State threaded between the four app-lifecycle steps. mainAppId lives on
// State (used by later steps too); the rest is step-to-step plumbing.
interface AppContext {
  name: string;
  redirectUri: string;
  renamedTo: string;
  extraRedirectUri: string;
}

let appCtx: AppContext | null = null;

async function stepAppCreate(state: State): Promise<string> {
  // Readable, traceable name. Concurrent CI runs are namespaced by GH run id.
  const stamp = state.opts.ci
    ? `${process.env.GITHUB_RUN_ID || Date.now()}-${process.env.GITHUB_RUN_ATTEMPT || '1'}`
    : String(Date.now());
  const name = `brevo-cli-smoke-test-${stamp}`;
  const redirectUri = `http://localhost:${state.opts.port}/auth/callback`;
  appCtx = {
    name,
    redirectUri,
    renamedTo: `${name}-renamed`,
    extraRedirectUri: 'https://example.com/cb',
  };

  const create = execOrThrow(
    'brevo',
    [
      'app',
      'create',
      '--name',
      name,
      '--distribution',
      'private',
      '--redirect-uri',
      redirectUri,
      '--json',
    ],
    state,
  );
  const created = parseJson<Record<string, unknown>>(create.stdout);
  const rawAppId = created.id ?? created.appId;
  const appId =
    typeof rawAppId === 'string' || typeof rawAppId === 'number' ? String(rawAppId) : '';
  if (!appId) throw new Error(`no app id in create output: ${create.stdout.slice(0, 200)}`);
  state.mainAppId = appId;

  // List endpoint lags create — retry with backoff before declaring missing.
  if (!(await findAppInList(state, appId, true))) {
    throw new Error(`app ${appId} not present in list after create (after retries)`);
  }

  return `app ${appId} created + listed`;
}

function stepAppCredentials(state: State): string {
  if (!state.mainAppId) throw new Error('no mainAppId from create step');
  const creds = execOrThrow(
    'brevo',
    ['app', 'credentials', '--app-id', state.mainAppId, '--reveal-secret', '--json'],
    state,
  );
  const credObj = parseJson<Record<string, unknown>>(creds.stdout);
  if (!credObj.clientId || !credObj.clientSecret) {
    throw new Error('credentials response missing clientId or clientSecret');
  }
  return `clientId + clientSecret returned`;
}

function stepAppUpdate(state: State): string {
  if (!state.mainAppId) throw new Error('no mainAppId from create step');
  if (!appCtx) throw new Error('no appCtx from create step');
  const appId = state.mainAppId;
  const { redirectUri, renamedTo, extraRedirectUri } = appCtx;

  const updated = execOrThrow(
    'brevo',
    [
      'app',
      'update',
      '--app-id',
      appId,
      '--name',
      renamedTo,
      '--redirect-uri',
      extraRedirectUri,
      '--yes',
      '--json',
    ],
    state,
  );
  const updatedJson = parseJson<Record<string, unknown>>(updated.stdout);

  const rawUpdatedId = updatedJson.app_id;
  const updatedId =
    typeof rawUpdatedId === 'string' || typeof rawUpdatedId === 'number'
      ? String(rawUpdatedId)
      : '';
  if (updatedId !== appId) {
    throw new Error(`update returned app_id ${JSON.stringify(rawUpdatedId)}, expected ${appId}`);
  }
  if (updatedJson.name !== renamedTo) {
    throw new Error(
      `update returned name ${JSON.stringify(updatedJson.name)}, expected ${renamedTo}`,
    );
  }
  const updatedUris = updatedJson.redirect_uris;
  if (!Array.isArray(updatedUris)) {
    throw new TypeError(`update redirect_uris is not an array: ${JSON.stringify(updatedUris)}`);
  }
  // --redirect-uri appends (see CLAUDE.md + src/commands/app/update.ts:186-194):
  // the create-time URI must survive, and the new one must be present.
  if (!updatedUris.includes(redirectUri)) {
    throw new Error(
      `update redirect_uris missing original ${redirectUri}: ${JSON.stringify(updatedUris)}`,
    );
  }
  if (!updatedUris.includes(extraRedirectUri)) {
    throw new Error(
      `update redirect_uris missing appended ${extraRedirectUri}: ${JSON.stringify(updatedUris)}`,
    );
  }

  return `renamed + redirect_uri appended (response validated)`;
}

async function stepVerifyRename(state: State): Promise<string> {
  if (!state.mainAppId) throw new Error('no mainAppId from create step');
  if (!appCtx) throw new Error('no appCtx from create step');
  const appId = state.mainAppId;
  const { renamedTo } = appCtx;

  // Confirm the rename persisted server-side. The list endpoint is eventually
  // consistent (see findAppInList), so poll with backoff before declaring miss.
  const renameBackoff = [500, 1000, 2000, 4000];
  for (let i = 0; i < renameBackoff.length; i++) {
    const r = execOrThrow('brevo', ['app', 'list', '--json'], state);
    if (findAppByName(parseJson(r.stdout), renamedTo) === appId) {
      return `rename visible in list as "${renamedTo}"`;
    }
    if (i < renameBackoff.length - 1) await sleep(renameBackoff[i] ?? 4000);
  }
  throw new Error(
    `renamed app ${appId} (${renamedTo}) not present in list after update (after retries)`,
  );
}

// Negative test: `brevo app create --distribution public` must be rejected by
// the CLI itself, *before* any API call is made (see src/commands/app/create.ts).
// A successful exit here would mean the CLI silently created a public app on
// the user's account — that's a real security regression, so we attempt to
// clean up if it ever happens.
function stepPublicAppRejected(state: State): string {
  const probeName = `brevo-cli-smoke-public-reject-${Date.now()}`;
  const result = exec(
    'brevo',
    [
      'app',
      'create',
      '--name',
      probeName,
      '--distribution',
      'public',
      '--redirect-uri',
      `http://localhost:${state.opts.port}/auth/callback`,
      '--json',
    ],
    state,
  );

  if (result.exitCode === 0) {
    // Unexpected success — the CLI may have just created a public app. Try
    // to identify and delete it so we don't leak.
    try {
      const obj = parseJson<Record<string, unknown>>(result.stdout);
      const rawId = obj.appId ?? obj.app_id ?? obj.id;
      const id = typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : '';
      if (id) {
        logToFile(state, `unexpected public-app creation: ${id} — attempting cleanup`);
        spawnSync('brevo', ['app', 'delete', '--app-id', id, '--force', '--json'], {
          timeout: 30_000,
        });
      }
    } catch {
      // ignore parse failures — error path is what matters
    }
    throw new Error(
      `brevo app create --distribution public was NOT rejected (exit 0); CLI may have created a public app`,
    );
  }

  // Confirm the rejection came from the expected guard. The message lives in
  // src/lang/en.ts (APP_CREATE_PUBLIC_UNAVAILABLE) and starts with "Public".
  const errText = (result.stderr + result.stdout).toLowerCase();
  if (!errText.includes('public')) {
    throw new Error(
      `public-app create was rejected, but error text did not mention "public": ${(result.stderr || result.stdout).slice(0, 200)}`,
    );
  }

  return `CLI rejected --distribution public (exit ${result.exitCode})`;
}

function stepScaffold(state: State): string {
  if (!state.mainAppId) throw new Error('no mainAppId from previous step');
  const tmp = mkdtempSync(join(tmpdir(), 'brevo-smoke-'));
  state.mainTmpDir = tmp;

  // `brevo app scaffold` prompts inquirer for output dir; feed "\n" so the
  // default (`./<slug>`) is accepted under piped stdin.
  const result = execOrThrow(
    'brevo',
    ['app', 'scaffold', '--app-id', state.mainAppId, '--json'],
    state,
    { cwd: tmp, input: '\n' },
  );

  // The --json output of scaffold includes the resolved target directory.
  const candidates = ['package.json', '.env.example', '.env', 'app-config.json', 'README.md'];
  const dirsToCheck: string[] = [];
  try {
    const parsed = parseJson<Record<string, unknown>>(result.stdout);
    if (typeof parsed.directory === 'string') dirsToCheck.push(parsed.directory);
  } catch {
    // fall through to subdir scan
  }
  dirsToCheck.push(tmp);

  for (const d of dirsToCheck) {
    const found = candidates.filter((f) => existsSync(join(d, f)));
    if (found.length > 0) {
      state.mainScaffoldDir = d;
      return `scaffolded into ${d} (${found.join(', ')})`;
    }
  }

  // Last resort: any subdir of tmp that contains a candidate file.
  try {
    const entries = readdirSync(tmp, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const sub = join(tmp, e.name);
      const found = candidates.filter((f) => existsSync(join(sub, f)));
      if (found.length > 0) {
        state.mainScaffoldDir = sub;
        return `scaffolded into ${sub} (${found.join(', ')})`;
      }
    }
  } catch {
    // ignore
  }
  throw new Error(`no expected scaffold files in ${tmp} or its subdirectories`);
}

async function stepStartBriefly(state: State): Promise<string> {
  // `brevo app start oauth` reads app-config.json from cwd, so we must run it
  // from inside the scaffolded subdirectory, not the parent tmp dir.
  const dir = state.mainScaffoldDir ?? state.mainTmpDir;
  if (!dir) throw new Error('no scaffold dir from previous step');
  await assertPortFree(state.opts.port);

  // The scaffold template puts a per-feature package.json inside src/oauth/
  // (see src/templates/index.ts). `brevo app start oauth` rejects with
  // "Dependencies not installed" unless node_modules exists there, so we run
  // yarn install in both the project root and the feature subdir.
  execOrThrow('yarn', ['install'], state, { cwd: dir });
  const featureDir = join(dir, 'src', 'oauth');
  if (existsSync(join(featureDir, 'package.json'))) {
    execOrThrow('yarn', ['install'], state, { cwd: featureDir });
  }

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

async function stepDeleteMainApp(state: State): Promise<string> {
  if (!state.mainAppId) throw new Error('no mainAppId to delete');
  const id = state.mainAppId;
  execOrThrow('brevo', ['app', 'delete', '--app-id', id, '--force', '--json'], state);

  // List lags delete too — retry until the app is gone.
  if (!(await findAppInList(state, id, false))) {
    throw new Error(`app ${id} still present after delete (after retries)`);
  }
  state.mainAppId = null;
  return `app ${id} deleted`;
}

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
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    if (cfg.appId) return String(cfg.appId);
  } catch (e) {
    logToFile(state, `app-config.json parse failed: ${errMsg(e)}`);
  }
  return null;
}

async function stepInitWizard(state: State): Promise<string> {
  const tmp = mkdtempSync(join(tmpdir(), 'brevo-smoke-init-'));
  state.initTmpDir = tmp;

  // Wizard prompts (must stay in sync with `brevo app init` flow):
  //   1. App name          → unique, readable, traceable name
  //   2. Distribution type → '' = accept default (Private)
  //   3. OAuth callback    → '' = accept default
  //   4. Add another?      → n
  //   5. Generate starter? → n (scaffold has its own step)
  const stamp = state.opts.ci
    ? `${process.env.GITHUB_RUN_ID || Date.now()}-${process.env.GITHUB_RUN_ATTEMPT || '1'}`
    : String(Date.now());
  const expectedName = `brevo-cli-smoke-init-${stamp}`;
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

function findAppByName(listJson: unknown, name: string): string | null {
  const items = Array.isArray(listJson)
    ? listJson
    : ((listJson as { apps?: unknown[]; data?: unknown[] })?.apps ??
      (listJson as { data?: unknown[] })?.data ??
      []);
  for (const item of items as Array<Record<string, unknown>>) {
    if (item.name === name) {
      const id = item.app_id ?? item.appId ?? item.id;
      if (typeof id === 'string' || typeof id === 'number') return String(id);
    }
  }
  return null;
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
    const apps = parseJson<unknown>(r.stdout);
    const items = Array.isArray(apps) ? apps : ((apps as { apps?: unknown[] }).apps ?? []);
    process.stdout.write(`${COLOR.yellow}Apps currently on the account:${COLOR.reset}\n`);
    for (const a of items as Array<Record<string, unknown>>) {
      const rawId = a.app_id ?? a.appId ?? a.id;
      const id = typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : '?';
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
  for (const dir of [state.mainTmpDir, state.initTmpDir]) {
    if (dir && existsSync(dir)) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch (e) {
        if (logFailures) {
          logToFile(state, `rm ${dir} failed: ${errMsg(e)}`);
        }
      }
    }
  }
  state.mainTmpDir = null;
  state.initTmpDir = null;
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
  for (const appId of [state.mainAppId, state.initAppId]) {
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
  state.mainAppId = null;
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
    steps: state.stepResults,
  };
  writeFileSync(state.opts.reportPath, JSON.stringify(report, null, 2));
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
  return [
    ['Pre-flight', stepPreflight],
    ['Reinstall local', stepReinstall],
    ['Auth lifecycle', stepAuth],
    ['App create', stepAppCreate],
    ['App credentials', stepAppCredentials],
    ['App update', stepAppUpdate],
    ['Verify rename', stepVerifyRename],
    ['Negative: public app rejected', stepPublicAppRejected],
    ['Scaffold', stepScaffold],
    ['Start briefly', stepStartBriefly],
    ['Delete main test app', stepDeleteMainApp],
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
    state.mainAppId ||
    state.initAppId ||
    state.mainTmpDir ||
    state.initTmpDir ||
    state.linked ||
    state.startChild,
  );
}

async function main(): Promise<void> {
  let opts: Options;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n\n`);
    printHelp();
    process.exit(2);
  }

  const logFile = join(tmpdir(), `brevo-smoke-${Date.now()}.log`);
  const logFd = openSync(logFile, 'a');
  const state: State = {
    opts,
    logFile,
    logFd,
    mainAppId: null,
    initAppId: null,
    mainTmpDir: null,
    mainScaffoldDir: null,
    initTmpDir: null,
    linked: false,
    startChild: null,
    stepResults: [],
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
  const passed = state.stepResults.filter((s) => s.ok).length;
  const failed = state.stepResults.length - passed;
  const headerColor = allOk ? COLOR.green : COLOR.red;
  const title = allOk ? '  SMOKE TEST PASSED' : '  SMOKE TEST FAILED';

  process.stdout.write(`\n${headerColor}${rule}${COLOR.reset}\n`);
  process.stdout.write(`${headerColor}${COLOR.bold}${title.padEnd(width)}${COLOR.reset}\n`);
  process.stdout.write(`${headerColor}${rule}${COLOR.reset}\n`);

  state.stepResults.forEach((r, i) => {
    const n = String(i + 1).padStart(2, ' ');
    const name = r.name.padEnd(28, ' ');
    const status = r.ok ? `${COLOR.green}✓ PASS${COLOR.reset}` : `${COLOR.red}✗ FAIL${COLOR.reset}`;
    const ms = `${COLOR.dim}(${formatMs(r.durationMs)})${COLOR.reset}`;
    const detail = r.ok ? '' : ` ${COLOR.red}— ${r.error?.slice(0, 80) ?? ''}${COLOR.reset}`;
    process.stdout.write(`  ${n}. ${name} ${status}  ${ms}${detail}\n`);
  });

  process.stdout.write(`${COLOR.dim}${thin}${COLOR.reset}\n`);
  const failedPart = failed > 0 ? `, ${COLOR.red}${failed} failed${COLOR.reset}` : '';
  const firstFailedPart = allOk
    ? ''
    : `  ${COLOR.dim}(first failure: step ${firstFailed})${COLOR.reset}`;
  const counts = `  ${COLOR.green}${passed} passed${COLOR.reset}${failedPart}${firstFailedPart}`;
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
