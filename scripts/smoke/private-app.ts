/*
 * Private-app lifecycle: create -> credentials -> upload -> verify rename ->
 * scaffold -> start -> delete, plus the client-side negative probes.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import {
  State,
  Suite,
  asStringArray,
  assertMappedFailure,
  assertPortFree,
  brevoCmd,
  createSmokeApp,
  deleteSmokeApp,
  ensureWorkRoot,
  exec,
  execOrThrow,
  findAppByName,
  logToFile,
  must,
  optStr,
  parseJson,
  probeHttp,
  renamedName,
  requireApp,
  requireCommand,
  requireProjectDir,
  sameSet,
  sleep,
  uploadApp,
  waitForExit,
} from './core';

async function stepAppCreate(state: State): Promise<string> {
  const app = await createSmokeApp(state, { label: 'test', distribution: 'private' });
  return `private app ${app.appId} created in ${app.projectDir}, listed`;
}

function stepAppCredentials(state: State): string {
  const app = requireApp(state.mainApp, 'private');
  const creds = execOrThrow(
    brevoCmd(state),
    ['app', 'credentials', '--app-id', app.appId, '--reveal-secret', '--json'],
    state,
  );
  const credObj = parseJson<Record<string, unknown>>(creds.stdout);
  if (!credObj.clientId || !credObj.clientSecret) {
    throw new Error('credentials response missing clientId or clientSecret');
  }
  return `clientId + clientSecret returned`;
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
    execOrThrow(brevoCmd(state), ['app', 'upload', '--yes', '--json'], state, {
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
    const r = execOrThrow(brevoCmd(state), ['app', 'list', '--json'], state);
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
  const result = execOrThrow(brevoCmd(state), ['app', 'scaffold', '--json'], state, {
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

  const child = spawn(
    brevoCmd(state),
    ['app', 'start', 'oauth', '--port', String(state.opts.port)],
    {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    },
  );
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
        brevoCmd(state),
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
      assertMappedFailure(
        exec(brevoCmd(state), ['app', 'upload', '--json'], state, { cwd: workRoot }),
        {
          what: 'upload with no app-config.json',
          patterns: [/No app-config\.json found in this directory/],
          exitCodes: [1],
        },
      ),
    );
  }

  if (state.caps?.submit !== false) {
    details.push(
      assertMappedFailure(
        exec(brevoCmd(state), ['app', 'submit', '--json'], state, { cwd: workRoot }),
        {
          what: 'submit with no resolvable app',
          patterns: [/Cannot determine which app to submit/],
          exitCodes: [1],
        },
      ),
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
  const r = exec(brevoCmd(state), ['app', 'submit', '--app-id', app.appId, '--json'], state, {
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
      // ordering is a CLI-side issue, recorded in the repo-root follow-up list.
      /not supported for private apps/,
      // A backend with no submission record at all answers 404 on that read,
      // which maps to the not-found message and exit 5.
      /not found\./,
    ],
    exitCodes: [1, 5],
  });
}

async function stepDeleteMainApp(state: State): Promise<string> {
  const app = requireApp(state.mainApp, 'private');
  const detail = await deleteSmokeApp(state, app);
  state.mainApp = null;
  return detail;
}

// ──────────────────────────── public-app lifecycle ────────────────────────────

export const privateAppSuite: Suite = {
  name: 'private',
  description: 'Private-app lifecycle and client-side guardrails',
  steps: [
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
  ],
};
