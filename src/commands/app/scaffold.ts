import * as fs from 'node:fs';
import * as path from 'node:path';
import inquirer from 'inquirer';
import {
  DEFAULT_REDIRECT_URI,
  PLACEHOLDER_CLIENT_ID,
  OAUTH_BASE,
  OAUTH_REALM,
  DEFAULT_SCOPES,
  LEGACY_ALL_SCOPE,
} from '../../lib/constants';
import { logSuccess, logInfo, logWarn } from '../../lib/logger';
import { createSpinner, printBox, indentChoices } from '../../lib/ui';
import { messages } from '../../lang/en';
import { withCommandHandler } from '../../lib/command-handler';
import { CliError } from '../../lib/errors';
import { jsonOutput } from '../../lib/json-output';
import { appService } from '../../container';
import { loadBaseTemplates, loadFeatureTemplates, FeatureType } from '../../templates';
import { containsLegacyAllScope } from '../../lib/validators';
import {
  readProjectConfig,
  findEnclosingProjectDir,
  ProjectConfig,
  isUiAppConfig,
} from '../../lib/config';
import { resolveFromRecord } from '../../app-types';
import { stripUiAppWireOnlyKeys } from '../../app-types/wire';
import { promptAppSelection } from './select-app';
// Re-exported below as well: `app create` imports `promptFeatureType` from this
// module and its tests mock this module, so the name has to keep resolving here.
import { promptFeatureType, promptScaffoldFeature } from './scaffold-prompts';
export { promptFeatureType, promptScaffoldFeature, soleFeatureLabel } from './scaffold-prompts';
import { OAuthApp, UiApp } from '../../types';

interface TreeNode {
  [key: string]: TreeNode;
}

function formatFileTree(filePaths: string[]): string {
  // Build tree structure
  const tree: TreeNode = {};
  for (const fp of filePaths) {
    const parts = fp.split('/');
    let node = tree;
    for (const part of parts) {
      node[part] = node[part] || {};
      node = node[part];
    }
  }

  const lines: string[] = [];
  function render(node: TreeNode, prefix: string): void {
    const entries = Object.keys(node).sort((a, b) => {
      // Directories (non-empty children) first, then files
      const aIsDir = Object.keys(node[a] ?? {}).length > 0;
      const bIsDir = Object.keys(node[b] ?? {}).length > 0;
      if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
      return a.localeCompare(b);
    });
    entries.forEach((name, i) => {
      const isLast = i === entries.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const children = node[name] ?? {};
      const isDir = Object.keys(children).length > 0;
      lines.push(`${prefix}${connector}${name}${isDir ? '/' : ''}`);
      if (isDir) {
        render(children, prefix + (isLast ? '    ' : '│   '));
      }
    });
  }

  render(tree, '    ');
  return lines.join('\n');
}

export interface AppContext {
  appDetails: Awaited<ReturnType<typeof appService.resolveAppCredentials>> extends infer R
    ? R extends { app: infer A }
      ? A
      : null
    : null;
  clientId: string;
  clientSecret: string;
  redirectUris: string[];
  redirectUri: string;
  /**
   * The UI-app block to write into app-config.json (BEX-290). Unlike every other
   * field here it is not necessarily server-sourced: `app create` collects it
   * from prompts before the server knows about it, and `app scaffold` carries the
   * *local* block forward so a refresh never destroys hand-edited values.
   * Absent for OAuth apps.
   */
  uiApp?: UiApp;
}

export function computeSlug(name: string | undefined): string {
  return (
    (name || 'my-app')
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'my-app'
  );
}

export async function fetchAppContext(
  appId: string,
  silent?: boolean,
  // The UI-app block to scaffold, supplied by the caller — deliberately NOT read
  // from the server response. Both callers already know the app type locally
  // (`app create` from the type it just prompted for, `app scaffold` from the
  // local `app-config.json`), and falling back to `appDetails.ui_app` would let
  // stale or unexpected server data reclassify an app the user explicitly created
  // as OAuth. Absent here means "OAuth app", authoritatively.
  uiApp?: UiApp,
  // The app object to fall back on when the server can't return one. Supplied by
  // `app create` only, and it is the create response itself: at that point the app
  // provably exists (the server just issued its ID), so a 404 on the read-back is
  // the server contradicting itself, not a missing app. Without this the read-back
  // threw and took the whole create with it — the app stayed on the server while
  // the user got `App <id> not found.` and no project directory (BEX-290).
  fallbackApp?: OAuthApp,
): Promise<AppContext> {
  const spinner = createSpinner('Fetching app details...', { silent });
  let result: Awaited<ReturnType<typeof appService.resolveAppCredentials>>;
  try {
    result = await appService.resolveAppCredentials(appId, {
      tolerateMissing: Boolean(fallbackApp),
    });
  } finally {
    // In `finally` so a propagating error stops the spinner too — otherwise the
    // frame keeps printing over the error output.
    spinner.stop();
  }
  let appDetails = result?.app ?? null;
  if (result) {
    if (result.diffs.length > 0) {
      logWarn(
        `Local credentials for app ${appId} differ from server (${result.diffs.join(', ')}). Updating local cache.`,
      );
    }
    appService.syncAppCredentials(appId, result.app);
  } else if (fallbackApp) {
    appDetails = fallbackApp;
    // Suppressed under --json: logWarn writes to stdout, which would corrupt the
    // single JSON blob the command emits.
    if (!silent) logWarn(messages.APP_SCAFFOLD_SERVER_READBACK_FAILED(appId));
  }
  const serverRedirectUrls = appDetails?.redirect_uris ?? [];
  const redirectUris = serverRedirectUrls.length > 0 ? serverRedirectUrls : [DEFAULT_REDIRECT_URI];
  const localhostUri = redirectUris.find(
    (url: string) => url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1'),
  );
  return {
    appDetails,
    clientId: appDetails?.client_id || PLACEHOLDER_CLIENT_ID,
    clientSecret: appDetails?.client_secret || 'YOUR_CLIENT_SECRET',
    redirectUris,
    redirectUri: localhostUri || DEFAULT_REDIRECT_URI,
    ...(uiApp ? { uiApp } : {}),
  };
}

