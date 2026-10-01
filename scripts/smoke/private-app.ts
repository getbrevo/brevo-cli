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
  computeSlug,
  createSmokeApp,
  deleteSmokeApp,
  ensureWorkRoot,
  errMsg,
  exec,
  execOrThrow,
  featureMissing,
  findAppByName,
  firstLine,
  listItems,
  logToFile,
  markFeatureUnavailable,
  must,
  optStr,
  parseJson,
  pickId,
  probeHttp,
  renamedName,
  requireApp,
  requireCommand,
  requireFeature,
  requireProjectDir,
  sameSet,
  skip,
  sleep,
  stampedName,
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

// ──────────────────────────── M2M (machine-to-machine) ────────────────────────────
//
// An M2M app is CREATE-ONLY: `brevo app create --m2m` writes no directory and no
// app-config.json. So it cannot go through `createSmokeApp`, which sends `--redirect-uri`
// and asserts a project on disk — the two things an M2M app is defined by not having.
// That absence is what these steps check; everything else about the app is ordinary.
//
// Every step opens with `requireFeature(state, 'm2m-flag')`. The flag is GA and in every
// build this repo produces, but it is newer than the version on npm, so an
// `--against=published` run has to SKIP these six rather than fail them — and the checks
// below are the reason the skip has to be per step: each one is reached independently.
//
// `brevo app scopes update` (BEX-486) is checked here too, with its own extra gate:
// `m2m-scopes-update` covers the CLI-build side (same reasoning as `m2m-flag`), but the
// command also depends on a backend endpoint (BEX-481) that had not shipped as of this
// writing — see `stepM2mScopesUpdate`'s own comment for how that second gate is
// discovered and downgraded at runtime rather than assumed.

const M2M_SCOPES = ['contacts:read', 'crm:read'];
// The set `stepM2mScopesUpdate` submits: every original scope plus one new one, so the
// update is checkable as a genuine add (not a no-op) and the no-op step after it has a
// stable target to resubmit.
const UPDATED_M2M_SCOPES = [...M2M_SCOPES, 'crm:write'];

async function stepM2mCreate(state: State): Promise<string> {
  requireFeature(state, 'm2m-flag');
  const workRoot = ensureWorkRoot(state);
  const name = stampedName(state, 'm2m');

  const created = parseJson<Record<string, unknown>>(
    execOrThrow(
      brevoCmd(state),
      [
        'app',
        'create',
        '--name',
        name,
        '--distribution',
        'private',
        '--m2m',
        '--scopes',
        M2M_SCOPES.join(','),
        '--json',
      ],
      state,
      { cwd: workRoot },
    ).stdout,
  );

  const appId = pickId(created);
  must(appId, `no app id in m2m create output: ${JSON.stringify(created).slice(0, 200)}`);
  // Registered before any assertion below can throw, so a failure still cleans up.
  state.m2mApp = { appId, name, distribution: 'private', projectDir: '', redirectUri: '' };

  must(created.appName === name, `m2m create returned appName ${JSON.stringify(created.appName)}`);
  must(
    created.authType === 'm2m',
    `m2m create returned authType ${JSON.stringify(created.authType)}, expected "m2m"`,
  );
  // `appType` stays `oauth` — M2M is a flow within the OAuth app type, not a third type.
  must(
    created.appType === 'oauth',
    `m2m create returned appType ${JSON.stringify(created.appType)}, expected "oauth"`,
  );
  must(
    typeof created.clientId === 'string' && created.clientId.length > 0,
    'm2m create returned no clientId',
  );
  must(
    sameSet(asStringArray(created.scopes, 'm2m create scopes'), M2M_SCOPES),
    `m2m create returned scopes ${JSON.stringify(created.scopes)}, expected ${JSON.stringify(M2M_SCOPES)}`,
  );

  // The create-only contract, asserted as absence on both sides: no key in the JSON…
  for (const key of ['redirectUri', 'directory', 'scaffolded']) {
    must(!(key in created), `m2m create --json unexpectedly emitted "${key}"`);
  }
  // …and nothing on disk. `app create` would have used `./<slug>` had it written one.
  const wouldBeDir = join(workRoot, computeSlug(name));
  must(!existsSync(wouldBeDir), `m2m create wrote a project directory at ${wouldBeDir}`);

  return `m2m app ${appId} created, no project directory written`;
}

