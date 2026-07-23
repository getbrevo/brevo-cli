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
import { createSpinner, printBox } from '../../lib/ui';
import { messages } from '../../lang/en';
import { withCommandHandler } from '../../lib/command-handler';
import { CliError } from '../../lib/errors';
import { jsonOutput } from '../../lib/json-output';
import { appService } from '../../container';
import { loadBaseTemplates, loadFeatureTemplates, FeatureType } from '../../templates';
import { containsLegacyAllScope } from '../../lib/validators';
import { readProjectConfig, ProjectConfig } from '../../lib/config';

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
  redirectUrls: string[];
  redirectUri: string;
}

export function computeSlug(name: string | undefined): string {
  return (
    (name || 'my-app')
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'my-app'
  );
}

export async function fetchAppContext(appId: string, silent?: boolean): Promise<AppContext> {
  const spinner = createSpinner('Fetching app details...', { silent });
  const result = await appService.resolveAppCredentials(appId);
  spinner.stop();
  const appDetails = result?.app ?? null;
  if (result) {
    if (result.diffs.length > 0) {
      logWarn(
        `Local credentials for app ${appId} differ from server (${result.diffs.join(', ')}). Updating local cache.`,
      );
    }
    appService.syncAppCredentials(appId, result.app);
  }
  const serverRedirectUrls = appDetails?.redirect_uris ?? [];
  const redirectUrls = serverRedirectUrls.length > 0 ? serverRedirectUrls : [DEFAULT_REDIRECT_URI];
  const localhostUri = redirectUrls.find(
    (url: string) => url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1'),
  );
  return {
    appDetails,
    clientId: appDetails?.client_id || PLACEHOLDER_CLIENT_ID,
    clientSecret: appDetails?.client_secret || 'YOUR_CLIENT_SECRET',
    redirectUrls,
    redirectUri: localhostUri || DEFAULT_REDIRECT_URI,
  };
}

// `unresolved: true` signals a directory conflict that couldn't be resolved
// without a prompt (only reachable when jsonMode is true). The other branch
// deliberately leaves `unresolved` unset (rather than `false`) so existing
// callers/tests that compare against `{ targetDir, mergeOnly, chooseAgain }`
// via `toEqual` keep working unmodified (`toEqual` ignores undefined keys).
export type ResolveProjectDirectoryResult =
  | { targetDir: string; mergeOnly: boolean; chooseAgain: boolean; unresolved?: false }
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

  if (!fs.existsSync(targetDir)) {
    if (!jsonMode) {
      logInfo(messages.APP_SCAFFOLD_CREATING_DIR(path.relative(process.cwd(), targetDir)));
    }
    fs.mkdirSync(targetDir, { recursive: true });
    process.chdir(targetDir);
    return { targetDir, mergeOnly: false, chooseAgain: false };
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
      choices: [
        { name: 'Overwrite existing files', value: 'overwrite' },
        { name: 'Merge (keep existing, add missing)', value: 'merge' },
        { name: 'Choose a different path', value: 'new' },
      ],
    },
  ]);
  if (action === 'new') {
    return { targetDir, mergeOnly: false, chooseAgain: true };
  }
  if (targetDir === process.cwd()) {
    logInfo(messages.APP_SCAFFOLD_TARGET_IS_CWD);
  } else {
    logInfo(messages.APP_SCAFFOLD_CREATING_DIR(path.relative(process.cwd(), targetDir)));
  }
  process.chdir(targetDir);
  return { targetDir, mergeOnly: action === 'merge', chooseAgain: false };
}

