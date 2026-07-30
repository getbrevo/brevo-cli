/*
 * The `brevo app init` wizard, driven through scripted stdin. Opt-in only.
 */

import { existsSync } from 'node:fs';
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

// Tertiary appId recovery: read app-config.json (only present if user
// scaffolded in wizard, which our scripted answers explicitly decline — but
// keep as a safety net in case the wizard flow changes).
function readInitAppIdFromConfig(state: State, tmp: string): string | null {
  const cfgPath = join(tmp, 'app-config.json');
  if (!existsSync(cfgPath)) return null;
  try {
    const cfg = readJsonFile(cfgPath);
    // Narrow before stringifying — `appId` is unknown here, and an object would
    // stringify to "[object Object]" and then be used as an app id.
    const rawId = cfg.appId;
    if (typeof rawId === 'string' || typeof rawId === 'number') return String(rawId);
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
  const r = await execScriptedStdin(brevoCmd(state), ['app', 'init'], state, {
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