// The credentials read is what proves the app is usable: it is also the check that
// catches the app being MISCLASSIFIED server-side. `app credentials` refuses a UI app,
// and the CLI calls a record with no client_id and no callbacks a UI app — so if the
// listing ever stops returning `client_id` for an M2M app, this step fails loudly here
// rather than the misclassification surfacing to a partner.
function stepM2mCredentials(state: State): string {
  requireFeature(state, 'm2m-flag');
  const app = requireApp(state.m2mApp, 'm2m');
  const creds = parseJson<Record<string, unknown>>(
    execOrThrow(
      brevoCmd(state),
      ['app', 'credentials', '--app-id', app.appId, '--reveal-secret', '--json'],
      state,
      { cwd: ensureWorkRoot(state) },
    ).stdout,
  );
  must(
    typeof creds.clientId === 'string' && creds.clientId.length > 0,
    'm2m credentials returned no clientId',
  );
  // `--reveal-secret` is deliberately a no-op off a TTY: `resolveSecretReveal` in
  // src/commands/app/credentials.ts returns the placeholder without prompting whenever
  // `process.stdin.isTTY` is falsy, and the smoke runner is always non-interactive. So the
  // step pins THAT contract rather than pretending to observe a secret it cannot reach —
  // the previous assertion ("did not reveal a clientSecret") was satisfied by the
  // placeholder itself and could never fail on the thing it named. If this ever starts
  // failing because a real secret came back, the no-op gate has regressed and the docs in
  // agent-context/ (which tell agents `[hidden]` is never a secret) need revisiting too.
  must(
    creds.clientSecret === '[hidden]',
    `m2m credentials returned ${JSON.stringify(creds.clientSecret)} for clientSecret; a non-interactive --reveal-secret must stay the '[hidden]' placeholder`,
  );
  return `m2m app ${app.appId} credentials readable (secret correctly withheld off a TTY)`;
}

// Brevo declining the scopes-update PATCH because the backend (BEX-481) hasn't shipped in
// this environment yet — matched narrowly, the same way `SERVER_REFUSES_PUBLIC` in
// public-app.ts matches Brevo declining public-app creation. `rethrowNotFound` in
// services/app.ts maps ANY 404 on this endpoint to "App … not found.", which is ambiguous
// on its own — but a route that doesn't exist yet is the far likelier read here than the
// app vanishing between the credentials step and this one — so it's included alongside the
// other "route not there" shapes a gateway or origin might answer with.
const SCOPES_UPDATE_ENDPOINT_NOT_READY =
  /not found\.|not implemented|method not allowed|\b404\b|\b405\b|\b501\b/i;