// `unresolved: true` signals a directory conflict that couldn't be resolved
// without a prompt (only reachable when jsonMode is true). The other branch
// deliberately leaves `unresolved` unset (rather than `false`) so existing
// callers/tests that compare against `{ targetDir, mergeOnly, chooseAgain }`
// via `toEqual` keep working unmodified (`toEqual` ignores undefined keys).
export type ResolveProjectDirectoryResult =
  | {
      targetDir: string;
      mergeOnly: boolean;
      chooseAgain: boolean;
      /**
       * Whether `targetDir` was already on disk when the decision was taken.
       * `applyProjectDirectory` needs it to know whether to `mkdir`, and it cannot
       * re-test with `existsSync` because by then the answer may be "yes, because
       * we just made it".
       */
      existed: boolean;
      unresolved?: false;
    }
  | { targetDir: string; unresolved: true };

export async function resolveProjectDirectory(
  defaultDir: string,
  jsonMode = false,
): Promise<ResolveProjectDirectoryResult> {
  // --json must never block on a prompt: skip the "Output directory:" input
  // and use the default directly.
  const outputDir = jsonMode
    ? defaultDir
    : ((
        await inquirer.prompt([
          {
            type: 'input',
            name: 'outputDir',
            message: messages.APP_SCAFFOLD_DIR_PROMPT,
            default: defaultDir,
          },
        ])
      ).outputDir as string);
  const targetDir = path.resolve(outputDir);
  const existed = fs.existsSync(targetDir);

  if (!existed) {
    return { targetDir, mergeOnly: false, chooseAgain: false, existed: false };
  }

  // --json can't ask "Overwrite / Merge / Choose a different path" either —
  // report this as unresolved instead of guessing on the user's behalf.
  if (jsonMode) {
    return { targetDir, unresolved: true };
  }

  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: messages.APP_SCAFFOLD_DIR_EXISTS,
      choices: indentChoices([
        { name: 'Overwrite existing files', value: 'overwrite' },
        { name: 'Merge (keep existing, add missing)', value: 'merge' },
        { name: 'Choose a different path', value: 'new' },
      ]),
    },
  ]);
  if (action === 'new') {
    return { targetDir, mergeOnly: false, chooseAgain: true, existed: true };
  }
  return { targetDir, mergeOnly: action === 'merge', chooseAgain: false, existed: true };
}

/**
 * Perform the directory decision taken by `resolveProjectDirectory` — create it if
 * needed, announce it, and move into it.
 *
 * Split out from the resolve step because the two halves have opposite ordering
 * constraints in `app create`. The *decision* has to happen before the app is
 * registered, so that abandoning a prompt (Ctrl-C at "Output directory:") cannot
 * leave an app stranded on the server with no project. The *mutation* has to happen
 * after, because until the create returns there may be no app to build a project
 * for — and a create can fail for reasons no amount of local validation predicts (a
 * plan quota `403`, a dropped connection, an unmapped `400`). Doing both up front
 * meant every one of those failures left a directory behind and the process `chdir`'d
 * into it, so the user's next command ran somewhere they had not chosen.
 *
 * A no-op for the two results that describe no directory to apply: an unresolved
 * `--json` conflict, and `chooseAgain`, which is the caller being asked to loop.
 */
