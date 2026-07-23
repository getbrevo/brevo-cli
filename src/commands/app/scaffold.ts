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
import { jsonOutput } from '../../lib/json-output';
import { appService } from '../../container';
import { loadAllTemplates } from '../../templates';
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

export async function resolveProjectDirectory(
  defaultDir: string,
  jsonMode = false,
): Promise<{ targetDir: string; mergeOnly: boolean; chooseAgain: boolean }> {
  const { outputDir } = await inquirer.prompt([
    {
      type: 'input',
      name: 'outputDir',
      message: messages.APP_SCAFFOLD_DIR_PROMPT,
      default: defaultDir,
    },
  ]);
  const targetDir = path.resolve(outputDir);

  if (!fs.existsSync(targetDir)) {
    if (!jsonMode) {
      logInfo(messages.APP_SCAFFOLD_CREATING_DIR(path.relative(process.cwd(), targetDir)));
    }
    fs.mkdirSync(targetDir, { recursive: true });
    process.chdir(targetDir);
    return { targetDir, mergeOnly: false, chooseAgain: false };
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
  if (!jsonMode) {
    if (targetDir === process.cwd()) {
      logInfo(messages.APP_SCAFFOLD_TARGET_IS_CWD);
    } else {
      logInfo(messages.APP_SCAFFOLD_CREATING_DIR(path.relative(process.cwd(), targetDir)));
    }
  }
  process.chdir(targetDir);
  return { targetDir, mergeOnly: action === 'merge', chooseAgain: false };
}

export async function promptProjectType(interactive: boolean): Promise<'oauth'> {
  if (!interactive) return 'oauth';
  const { projectType } = await inquirer.prompt([
    {
      type: 'list',
      name: 'projectType',
      message: messages.APP_SCAFFOLD_PROJECT_TYPE_PROMPT,
      choices: [{ name: 'Test OAuth App', value: 'oauth' }],
    },
  ]);
  return projectType;
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

  const localRedirects = [...(localConfig.auth?.redirectUrls ?? [])].sort();
  const serverRedirects = [...ctx.redirectUrls].sort();
  if (JSON.stringify(localRedirects) !== JSON.stringify(serverRedirects)) {
    diffs.push({
      field: 'redirectUrls',
      local: localRedirects.join(', ') || '(none)',
      server: serverRedirects.join(', ') || '(none)',
    });
  }

  const localScopes = [...(localConfig.auth?.scopes ?? [])].sort();
  const serverScopes = [...(ctx.appDetails?.scopes ?? [])]
    .filter((s) => s !== LEGACY_ALL_SCOPE)
    .sort();
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

export interface ScaffoldRunResult {
  written: number;
  targetDir: string;
  legacyAllSubstituted: boolean;
  scopes: string[];
  files: Array<{ name: string; content: string }>;
}

// Pure(ish) core: given an already-fetched app context and a resolved target
// directory, build template vars and write files. No prompting, no
// logging/jsonOutput — callers own how the result is reported.
export function runScaffold(
  appId: string,
  ctx: AppContext,
  targetDir: string,
  mergeOnly: boolean,
): ScaffoldRunResult {
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

  fs.mkdirSync(path.join(targetDir, 'src', 'oauth'), { recursive: true });
  const files = loadAllTemplates(vars);
  const written = writeScaffoldFiles(files, targetDir, mergeOnly);

  return { written, targetDir, legacyAllSubstituted, scopes, files };
}

export function reportScaffoldSuccess(result: {
  written: number;
  legacyAllSubstituted: boolean;
  scopes: string[];
  files: Array<{ name: string; content: string }>;
  targetDir: string;
}): void {
  logSuccess(messages.APP_SCAFFOLD_SUCCESS(result.written));
  if (result.legacyAllSubstituted) {
    logWarn(messages.LEGACY_ALL_SCOPE_SCAFFOLD_SUBSTITUTED(result.scopes.join(', ')));
  }
  logInfo(formatFileTree(result.files.map((f) => f.name)));

  printBox(messages.APP_SCAFFOLD_NEXT_STEPS_TITLE, messages.APP_SCAFFOLD_NEXT_STEPS_LINES());
  logInfo(messages.APP_SCAFFOLD_SCOPES_TIP);
}

async function resolveScaffoldTarget(
  appId: string,
  slug: string,
  ctx: AppContext,
  jsonMode = false,
): Promise<{ targetDir: string; mergeOnly: boolean } | null> {
  const cwdConfigPath = path.join(process.cwd(), 'app-config.json');

  if (!fs.existsSync(cwdConfigPath)) {
    let dir = await resolveProjectDirectory(`./${slug}`, jsonMode);
    while (dir.chooseAgain) {
      dir = await resolveProjectDirectory(`./${slug}`, jsonMode);
    }
    return { targetDir: dir.targetDir, mergeOnly: dir.mergeOnly };
  }

  const localConfig = readProjectConfig();
  if (localConfig?.appId === appId) {
    const diffs = diffLocalConfig(localConfig, ctx);
    if (diffs.length === 0) {
      if (!jsonMode) logInfo(messages.APP_SCAFFOLD_TARGET_IS_CWD);
      return { targetDir: process.cwd(), mergeOnly: true };
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
    if (!confirmed) return null;
    if (!jsonMode) logInfo(messages.APP_SCAFFOLD_TARGET_IS_CWD);
    return { targetDir: process.cwd(), mergeOnly: false };
  }

  const { choice } = await inquirer.prompt([
    {
      type: 'list',
      name: 'choice',
      message: messages.APP_SCAFFOLD_DIFFERENT_APP_PROMPT(
        localConfig?.appName || 'a different app',
      ),
      choices: [
        { name: 'Choose a different directory', value: 'choose' },
        { name: 'Cancel', value: 'cancel' },
      ],
    },
  ]);
  if (choice === 'cancel') return null;

  let dir = await resolveProjectDirectory(`./${slug}`, jsonMode);
  while (dir.chooseAgain) {
    dir = await resolveProjectDirectory(`./${slug}`, jsonMode);
  }
  return { targetDir: dir.targetDir, mergeOnly: dir.mergeOnly };
}

export const scaffoldCommand = withCommandHandler(
  async (options: { appId?: string; json?: boolean }): Promise<void> => {
    const appId = options.appId ?? (await appService.pickApp('Select an app:'));
    const ctx = await fetchAppContext(appId, options.json);
    const slug = computeSlug(ctx.appDetails?.name);

    const target = await resolveScaffoldTarget(appId, slug, ctx, options.json);
    if (!target) {
      if (options.json) {
        jsonOutput({ cancelled: true });
        return;
      }
      logInfo(messages.APP_SCAFFOLD_CANCELLED);
      return;
    }

    await promptProjectType(!options.json);

    const { written, legacyAllSubstituted, scopes, files } = runScaffold(
      appId,
      ctx,
      target.targetDir,
      target.mergeOnly,
    );

    if (options.json) {
      jsonOutput({ scaffolded: written, directory: target.targetDir });
      return;
    }

    reportScaffoldSuccess({
      written,
      legacyAllSubstituted,
      scopes,
      files,
      targetDir: target.targetDir,
    });
  },
);