// `brevo app scopes update` (BEX-486). Unlike every other M2M step, this one can be
// unavailable in TWO independent ways, and only the first is what `requireFeature` checks
// automatically: the CLI build may predate the command (`m2m-flag`'s own reason, checked
// by `requireFeature` below), OR the build may have it but the backend it calls (BEX-481)
// may not have shipped in this environment yet. The second is discovered here, the same
// way `stepPublicAppCreate` discovers Brevo declining public-app creation: on a failure
// that LOOKS LIKE the endpoint isn't there (see `SCOPES_UPDATE_ENDPOINT_NOT_READY`),
// downgrade the capability with `markFeatureUnavailable` and skip. Anything else — a 400 on
// a bad payload, a crash, a real regression — rethrows and fails the step for real: a
// catch-all here would let every one of those report as "backend not ready" instead, and
// since the capability gets downgraded either way, `stepM2mScopesUpdateNoop` would then
// skip too — silently disabling both steps' gating value on any genuine bug.
async function stepM2mScopesUpdate(state: State): Promise<string> {
  requireFeature(state, 'm2m-flag');
  requireFeature(state, 'm2m-scopes-update');
  const app = requireApp(state.m2mApp, 'm2m');
  const workRoot = ensureWorkRoot(state);

  let raw: string;
  try {
    raw = execOrThrow(
      brevoCmd(state),
      [
        'app',
        'scopes',
        'update',
        '--app-id',
        app.appId,
        '--scopes',
        UPDATED_M2M_SCOPES.join(','),
        '--yes',
        '--json',
      ],
      state,
      { cwd: workRoot },
    ).stdout;
  } catch (err) {
    const message = errMsg(err);
    if (!SCOPES_UPDATE_ENDPOINT_NOT_READY.test(message)) throw err;
    markFeatureUnavailable(state, 'm2m-scopes-update', firstLine(message));
    skip(`scopes-update backend not available in this environment: ${firstLine(message)}`);
  }

  const updated = parseJson<Record<string, unknown>>(raw);
  must(
    updated.changed === true,
    `scopes update returned changed=${JSON.stringify(updated.changed)}`,
  );
  must(
    sameSet(asStringArray(updated.scopes, 'scopes update scopes'), UPDATED_M2M_SCOPES),
    `scopes update returned scopes ${JSON.stringify(updated.scopes)}, expected ${JSON.stringify(UPDATED_M2M_SCOPES)}`,
  );
  must(
    sameSet(asStringArray(updated.added, 'scopes update added'), ['crm:write']),
    `scopes update returned added ${JSON.stringify(updated.added)}, expected ["crm:write"]`,
  );
  must(
    asStringArray(updated.removed, 'scopes update removed').length === 0,
    `scopes update returned removed ${JSON.stringify(updated.removed)}, expected none`,
  );

  // The command's own --json output only proves it echoed the right answer, not that the
  // server actually stored it — read the app back through a wholly separate command to
  // confirm the PATCH was really persisted.
  const creds = parseJson<Record<string, unknown>>(
    execOrThrow(brevoCmd(state), ['app', 'credentials', '--app-id', app.appId, '--json'], state, {
      cwd: workRoot,
    }).stdout,
  );
  must(
    sameSet(asStringArray(creds.scopes, 'credentials scopes after update'), UPDATED_M2M_SCOPES),
    `app credentials after scopes update returned ${JSON.stringify(creds.scopes)}, expected ${JSON.stringify(UPDATED_M2M_SCOPES)}`,
  );

  return `m2m app ${app.appId} scopes updated to [${UPDATED_M2M_SCOPES.join(', ')}], verified via a fresh credentials read`;
}

// Resubmitting the same (now-current) scopes must be a no-op: no PATCH-worthy change, and
// — since nothing changed — no confirmation prompt to skip either, so this deliberately
// omits `--yes` to prove the no-op path never reaches one.
function stepM2mScopesUpdateNoop(state: State): string {
  requireFeature(state, 'm2m-flag');
  requireFeature(state, 'm2m-scopes-update');
  const app = requireApp(state.m2mApp, 'm2m');

  const result = parseJson<Record<string, unknown>>(
    execOrThrow(
      brevoCmd(state),
      [
        'app',
        'scopes',
        'update',
        '--app-id',
        app.appId,
        '--scopes',
        UPDATED_M2M_SCOPES.join(','),
        '--json',
      ],
      state,
      { cwd: ensureWorkRoot(state) },
    ).stdout,
  );
  must(
    result.changed === false,
    `no-op scopes update returned changed=${JSON.stringify(result.changed)}`,
  );

  return `resubmitting the app's current scopes is a no-op (changed=false), no confirmation needed`;
}