export function applyProjectDirectory(
  decision: ResolveProjectDirectoryResult,
  jsonMode = false,
): void {
  if (decision.unresolved || decision.chooseAgain) return;

  const { targetDir, existed } = decision;
  if (!existed) {
    if (!jsonMode) {
      logInfo(messages.APP_SCAFFOLD_CREATING_DIR(path.relative(process.cwd(), targetDir)));
    }
    fs.mkdirSync(targetDir, { recursive: true });
  } else if (!jsonMode) {
    if (targetDir === process.cwd()) {
      logInfo(messages.APP_SCAFFOLD_TARGET_IS_CWD);
    } else {
      // Not "Creating": the user answered "Directory already exists…" one line up,
      // so claiming to create it contradicts the question they were just asked.
      logInfo(messages.APP_SCAFFOLD_USING_EXISTING_DIR(path.relative(process.cwd(), targetDir)));
    }
  }
  process.chdir(targetDir);
}

interface ConfigDiff {
  field: string;
  local: string;
  server: string;
}

function diffLocalConfig(localConfig: ProjectConfig, ctx: AppContext): ConfigDiff[] {
  const diffs: ConfigDiff[] = [];

  const serverName = ctx.appDetails?.name;
  if (serverName && localConfig.appName !== serverName) {
    diffs.push({ field: 'appName', local: localConfig.appName || '(none)', server: serverName });
  }

  const serverDistribution = ctx.appDetails?.distribution_type ?? 'private';
  if (localConfig.distribution_type !== serverDistribution) {
    diffs.push({
      field: 'distribution_type',
      local: localConfig.distribution_type,
      server: serverDistribution,
    });
  }

  // UI apps have no OAuth callback, and `ctx.redirectUris` falls back to the
  // default localhost URI when the server returns none — comparing the two would
  // report a permanent phantom diff on every UI-app scaffold. Skip it entirely.
  if (!isUiAppConfig(localConfig)) {
    const localRedirects = [...(localConfig.auth?.redirectUris ?? [])].sort((a, b) =>
      a.localeCompare(b),
    );
    const serverRedirects = [...ctx.redirectUris].sort((a, b) => a.localeCompare(b));
    if (JSON.stringify(localRedirects) !== JSON.stringify(serverRedirects)) {
      diffs.push({
        field: 'redirectUris',
        local: localRedirects.join(', ') || '(none)',
        server: serverRedirects.join(', ') || '(none)',
      });
    }
  }

  // Scopes are OAuth-only too: a UI app's config carries no scopes by design
  // (`auth: {}`), so comparing against whatever the server
  // reports would flag drift on every refresh.
  if (!isUiAppConfig(localConfig)) {
    const localScopes = [...(localConfig.auth?.scopes ?? [])].sort((a, b) => a.localeCompare(b));
    const serverScopes = [...(ctx.appDetails?.scopes ?? [])]
      .filter((s) => s !== LEGACY_ALL_SCOPE)
      .sort((a, b) => a.localeCompare(b));
    if (JSON.stringify(localScopes) !== JSON.stringify(serverScopes)) {
      diffs.push({
        field: 'scopes',
        local: localScopes.join(', ') || '(none)',
        server: serverScopes.join(', ') || '(none)',
      });
    }
  }

  const localLogo = localConfig.logoUri ?? '';
  const serverLogo = ctx.appDetails?.logo_uri ?? '';
  if (localLogo !== serverLogo) {
    diffs.push({ field: 'logoUri', local: localLogo || '(none)', server: serverLogo || '(none)' });
  }

  const localVersion = localConfig.version ?? '';
  const serverVersion = ctx.appDetails?.version ?? '';
  if (localVersion !== serverVersion) {
    diffs.push({
      field: 'version',
      local: localVersion || '(none)',
      server: serverVersion || '(none)',
    });
  }

  // `ui_app` is deliberately NOT diffed. The local block is the author's source
  // of truth — the CLI writes it, the server validates it — and not every server
  // build echoes it back on reads. Diffing it would report drift against an
  // absent remote value and then a confirmed refresh would overwrite the
  // partner's hand-edited block with nothing. The local block is instead carried
  // through the refresh verbatim (see the ctx override in scaffoldCommand).

  return diffs;
}