export async function promptFeatureType(interactive: boolean): Promise<FeatureType> {
  if (!interactive) return 'oauth';
  const { featureType } = await inquirer.prompt([
    {
      type: 'list',
      name: 'featureType',
      message: messages.APP_SCAFFOLD_FEATURE_TYPE_PROMPT,
      choices: [{ name: 'Test OAuth App', value: 'oauth' }],
    },
  ]);
  return featureType;
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

  const localRedirects = [...(localConfig.auth?.redirectUrls ?? [])].sort((a, b) =>
    a.localeCompare(b),
  );
  const serverRedirects = [...ctx.redirectUrls].sort((a, b) => a.localeCompare(b));
  if (JSON.stringify(localRedirects) !== JSON.stringify(serverRedirects)) {
    diffs.push({
      field: 'redirectUrls',
      local: localRedirects.join(', ') || '(none)',
      server: serverRedirects.join(', ') || '(none)',
    });
  }

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
function buildTemplateVars(appId: string, ctx: AppContext, targetDir: string): TemplateVars {
  const rawAppName = ctx.appDetails?.name || path.basename(targetDir);
  const appName = rawAppName.replaceAll(/["\\\n\r\t]/g, '').trim() || 'my-app';
  // Never propagate the deprecated legacy 'all' scope into a fresh
  // app-config.json — keep the app's granular scopes, fall back to
  // DEFAULT_SCOPES when 'all' was the only scope, and tell the user (BEX-214).
  const remoteScopes = ctx.appDetails?.scopes;
  const legacyAllSubstituted = containsLegacyAllScope(remoteScopes);
  const granularScopes = (remoteScopes ?? []).filter((s) => s !== LEGACY_ALL_SCOPE);
  const scopes = granularScopes.length > 0 ? granularScopes : [...DEFAULT_SCOPES];

  const pkg = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf-8'),
  );
  const cliVersion: string = pkg.version;
  const slug = computeSlug(ctx.appDetails?.name);

  const vars = {
    '{{APP_NAME}}': appName,
    '{{APP_SLUG}}': slug,
    '{{APP_ID}}': String(appId),
    '{{CLIENT_ID}}': ctx.clientId,
    '{{CLIENT_SECRET}}': ctx.clientSecret,
    '{{REDIRECT_URI}}': ctx.redirectUri,
    '{{REDIRECT_URLS_JSON}}': JSON.stringify(ctx.redirectUrls),
    '{{SCOPES_JSON}}': JSON.stringify(scopes),
    '{{DISTRIBUTION}}': ctx.appDetails?.distribution_type ?? 'private',
    '{{LOGO_URI}}': ctx.appDetails?.logo_uri ?? '',
    '{{APP_VERSION}}': ctx.appDetails?.version ?? '',
    '{{OAUTH_BASE}}': OAUTH_BASE,
    '{{OAUTH_REALM}}': OAUTH_REALM,
    '{{CLI_VERSION}}': cliVersion,
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
      choices: [
        { name: messages.APP_SCAFFOLD_FEATURE_EXISTS_OVERWRITE, value: 'overwrite' },
        { name: messages.APP_SCAFFOLD_FEATURE_EXISTS_MERGE, value: 'merge' },
        { name: messages.APP_SCAFFOLD_FEATURE_EXISTS_CANCEL, value: 'cancel' },
      ],
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
  const ctx = await fetchAppContext(appId, jsonMode);
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

export const scaffoldCommand = withCommandHandler(
  async (options: { json?: boolean; overwrite?: boolean }): Promise<void> => {
    const jsonMode = !!options.json;
    const overwrite = !!options.overwrite;

    // Scaffolding a feature only makes sense inside an already-created project.
    const localConfig = readProjectConfig();
    if (!localConfig) {
      throw new CliError(messages.APP_SCAFFOLD_NO_CONFIG);
    }

    const plan = await resolveScaffoldPlan(localConfig, jsonMode);
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
    const feature = await promptFeatureType(!jsonMode);
    const targetDir = process.cwd();

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
    if (refreshBase) {
      const base = runBaseScaffold(appId, ctx, targetDir, false);
      baseWritten = base.written;
      baseFiles = base.files;
      legacyAllSubstituted = base.legacyAllSubstituted;
      scopes = base.scopes;
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

    // scaffold always runs in the project directory, so no `cd` hint is needed.
    reportScaffoldSuccess({
      written,
      legacyAllSubstituted,
      scopes,
      files,
      targetDir,
    });
  },
);