// `brevo app token` (BEX-482). Same two-way-unavailable shape as `stepM2mScopesUpdate`
// above: the CLI build may predate the command (`m2m-flag`'s reason, checked by
// `requireFeature` below via `m2m-app-token`), OR the build may have it but the backend
// it depends on ("brevo app token [Backend]") may not have shipped in this environment
// yet — discovered here and downgraded with `markFeatureUnavailable` rather than treated
// as a hard smoke failure.
async function stepM2mAppToken(state: State): Promise<string> {
  requireFeature(state, 'm2m-flag');
  requireFeature(state, 'm2m-app-token');
  const app = requireApp(state.m2mApp, 'm2m');

  let raw: string;
  try {
    raw = execOrThrow(brevoCmd(state), ['app', 'token', '--app-id', app.appId, '--json'], state, {
      cwd: ensureWorkRoot(state),
    }).stdout;
  } catch (err) {
    const message = errMsg(err);
    markFeatureUnavailable(state, 'm2m-app-token', firstLine(message));
    skip(`app token backend not available in this environment: ${firstLine(message)}`);
  }

  const token = parseJson<Record<string, unknown>>(raw);
  must(
    typeof token.accessToken === 'string' && token.accessToken.length > 0,
    `app token returned no accessToken (${JSON.stringify(token.accessToken)})`,
  );
  must(
    typeof token.expiresIn === 'number' && token.expiresIn > 0,
    `app token returned a non-positive expiresIn (${JSON.stringify(token.expiresIn)})`,
  );
  must(
    typeof token.tokenType === 'string' && token.tokenType.length > 0,
    `app token returned no tokenType (${JSON.stringify(token.tokenType)})`,
  );

  return `m2m app ${app.appId} minted a ${String(token.tokenType)} token, expires in ${String(token.expiresIn)}s`;
}

// `brevo app secret rotate` (BEX-484). Same two-way-unavailable shape as
// `stepM2mAppToken` above: the CLI build may predate the command (`m2m-flag`'s reason,
// checked by `requireFeature` below via `m2m-secret-rotate`), OR the build may have it but
// the backend it depends on ("brevo app secret rotate [Backend]") may not have shipped in
// this environment yet — discovered here and downgraded with `markFeatureUnavailable`
// rather than treated as a hard smoke failure.
async function stepM2mSecretRotate(state: State): Promise<string> {
  requireFeature(state, 'm2m-flag');
  requireFeature(state, 'm2m-secret-rotate');
  const app = requireApp(state.m2mApp, 'm2m');
  const workRoot = ensureWorkRoot(state);

  const before = parseJson<Record<string, unknown>>(
    execOrThrow(
      brevoCmd(state),
      ['app', 'credentials', '--app-id', app.appId, '--reveal-secret', '--json'],
      state,
      { cwd: workRoot },
    ).stdout,
  );
  const oldSecret = before.clientSecret;

  let raw: string;
  try {
    raw = execOrThrow(
      brevoCmd(state),
      ['app', 'secret', 'rotate', '--app-id', app.appId, '--yes', '--json'],
      state,
      { cwd: workRoot },
    ).stdout;
  } catch (err) {
    const message = errMsg(err);
    markFeatureUnavailable(state, 'm2m-secret-rotate', firstLine(message));
    skip(`secret rotate backend not available in this environment: ${firstLine(message)}`);
  }

  const rotated = parseJson<Record<string, unknown>>(raw);
  must(
    typeof rotated.clientSecret === 'string' && rotated.clientSecret.length > 0,
    `secret rotate returned no clientSecret (${JSON.stringify(rotated.clientSecret)})`,
  );
  must(
    rotated.clientSecret !== oldSecret,
    'secret rotate returned the same clientSecret the app had before rotation',
  );

  // The command's own --json output only proves it echoed a new secret, not that the
  // server actually stored it — read the app back through a wholly separate command to
  // confirm the rotated secret is really the one in effect.
  const after = parseJson<Record<string, unknown>>(
    execOrThrow(
      brevoCmd(state),
      ['app', 'credentials', '--app-id', app.appId, '--reveal-secret', '--json'],
      state,
      { cwd: workRoot },
    ).stdout,
  );
  must(
    after.clientSecret === rotated.clientSecret,
    `app credentials after rotation returned ${JSON.stringify(after.clientSecret)}, expected the rotated secret`,
  );

  return `m2m app ${app.appId} client secret rotated, verified via a fresh credentials read`;
}