function writeScaffoldFiles(
  files: Array<{ name: string; content: string }>,
  targetDir: string,
  mergeOnly: boolean,
): number {
  let written = 0;
  for (const file of files) {
    const filePath = path.join(targetDir, file.name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (mergeOnly && fs.existsSync(filePath)) continue;
    // Write .env.local with restricted permissions to protect secrets
    const writeOptions = file.name.endsWith('.env.local') ? { mode: 0o600 } : {};
    fs.writeFileSync(filePath, file.content, { encoding: 'utf-8', ...writeOptions });
    written++;
  }
  return written;
}

interface TemplateVars {
  vars: Record<string, string>;
  scopes: string[];
  legacyAllSubstituted: boolean;
}

// Build the `{{...}}` substitution map shared by base and feature templates,
// plus the resolved scopes and whether the legacy 'all' scope was substituted.
// Render a `ui_app` block for embedding at a 2-space indent inside
// app-config.json.tmpl. JSON.stringify only indents *nested* levels, so every
// line after the first needs the parent's indent added to keep the emitted file
// readable (and diff-friendly against a hand-edited one).
function renderUiAppJson(uiApp: UiApp | undefined): string {
  if (!uiApp) return '';
  return JSON.stringify(uiApp, null, 2).split('\n').join('\n  ');
}

function buildTemplateVars(appId: string, ctx: AppContext, targetDir: string): TemplateVars {
  const rawAppName = ctx.appDetails?.name || path.basename(targetDir);
  const appName = rawAppName.replaceAll(/["\\\n\r\t]/g, '').trim() || 'my-app';
  // Never propagate the deprecated legacy 'all' scope into a fresh
  // app-config.json — keep the app's granular scopes, fall back to the
  // defaults when 'all' was the only scope, and tell the user (BEX-214).
  // UI apps have no OAuth block at all (`auth: {}`), so their
  // scopes resolve to [] — the ui_app template branch never renders them.
  const remoteScopes = ctx.appDetails?.scopes;
  const legacyAllSubstituted = !ctx.uiApp && containsLegacyAllScope(remoteScopes);
  const granularScopes = (remoteScopes ?? []).filter((s) => s !== LEGACY_ALL_SCOPE);
  let scopes: string[];
  if (ctx.uiApp) {
    scopes = [];
  } else {
    scopes = granularScopes.length > 0 ? granularScopes : [...DEFAULT_SCOPES];
  }

  const slug = computeSlug(ctx.appDetails?.name);

  const vars = {
    '{{APP_NAME}}': appName,
    '{{APP_SLUG}}': slug,
    '{{APP_ID}}': String(appId),
    '{{CLIENT_ID}}': ctx.clientId,
    '{{CLIENT_SECRET}}': ctx.clientSecret,
    '{{REDIRECT_URI}}': ctx.redirectUri,
    '{{REDIRECT_URLS_JSON}}': JSON.stringify(ctx.redirectUris),
    '{{SCOPES_JSON}}': JSON.stringify(scopes),
    '{{DISTRIBUTION}}': ctx.appDetails?.distribution_type ?? 'private',
    '{{LOGO_URI}}': ctx.appDetails?.logo_uri ?? '',
    '{{APP_VERSION}}': ctx.appDetails?.version ?? '',
    '{{OAUTH_BASE}}': OAUTH_BASE,
    '{{OAUTH_REALM}}': OAUTH_REALM,
    // Empty for OAuth apps — its emptiness is what selects the `oauth`
    // conditional branch in templates (see resolveTemplateFlags).
    '{{UI_APP_JSON}}': renderUiAppJson(ctx.uiApp),
  };

  return { vars, scopes, legacyAllSubstituted };
}

export interface BaseScaffoldResult {
  written: number;
  legacyAllSubstituted: boolean;
  scopes: string[];
  files: Array<{ name: string; content: string }>;
}

// Write the basic project structure (app-config.json + project meta files).
// No prompting, no logging/jsonOutput — callers own how the result is reported.
export function runBaseScaffold(
  appId: string,
  ctx: AppContext,
  targetDir: string,
  mergeOnly: boolean,
): BaseScaffoldResult {
  const { vars, scopes, legacyAllSubstituted } = buildTemplateVars(appId, ctx, targetDir);
  const files = loadBaseTemplates(vars);
  const written = writeScaffoldFiles(files, targetDir, mergeOnly);
  return { written, legacyAllSubstituted, scopes, files };
}

export type FeatureConflictChoice = 'merge' | 'overwrite' | 'cancel';

// Decide how to handle feature files that already exist on disk, before any
// write. Precedence:
//   1. `--overwrite` flag  → overwrite, no prompt (interactive or --json)
//   2. no existing files   → merge (nothing to skip; identical to a fresh write)
//   3. --json (no flag)    → merge (non-destructive default; use --overwrite to force)
//   4. interactive         → prompt Overwrite / Merge / Cancel
export async function resolveFeatureConflict(
  featureType: FeatureType,
  appId: string,
  ctx: AppContext,
  targetDir: string,
  opts: { jsonMode: boolean; overwrite: boolean },
): Promise<FeatureConflictChoice> {
  if (opts.overwrite) return 'overwrite';

  const { vars } = buildTemplateVars(appId, ctx, targetDir);
  const files = loadFeatureTemplates(featureType, vars);
  const anyExists = files.some((f) => fs.existsSync(path.join(targetDir, f.name)));
  if (!anyExists) return 'merge';

  // --json can't prompt — stay non-destructive and merge. Scripts that want to
  // regenerate feature files must pass --overwrite explicitly.
  if (opts.jsonMode) return 'merge';

  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: messages.APP_SCAFFOLD_FEATURE_EXISTS,
      choices: indentChoices([
        { name: messages.APP_SCAFFOLD_FEATURE_EXISTS_OVERWRITE, value: 'overwrite' },
        { name: messages.APP_SCAFFOLD_FEATURE_EXISTS_MERGE, value: 'merge' },
        { name: messages.APP_SCAFFOLD_FEATURE_EXISTS_CANCEL, value: 'cancel' },
      ]),
    },
  ]);
  return action as FeatureConflictChoice;
}

