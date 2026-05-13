import { CommandDefinition, SubcommandGroupDefinition } from '../lib/command-registry';
import { parseAppId, parsePositiveInt, collectUrls } from '../lib/validators';

import { initCommand } from './init';
import { loginCommand } from './login';
import { logoutCommand } from './logout';
import { whoamiCommand } from './whoami';
import { createCommand } from './app/create';
import { listCommand } from './app/list';
import { credentialsCommand } from './app/credentials';
import { updateCommand } from './app/update';
import { deleteCommand } from './app/delete';
import { scaffoldCommand } from './app/scaffold';
import { startCommand } from './app/start';
import { installCommand as skillInstallCommand } from './skill/install';
import { uninstallCommand as skillUninstallCommand } from './skill/uninstall';

export const topLevelCommands: CommandDefinition[] = [
  {
    name: 'login',
    description: 'Authenticate with your Brevo account',
    options: [
      { flags: '--browser', description: 'Force browser-based login' },
      { flags: '--json', description: 'Output as JSON' },
    ],
    examples: ['brevo login', 'brevo login --browser', 'BREVO_API_KEY=xkeysib-... brevo login'],
    handler: (opts) =>
      loginCommand({
        browser: Boolean(opts.browser),
        json: Boolean(opts.json),
      }),
  },
  {
    name: 'logout',
    description: 'Clear stored credentials',
    options: [
      { flags: '--force', description: 'Skip confirmation (for CI)' },
      { flags: '--json', description: 'Output as JSON' },
    ],
    handler: (opts) => logoutCommand({ force: Boolean(opts.force), json: Boolean(opts.json) }),
  },
  {
    name: 'whoami',
    description: 'Show current authenticated user',
    options: [{ flags: '--json', description: 'Output as JSON' }],
    handler: (opts) => whoamiCommand({ json: Boolean(opts.json) }),
  },
];