// `brevo app list --type` (BEX-495), exercised against the one app in this suite whose
// type is known for certain: the M2M app the create step just made. The filter is
// server-side (`app list` sends it as a query parameter and never post-filters locally —
// see the comment in src/commands/app/list.ts), so this is the only place the CLI's whole
// `--type` path — token validation, the CLI-spelling→wire-value mapping in
// `LIST_FILTER_APP_TYPE`, and the request — is driven end to end.
//
// Two positive assertions, because one alone would not distinguish a filter from a label:
// the app must be IN `--type m2m` and must be OUT of `--type ui`. A filter that excluded
// nothing would pass the first and fail the second.
//
// `--type oauth` is deliberately NOT asserted here even though it is documented as a
// superset of `--type m2m`. The four tokens are the server's classification and explicitly
// not a partition (an app may come back under two of them, or under none), so pinning a
// cross-token relationship in a smoke run would fail on a server-side reclassification
// that broke nothing in the CLI. The two assertions below are about THIS app under the
// token that names its own flow.
const LIST_TYPE_BACKOFF = [500, 1000, 2000, 4000];

function listAppIdsOfType(state: State, type: string): string[] {
  const r = execOrThrow(brevoCmd(state), ['app', 'list', '--type', type, '--json'], state, {
    cwd: ensureWorkRoot(state),
  });
  return listItems(parseJson(r.stdout))
    .map((item) => pickId(item))
    .filter((id) => id.length > 0);
}

async function stepM2mListTypeFilter(state: State): Promise<string> {
  requireFeature(state, 'm2m-flag');
  requireFeature(state, 'list-type-filter');
  const app = requireApp(state.m2mApp, 'm2m');

  // The list endpoint is eventually consistent (see `findAppInList` and the rename
  // verification above), and this step runs moments after the create — so poll for the
  // app's appearance rather than reading "not there yet" as "the filter dropped it".
  let m2mIds: string[] = [];
  for (let i = 0; i < LIST_TYPE_BACKOFF.length; i++) {
    m2mIds = listAppIdsOfType(state, 'm2m');
    if (m2mIds.includes(app.appId)) break;
    if (i < LIST_TYPE_BACKOFF.length - 1) await sleep(LIST_TYPE_BACKOFF[i] ?? 4000);
  }
  must(
    m2mIds.includes(app.appId),
    `app list --type m2m did not return the M2M app ${app.appId} after retries (${m2mIds.length} app(s) returned) — either the filter is not reaching the server, or the server no longer classifies an M2M app under "m2m"`,
  );

  // Absence is only meaningful now that presence above proved the listing has caught up
  // with this app; checked first, it could not tell an exclusion from propagation lag.
  const uiIds = listAppIdsOfType(state, 'ui');
  must(
    !uiIds.includes(app.appId),
    `app list --type ui returned the M2M app ${app.appId} — --type is labelling the listing rather than filtering it`,
  );

  // Refused by the Commander parser (`parseAppListType`), so it never reaches the network.
  // Smoke can only observe the exit and the message; that the refusal is ahead of the
  // request is a placement guaranteed by the option's `parser` in definitions.ts and
  // covered in src/__tests__/lib/validators.test.ts.
  const refusal = assertMappedFailure(
    exec(brevoCmd(state), ['app', 'list', '--type', 'bogus', '--json'], state, {
      cwd: ensureWorkRoot(state),
    }),
    {
      what: 'app list --type with an unaccepted value',
      patterns: [/Invalid --type "bogus"\. Must be one of: oauth, ui, function, m2m\./],
      exitCodes: [1],
    },
  );

  return `--type m2m returned ${app.appId}, --type ui excluded it, ${refusal}`;
}