export interface FeatureScaffoldResult {
  written: number;
  files: Array<{ name: string; content: string }>;
}

// Write a single feature's files into an existing project directory.
export function runFeatureScaffold(
  featureType: FeatureType,
  appId: string,
  ctx: AppContext,
  targetDir: string,
  mergeOnly: boolean,
): FeatureScaffoldResult {
  const { vars } = buildTemplateVars(appId, ctx, targetDir);
  if (featureType === 'oauth') {
    fs.mkdirSync(path.join(targetDir, 'src', 'oauth'), { recursive: true });
  }
  const files = loadFeatureTemplates(featureType, vars);
  const written = writeScaffoldFiles(files, targetDir, mergeOnly);
  return { written, files };
}

// Report the basic project structure written by `brevo app create` — shown
// with the created-app box, before the feature prompt. No "Next steps" box
// (that belongs to a feature scaffold, or the base-only follow-up in create.ts).
export function reportBaseScaffoldSuccess(result: {
  written: number;
  legacyAllSubstituted: boolean;
  scopes: string[];
  files: Array<{ name: string; content: string }>;
}): void {
  logSuccess(messages.APP_CREATE_BASE_SUCCESS(result.written));
  if (result.legacyAllSubstituted) {
    logWarn(messages.LEGACY_ALL_SCOPE_SCAFFOLD_SUBSTITUTED(result.scopes.join(', ')));
  }
  logInfo(formatFileTree(result.files.map((f) => f.name)));
}

export function reportScaffoldSuccess(result: {
  written: number;
  legacyAllSubstituted: boolean;
  scopes: string[];
  files: Array<{ name: string; content: string }>;
  targetDir: string;
  cdDir?: string;
}): void {
  logSuccess(messages.APP_SCAFFOLD_SUCCESS(result.written));
  if (result.legacyAllSubstituted) {
    logWarn(messages.LEGACY_ALL_SCOPE_SCAFFOLD_SUBSTITUTED(result.scopes.join(', ')));
  }
  logInfo(formatFileTree(result.files.map((f) => f.name)));

  printBox(
    messages.APP_SCAFFOLD_NEXT_STEPS_TITLE,
    messages.APP_SCAFFOLD_NEXT_STEPS_LINES(result.cdDir),
  );
  logInfo(messages.APP_SCAFFOLD_SCOPES_TIP);
}

// process.chdir() only moves the CLI's own process, never the shell the user
// typed the command in — so the "cd" hint in Next steps must be relative to
// where the command was actually invoked (captured before any chdir), not
// the CLI's current (already-moved) cwd.
export function computeCdHint(originalCwd: string, targetDir: string): string | undefined {
  return path.relative(originalCwd, targetDir) || undefined;
}

// Resolve which app this project is linked to (from cwd's app-config.json),
// and decide whether the base config has drifted from the server. Returns a
// cancellation instead of prompting when running under --json.
interface ScaffoldPlanResolved {
  cancelled: false;
  appId: string;
  ctx: AppContext;
  refreshBase: boolean;
}

interface ScaffoldPlanCancelled {
  cancelled: true;
  reason?: string;
  diffs?: ConfigDiff[];
}

type ScaffoldPlan = ScaffoldPlanResolved | ScaffoldPlanCancelled;

async function resolveScaffoldPlan(
  localConfig: ProjectConfig,
  jsonMode: boolean,
): Promise<ScaffoldPlan> {
  const appId = localConfig.appId;
  // Carry the local `ui_app` block into the context so that if the user consents
  // to a config refresh, `runBaseScaffold` rewrites app-config.json *with* it
  // rather than dropping it (the refresh is a full overwrite, not a merge).
  const ctx = await fetchAppContext(appId, jsonMode, localConfig.ui_app);
  const diffs = diffLocalConfig(localConfig, ctx);

  // No drift → nothing to refresh; just add the feature.
  if (diffs.length === 0) {
    return { cancelled: false, appId, ctx, refreshBase: false };
  }

  // --json can't prompt for confirmation — decline and surface the diffs so a
  // script can decide how to proceed.
  if (jsonMode) {
    return { cancelled: true, reason: messages.APP_SCAFFOLD_JSON_DIFF_CANCELLED, diffs };
  }

  logInfo(messages.APP_SCAFFOLD_DIFF_INTRO(localConfig.appName || appId));
  for (const diff of diffs) {
    logInfo(messages.APP_SCAFFOLD_DIFF_LINE(diff.field, diff.local, diff.server));
  }
  const { confirmed } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmed',
      message: messages.APP_SCAFFOLD_DIFF_CONFIRM,
      default: true,
    },
  ]);
  if (!confirmed) return { cancelled: true };
  return { cancelled: false, appId, ctx, refreshBase: true };
}

