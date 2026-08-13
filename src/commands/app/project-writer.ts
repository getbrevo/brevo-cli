/**
 * The project writer — everything that puts a Brevo app project on disk.
 *
 * Split out of `scaffold.ts` because two commands write projects, not one. `app create`
 * imports the whole of this module; `app scaffold` imports it too and adds the plan
 * resolution (drift diff, bootstrap, app picker) that is its own. Nothing here knows
 * which command is running, and nothing here prompts for an *app* — the caller has
 * already decided that and hands over an `AppContext`.
 *
 * The two used to live in one 935-line `scaffold.ts`, which made `create.ts` read as
 * though it depended on the `scaffold` COMMAND. It never did: it depends on these
 * functions. The dependency runs one way — `scaffold.ts` imports from here, never the
 * reverse — so this file can be read without the command in view.
 */
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
import { appService } from '../../container';
import { loadBaseTemplates, loadFeatureTemplates, FeatureType } from '../../templates';
import { containsLegacyAllScope } from '../../lib/validators';
import { ProjectConfig, isUiAppConfig } from '../../lib/config';
import { OAuthApp, UiApp } from '../../types';

interface TreeNode {
  [key: string]: TreeNode;
}

export function formatFileTree(filePaths: string[]): string {
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

  // Two columns, not four: the tree is printed a line at a time through `logInfo`,
  // which adds the CLI's own two-space gutter to each of them. Handing `logInfo` the
  // whole tree as one string is what used to indent the first row two columns deeper
  // than its siblings — the gutter landed on the string, so only the first line got it.
  render(tree, '  ');
  return lines.join('\n');
}

/**
 * Print a file tree with every row in the output gutter. See `formatFileTree` for why
 * the rows have to be written one at a time.
 */
export function printFileTree(filePaths: string[]): void {
  for (const line of formatFileTree(filePaths).split('\n')) logInfo(line);
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
  /**
   * Optional refusal hook, run as soon as a target directory is known and **before**
   * the Overwrite / Merge / Choose-a-different-path question. Throw from it to reject
   * the directory outright.
   *
   * It runs before that prompt on purpose: a directory we are going to refuse must not
   * first be the subject of a question about how to write into it. It also runs on every
   * pass of the caller's `chooseAgain` loop, so a second answer is validated like the
   * first. `app scaffold`'s bootstrap uses it to refuse a directory that already belongs
   * to a *different* app — a case its `--app-id` guard cannot see, because that one
   * compares against the current directory and this target is somewhere else.
   */
  validateTarget?: (targetDir: string) => void,
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

  // Before the conflict question, not after — see the parameter's own note. A
  // directory that does not exist cannot hold a project, but the hook is called for it
  // anyway so the caller owns that judgement rather than inferring it from `existed`.
  validateTarget?.(targetDir);

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

export interface ConfigDiff {
  field: string;
  local: string;
  server: string;
}

export function diffLocalConfig(localConfig: ProjectConfig, ctx: AppContext): ConfigDiff[] {
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
  return JSON.stringify(uiApp, null, 2).replaceAll('\n', '\n  ');
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
  logSuccess(messages.APP_CREATE_BASE_SUCCESS(result.written, result.files.length));
  if (result.legacyAllSubstituted) {
    logWarn(messages.LEGACY_ALL_SCOPE_SCAFFOLD_SUBSTITUTED(result.scopes.join(', ')));
  }
  printFileTree(result.files.map((f) => f.name));
}

export function reportScaffoldSuccess(result: {
  written: number;
  legacyAllSubstituted: boolean;
  scopes: string[];
  files: Array<{ name: string; content: string }>;
  targetDir: string;
  cdDir?: string;
}): void {
  logSuccess(messages.APP_SCAFFOLD_SUCCESS(result.written, result.files.length));
  if (result.legacyAllSubstituted) {
    logWarn(messages.LEGACY_ALL_SCOPE_SCAFFOLD_SUBSTITUTED(result.scopes.join(', ')));
  }
  printFileTree(result.files.map((f) => f.name));

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