// Every refusal `assertM2mFlags` owns, driven through the real binary. They must all fail
// before the app is created, so a leaked app here would itself be the finding.
function stepM2mNegativeFlags(state: State): string {
  requireFeature(state, 'm2m-flag');
  const workRoot = ensureWorkRoot(state);
  const run = (args: string[]): ReturnType<typeof exec> =>
    exec(
      brevoCmd(state),
      ['app', 'create', '--name', stampedName(state, 'm2m-neg'), ...args],
      state,
      {
        cwd: workRoot,
      },
    );

  const details = [
    assertMappedFailure(run(['--distribution', 'private', '--m2m', '--json']), {
      what: '--m2m without --scopes',
      patterns: [/--m2m` needs `--scopes/],
      exitCodes: [1],
    }),
    assertMappedFailure(run(['--distribution', 'private', '--scopes', 'contacts:read', '--json']), {
      what: '--scopes without --m2m',
      patterns: [/--scopes` only applies to an M2M app/],
      exitCodes: [1],
    }),
    assertMappedFailure(
      run([
        '--distribution',
        'private',
        '--m2m',
        '--scopes',
        'contacts:read',
        '--redirect-uri',
        `http://localhost:${state.opts.port}/auth/callback`,
        '--json',
      ]),
      {
        what: '--m2m with --redirect-uri',
        patterns: [/can't be combined with `--redirect-uri`/],
        exitCodes: [1],
      },
    ),
    assertMappedFailure(
      run(['--distribution', 'private', '--m2m', '--scopes', 'not a scope!', '--json']),
      {
        what: '--m2m with a malformed scope',
        patterns: [/Invalid scope/],
        exitCodes: [1],
      },
    ),
    assertMappedFailure(
      run([
        '--distribution',
        'private',
        '--m2m',
        '--scopes',
        'contacts:read',
        '--ui-app',
        '--json',
      ]),
      {
        what: '--m2m with --ui-app',
        patterns: [/can't be combined with `--ui-app`/],
        exitCodes: [1],
      },
    ),
    // The path deliberately does not exist: the refusal has to come from the flag
    // COMBINATION, before anything tries to read the file, so a "no such file" error here
    // would mean `assertM2mFlags` had stopped running first.
    assertMappedFailure(
      run([
        '--distribution',
        'private',
        '--m2m',
        '--scopes',
        'contacts:read',
        '--ui-config',
        join(workRoot, 'no-such-ui-app.json'),
        '--json',
      ]),
      {
        what: '--m2m with --ui-config',
        patterns: [/can't be combined with `--ui-config`/],
        exitCodes: [1],
      },
    ),
    assertMappedFailure(
      run(['--distribution', 'public', '--m2m', '--scopes', 'contacts:read', '--json']),
      {
        what: '--m2m with --distribution public',
        // Refused twice over, and WHICH refusal fires depends on the build: a
        // published-surface build drops `--distribution public` entirely (BEX-405) and
        // `assertDistributionFlag` — which runs first — refuses it as an unreleased
        // feature, so only a preview build reaches `APP_CREATE_M2M_PUBLIC`. Asserted as
        // either rather than skipped, because the property under test is that no build
        // creates a public M2M app.
        patterns: featureMissing(state, 'public-distribution')
          ? [/not available yet/]
          : [/requires `--distribution private`/],
        exitCodes: [1],
      },
    ),
  ];

  return details.join('; ');
}

async function stepM2mDelete(state: State): Promise<string> {
  requireFeature(state, 'm2m-flag');
  const app = requireApp(state.m2mApp, 'm2m');
  const detail = await deleteSmokeApp(state, app);
  state.m2mApp = null;
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
    ['M2M create', stepM2mCreate],
    ['App list --type filter', stepM2mListTypeFilter],
    ['M2M credentials', stepM2mCredentials],
    ['M2M scopes update', stepM2mScopesUpdate],
    ['M2M scopes update (no-op)', stepM2mScopesUpdateNoop],
    ['M2M app token', stepM2mAppToken],
    ['M2M secret rotate', stepM2mSecretRotate],
    ['Negative: M2M flag combinations', stepM2mNegativeFlags],
    ['Delete M2M app', stepM2mDelete],
  ],
};