// Set an empty directory up for an app that already exists on the platform.
//
// Unlike `resolveScaffoldPlan` there is nothing local to diff against, so there is
// no drift question to ask and `refreshBase` is unconditionally true — writing
// app-config.json is the point of the command in this mode, not a side effect of
// consenting to a refresh.
//
// This is also the one place the *server* is authoritative about the app type.
// `fetchAppContext` deliberately ignores `appDetails.ui_app` and takes the block
// from its caller, because its two original callers both knew the type locally and
// stale server data must not reclassify an app. Bootstrapping knows nothing
// locally — that is its premise — so the server's answer is the only one there is,
// and taking it is the same choice those callers made, not an exception to it.
async function resolveBootstrapPlan(appId: string, jsonMode: boolean): Promise<ScaffoldPlan> {
  if (!jsonMode) logInfo(messages.APP_SCAFFOLD_BOOTSTRAP_INTRO(appId));
  const probe = await fetchAppContext(appId, jsonMode);
  const record = probe.appDetails;

  // Refuse before writing anything when the server cannot answer with enough to rebuild
  // a complete app-config.json. Today that means exactly one case: a UI app created but
  // never uploaded, whose `ui_app` block the read endpoint sources from the latest upload
  // snapshot and so returns empty.
  //
  // It has to be a refusal rather than a partial write, because the omission is invisible.
  // The presence of `ui_app` IS the app-type discriminator, so a config written without it
  // does not read as an incomplete UI app — it reads as a perfectly valid OAuth one, and
  // the next `app upload` pushes an `auth` block where `ui_app` belonged.
  //
  // Asked of the app type rather than tested inline as `!record.ui_app`, so a third type
  // answers the same question instead of needing someone to find this branch by hand.
  // Skipped entirely when there is no record at all: that is a fetch failure, which
  // `fetchAppContext` has already reported on its own terms.
  const appType = resolveFromRecord(record);
  if (record && !appType.recoverableFromRecord(record)) {
    throw new CliError(messages.APP_SCAFFOLD_BOOTSTRAP_UNRECOVERABLE(appId));
  }

  // Strip the keys the platform owns before the block reaches app-config.json — it
  // injects `link_target`, manages the snapshot `version`, and stamps the dotted
  // `extension_point_name` onto every entry. None is authored, and writing one into the
  // file puts a value there that the very next `app upload` rejects as an unknown key.
  // Same owner the upload diff and write-back use; see `src/app-types/wire.ts`.
  const serverUiApp = record?.ui_app ? stripUiAppWireOnlyKeys(record.ui_app) : undefined;
  const ctx = serverUiApp ? { ...probe, uiApp: serverUiApp } : probe;
  return { cancelled: false, appId, ctx, refreshBase: true };
}

/**
 * Which app should an empty directory be set up for?
 *
 * `--app-id` wins when given — it is the non-interactive entry point and the migration
 * path off `brevo app update --app-id <id>`. Without it, an interactive run picks from
 * the account's apps, because a user who has lost their project folder (fresh clone, new
 * laptop, a create that ran in CI) has the app but not necessarily its ID.
 *
 * Falls back to the no-config error whenever prompting is impossible — under `--json` or
 * off a TTY — rather than picking an app on the user's behalf. That error already names
 * `--app-id`, which is the answer for those cases.
 */
async function resolveBootstrapAppId(
  requestedAppId: string | undefined,
  jsonMode: boolean,
): Promise<string | undefined> {
  if (requestedAppId) return requestedAppId;
  if (jsonMode || !process.stdin.isTTY) {
    throw new CliError(messages.APP_SCAFFOLD_NO_CONFIG);
  }
  // Asked before the picker rather than opening straight into it. Bootstrapping is
  // not what `scaffold` normally does, and the most common way to arrive here is a
  // mistyped `cd` — for that user the list of their apps is a non-sequitur, and the
  // useful answer is "no". Returning `undefined` for a decline keeps that a normal
  // outcome rather than an error the caller has to recognise.
  logInfo(messages.APP_SCAFFOLD_BOOTSTRAP_OFFER);
  const { useExisting } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'useExisting',
      message: messages.APP_SCAFFOLD_BOOTSTRAP_CONFIRM,
      default: true,
    },
  ]);
  if (!useExisting) return undefined;
  const { appId } = await promptAppSelection(messages.APP_SCAFFOLD_SELECT);
  return appId;
}

/**
 * Where should a bootstrap write?
 *
 * The feature-add path has no question to answer — its directory is the project it
 * was run in. A bootstrap does: it is the one `scaffold` entry point that can be
 * invoked from a directory the user never meant to fill, and the most likely such
 * directory is the folder they keep their apps *in*. Writing eleven files
 * (`app-config.json`, `README.md`, `CLAUDE.md`, `AGENTS.md`, `.gitignore`, the
 * OAuth server) straight into that folder is silent and tedious to undo, so the
 * command asks the same question `app create` asks, with the same default —
 * `./<slug of the app's name>` — and the same escape: type `.` to stay put.
 *
 * Interactive only. Under `--json` or off a TTY the answer stays the current
 * directory, because `scaffold --app-id <id>` is the scripted migration path off
 * `app update --app-id` and a pipeline that already `mkdir`s and `cd`s must not
 * start finding its config one level deeper. `resolveProjectDirectory` would not
 * prompt in that mode anyway — it would take the default, which is exactly the
 * relocation we must not do.
 */