export const appCommandGroup: SubcommandGroupDefinition = {
  name: 'app',
  description: 'Manage OAuth applications',
  commands: [
    {
      name: 'init',
      description: 'Quick setup — login, create app, and scaffold in one go',
      examples: ['brevo app init'],
      handler: () => initCommand({}),
    },
    {
      name: 'create',
      description: 'Create a new OAuth app',
      examples: [
        'brevo app create',
        'brevo app create --name "My App" --distribution private',
        'brevo app create --name "My App" --distribution private --redirect-uri http://localhost:3009/auth/callback',
        'brevo app create --name "My App" --distribution private --redirect-uri http://localhost:3009/auth/callback --redirect-uri https://myapp.com/callback --json',
      ],
      options: [
        { flags: '--name <name>', description: 'App name' },
        { flags: '--distribution <type>', description: 'Distribution type (private|public)' },
        {
          flags: '--redirect-uri <url>',
          description: 'Redirect URI (repeatable)',
          parser: collectUrls,
        },
        { flags: '--json', description: 'Output as JSON' },
      ],
      handler: (opts) =>
        createCommand({
          name: opts.name as string | undefined,
          distribution: opts.distribution as string | undefined,
          redirectUri: opts.redirectUri as string[] | undefined,
          json: Boolean(opts.json),
        }),
    },
    {
      name: 'list',
      description: 'List all apps in your account',
      examples: ['brevo app list', 'brevo app list --json'],
      options: [{ flags: '--json', description: 'Output as JSON' }],
      handler: (opts) => listCommand({ json: Boolean(opts.json) }),
    },
    {
      name: 'credentials',
      description: 'Show client ID and secret for an app',
      examples: [
        'brevo app credentials --app-id 42',
        'brevo app credentials --app-id 42 --reveal-secret --json',
      ],
      options: [
        {
          flags: '--app-id <id>',
          description: 'App ID',
          parser: (v) => parseAppId(v),
        },
        { flags: '--reveal-secret', description: 'Show the client secret' },
        { flags: '--json', description: 'Output as JSON' },
      ],
      handler: (opts) =>
        credentialsCommand({
          appId: opts.appId as string | undefined,
          revealSecret: Boolean(opts.revealSecret),
          json: Boolean(opts.json),
        }),
    },
    {
      name: 'update',
      description: 'Update an app name or redirect URLs',
      examples: [
        'brevo app update',
        'brevo app update --name "My New Name"',
        'brevo app update --redirect-uri https://myapp.com/callback',
        'brevo app update --name "My App" --redirect-uri https://myapp.com/callback',
        'brevo app update --app-id 42 --name "My App"',
        'brevo app update --app-id 42 --redirect-uri https://myapp.com/callback --json',
      ],
      options: [
        {
          flags: '--app-id <id>',
          description: 'App ID (uses app-config.json if omitted)',
          parser: (v) => parseAppId(v),
        },
        { flags: '--name <name>', description: 'New app name' },
        {
          flags: '--redirect-uri <url>',
          description: 'Redirect URI to append (repeatable)',
          parser: collectUrls,
        },
        { flags: '--yes', description: 'Skip confirmation prompt' },
        { flags: '--json', description: 'Output as JSON' },
      ],
      handler: (opts) =>
        updateCommand({
          appId: opts.appId,
          name: opts.name,
          redirectUri: opts.redirectUri,
          yes: Boolean(opts.yes),
          json: Boolean(opts.json),
        }),
    },
    {
      name: 'delete',
      description: 'Delete an app',
      examples: ['brevo app delete --app-id 42', 'brevo app delete --app-id 42 --force'],
      options: [
        {
          flags: '--app-id <id>',
          description: 'App ID',
          parser: (v) => parseAppId(v),
        },
        { flags: '--force', description: 'Skip confirmation (for CI)' },
        { flags: '--json', description: 'Output as JSON' },
      ],
      handler: (opts) =>
        deleteCommand({
          appId: opts.appId as string | undefined,
          force: Boolean(opts.force),
          json: Boolean(opts.json),
        }),
    },
    {
      name: 'scaffold',
      description: 'Generate starter code for an app',
      examples: ['brevo app scaffold', 'brevo app scaffold --app-id 42'],
      options: [
        {
          flags: '--app-id <id>',
          description: 'App ID',
          parser: (v) => parseAppId(v),
        },
        { flags: '--json', description: 'Output as JSON' },
      ],
      handler: (opts) =>
        scaffoldCommand({ appId: opts.appId as string | undefined, json: Boolean(opts.json) }),
    },
    {
      name: 'start',
      description: 'Run a scaffolded feature locally',
      arguments: [{ name: '[feature]', description: 'Feature to start (e.g. oauth)' }],
      examples: ['brevo app start oauth', 'brevo app start oauth --port 3000'],
      options: [
        {
          flags: '--port <port>',
          description: 'Server port (default: 3009)',
          parser: (v) => parsePositiveInt(v, '--port'),
        },
      ],
      handler: (opts, feature) =>
        startCommand({
          feature: feature as string | undefined,
          port: opts.port as number | undefined,
        }),
    },
  ],
};

export const skillCommandGroup: SubcommandGroupDefinition = {
  name: 'skill',
  description: 'Install Brevo-authored agent skills (Claude Code)',
  commands: [
    {
      name: 'install',
      description: 'Install Brevo-published skills into ~/.claude/skills/',
      examples: ['brevo skill install', 'brevo skill install --json'],
      options: [{ flags: '--json', description: 'Output as JSON' }],
      handler: (opts) => skillInstallCommand({ json: Boolean(opts.json) }),
    },
    {
      name: 'uninstall',
      description: 'Remove Brevo-installed skills from ~/.claude/skills/',
      examples: ['brevo skill uninstall', 'brevo skill uninstall --json'],
      options: [{ flags: '--json', description: 'Output as JSON' }],
      handler: (opts) => skillUninstallCommand({ json: Boolean(opts.json) }),
    },
  ],
};
