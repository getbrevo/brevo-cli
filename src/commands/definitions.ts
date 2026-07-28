import { CommandDefinition, SubcommandGroupDefinition } from '../lib/command-registry';
import { parseAppId, parsePositiveInt, collectUrls, validateUrl } from '../lib/validators';

import { initCommand } from './init';
import { loginCommand } from './login';
import { logoutCommand } from './logout';
import { whoamiCommand } from './whoami';
import { createCommand } from './app/create';
import { deployCommand } from './app/deploy';
import { removeCommand } from './app/remove';
import { listCommand } from './app/list';
import { credentialsCommand } from './app/credentials';
import { statusCommand } from './app/status';
import { uploadCommand } from './app/upload';
import { deleteCommand } from './app/delete';
import { withdrawCommand } from './app/withdraw';
import { scaffoldCommand } from './app/scaffold';
import { scopesCommand } from './app/scopes';
import { startCommand } from './app/start';
import { submitCommand } from './app/submit';
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
      description: 'Create a new app (OAuth integration or UI app)',
      examples: [
        'brevo app create',
        'brevo app create --name "My App" --distribution private',
        'brevo app create --name "My App" --distribution public',
        'brevo app create --name "My App" --distribution private --redirect-uri http://localhost:3009/auth/callback',
        'brevo app create --name "My App" --distribution private --redirect-uri http://localhost:3009/auth/callback --redirect-uri https://myapp.com/callback --json',
        'brevo app create --name "My App" --distribution private --logo-uri https://example.com/logo.png',
      ],
      // A UI app is authored entirely through the interactive prompts (BEX-290) —
      // there is deliberately no `--type` or per-field flag. Every flag below
      // applies to an OAuth app, which is what a non-interactive run always
      // creates.
      options: [
        { flags: '--name <name>', description: 'App name' },
        { flags: '--distribution <type>', description: 'Distribution type (private|public)' },
        {
          flags: '--redirect-uri <url>',
          description: 'Redirect URI (repeatable, OAuth apps only)',
          parser: collectUrls,
        },
        {
          flags: '--logo-uri <url>',
          description: 'App logo URL (http or https)',
          parser: (v: string) => {
            validateUrl(v, 'logo URL');
            return v;
          },
        },
        { flags: '--json', description: 'Output as JSON' },
      ],
      handler: (opts) =>
        createCommand({
          name: opts.name as string | undefined,
          distribution: opts.distribution as string | undefined,
          redirectUri: opts.redirectUri as string[] | undefined,
          logoUri: opts.logoUri as string | undefined,
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
      name: 'status',
      description: "Show an app's review status",
      examples: [
        'brevo app status',
        'brevo app status --app-id 42',
        'brevo app status --app-id 42 --json',
      ],
      options: [
        {
          flags: '--app-id <id>',
          description: 'App ID (uses app-config.json if omitted)',
          parser: (v) => parseAppId(v),
        },
        { flags: '--json', description: 'Output as JSON' },
      ],
      handler: (opts) =>
        statusCommand({ appId: opts.appId as string | undefined, json: Boolean(opts.json) }),
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
      name: 'upload',
      description: 'Push app-config.json to Brevo, validated and synced with the server',
      examples: ['brevo app upload', 'brevo app upload --yes', 'brevo app upload --json'],
      options: [
        { flags: '--yes', description: 'Skip confirmation prompt' },
        { flags: '--json', description: 'Output as JSON' },
      ],
      handler: (opts) =>
        uploadCommand({
          yes: Boolean(opts.yes),
          json: Boolean(opts.json),
        }),
    },
    {
      name: 'deploy',
      description: 'Make an app available in a Brevo account',
      arguments: [{ name: '<account-id>', description: 'Brevo account (tenant) ID' }],
      examples: [
        'brevo app deploy 99999',
        'brevo app deploy 99999 --app-id 42',
        'brevo app deploy 99999 --force --json',
      ],
      options: [
        {
          flags: '--app-id <id>',
          description: 'App ID (uses app-config.json if omitted)',
          parser: (v) => parseAppId(v),
        },
        { flags: '--force', description: 'Skip confirmation (for CI)' },
        { flags: '--json', description: 'Output as JSON' },
      ],
      handler: (opts, accountId) =>
        deployCommand({
          accountId: accountId as string | undefined,
          appId: opts.appId as string | undefined,
          force: Boolean(opts.force),
          json: Boolean(opts.json),
        }),
    },
    {
      name: 'remove',
      description: 'Remove an app from a Brevo account',
      arguments: [{ name: '<account-id>', description: 'Brevo account (tenant) ID' }],
      examples: [
        'brevo app remove 99999',
        'brevo app remove 99999 --app-id 42',
        'brevo app remove 99999 --force --json',
      ],
      options: [
        {
          flags: '--app-id <id>',
          description: 'App ID (uses app-config.json if omitted)',
          parser: (v) => parseAppId(v),
        },
        { flags: '--force', description: 'Skip confirmation (for CI)' },
        { flags: '--json', description: 'Output as JSON' },
      ],
      handler: (opts, accountId) =>
        removeCommand({
          accountId: accountId as string | undefined,
          appId: opts.appId as string | undefined,
          force: Boolean(opts.force),
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
      name: 'withdraw',
      description: 'Withdraw an app from submission',
      examples: [
        'brevo app withdraw --app-id 42',
        'brevo app withdraw --app-id 42 --force',
        'brevo app withdraw --app-id 42 --json',
      ],
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
        withdrawCommand({
          appId: opts.appId as string | undefined,
          force: Boolean(opts.force),
          json: Boolean(opts.json),
        }),
    },
    {
      name: 'scaffold',
      description: 'Add a feature (e.g. the OAuth test server) to the app in this directory',
      examples: [
        'brevo app scaffold',
        'brevo app scaffold --overwrite',
        'brevo app scaffold --json',
      ],
      options: [
        {
          flags: '--overwrite',
          description: 'Overwrite existing feature files instead of merging (skips the prompt)',
        },
        { flags: '--json', description: 'Output as JSON' },
      ],
      handler: (opts) =>
        scaffoldCommand({ json: Boolean(opts.json), overwrite: Boolean(opts.overwrite) }),
    },
    {
      name: 'available-scopes',
      description: 'List OAuth scopes supported by the IdP',
      examples: [
        'brevo app available-scopes',
        'brevo app available-scopes --web',
        'brevo app available-scopes --json',
      ],
      options: [
        { flags: '--json', description: 'Output as JSON' },
        { flags: '--web', description: 'Open the scope catalog in a local browser page' },
      ],
      handler: (opts) => scopesCommand({ json: Boolean(opts.json), web: Boolean(opts.web) }),
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
    {
      name: 'submit',
      description: 'Submit a public app for review',
      examples: [
        'brevo app submit',
        'brevo app submit --app-id 42',
        'brevo app submit --app-id 42 --json',
      ],
      options: [
        {
          flags: '--app-id <id>',
          description: 'App ID (uses app-config.json if omitted)',
          parser: (v) => parseAppId(v),
        },
        {
          flags: '--json',
          description: 'Print the submission form URL as JSON instead of opening a browser',
        },
      ],
      handler: (opts) =>
        submitCommand({
          appId: opts.appId as string | undefined,
          json: Boolean(opts.json),
        }),
    },
  ],
};

export const skillCommandGroup: SubcommandGroupDefinition = {
  name: 'skill:cli',
  description: 'Install the brevo-cli Claude Code skill (Claude only)',
  commands: [
    {
      name: 'install',
      description:
        'Install the brevo-cli skill into ~/.claude/skills/ (Claude only — other AI tools should read agent-context/AGENTS.md instead)',
      examples: ['brevo skill:cli install', 'brevo skill:cli install --json'],
      options: [{ flags: '--json', description: 'Output as JSON' }],
      handler: (opts) => skillInstallCommand({ json: Boolean(opts.json) }),
    },
    {
      name: 'uninstall',
      description: 'Remove the brevo-cli skill from ~/.claude/skills/ (Claude only)',
      examples: ['brevo skill:cli uninstall', 'brevo skill:cli uninstall --json'],
      options: [{ flags: '--json', description: 'Output as JSON' }],
      handler: (opts) => skillUninstallCommand({ json: Boolean(opts.json) }),
    },
  ],
};
