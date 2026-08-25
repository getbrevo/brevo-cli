import { CommandDefinition, SubcommandGroupDefinition } from '../lib/command-registry';
import { parseAppId, parsePositiveInt, collectUrls, validateUrl } from '../lib/validators';
import { EXAMPLE_APP_ID } from '../lib/constants';
import { isFeatureAvailable } from '../lib/preview';
import { createDescription, distributionValues } from '../lib/help';
// The gated subcommands are referenced only through this binding, and only from behind
// `__BREVO_PREVIEW__`. That is what lets esbuild drop them — and their three handler
// modules — from a published build. Importing any of those handlers directly here would
// make them live references again and ship the whole surface. See ./preview-definitions.ts.
import { previewAppCommands } from './preview-definitions';

import { initCommand } from './init';
import { loginCommand } from './login';
import { logoutCommand } from './logout';
import { whoamiCommand } from './whoami';
import { createCommand } from './app/create';
import { listCommand } from './app/list';
import { credentialsCommand } from './app/credentials';
import { uploadCommand } from './app/upload';
import { deleteCommand } from './app/delete';
import { scaffoldCommand } from './app/scaffold';
import { scopesCommand } from './app/scopes';
import { startCommand } from './app/start';
import { appInstallCommand } from './app/install';
import { appUninstallCommand } from './app/uninstall';
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
      description: createDescription(),
      // The `--distribution public` example is filtered out while public distribution
      // is pre-GA (BEX-405) — `brevo app create --help` must not advertise a value the
      // command will refuse. Filtered from the same table the refusal reads, so GA
      // restores it without an edit here.
      examples: [
        'brevo app create',
        'brevo app create --name "My App" --distribution private',
        ...(isFeatureAvailable('public-distribution')
          ? ['brevo app create --name "My App" --distribution public']
          : []),
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
        {
          flags: '--distribution <type>',
          description: `Distribution type (${distributionValues()})`,
        },
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
      name: 'credentials',
      description: 'Show client ID and secret for an app',
      examples: [
        `brevo app credentials --app-id ${EXAMPLE_APP_ID}`,
        `brevo app credentials --app-id ${EXAMPLE_APP_ID} --reveal-secret --json`,
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
      name: 'delete',
      description: 'Delete an app',
      examples: [
        `brevo app delete --app-id ${EXAMPLE_APP_ID}`,
        `brevo app delete --app-id ${EXAMPLE_APP_ID} --force`,
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
        deleteCommand({
          appId: opts.appId as string | undefined,
          force: Boolean(opts.force),
          json: Boolean(opts.json),
        }),
    },
    {
      name: 'scaffold',
      // Two modes, selected by whether cwd holds an app-config.json: inside a project it
      // adds a feature to the linked app; in a directory with none it sets that directory
      // up for an app that already exists — picked interactively, or named by --app-id
      // when there is no terminal to prompt on.
      description:
        'Add a feature to the app in this directory, or set an empty directory up for an existing app',
      examples: [
        'brevo app scaffold',
        `brevo app scaffold --app-id ${EXAMPLE_APP_ID}`,
        'brevo app scaffold --overwrite',
        'brevo app scaffold --json',
        `brevo app scaffold --app-id ${EXAMPLE_APP_ID} --json`,
      ],
      options: [
        {
          flags: '--app-id <id>',
          description: 'Set an empty directory up for an app you already have',
          parser: (v) => parseAppId(v),
        },
        {
          flags: '--overwrite',
          description: 'Overwrite existing feature files instead of merging (skips the prompt)',
        },
        { flags: '--json', description: 'Output as JSON' },
      ],
      handler: (opts) =>
        scaffoldCommand({
          appId: opts.appId as string | undefined,
          json: Boolean(opts.json),
          overwrite: Boolean(opts.overwrite),
        }),
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
    // Moved here from ./preview-definitions.ts when UI apps went GA. `requires` stays:
    // it is the capability the command applies to (UI apps only — see
    // `src/app-types/capabilities.ts`), and with its `FEATURE_STAGE` row at 'ga' it no
    // longer hides or refuses anything.
    {
      name: 'install',
      requires: 'account-install',
      description: 'Install an app into a Brevo account',
      arguments: [
        {
          name: '[account-id]',
          description: 'Brevo account (tenant) ID (defaults to your own account)',
        },
      ],
      examples: [
        'brevo app install',
        'brevo app install 99999',
        `brevo app install 99999 --app-id ${EXAMPLE_APP_ID}`,
        'brevo app install 99999 --force --json',
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
        appInstallCommand({
          accountId: accountId as string | undefined,
          appId: opts.appId as string | undefined,
          force: Boolean(opts.force),
          json: Boolean(opts.json),
        }),
    },
    {
      name: 'uninstall',
      requires: 'account-install',
      description: 'Uninstall an app from a Brevo account',
      arguments: [
        {
          name: '[account-id]',
          description: 'Brevo account (tenant) ID (defaults to your own account)',
        },
      ],
      examples: [
        'brevo app uninstall',
        'brevo app uninstall 99999',
        `brevo app uninstall 99999 --app-id ${EXAMPLE_APP_ID}`,
        'brevo app uninstall 99999 --force --json',
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
        appUninstallCommand({
          accountId: accountId as string | undefined,
          appId: opts.appId as string | undefined,
          force: Boolean(opts.force),
          json: Boolean(opts.json),
        }),
    },
    // ELIMINATION SITE — the raw global rather than `isFeatureAvailable()` on purpose:
    // esbuild substitutes the global here, folds the ternary to `[]`, and can then drop
    // `previewAppCommands` and the three handler modules only it imports. Importing the
    // constant instead leaves a runtime ternary and ships the whole gated surface. See
    // src/globals.d.ts.
    //
    // Appended, not interleaved, so the spread is one foldable expression. Ordering in
    // `brevo app --help` is unaffected in a public build (there is nothing to order);
    // a preview build simply lists these three last.
    ...(__BREVO_PREVIEW__ ? previewAppCommands : []),
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
