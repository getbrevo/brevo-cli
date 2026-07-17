import { CommandDefinition, SubcommandGroupDefinition } from '../lib/command-registry';
import {
  parseAppId,
  parsePositiveInt,
  collectUrls,
  collectScopes,
  validateUrl,
} from '../lib/validators';

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
import { scopesCommand } from './app/scopes';
import { startCommand } from './app/start';
import { installCommand as skillInstallCommand } from './skill/install';
import { uninstallCommand as skillUninstallCommand } from './skill/uninstall';
import { dpGenerateCommand } from './dp-functions/generate';
import { dpListCommand } from './dp-functions/list';
import { dpGetCommand } from './dp-functions/get';
import { dpDeleteCommand } from './dp-functions/delete';
import { dpPublishCommand } from './dp-functions/publish';
import { dpRunCommand } from './dp-functions/run';
import { dpValidateCommand } from './dp-functions/validate';
import { dpToolsCommand } from './dp-functions/tools';

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
        'brevo app create --name "My App" --distribution private --logo-uri https://example.com/logo.png',
      ],
      options: [
        { flags: '--name <name>', description: 'App name' },
        { flags: '--distribution <type>', description: 'Distribution type (private|public)' },
        {
          flags: '--redirect-uri <url>',
          description: 'Redirect URI (repeatable)',
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
      description: 'Update an app name, redirect URLs, scopes, or logo URL',
      examples: [
        'brevo app update',
        'brevo app update --name "My New Name"',
        'brevo app update --redirect-uri https://myapp.com/callback',
        'brevo app update --name "My App" --redirect-uri https://myapp.com/callback',
        'brevo app update --app-id 42 --name "My App"',
        'brevo app update --app-id 42 --redirect-uri https://myapp.com/callback --json',
        'brevo app update --logo-uri https://example.com/logo.png',
        'brevo app update --scope crm:write',
        'brevo app update --scope contacts:read --scope crm:write',
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
        {
          flags: '--scope <scope>',
          description:
            'OAuth scope to append (repeatable; comma- or whitespace-separated values are split)',
          parser: collectScopes,
        },
        {
          flags: '--logo-uri <url>',
          description: 'App logo URL (http or https)',
          parser: (v: string) => {
            validateUrl(v, 'logo URL');
            return v;
          },
        },
        { flags: '--yes', description: 'Skip confirmation prompt' },
        { flags: '--json', description: 'Output as JSON' },
      ],
      handler: (opts) =>
        updateCommand({
          appId: opts.appId,
          name: opts.name,
          redirectUri: opts.redirectUri,
          logoUri: opts.logoUri,
          scope: opts.scope,
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

export const dpCommandGroup: SubcommandGroupDefinition = {
  name: 'dp',
  description: 'Manage AI-generated enrichment functions (dp-functions)',
  commands: [
    {
      name: 'generate',
      description: 'Generate an enrichment function using AI (WebSocket, interactive)',
      arguments: [{ name: '<prompt>', description: 'Description of what the function should do' }],
      options: [
        { flags: '--context-file <path>', description: 'Path to JSON context file' },
        { flags: '--output <path>', description: 'Save generated code to file' },
        { flags: '--session-id <id>', description: 'Resume an existing generation session' },
        { flags: '--previous-code <path>', description: 'Path to previous code to improve' },
        { flags: '--no-questions', description: 'Skip clarifying Q&A (CI mode)' },
        { flags: '--json', description: 'Output as JSON' },
      ],
      examples: [
        'brevo dp generate "score contacts by email engagement"',
        'brevo dp generate "normalize phone numbers" --context-file ctx.json',
        'brevo dp generate "improve scoring" --previous-code score.js --session-id abc-123',
      ],
      handler: (opts, prompt) =>
        dpGenerateCommand({
          prompt: prompt as string,
          contextFile: opts.contextFile as string | undefined,
          output: opts.output as string | undefined,
          sessionId: opts.sessionId as string | undefined,
          previousCode: opts.previousCode as string | undefined,
          noQuestions: Boolean(opts.noQuestions),
          json: Boolean(opts.json),
        }),
    },
    {
      name: 'list',
      description: 'List all stored enrichment functions',
      options: [{ flags: '--json', description: 'Output as JSON' }],
      examples: ['brevo dp list', 'brevo dp list --json'],
      handler: (opts) => dpListCommand({ json: Boolean(opts.json) }),
    },
    {
      name: 'get',
      description: 'Get details of a stored function',
      arguments: [{ name: '<id>', description: 'Function ID' }],
      options: [
        { flags: '--output <path>', description: 'Save code to file' },
        { flags: '--json', description: 'Output as JSON' },
      ],
      examples: ['brevo dp get abc123', 'brevo dp get abc123 --output fn.js'],
      handler: (opts, id) =>
        dpGetCommand({
          id: id as string,
          output: opts.output as string | undefined,
          json: Boolean(opts.json),
        }),
    },
    {
      name: 'delete',
      description: 'Delete a stored function',
      arguments: [{ name: '<id>', description: 'Function ID' }],
      options: [
        { flags: '--force', description: 'Skip confirmation' },
        { flags: '--json', description: 'Output as JSON' },
      ],
      examples: ['brevo dp delete abc123', 'brevo dp delete abc123 --force'],
      handler: (opts, id) =>
        dpDeleteCommand({
          id: id as string,
          force: Boolean(opts.force),
          json: Boolean(opts.json),
        }),
    },
    {
      name: 'publish',
      description: 'Validate, test, and save an enrichment function',
      options: [
        { flags: '--file <path>', description: 'Path to JavaScript function file (required)' },
        { flags: '--name <name>', description: 'Function name' },
        { flags: '--description <desc>', description: 'Function description' },
        {
          flags: '--category <cat>',
          description: 'Category: contact, ecommerce, engagement, or revenue',
        },
        {
          flags: '--attribute-id <id>',
          description: 'Contact attribute key to write the result to',
        },
        {
          flags: '--scope <scope>',
          description: 'Scope: contact, objects, or order (repeatable)',
          parser: collectScopes,
        },
        { flags: '--data <json>', description: 'Inline JSON test data' },
        { flags: '--data-file <path>', description: 'Path to JSON test data file' },
        { flags: '--id <id>', description: 'Update existing function by ID' },
        { flags: '--json', description: 'Output as JSON' },
      ],
      examples: [
        'brevo dp publish --file fn.js --name "Lead Scorer" --category contact --attribute-id lead_score',
        'brevo dp publish --file fn.js --name "Scorer" --data \'{"email":"test@example.com"}\'',
      ],
      handler: (opts) =>
        dpPublishCommand({
          file: opts.file as string | undefined,
          name: opts.name as string | undefined,
          description: opts.description as string | undefined,
          category: opts.category as string | undefined,
          attributeId: opts.attributeId as string | undefined,
          scope: opts.scope as string[] | undefined,
          data: opts.data as string | undefined,
          dataFile: opts.dataFile as string | undefined,
          id: opts.id as string | undefined,
          json: Boolean(opts.json),
        }),
    },
    {
      name: 'run',
      description: 'Execute an enrichment function with contact data',
      options: [
        { flags: '--file <path>', description: 'Path to code file (ad-hoc execution)' },
        { flags: '--id <id>', description: 'Stored function ID' },
        { flags: '--data <json>', description: 'Inline JSON contact data' },
        { flags: '--data-file <path>', description: 'Path to JSON data file' },
        { flags: '--json', description: 'Output as JSON' },
      ],
      examples: [
        'brevo dp run --file fn.js --data \'{"email":"test@example.com"}\'',
        'brevo dp run --id abc123 --data-file contact.json',
      ],
      handler: (opts) =>
        dpRunCommand({
          file: opts.file as string | undefined,
          id: opts.id as string | undefined,
          data: opts.data as string | undefined,
          dataFile: opts.dataFile as string | undefined,
          json: Boolean(opts.json),
        }),
    },
    {
      name: 'validate',
      description: 'Validate ES5 syntax of a function file',
      arguments: [{ name: '<file>', description: 'Path to JavaScript file' }],
      options: [{ flags: '--json', description: 'Output as JSON' }],
      examples: ['brevo dp validate fn.js'],
      handler: (opts, file) =>
        dpValidateCommand({
          file: file as string,
          json: Boolean(opts.json),
        }),
    },
    {
      name: 'tools',
      description: 'List available MCP tools',
      options: [{ flags: '--json', description: 'Output as JSON' }],
      examples: ['brevo dp tools', 'brevo dp tools --json'],
      handler: (opts) => dpToolsCommand({ json: Boolean(opts.json) }),
    },
  ],
};
