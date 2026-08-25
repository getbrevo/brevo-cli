#!/usr/bin/env node
/*
 * Smoke test for @getbrevo/cli — runner.
 *
 * Setup (pre-flight, install, auth) and teardown (leftover-app cleanup, logout,
 * uninstall) always run. In between it runs whichever suites `--suite` selects:
 *
 *   scripts/smoke/private-app.ts  create → credentials → upload → verify rename
 *                                 → scaffold → start → delete, + guardrail probes
 *   scripts/smoke/public-app.ts   create → upload → status → submit → submit again
 *                                 → status → withdraw → status → delete
 *   scripts/smoke/ui-app.ts       UI-app lifecycle: interactive create (pty) → upload
 *                                 no-op → per-entry edit upload → install → uninstall
 *                                 → delete (opt-in)
 *   scripts/smoke/init-wizard.ts  the `brevo app init` wizard (opt-in)
 *
 * Shared plumbing lives in scripts/smoke/core.ts.
 *
 * Every app a run creates is tracked on `State` so the cleanup step and the
 * signal traps tear it down on success, on failure, and on SIGINT/SIGTERM.
 * Every directory written lives under a tracked tmp dir — `brevo app create`
 * creates `./<slug>` in the cwd, so creates never run from the repo root.
 */

import { closeSync, openSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  COLOR,
  Options,
  SkippedStep,
  State,
  StepFn,
  Suite,
  announce,
  bestEffortCleanup,
  errMsg,
  formatMs,
  logToFile,
  pickFreePort,
  redact,
  stepAuth,
  stepDeleteLeftoverApps,
  stepDone,
  stepFinalCleanup,
  stepLogout,
  stepPreflight,
  stepReinstall,
} from './smoke/core';
import { privateAppSuite } from './smoke/private-app';
import { publicAppSuite } from './smoke/public-app';
import { uiAppSuite } from './smoke/ui-app';
import { initWizardSuite } from './smoke/init-wizard';

// Suite registry. `--suite=<name[,name]>` picks from these; the ui suite and
// the init wizard are opt-in because they drive interactive prompts (ui through
// a pty, init through scripted stdin).
const SUITES: Record<string, Suite> = {
  private: privateAppSuite,
  public: publicAppSuite,
  ui: uiAppSuite,
  init: initWizardSuite,
};

const DEFAULT_SUITES = ['private', 'public'];

// Minimum spacing between `brevo` invocations. Chosen to cost ~40s across a full
// ~40-call run — cheap next to the 126s a single rate-limited delete burned before
// leaking its app. `--gap=0` restores the old unpaced behaviour.
const DEFAULT_GAP_MS = 1000;

function uniq(values: string[]): string[] {
  return [...new Set(values)];
}

function parseSuiteValue(arg: string): string[] {
  const raw = arg.slice('--suite='.length);
  if (raw === 'all') return Object.keys(SUITES);
  const names = uniq(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  if (names.length === 0) throw new Error('--suite needs at least one suite name');
  const unknown = names.filter((n) => !SUITES[n]);
  if (unknown.length > 0) {
    throw new Error(
      `unknown suite(s): ${unknown.join(', ')} — valid: ${Object.keys(SUITES).join(', ')}, all`,
    );
  }
  return names;
}

function parsePortValue(arg: string): number {
  const n = Number.parseInt(arg.slice('--port='.length), 10);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) {
    throw new Error(`invalid --port value: ${arg}`);
  }
  return n;
}

