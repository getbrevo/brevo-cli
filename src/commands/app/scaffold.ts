import * as fs from 'node:fs';
import * as path from 'node:path';
import inquirer from 'inquirer';
import {
  DEFAULT_REDIRECT_URI,
  PLACEHOLDER_CLIENT_ID,
  OAUTH_BASE,
  OAUTH_REALM,
  DEFAULT_SCOPES,
} from '../../lib/constants';
import { logSuccess, logInfo, logWarn } from '../../lib/logger';
import { createSpinner, printBox } from '../../lib/ui';
import { messages } from '../../lang/en';
import { withCommandHandler } from '../../lib/command-handler';
import { CliError } from '../../lib/errors';
import { jsonOutput } from '../../lib/json-output';
import { appService } from '../../container';
import { loadAllTemplates } from '../../templates';
import { containsLegacyAllScope } from '../../lib/validators';

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

interface AppContext {
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

async function fetchAppContext(appId: string, silent?: boolean): Promise<AppContext> {
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
    appDetails: appDetails as AppContext['appDetails'],
    clientId: appDetails?.client_id || PLACEHOLDER_CLIENT_ID,
    clientSecret: appDetails?.client_secret || 'YOUR_CLIENT_SECRET',
    redirectUrls,
    redirectUri: localhostUri || DEFAULT_REDIRECT_URI,
  };
}

async function resolveTargetDir(
  defaultDir: string,
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
  return {
    targetDir,
    mergeOnly: action === 'merge',
    chooseAgain: action === 'new',
  };
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

export const scaffoldCommand = withCommandHandler(
  async (options: { appId?: string; json?: boolean }): Promise<void> => {
    // Refuse to scaffold inside an existing project — app-config.json in cwd
    // means the user is already in a scaffolded project and likely meant to
    // run `brevo app update` instead.
    if (fs.existsSync(path.join(process.cwd(), 'app-config.json'))) {
      throw new CliError(messages.APP_SCAFFOLD_ALREADY_IN_PROJECT);
    }

    const appId = options.appId ?? (await appService.pickApp('Select an app:'));
    const ctx = await fetchAppContext(appId, options.json);

    const slug =
      (ctx.appDetails?.name || 'my-app')
        .toLowerCase()
        .replaceAll(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'my-app';

    const { targetDir, mergeOnly, chooseAgain } = await resolveTargetDir(`./${slug}`);
    if (chooseAgain) {
      return scaffoldCommand({ ...options, appId });
    }

    const rawAppName = ctx.appDetails?.name || path.basename(targetDir);
    const appName = rawAppName.replaceAll(/["\\\n\r\t]/g, '').trim() || 'my-app';
    // Never propagate the deprecated legacy 'all' scope into a fresh
    // app-config.json — substitute DEFAULT_SCOPES and tell the user (BEX-214).
    const remoteScopes = ctx.appDetails?.scopes;
    const legacyAllSubstituted = containsLegacyAllScope(remoteScopes);
    const scopes = legacyAllSubstituted
      ? [...DEFAULT_SCOPES]
      : (remoteScopes ?? [...DEFAULT_SCOPES]);

    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf-8'),
    );
    const cliVersion: string = pkg.version;

    const vars = {
      '{{APP_NAME}}': appName,
      '{{APP_SLUG}}': slug,
      '{{APP_ID}}': String(appId),
      '{{CLIENT_ID}}': ctx.clientId,
      '{{CLIENT_SECRET}}': ctx.clientSecret,
      '{{REDIRECT_URI}}': ctx.redirectUri,
      '{{REDIRECT_URLS_JSON}}': JSON.stringify(ctx.redirectUrls),
      '{{SCOPES_JSON}}': JSON.stringify(scopes),
      '{{LOGO_URI}}': ctx.appDetails?.logo_uri ?? '',
      '{{OAUTH_BASE}}': OAUTH_BASE,
      '{{OAUTH_REALM}}': OAUTH_REALM,
      '{{CLI_VERSION}}': cliVersion,
    };

    fs.mkdirSync(path.join(targetDir, 'src', 'oauth'), { recursive: true });
    const files = loadAllTemplates(vars);
    const written = writeScaffoldFiles(files, targetDir, mergeOnly);

    if (options.json) {
      jsonOutput({ scaffolded: written, directory: targetDir });
      return;
    }

    logSuccess(messages.APP_SCAFFOLD_SUCCESS(written));
    if (legacyAllSubstituted) {
      logWarn(messages.LEGACY_ALL_SCOPE_SCAFFOLD_SUBSTITUTED(DEFAULT_SCOPES.join(', ')));
    }
    logInfo(formatFileTree(files.map((f) => f.name)));

    const relativeDir = path.relative(process.cwd(), targetDir) || '.';
    printBox(
      messages.APP_SCAFFOLD_NEXT_STEPS_TITLE,
      messages.APP_SCAFFOLD_NEXT_STEPS_LINES(relativeDir),
    );
    logInfo(messages.APP_SCAFFOLD_SCOPES_TIP);
  },
);