async function resolveBootstrapDirectory(
  ctx: AppContext,
  jsonMode: boolean,
): Promise<{ targetDir: string; mergeOnly: boolean } | undefined> {
  if (jsonMode || !process.stdin.isTTY) return undefined;

  const defaultDir = `./${computeSlug(ctx.appDetails?.name)}`;
  let dir = await resolveProjectDirectory(defaultDir);
  while (!dir.unresolved && dir.chooseAgain) {
    dir = await resolveProjectDirectory(defaultDir);
  }
  if (dir.unresolved) {
    // Unreachable: `unresolved` is only ever returned with jsonMode=true, which
    // returned above. Fail loudly rather than guess if that ever changes.
    throw new CliError(messages.APP_CREATE_DIR_UNRESOLVED);
  }
  // Safe to create and move into it immediately: unlike `app create`, nothing has
  // been registered on the server that a later failure could orphan — the app
  // already exists and this command only writes files.
  applyProjectDirectory(dir);
  return { targetDir: dir.targetDir, mergeOnly: dir.mergeOnly };
}

export const scaffoldCommand = withCommandHandler(
  async (options: { json?: boolean; overwrite?: boolean; appId?: string }): Promise<void> => {
    const jsonMode = !!options.json;
    const overwrite = !!options.overwrite;
    const requestedAppId = options.appId?.trim() || undefined;

    // Scaffolding a feature only makes sense inside an already-created project —
    // unless we are setting the directory up for an app that already exists, either
    // named by `--app-id` or chosen from the picker.
    const localConfig = readProjectConfig();

    // Everything below until the plan is the bootstrap branch's own pre-flight.
    let bootstrapAppId: string | undefined;
    if (!localConfig) {
      // `readProjectConfig` reads cwd and deliberately does not walk up, which makes a
      // directory one level inside a project indistinguishable from an empty one
      // outside it. They must not get the same answer: bootstrapping into `myapp/src/`
      // would leave a second app-config.json nested in the first, after which
      // `app upload` from that directory pushes the wrong app with no warning. Checked
      // before the picker so the user is told what is wrong rather than being asked to
      // choose an app the command will not use.
      const enclosingProject = findEnclosingProjectDir();
      if (enclosingProject) {
        throw new CliError(messages.APP_SCAFFOLD_INSIDE_PROJECT(enclosingProject));
      }
      bootstrapAppId = await resolveBootstrapAppId(requestedAppId, jsonMode);
      // Declined the offer: nothing to scaffold and nothing went wrong, so exit 0
      // with the remaining routes on screen rather than raising the no-config error
      // the user has just been shown a friendlier version of.
      if (!bootstrapAppId) {
        logInfo(messages.APP_SCAFFOLD_BOOTSTRAP_DECLINED);
        return;
      }
    }

    // Checked before any fetch or write: pointing `--app-id` at a directory that
    // belongs to another app is a mistake worth catching for free, and a bootstrap
    // here would overwrite that app's app-config.json with a different app's.
    if (localConfig && requestedAppId && localConfig.appId !== requestedAppId) {
      throw new CliError(messages.APP_SCAFFOLD_APP_ID_MISMATCH(localConfig.appId, requestedAppId));
    }

    const plan = localConfig
      ? await resolveScaffoldPlan(localConfig, jsonMode)
      : await resolveBootstrapPlan(bootstrapAppId!, jsonMode);
    if (plan.cancelled) {
      if (jsonMode) {
        jsonOutput({
          cancelled: true,
          ...(plan.reason ? { reason: plan.reason } : {}),
          ...(plan.diffs ? { diffs: plan.diffs } : {}),
        });
        return;
      }
      logInfo(messages.APP_SCAFFOLD_CANCELLED);
      return;
    }

    const { appId, ctx, refreshBase } = plan;

    // Captured before `resolveBootstrapDirectory` may chdir: the `cd` hint has to
    // be relative to the shell the user typed the command in, not to the directory
    // the CLI has since moved its own process into.
    const originalCwd = process.cwd();
    const bootstrapDir = localConfig ? undefined : await resolveBootstrapDirectory(ctx, jsonMode);
    const targetDir = bootstrapDir?.targetDir ?? process.cwd();
    // `cd` is only worth printing when the files did not land where the user is
    // standing; `computeCdHint` returns undefined for the directory they're in.
    const cdDir = bootstrapDir ? computeCdHint(originalCwd, targetDir) : undefined;
    // Merging the *base* files is the directory decision's call, not the feature
    // prompt's — it answers "this directory already had files in it", which only a
    // bootstrap that was pointed at a non-empty directory can hit. The feature-add
    // path keeps its full overwrite: a consented refresh means "make it match the
    // server", which a merge would quietly not do.
    const baseMergeOnly = bootstrapDir?.mergeOnly ?? false;

    // UI apps have no scaffoldable features — there is no local server to run for
    // an action link. `app scaffold` degrades to a base-config refresh so the
    // command still has a use inside a UI-app project, instead of offering an
    // OAuth test server the app can't use.
    //
    // Bootstrapping has no local config to classify, so it falls back to the block
    // `resolveBootstrapPlan` read off the server; the two agree on the linked path,
    // where `ctx.uiApp` is the local block by construction.
    const isUiApp = localConfig ? isUiAppConfig(localConfig) : Boolean(ctx.uiApp);
    if (isUiApp) {
      const base = refreshBase ? runBaseScaffold(appId, ctx, targetDir, baseMergeOnly) : null;
      if (jsonMode) {
        jsonOutput({
          scaffolded: base?.written ?? 0,
          directory: targetDir,
          features: [],
          reason: messages.APP_SCAFFOLD_NO_FEATURES_FOR_UI_APP,
        });
        return;
      }
      if (base) {
        logSuccess(messages.APP_CREATE_BASE_SUCCESS(base.written));
        logInfo(formatFileTree(base.files.map((f) => f.name)));
      }
      logInfo(messages.APP_SCAFFOLD_NO_FEATURES_FOR_UI_APP);
      // A bootstrap that made its own directory has to say which one, and for a UI
      // app upload → deploy is the whole of what comes next.
      if (cdDir)
        printBox(messages.APP_SCAFFOLD_NEXT_STEPS_TITLE, messages.APP_CREATE_UI_NEXT(cdDir));
      return;
    }

    // A bootstrap writes and reports the project *before* asking about the feature:
    // the project is what the command was asked for, so it should exist whatever the
    // answer is, and the user can see what they got before deciding on the extra.
    // (The feature-add mode never asks — there, the feature *is* the request — and
    // `--json` never prompts, so both keep writing the base further down.)
    // Gated on a TTY, not just on `--json`, for the same reason the directory
    // question is: it is a new blocking prompt, and a piped run must keep finishing
    // on its own. Off a TTY the base is written further down and the feature always
    // follows, exactly as before.
    const bootstrapInteractive = !localConfig && !jsonMode && !!process.stdin.isTTY;
    const bootstrapBase = bootstrapInteractive
      ? runBaseScaffold(appId, ctx, targetDir, baseMergeOnly)
      : null;
    if (bootstrapBase) {
      reportBaseScaffoldSuccess(bootstrapBase);
      if (!(await promptScaffoldFeature())) {
        logInfo(messages.APP_SCAFFOLD_SCOPES_TIP);
        printBox(messages.APP_SCAFFOLD_NEXT_STEPS_TITLE, messages.APP_CREATE_BASE_ONLY_NEXT(cdDir));
        return;
      }
    }

    const feature = await promptFeatureType(!jsonMode);

    // Decide how existing feature files are handled (overwrite/merge/cancel)
    // before writing anything.
    const conflict = await resolveFeatureConflict(feature, appId, ctx, targetDir, {
      jsonMode,
      overwrite,
    });
    if (conflict === 'cancel') {
      logInfo(messages.APP_SCAFFOLD_CANCELLED);
      return;
    }
    const featureMergeOnly = conflict === 'merge';

    // Refresh the base config/meta files (full overwrite) only when the local
    // config drifted from the server and the user consented.
    let baseWritten = 0;
    let baseFiles: Array<{ name: string; content: string }> = [];
    let legacyAllSubstituted = false;
    let scopes: string[] = [];
    if (refreshBase && !bootstrapBase) {
      const base = runBaseScaffold(appId, ctx, targetDir, baseMergeOnly);
      baseWritten = base.written;
      baseFiles = base.files;
      legacyAllSubstituted = base.legacyAllSubstituted;
      scopes = base.scopes;
    } else if (bootstrapBase) {
      // Written and reported above, so only the scope list is carried forward — the
      // count and the file tree would otherwise be printed a second time, and the
      // legacy-'all' notice repeated. Same split `app create` uses.
      scopes = bootstrapBase.scopes;
    }

    // Feature files merge by default (never clobber hand-edited code); the user
    // (or --overwrite) can opt into a full overwrite via resolveFeatureConflict.
    const feat = runFeatureScaffold(feature, appId, ctx, targetDir, featureMergeOnly);

    const written = baseWritten + feat.written;
    const files = [...baseFiles, ...feat.files];

    if (jsonMode) {
      jsonOutput({ scaffolded: written, directory: targetDir });
      return;
    }

    // `cdDir` is set only when a bootstrap made (or was pointed at) a directory
    // other than the one the command was typed in; the feature-add path always
    // writes into the project directory, so it stays undefined there.
    reportScaffoldSuccess({
      written,
      legacyAllSubstituted,
      scopes,
      files,
      targetDir,
      cdDir,
    });
  },
);