function parseGapValue(arg: string): number {
  const n = Number.parseInt(arg.slice('--gap='.length), 10);
  if (!Number.isInteger(n) || n < 0 || n > 60_000) {
    throw new Error(`invalid --gap value (expected 0-60000 ms): ${arg}`);
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

// Split in two so neither half trips Sonar's cognitive-complexity limit, and so
// adding a flag means touching exactly one of them.
function applyBooleanFlag(opts: Options, arg: string): boolean {
  if (arg === '--skip-auth') opts.skipAuth = true;
  else if (arg === '--verbose') opts.verbose = true;
  else if (arg === '--ci') {
    opts.ci = true;
    opts.verbose = true;
  } else if (arg === '--with-init') opts.suites = uniq([...opts.suites, 'init']);
  else if (arg === '--with-ui') opts.suites = uniq([...opts.suites, 'ui']);
  // Kept as aliases for --suite so existing invocations keep working.
  else if (arg === '--with-public') opts.suites = uniq([...opts.suites, 'public']);
  else if (arg === '--skip-public') opts.suites = opts.suites.filter((s) => s !== 'public');
  else return false;
  return true;
}

function applyValueFlag(opts: Options, arg: string): boolean {
  if (arg.startsWith('--port=')) {
    opts.port = parsePortValue(arg);
    opts.portExplicit = true;
  } else if (arg.startsWith('--report=')) {
    opts.reportPath = arg.slice('--report='.length);
  } else if (arg.startsWith('--against=')) {
    opts.against = parseAgainstValue(arg);
  } else if (arg.startsWith('--suite=')) {
    opts.suites = parseSuiteValue(arg);
  } else if (arg.startsWith('--gap=')) {
    opts.gapMs = parseGapValue(arg);
  } else return false;
  return true;
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
    gapMs: DEFAULT_GAP_MS,
    suites: [...DEFAULT_SUITES],
  };
  for (const arg of argv) {
    if (arg === '-h' || arg === '--help') {
      printHelp();
      process.exit(0);
    }
    if (!applyBooleanFlag(opts, arg) && !applyValueFlag(opts, arg)) {
      throw new Error(`unknown flag: ${arg}`);
    }
  }
  if (opts.suites.length === 0) throw new Error('no suites selected');
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
  --gap=<ms>                   Minimum spacing between brevo invocations
                               (default 1000). Proactive throttle avoidance;
                               --gap=0 disables it.
  --suite=<names>              Which suites to run, comma-separated, in order.
                               private  private-app lifecycle + client guardrails
                               public   public-app submission/review lifecycle
                               ui       UI-app lifecycle (interactive create via a
                                        pty; opt-in)
                               init     'brevo app init' wizard (interactive, opt-in)
                               all      every suite
                               Default: private,public
  --with-init                  Append the init suite (same as adding 'init').
  --with-ui                    Append the ui suite.
  --with-public                Append the public suite.
  --skip-public                Drop the public suite (same as --suite=private).
  -h, --help                   Show this help.

Setup (pre-flight, install, auth) and teardown (leftover-app cleanup, logout,
uninstall) always run, whichever suites are selected. Examples:

  yarn smoke --skip-auth --suite=private     # private lifecycle only
  yarn smoke --skip-auth --suite=public      # public review lifecycle only
  yarn smoke --ci --suite=private,public     # both (the default)

Steps that need a command the installed CLI doesn't have (notably
--against=published, where 'app submit' / 'app status' / 'app withdraw' /
'app upload' may not be released yet) are auto-detected and reported as
skipped rather than failed. The same detection covers gated *features* that
come with no command of their own — '--distribution public', which a published
build refuses (BEX-405).

--against=local builds what the selected suites need, and one 'yarn link' can
only hold one build:
  * with 'public' selected (the default) it builds PREVIEW=1, because the
    public lifecycle only exists on the preview surface;
  * with only 'private' selected it builds the published surface, i.e. what npm
    actually ships. Run 'yarn smoke --suite=private' when that is the thing you
    want to verify.
The ui suite needs neither: UI apps are GA (BEX-290) and ship in every build, so
it runs on whichever artefact the other selected suites decided on. It DOES need
a pty — 'brevo app create' only offers the UI app type on a real terminal — so
the suite drives the prompts through script(1) and is opt-in like init.
`);
}

// ──────────────────────────── state ────────────────────────────

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

function writeReport(state: State, ok: boolean): void {
  if (!state.opts.reportPath) return;
  const report = {
    ok,
    against: state.opts.against,
    ci: state.opts.ci,
    logFile: state.logFile,
    capabilities: state.caps,
    suites: state.opts.suites,
    publicFlow: state.opts.suites.includes('public') ? state.publicObs : 'suite not selected',
    rateLimitWaits: state.rateLimitWaits,
    gapMs: state.opts.gapMs,
    pacedMs: state.pacedMs,
    // Anything here is a real leak on the account, not a test detail.
    orphanedAppIds: state.orphanedAppIds,
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

// Setup and teardown always run; the middle is whichever suites were selected.
// Teardown order matters: leftover-app cleanup must precede Logout / Final
// cleanup, which destroy the credentials and the linked binary it needs.
function buildSteps(opts: Options): Array<[string, StepFn]> {
  const selected = opts.suites.flatMap((name) => {
    const suite = SUITES[name];
    if (!suite) throw new Error(`unknown suite: ${name}`);
    return suite.steps;
  });
  return [
    ['Pre-flight', stepPreflight],
    ['Reinstall local', stepReinstall],
    ['Auth lifecycle', stepAuth],
    ...selected,
    ['Cleanup: leftover apps', stepDeleteLeftoverApps],
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
    state.uiApp ||
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
    uiApp: null,
    initAppId: null,
    linked: false,
    caps: null,
    startChild: null,
    stepResults: [],
    publicObs: {},
    rateLimitWaits: 0,
    lastBrevoCallAt: 0,
    pacedMs: 0,
    orphanedAppIds: [],
    brevoBin: null,
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
  if (state.rateLimitWaits > 0) {
    process.stdout.write(
      `  ${COLOR.yellow}${state.rateLimitWaits} rate-limit wait(s) — the API throttled this run${COLOR.reset}\n`,
    );
  }
  // Reported even at zero waits: it is the reason there were none, and it explains
  // where the wall-clock went to anyone comparing runs.
  if (state.pacedMs > 0) {
    process.stdout.write(
      `  ${COLOR.dim}paced ${formatMs(state.pacedMs)} across the run (--gap=${state.opts.gapMs})${COLOR.reset}\n`,
    );
  }
  if (state.orphanedAppIds.length > 0) {
    process.stdout.write(
      `  ${COLOR.red}LEAKED ${state.orphanedAppIds.length} app(s): ${state.orphanedAppIds.join(', ')}${COLOR.reset}\n`,
    );
  }
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
