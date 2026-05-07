import * as fs from 'node:fs';
import * as path from 'node:path';
import inquirer from 'inquirer';
import {
  DEFAULT_REDIRECT_URI,
  PLACEHOLDER_CLIENT_ID,
  OAUTH_BASE,
  OAUTH_REALM,
  MIN_CLI_VERSION,
} from '../../lib/constants';
import { logSuccess, logInfo, logWarn } from '../../lib/logger';
import { createSpinner, printBox } from '../../lib/ui';
import { messages } from '../../lang/en';
import { withCommandHandler } from '../../lib/command-handler';
import { CliError } from '../../lib/errors';
import { jsonOutput } from '../../lib/json-output';
import { appService } from '../../container';
import { loadAllTemplates } from '../../templates';

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

export const scaffoldCommand = withCommandHandler(
  async (options: { appId?: string; json?: boolean }): Promise<void> => {
    // Refuse to scaffold inside an existing project — app-config.json in cwd
    // means the user is already in a scaffolded project and likely meant to
    // run `brevo app update` instead.
    if (fs.existsSync(path.join(process.cwd(), 'app-config.json'))) {
      throw new CliError(messages.APP_SCAFFOLD_ALREADY_IN_PROJECT);
    }

    let appId = options.appId;

    // Pick app if not specified
    if (!appId) {
      appId = await appService.pickApp('Select an app:');
    }

    // Fetch app details from API and sync local cache
    const spinner = createSpinner('Fetching app details...', { silent: options.json });
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
    const clientId = appDetails?.client_id || PLACEHOLDER_CLIENT_ID;
    const clientSecret = appDetails?.client_secret || 'YOUR_CLIENT_SECRET';

    // Use redirect URLs from the app (set during app create).
    // For the local test server, prefer a localhost URL from the registered
    // list. Fall back to DEFAULT_REDIRECT_URI so the scaffold works out of
    // the box even when only production URLs are registered.
    const serverRedirectUrls = appDetails?.redirect_uris ?? [];
    const redirectUrls =
      serverRedirectUrls.length > 0 ? serverRedirectUrls : [DEFAULT_REDIRECT_URI];
    const localhostUri = redirectUrls.find(
      (url: string) => url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1'),
    );
    const redirectUri = localhostUri || DEFAULT_REDIRECT_URI;

    // Prompt for output directory — default to app name slugified for filesystem
    const slug =
      (appDetails?.name || 'my-app')
        .toLowerCase()
        .replaceAll(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'my-app';
    const defaultDir = `./${slug}`;
    const { outputDir } = await inquirer.prompt([
      {
        type: 'input',
        name: 'outputDir',
        message: messages.APP_SCAFFOLD_DIR_PROMPT,
        default: defaultDir,
      },
    ]);

    const targetDir = path.resolve(outputDir);

    // Handle existing directory
    let mergeOnly = false;
    if (fs.existsSync(targetDir)) {
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
        return scaffoldCommand({ ...options, appId });
      }

      if (action === 'merge') {
        mergeOnly = true;
      }
    }

    const rawAppName = appDetails?.name || path.basename(targetDir);
    // Sanitize app name: strip characters that could break JSON or template injection
    const appName = rawAppName.replaceAll(/["\\\n\r\t]/g, '').trim() || 'my-app';

    const scopes = appDetails?.scopes ?? ['all'];

    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf-8'),
    );
    const cliVersion: string = pkg.version;

    const vars = {
      '{{APP_NAME}}': appName,
      '{{APP_SLUG}}': slug,
      '{{APP_ID}}': String(appId),
      '{{CLIENT_ID}}': clientId,
      '{{CLIENT_SECRET}}': clientSecret,
      '{{REDIRECT_URI}}': redirectUri,
      '{{REDIRECT_URLS_JSON}}': JSON.stringify(redirectUrls),
      '{{SCOPES_JSON}}': JSON.stringify(scopes),
      '{{OAUTH_BASE}}': OAUTH_BASE,
      '{{OAUTH_REALM}}': OAUTH_REALM,
      '{{CLI_VERSION}}': cliVersion,
      '{{MIN_CLI_VERSION}}': MIN_CLI_VERSION,
    };

    // Create directory structure
    fs.mkdirSync(path.join(targetDir, 'src', 'oauth'), { recursive: true });

    // Load all templates from .tmpl files with variable substitution
    const files = loadAllTemplates(vars);

    let written = 0;
    for (const file of files) {
      const filePath = path.join(targetDir, file.name);
      // Ensure parent directory exists for nested files
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      if (mergeOnly && fs.existsSync(filePath)) continue;
      // Write .env.local with restricted permissions to protect secrets
      const writeOptions = file.name.endsWith('.env.local') ? { mode: 0o600 } : {};
      fs.writeFileSync(filePath, file.content, { encoding: 'utf-8', ...writeOptions });
      written++;
    }

    if (options.json) {
      jsonOutput({ scaffolded: written, directory: targetDir });
      return;
    }

    logSuccess(messages.APP_SCAFFOLD_SUCCESS(written));
    logInfo(formatFileTree(files.map((f) => f.name)));

    // Show next steps
    const relativeDir = path.relative(process.cwd(), targetDir) || '.';
    printBox(
      messages.APP_SCAFFOLD_NEXT_STEPS_TITLE,
      messages.APP_SCAFFOLD_NEXT_STEPS_LINES(relativeDir),
    );
  },
);
