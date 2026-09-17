/*
 * The `brevo app init` wizard, driven through scripted stdin. Opt-in only.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  State,
  Suite,
  brevoCmd,
  errMsg,
  execOrThrow,
  execScriptedStdin,
  findAppByName,
  logToFile,
  parseJson,
  printOrphanWarning,
  readJsonFile,
  configField,
  sleep,
  stampedName,
  trackTmpDir,
} from './core';

// Secondary appId recovery: if our unique name made it through, the app is
// identifiable even without parsing wizard output. Retry to absorb
// list-endpoint propagation lag.
async function findInitAppByName(state: State, expectedName: string): Promise<string | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const after = execOrThrow(brevoCmd(state), ['app', 'list', '--json'], state);
    const found = findAppByName(parseJson(after.stdout), expectedName);
    if (found) return found;
    if (attempt < 3) await sleep([500, 1000, 2000][attempt] ?? 2000);
  }
  return null;
}

// Tertiary appId recovery: read app-config.json.
//
// It is written by the *base* project write, so it is always there on a
// successful run — declining the feature only skips `src/oauth/`. But it is one
// level DOWN: `app create` writes into `./<slug-of-the-app-name>` under the cwd it
// was given, not into the cwd itself. This looked only in `tmp`, which is where
// create used to write, so the fallback could never fire. Both are checked, and
// the search stays one level deep — deeper would risk picking up a config this
// run did not write.
function readInitAppIdFromConfig(state: State, tmp: string): string | null {
  const candidates = [join(tmp, 'app-config.json')];
  try {
    for (const entry of readdirSync(tmp, { withFileTypes: true })) {
      if (entry.isDirectory()) candidates.push(join(tmp, entry.name, 'app-config.json'));
    }
  } catch (e) {
    logToFile(state, `could not list ${tmp}: ${errMsg(e)}`);
  }

  for (const cfgPath of candidates) {
    if (!existsSync(cfgPath)) continue;
    try {
      const cfg = readJsonFile(cfgPath);
      // Narrow before stringifying — the id is unknown here, and an object would
      // stringify to "[object Object]" and then be used as an app id.
      const rawId = configField(cfg, 'app_id', 'appId');
      if (typeof rawId === 'string' || typeof rawId === 'number') return String(rawId);
    } catch (e) {
      logToFile(state, `${cfgPath} parse failed: ${errMsg(e)}`);
    }
  }
  return null;
}

async function stepInitWizard(state: State): Promise<string> {
  const tmp = trackTmpDir(state, 'brevo-smoke-init-');

  // Exactly ONE prompt is reachable here, and that is not a simplification —
  // `execScriptedStdin` gives the child a **pipe** for stdin, so
  // `process.stdin.isTTY` is undefined in it, and every question in `app create`
  // is gated either on that flag directly (logo, redirect URL, output directory)
  // or on the `interactive` value derived from it (distribution, app type, the
  // feature offer). What is left is:
  //
  //   1. App name → unique, readable, traceable name
  //
  // Everything else takes its non-interactive default: `private`, an OAuth app,
  // the default localhost callback, `./<slug>` for the directory, and no feature
  // (base files only — `scaffold` has its own step). `app init`'s own
  // "what would you like to do?" list is not asked either: it only appears when
  // cwd already holds a linked `app-config.json`, and this runs in a fresh tmp dir.
  //
  // Send exactly that one answer and no filler. Blank padding lines would let a
  // newly-added prompt silently accept its default; with nothing left to read,
  // inquirer force-closes and the step fails loudly, which is the behaviour we
  // want from a smoke test.
  //
  // This list was `[name, '', '', 'n', 'n']` and described a five-prompt TTY flow
  // that no longer exists in that order (the logo moved to second, the app-type
  // question was added, the output directory is asked, and the feature confirm now
  // names the feature). The extra lines were inert only because of the TTY gating
  // above — under a pty they would have mis-answered, e.g. landing `n` on
  // `Output directory:` and creating a directory called `n`.
  const expectedName = stampedName(state, 'init');
  const answers = [expectedName];

  // Paced writes: the writer sleeps before each line and once more before closing
  // stdin, and EOF *before* inquirer attaches its reader force-closes the prompt.
  // With a single answer that pre-close window is the only slack there is, and the
  // name prompt sits behind `init`'s credential-verification round trip — hence
  // seconds, not milliseconds. (The old five-line array bought the same slack by
  // accident.)
  const r = await execScriptedStdin(brevoCmd(state), ['app', 'init'], state, {
    cwd: tmp,
    answers,
    interLineDelayMs: 2000,
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

function stepDeleteInitApp(state: State): string {
  if (!state.initAppId) throw new Error('no initAppId to delete');
  const id = state.initAppId;
  execOrThrow(brevoCmd(state), ['app', 'delete', '--app-id', id, '--force', '--json'], state);
  state.initAppId = null;
  return `app ${id} deleted`;
}

// ──────────────────────────── teardown ────────────────────────────

export const initWizardSuite: Suite = {
  name: 'init',
  description: '`brevo app init` wizard',
  steps: [
    ['brevo app init wizard', stepInitWizard],
    ['Delete init-created app', stepDeleteInitApp],
  ],
};
