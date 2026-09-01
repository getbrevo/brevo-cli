/*
 * UI-app lifecycle: interactive create (pty) -> upload no-op -> per-entry edit
 * upload -> install -> uninstall -> uninstall again -> delete — run for an
 * actionLink, then again (create -> upload -> install -> uninstall -> delete)
 * for an iframeExtension, whose leg skips on a build or environment that
 * predates the iframe-extension launch.
 *
 * UI apps are GA (BEX-290) and ship in every build, so this suite runs on the
 * published surface — it does NOT need a PREVIEW=1 artefact. What it does need
 * is a real terminal: `app create` gates its app-type prompt on
 * `process.stdin.isTTY`, so a UI app can only be authored through a pty (see
 * execExpectPty in ./core). That is why the suite is opt-in, same as `init`.
 *
 * Coverage maps to the branch-local manual QA plan (QA-TESTCASES.md Suite 12;
 * see CLAUDE.md — the file never lands on main): the create prompt path and the
 * authored `ui_app` on disk (TC-12.2c/12.3), create-writes-the-snapshot
 * (TC-12.5(a)), a per-entry CTA edit round-tripped through upload (TC-12.4,
 * BEX-426), and the never-manually-run install/uninstall pair (TC-12.7/12.9).
 */

import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  PtyExchange,
  State,
  Suite,
  brevoCmd,
  computeSlug,
  deleteSmokeApp,
  exec,
  execExpectPty,
  execOrThrow,
  findAppByName,
  findAppInList,
  firstLine,
  must,
  optStr,
  parseJson,
  printOrphanWarning,
  readJsonFile,
  requireApp,
  requireCommand,
  requireProjectDir,
  skip,
  sleep,
  stampedName,
  stripAnsi,
  trackTmpDir,
} from './core';

// What the create prompts are answered with, asserted verbatim against the
// app-config.json the create writes. example.com per the repo's fixture rules.
//
// Plain words only: the upload endpoint refuses a per-entry label with ANY
// special character ("label must be at most 48 characters and contain no
// special character" — found live 2026-08-24, when an edited label with
// parentheses 400'd). The CLI's validateUiAppLabel checks only blank + length,
// so the server is the authority here; recorded in the branch-local docs.md.
const UI_LABEL = 'Smoke menu entry';
const UI_LABEL_EDITED = 'Smoke menu entry edited';
const UI_MORE_INFO = 'Added by the smoke test';
const UI_REDIRECT_LINK = 'https://example.com/brevo-cli-smoke/action';
const UI_IFRAME_URL = 'https://example.com/brevo-cli-smoke/embed';

// Same secondary appId recovery as the init suite: the unique stamped name
// makes the app identifiable even when parsing the pty transcript fails.
async function findUiAppByName(state: State, expectedName: string): Promise<string | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = execOrThrow(brevoCmd(state), ['app', 'list', '--json'], state);
    const found = findAppByName(parseJson(r.stdout), expectedName);
    if (found) return found;
    if (attempt < 3) await sleep([500, 1000, 2000][attempt] ?? 2000);
  }
  return null;
}

// The interactive prompt sequence with `--name` and `--distribution` passed as
// flags. Expect patterns quote src/lang/en.ts; list prompts are answered with
// inquirer's number-key jump ('2') or a bare Enter (first choice / default).
//
//   1. logo (input, optional)      → Enter
//   2. app type (list)             → '2' = UI app, or abort → skip when the
//                                    build offers no such choice. Matched on
//                                    the OAuth choice line rather than the
//                                    question so the choices have provably
//                                    rendered before the transcript is
//                                    inspected for the UI one.
//   3. integration type (list)     → Enter (Link, the first choice) on the link leg;
//                                    '2' = Iframe on the iframe leg, or abort → skip
//                                    when the rendered choices carry no Iframe entry
//   4. record page (list)          → Enter (first registry location)
//   5. placement on page (list)    → Enter (first registry row)
//   6. label (input)               → UI_LABEL
//   7. more_info (input, optional) → Enter (blank must be OMITTED from config)
//   8. destination URL (input)     → UI_REDIRECT_LINK, or UI_IFRAME_URL on the
//                                    iframe leg (a different question: modal_iframe_url)
//   9. output directory (input)    → Enter (default ./<slug>)
//
// Nothing is asked after the POST: `finishProject` prints the UI-app
// next-steps box and returns — there is no feature offer for a UI app.
/**
 * The prompt patterns, named and exported so `en.test.ts` can pin them against
 * `messages`. They duplicate prompt copy BY NECESSITY — the smoke drives the
 * real binary, and under `--against=published` that binary's strings may
 * legitimately be older than this repo's — so the drift they invite has to be
 * caught somewhere else. That test is the somewhere: PR #73 (`890b19e`)
 * reworded three of these and this file wasn't touched, which surfaced as a
 * 122s pty timeout on `main` rather than a failed check on the PR.
 *
 * Keep every pattern SHORT and free of typographic punctuation. Two traps, both
 * of which #73's rewording walked into: the copy uses curly apostrophes (’) and
 * em dashes (—), so matching a phrase across one is brittle; and the transcript
 * comes back from a pty at a fixed width, so a long phrase can wrap mid-match.
 * Anchor on the few distinctive words at the START of the line instead.
 * Matching is sequential (the runner advances a cursor past each hit), so a
 * short anchor cannot be satisfied by earlier output.
 */
export const UI_CREATE_EXPECT = {
  logo: /App logo URL \(optional/,
  appTypeOAuth: /OAuth app\s+\(Authorize against Brevo/,
  appTypeUi: /UI app\s+\(Render inside Brevo/,
  integration: /What type of integration are you adding\?/,
  // The two integration choices, matched on the transcript once the question has
  // rendered: Link is always offered; Iframe only on a private app since the
  // iframe-extension launch, so its absence is how an older build is detected.
  integrationLink: /Link\s+\(Opens your URL in a new tab/,
  integrationIframe: /Iframe\s+\(Embeds your page in a modal/,
  page: /Which record page should it appear on\?/,
  placement: /Where should it appear on the .+ page\?/,
  label: /Label\b/,
  moreInfo: /More info \(optional\)/,
  redirect: /Redirect link\b/,
  iframeUrl: /Iframe URL\b/,
  outputDir: /Output directory:/,
} as const;

/** Which integration the create authors; decides the choice sent and the URL question. */
type UiIntegration = 'link' | 'iframe';

function createExchanges(integration: UiIntegration): PtyExchange[] {
  return [
    { expect: UI_CREATE_EXPECT.logo, send: '' },
    {
      expect: UI_CREATE_EXPECT.appTypeOAuth,
      send: (transcript) => (UI_CREATE_EXPECT.appTypeUi.test(transcript) ? '2' : null),
    },
    // The iframe path selects by number-key jump, and aborts (→ skip) when the
    // rendered choices carry no Iframe entry — an older build, same detection
    // pattern as the app-type prompt above.
    integration === 'iframe'
      ? {
          expect: UI_CREATE_EXPECT.integration,
          send: (transcript) => (UI_CREATE_EXPECT.integrationIframe.test(transcript) ? '2' : null),
        }
      : { expect: UI_CREATE_EXPECT.integration, send: '' },
    { expect: UI_CREATE_EXPECT.page, send: '' },
    { expect: UI_CREATE_EXPECT.placement, send: '' },
    { expect: UI_CREATE_EXPECT.label, send: UI_LABEL },
    { expect: UI_CREATE_EXPECT.moreInfo, send: '' },
    integration === 'iframe'
      ? { expect: UI_CREATE_EXPECT.iframeUrl, send: UI_IFRAME_URL }
      : { expect: UI_CREATE_EXPECT.redirect, send: UI_REDIRECT_LINK },
    { expect: UI_CREATE_EXPECT.outputDir, send: '' },
  ];
}

/** The authored entry, with the assertions every step shares. */
function requireUiEntry(cfg: Record<string, unknown>): {
  uiApp: Record<string, unknown>;
  entry: Record<string, unknown>;
} {
  const uiApp = cfg.ui_app as Record<string, unknown> | undefined;
  must(uiApp, 'app-config.json has no ui_app block — the create authored an OAuth app instead');
  const list = (uiApp as Record<string, unknown>).surface_point_list;
  must(
    Array.isArray(list) && list.length === 1,
    `surface_point_list should hold exactly the one authored entry, got: ${JSON.stringify(list)}`,
  );
  const entry = (list as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
  // Wire-only keys must never reach the file: `link_target` is injected by
  // upload, `extension_point_name` is stamped server-side per entry. Their
  // presence means stripUiAppWireOnlyKeys regressed (or a write path bypassed it).
  must(
    !('link_target' in entry) && !('extension_point_name' in entry),
    `wire-only keys leaked into a surface_point_list entry: ${JSON.stringify(entry)}`,
  );
  return { uiApp: uiApp as Record<string, unknown>, entry };
}

async function createUiSmokeApp(state: State, integration: UiIntegration): Promise<string> {
  const tmp = trackTmpDir(state, 'brevo-smoke-ui-');
  const name = stampedName(state, integration === 'iframe' ? 'ui-ifr' : 'ui');

  const r = await execExpectPty(
    brevoCmd(state),
    ['app', 'create', '--name', name, '--distribution', 'private'],
    state,
    { cwd: tmp, exchanges: createExchanges(integration) },
  );

  // Aborted at a list prompt whose choices rendered without the one this path
  // selects: the installed build predates UI apps GA (app-type prompt) or the
  // iframe-extension launch (integration prompt). Nothing was created — create
  // makes no API call until every prompt is answered.
  if (r.aborted) {
    skip(
      integration === 'iframe'
        ? `the installed build's integration prompt offers no Iframe (--against=${state.opts.against})`
        : `the installed build's app-type prompt offers no UI app (--against=${state.opts.against})`,
    );
  }
  if (r.exitCode !== 0) {
    // The iframe choice exists but the registry has no slot enabled for it yet —
    // the environment predates the iframe-extension registry flip. An environment
    // state, not a CLI defect, so the step skips and names the fix.
    const transcript = stripAnsi(r.stdout);
    if (
      integration === 'iframe' &&
      /(no available placements|None of the available placements)/i.test(transcript)
    ) {
      skip(
        'the registry has no slot enabled for iframeExtension — apply the registry flip (app-store-bo-be specs/database.sql) in this environment first',
      );
    }
    throw new Error(`brevo app create exited ${r.exitCode}: ${firstLine(transcript)}`);
  }

  // Primary appId recovery: the created-app box. UUID format only, same as the
  // init suite — the box prints no other UUID-shaped id for a UI app.
  const transcript = stripAnsi(r.stdout);
  const uuidPattern = /App ID:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
  let appId = uuidPattern.exec(transcript)?.[1] ?? null;
  if (!appId) appId = await findUiAppByName(state, name);

  const projectDir = join(tmp, computeSlug(name));
  const configPath = join(projectDir, 'app-config.json');
  if (!appId && existsSync(configPath)) {
    const rawId = readJsonFile(configPath).appId;
    if (typeof rawId === 'string' || typeof rawId === 'number') appId = String(rawId);
  }

  // Same refusal as the init suite: no blind "delete the first new app" guess.
  if (!appId) {
    printOrphanWarning(state, [], name);
    throw new Error(
      `could not identify the created UI app (expected name "${name}"); refusing to guess. See orphan warning above for manual cleanup.`,
    );
  }

  // Register for cleanup before any assertion can throw. redirectUri is '' —
  // a UI app has no OAuth callback.
  state.uiApp = {
    appId,
    name,
    distribution: 'private',
    projectDir: existsSync(configPath) ? projectDir : '',
    redirectUri: '',
  };

  // The authored config is the contract every later step reads — assert it in
  // full: identity fields, the ui_app discriminator, the per-entry CTA fields
  // (BEX-426), the omit-when-blank rules, and the absence of OAuth material.
  must(existsSync(configPath), `create did not write ${configPath}`);
  const cfg = readJsonFile(configPath);
  must(
    String(cfg.appId) === appId,
    `app-config.json appId ${JSON.stringify(cfg.appId)} != ${appId}`,
  );
  must(cfg.appName === name, `app-config.json appName ${JSON.stringify(cfg.appName)} != ${name}`);
  must(
    cfg.distribution_type === 'private',
    `app-config.json distribution_type ${JSON.stringify(cfg.distribution_type)} != private`,
  );
  must('version' in cfg, 'app-config.json has no version key');

  const { uiApp, entry } = requireUiEntry(cfg);
  const expectedType = integration === 'iframe' ? 'iframeExtension' : 'actionLink';
  must(
    uiApp.extension_type === expectedType,
    `extension_type ${JSON.stringify(uiApp.extension_type)} != ${expectedType} (camelCase, BEX-350)`,
  );
  // The CTA fields live per entry; their superseded root spellings must not be
  // written (validateUiApp refuses them by name — so would the next upload).
  for (const rootKey of ['label', 'more_info', 'redirect_link', 'link_target']) {
    must(!(rootKey in uiApp), `superseded root key "${rootKey}" written into ui_app`);
  }
  must(
    typeof entry.surface_point_name === 'string' && entry.surface_point_name.trim() !== '',
    `entry has no surface_point_name slug: ${JSON.stringify(entry)}`,
  );
  must(
    entry.label === UI_LABEL,
    `entry label ${JSON.stringify(entry.label)} != ${JSON.stringify(UI_LABEL)}`,
  );
  // One destination field, per type — the platform refuses the other type's URL on an
  // entry, so its presence here means the create authored a block its own upload 400s.
  if (integration === 'iframe') {
    must(
      entry.modal_iframe_url === UI_IFRAME_URL,
      `entry modal_iframe_url ${JSON.stringify(entry.modal_iframe_url)} != ${UI_IFRAME_URL}`,
    );
    must(
      !('redirect_link' in entry),
      `iframe entry must carry no redirect_link: ${JSON.stringify(entry)}`,
    );
  } else {
    must(
      entry.redirect_link === UI_REDIRECT_LINK,
      `entry redirect_link ${JSON.stringify(entry.redirect_link)} != ${UI_REDIRECT_LINK}`,
    );
    must(
      !('modal_iframe_url' in entry),
      `link entry must carry no modal_iframe_url: ${JSON.stringify(entry)}`,
    );
  }
  must(
    !('more_info' in entry),
    'blank more_info must be omitted from the entry, not written empty',
  );
  const authUrls = (cfg.auth as Record<string, unknown> | undefined)?.redirectUris;
  must(
    !Array.isArray(authUrls) || authUrls.length === 0,
    `UI app config carries OAuth redirect URIs: ${JSON.stringify(authUrls)}`,
  );

  // List endpoint lags create — retry with backoff before declaring missing.
  must(
    await findAppInList(state, appId, true),
    `app ${appId} not present in list after create (after retries)`,
  );

  return `${expectedType} app ${appId} created in ${projectDir}, slot ${String(entry.surface_point_name)}`;
}

async function stepUiAppCreate(state: State): Promise<string> {
  return createUiSmokeApp(state, 'link');
}

// The iframe leg reuses the shared lifecycle steps below — they read `state.uiApp`
// without caring which extension type authored it — and runs AFTER the actionLink
// leg's delete has cleared that slot.
async function stepIframeAppCreate(state: State): Promise<string> {
  return createUiSmokeApp(state, 'iframe');
}

// Create writes the app_versions snapshot inside its own transaction, so the
// first upload after it must diff clean — the headline drift regression,
// TC-12.5(a), proven live 2026-08-13.
function stepUiUploadNoop(state: State): string {
  requireCommand(state, 'upload');
  const app = requireApp(state.uiApp, 'ui');
  const res = parseJson<Record<string, unknown>>(
    execOrThrow(brevoCmd(state), ['app', 'upload', '--yes', '--json'], state, {
      cwd: requireProjectDir(app),
    }).stdout,
  );
  must(
    res.upToDate === true,
    `first upload after create should be up to date (create writes the snapshot): ${JSON.stringify(res).slice(0, 200)}`,
  );
  return `up to date at version ${optStr(res.version)}`;
}

// Edit the entry the way a user adding per-entry CTA copy would (BEX-426), push
// it, and assert the write-back — including that the server's echo of the
// wire-only keys was stripped before it reached the file.
function stepUiUploadEntryEdit(state: State): string {
  requireCommand(state, 'upload');
  const app = requireApp(state.uiApp, 'ui');
  const projectDir = requireProjectDir(app);
  const configPath = join(projectDir, 'app-config.json');

  const cfg = readJsonFile(configPath);
  const { entry } = requireUiEntry(cfg);
  entry.label = UI_LABEL_EDITED;
  entry.more_info = UI_MORE_INFO;
  writeFileSync(configPath, JSON.stringify(cfg, null, 2));

  const res = parseJson<Record<string, unknown>>(
    execOrThrow(brevoCmd(state), ['app', 'upload', '--yes', '--json'], state, {
      cwd: projectDir,
    }).stdout,
  );
  must(
    res.upToDate !== true,
    'a per-entry label/more_info edit did not register as a diff — the upload compared wrongly',
  );
  must(String(res.appId) === app.appId, `upload returned appId ${JSON.stringify(res.appId)}`);

  const written = readJsonFile(configPath);
  const { entry: writtenEntry } = requireUiEntry(written);
  must(
    writtenEntry.label === UI_LABEL_EDITED,
    `write-back label ${JSON.stringify(writtenEntry.label)} != ${JSON.stringify(UI_LABEL_EDITED)}`,
  );
  must(
    writtenEntry.more_info === UI_MORE_INFO,
    `write-back more_info ${JSON.stringify(writtenEntry.more_info)} != ${JSON.stringify(UI_MORE_INFO)}`,
  );
  return `per-entry label + more_info pushed, version ${optStr(written.version)}`;
}

// A plain account resolves the omitted [account-id] to itself with no prompt,
// so --json works. A corporate account can't — the CLI refuses with the
// "corporate account" message rather than prompting under --json — and that is
// an account shape, not a CLI defect, so it skips.
const CORPORATE_ACCOUNT_RE = /corporate account/i;

function stepUiInstall(state: State): string {
  requireCommand(state, 'install');
  const app = requireApp(state.uiApp, 'ui');
  const r = exec(brevoCmd(state), ['app', 'install', '--json'], state, {
    cwd: requireProjectDir(app),
  });
  if (r.exitCode !== 0) {
    if (CORPORATE_ACCOUNT_RE.test(r.stderr + r.stdout)) {
      skip('corporate account — install needs an explicit [account-id]');
    }
    throw new Error(`app install exited ${r.exitCode}: ${firstLine(r.stderr + r.stdout)}`);
  }
  const res = parseJson<Record<string, unknown>>(r.stdout);
  must(res.installed === true, `install did not report installed: ${JSON.stringify(res)}`);
  // `version` / `ui_app` are the machine-readable form of the configuration summary a human
  // sees before confirming. Reported, not asserted: both are present only when the app read
  // succeeded, and an unavailable read deliberately does not fail the install.
  return `installed into account ${optStr(res.accountId)} at version ${optStr(res.version) || '(not reported)'}`;
}

function stepUiUninstall(state: State): string {
  requireCommand(state, 'uninstall');
  const app = requireApp(state.uiApp, 'ui');
  const r = exec(brevoCmd(state), ['app', 'uninstall', '--json'], state, {
    cwd: requireProjectDir(app),
  });
  if (r.exitCode !== 0) {
    if (CORPORATE_ACCOUNT_RE.test(r.stderr + r.stdout)) {
      skip('corporate account — uninstall needs an explicit [account-id]');
    }
    throw new Error(`app uninstall exited ${r.exitCode}: ${firstLine(r.stderr + r.stdout)}`);
  }
  const res = parseJson<Record<string, unknown>>(r.stdout);
  must(res.uninstalled === true, `uninstall did not report uninstalled: ${JSON.stringify(res)}`);
  return 'uninstalled';
}

// "Not installed" is informational, not a failure: exit 0, uninstalled: false.
// This also pins the 404-for-both mapping — the server can't tell "no such
// install" from "no such app" on this route, and the CLI maps both to this path.
function stepUiUninstallAgain(state: State): string {
  requireCommand(state, 'uninstall');
  const app = requireApp(state.uiApp, 'ui');
  const r = exec(brevoCmd(state), ['app', 'uninstall', '--json'], state, {
    cwd: requireProjectDir(app),
  });
  if (r.exitCode !== 0 && CORPORATE_ACCOUNT_RE.test(r.stderr + r.stdout)) {
    skip('corporate account — uninstall needs an explicit [account-id]');
  }
  must(
    r.exitCode === 0,
    `repeat uninstall should exit 0 (informational not-installed), got ${r.exitCode}: ${firstLine(r.stderr + r.stdout)}`,
  );
  const res = parseJson<Record<string, unknown>>(r.stdout);
  must(
    res.uninstalled === false,
    `repeat uninstall should report uninstalled: false, got: ${JSON.stringify(res)}`,
  );
  return 'repeat uninstall reported not-installed, exit 0';
}

async function stepDeleteUiApp(state: State): Promise<string> {
  const app = requireApp(state.uiApp, 'ui');
  const detail = await deleteSmokeApp(state, app);
  state.uiApp = null;
  return detail;
}

export const uiAppSuite: Suite = {
  name: 'ui',
  description: 'UI-app lifecycle (interactive create via a pty)',
  steps: [
    ['UI app create (pty)', stepUiAppCreate],
    ['UI upload (no-op after create)', stepUiUploadNoop],
    ['UI upload (per-entry edit)', stepUiUploadEntryEdit],
    ['UI app install', stepUiInstall],
    ['UI app uninstall', stepUiUninstall],
    ['UI app uninstall (not installed)', stepUiUninstallAgain],
    ['Delete UI app', stepDeleteUiApp],
    // The iframe leg (iframe-extension launch): same lifecycle, second app, after the
    // first one's delete has freed the state slot. Skips — rather than fails — on a
    // build without the Iframe choice or an environment without the registry flip.
    ['Iframe app create (pty)', stepIframeAppCreate],
    ['Iframe upload (no-op after create)', stepUiUploadNoop],
    ['Iframe app install', stepUiInstall],
    ['Iframe app uninstall', stepUiUninstall],
    ['Delete iframe app', stepDeleteUiApp],
  ],
};
