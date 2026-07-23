import { CLI, BREVO_CLI_REFERENCE_URL, BREVO_OAUTH_SCOPES_DOCS_URL } from '../lib/constants';

export const messages = {
  // Update notifier
  UPDATE_AVAILABLE: (current: string, latest: string): string =>
    `Update available: ${current} → ${latest}`,
  UPDATE_RUN: (name: string): string => `Run: npm install -g ${name}`,
  UPDATE_RUN_YARN: (name: string): string => `Or:  yarn global add ${name}`,
  // Homebrew formula is `brevo` (tap getbrevo/tap), not the npm package name.
  UPDATE_RUN_BREW: 'Or:  brew upgrade brevo',

  // Force update (major-version behind — blocks the command)
  FORCE_UPDATE_REQUIRED: (current: string, latest: string): string =>
    `Update required: v${current} is no longer supported (latest v${latest}).`,
  FORCE_UPDATE_HINT: 'Update to continue using the Brevo CLI:',

  // Auth
  AUTH_WELCOME: 'Welcome to Brevo CLI',
  AUTH_PROMPT_METHOD: 'How would you like to authenticate?',
  AUTH_PROMPT_API_KEY: 'Paste your API key:',
  AUTH_SUCCESS: (email: string) => `Authenticated as ${email}`,
  AUTH_INVALID_KEY: 'Invalid API key. Please check and try again.',
  AUTH_HINT: (keysUrl: string, docsUrl: string) =>
    `\n  To authenticate, you need a Brevo API key.\n  Create one at: ${keysUrl}\n  Docs: ${docsUrl}\n`,
  AUTH_SAVED: (path: string) => `Credentials saved to ${path}`,
  AUTH_NEXT: `Next: ${CLI.APP_CREATE}`,
  AUTH_CREATE_APP_PROMPT: 'Would you like to create an app?',
  AUTH_NOT_LOGGED_IN: 'Not currently authenticated.',
  AUTH_LOGGED_OUT: 'Credentials cleared.',
  AUTH_LOGGED_OUT_WITH_APPS: (count: number) =>
    `Credentials cleared, including cached credentials for ${count} app${count === 1 ? '' : 's'}.`,
  AUTH_LOGOUT_APP_WARNING:
    'You have cached app credentials (clientId/clientSecret) that cannot be recovered after logout.\n    Run `brevo app credentials --reveal-secret` to view them before proceeding.',
  AUTH_LOGOUT_CONFIRM: 'Proceed with logout?',
  AUTH_EXPIRED: 'Your API key is invalid or expired.',
  AUTH_EXPIRED_PROMPT: 'Enter a new API key:',
  AUTH_GET_KEY_URL: 'Create an API key at: https://app.brevo.com/settings/keys/api',
  AUTH_BROWSER_OPENING: 'Opening your browser to log you in...',
  AUTH_BROWSER_FALLBACK_URL: (url: string) =>
    `If your browser didn't open automatically, open this URL to log in:\n  ${url}`,
  AUTH_BROWSER_WAITING: 'Waiting for login to complete (Ctrl+C to cancel)...',
  AUTH_BROWSER_TOKENS_RECEIVED: (path: string) =>
    `Login complete. Credentials saved to ${path}. Verifying account...`,
  AUTH_BROWSER_TIMEOUT:
    'Login timed out before we received a response from the browser.\n  If you were completing 2FA, close the browser tab and run `brevo login` again.\n  For non-interactive use, set BREVO_API_KEY instead.',
  AUTH_BROWSER_CANCELLED: 'Login cancelled.',
  AUTH_BROWSER_BAD_PAYLOAD: 'Unexpected response from the login service. Please try again.',
  AUTH_BROWSER_NON_INTERACTIVE:
    'Browser login needs an interactive terminal. Set BREVO_API_KEY to authenticate non-interactively.',

  // Whoami
  WHOAMI_AUTHENTICATED: (email: string, company: string) =>
    `Authenticated as ${email} (${company})`,
  WHOAMI_NOT_AUTHENTICATED: `Not authenticated. Run: ${CLI.LOGIN}`,
  WHOAMI_CREDENTIAL_MISMATCH: (fields: string[]) =>
    `Local credentials mismatch with API for: ${fields.join(', ')}. Run \`${CLI.LOGIN}\` to re-authenticate.`,

  // App create
  APP_CREATE_NAME_PROMPT: 'App name:',
  APP_CREATE_TYPE_PROMPT: 'Distribution type?',
  APP_CREATE_SUCCESS: 'App created.',
  APP_CREATE_NAME_TAKEN: 'That name is already taken. Try a different name.',
  APP_CREATE_REDIRECT_PROMPT:
    'OAuth callback URL — where users are sent after authorizing your app:',
  APP_CREATE_REDIRECT_HINT: (cmd: string) =>
    `Tip: The default below is a local test-server callback URL, used when you run \`${cmd}\`. Keep it to test your app locally, then add your production callback URL when you go live.`,
  APP_CREATE_REDIRECT_ANOTHER: 'Add another redirect URL?',
  APP_CREATE_REDIRECT_EMPTY: 'Redirect URL cannot be empty',
  APP_CREATE_REDIRECT_INVALID: 'Invalid format. Must start with http:// or https://',
  APP_CREATE_LOGO_PROMPT:
    'App logo URL (e.g. https://example.com/logo.png, optional — leave blank to skip):',
  APP_CREATE_LOGO_INVALID:
    'Invalid format. Must be a valid https:// URL (e.g. https://example.com/logo.png).',
  APP_CREATE_PORT_IN_USE: (port: number, available: number) =>
    `Port ${port} is in use. Defaulting to port ${available}.`,
  APP_CREATE_PORT_SCAN_FAILED: (port: number) =>
    `Warning: Could not find a free port near ${port}. Defaulting to ${port} — it may conflict with a running process.`,
  APP_CREATE_LIMIT_REACHED:
    'You have reached the maximum number of OAuth apps allowed for your account. To make room, delete an existing app: brevo app delete',
  APP_CREATE_BOX_TITLE: 'App created',
  APP_CREATE_BOX_SCOPES_LABEL: 'Default scopes:',
  APP_CREATE_BOX_SCOPE_HINT: `You can add more scopes later by editing \`auth.scopes\` in app-config.json and running \`${CLI.APP_UPLOAD}\`.`,
  APP_CREATE_JSON_SCAFFOLD_DIR_EXISTS: (dir: string, appId: string) =>
    `Skipped scaffold: directory already exists (${dir}). Run \`${CLI.APP_SCAFFOLD(appId)}\` to choose a different path.`,
  APP_CREATE_DIR_EXISTS_SKIPPED: (dir: string) =>
    `Skipped scaffolding: directory already exists (${dir}). Run \`${CLI.APP_SCAFFOLD()}\` to choose a different path.`,
  APP_CREATE_ALREADY_LINKED: (name: string) =>
    `App "${name}" is already linked in this directory (app-config.json found). Move to a different directory to create a new app, or run \`${CLI.APP_SCAFFOLD()}\` here to refresh this project against the server.`,
  APP_CREATE_DIR_UNRESOLVED: 'Could not resolve the output directory for scaffolding.',

  // App list
  APP_LIST_EMPTY: `No apps found. Create one with: ${CLI.APP_CREATE}`,
  APP_LIST_HEADER: 'Your OAuth apps:',

  // App credentials
  APP_CREDENTIALS_REVEAL_CONFIRM: 'Are you sure you want to reveal the client secret?',
  APP_CREDENTIALS_SELECT: 'Select an app:',
  CLIENT_SECRET_HIDDEN_HUMAN: `[hidden — run \`${CLI.APP_CREDENTIALS_REVEAL()}\`]`,
  CLIENT_SECRET_HIDDEN_JSON: '[hidden]',
  CLIENT_SECRET_NOT_AVAILABLE: '[not available]',

  // App upload
  APP_UPLOAD_NO_CONFIG: `No app-config.json found in this directory. Run \`${CLI.APP_UPLOAD}\` from the project directory that has your app's app-config.json, or run \`${CLI.APP_CREATE}\` / \`${CLI.APP_SCAFFOLD()}\` to set one up.`,
  APP_UPLOAD_INVALID_JSON: `app-config.json contains invalid JSON. Fix the file, or run \`${CLI.APP_SCAFFOLD()}\` to regenerate it.`,
  APP_UPLOAD_MISSING_APP_ID: `app-config.json is missing "appId". Fix the file, or run \`${CLI.APP_SCAFFOLD()}\` to regenerate it.`,
  APP_UPLOAD_NO_REDIRECT_URLS: 'app-config.json has no redirect URLs configured.',
  APP_UPLOAD_INVALID_REDIRECT_URL: (url: string) =>
    `Invalid redirect URL "${url}". Must be a valid http:// or https:// URL.`,
  APP_UPLOAD_INVALID_REDIRECT_PROTOCOL: (url: string) =>
    `Invalid redirect URL "${url}". Must use http:// or https://.`,
  APP_UPLOAD_SUMMARY: 'Upload summary:',
  APP_UPLOAD_CONFIRM: 'Proceed with upload?',
  APP_UPLOAD_CANCELLED: 'Upload cancelled.',
  APP_UPLOAD_SUCCESS: 'App uploaded.',
  APP_UPLOAD_UP_TO_DATE: (version: string) => `Already up to date at version ${version}.`,

  // Legacy 'all' scope deprecation (BEX-214)
  LEGACY_ALL_SCOPE_DEPRECATED_BLOCK: `This app currently has the legacy 'all' OAuth scope, which is being deprecated.\n  Replace 'all' with the specific scopes your integration uses in app-config.json's \`auth.scopes\`.\n  Run \`${CLI.APP_SCOPES}\` to see the catalog, then run \`${CLI.APP_UPLOAD}\` to migrate.`,
  LEGACY_ALL_SCOPE_START_BLOCK: `This app's auth.scopes in app-config.json still contains the legacy 'all' OAuth scope, which is being deprecated.\n  Replace 'all' with the specific scopes your integration uses (run \`${CLI.APP_SCOPES}\` to see the catalog),\n  migrate by editing \`auth.scopes\` and running \`${CLI.APP_UPLOAD}\`, then re-run \`${CLI.APP_START('oauth')}\`.`,
  LEGACY_ALL_SCOPE_LIST_TAG: ` (legacy 'all' — deprecated)`,
  LEGACY_ALL_SCOPE_SCAFFOLD_SUBSTITUTED: (writtenScopes: string): string =>
    `This app still has the legacy 'all' OAuth scope (deprecated). Wrote ${writtenScopes} to app-config.json instead of 'all'. Migrate the app by editing \`auth.scopes\` and running \`${CLI.APP_UPLOAD}\`.`,
  LEGACY_ALL_SCOPE_UPDATE_MIGRATING: `Migrating from legacy 'all' scope — 'all' will be removed.`,

  // App delete
  APP_DELETE_CONFIRM: (name: string, id: string) =>
    `Delete app "${name}" (${id})? This cannot be undone.`,
  APP_DELETE_SUCCESS: (id: string) => `App ${id} deleted.`,
  APP_DELETE_CANCELLED: 'Delete cancelled.',
  APP_DELETE_FOLDER_CONFIRM: (dir: string) => `Delete the local project folder at ${dir}?`,
  APP_DELETE_FOLDER_SUCCESS: (dir: string) => `Project folder deleted: ${dir}`,
  APP_DELETE_FOLDER_FAILED: (dir: string) => `Could not delete folder ${dir}. Remove it manually.`,

  // App scaffold
  APP_SCAFFOLD_DIR_PROMPT: 'Output directory:',
  APP_SCAFFOLD_DIR_EXISTS: 'Directory already exists. What would you like to do?',
  APP_SCAFFOLD_PROJECT_TYPE_PROMPT: 'What kind of project do you want to scaffold?',
  APP_SCAFFOLD_DIFF_INTRO: (name: string) =>
    `App "${name}" is linked here, but its local config differs from the server:`,
  APP_SCAFFOLD_DIFF_LINE: (field: string, local: string, server: string) =>
    `  ${field}: ${local} → ${server}`,
  APP_SCAFFOLD_DIFF_CONFIRM:
    'Update app-config.json and regenerate scaffold files to match the server?',
  APP_SCAFFOLD_DIFFERENT_APP_PROMPT: (name: string) =>
    `This directory is linked to a different app ("${name}"). What would you like to do?`,
  APP_SCAFFOLD_CANCELLED: 'Scaffold cancelled.',
  APP_SCAFFOLD_JSON_DIR_EXISTS: (dir: string) =>
    `Target directory already exists (${dir}). --json cannot prompt to overwrite, merge, or choose a different path. Re-run without --json to resolve interactively, or point at a fresh directory.`,
  APP_SCAFFOLD_JSON_DIFF_CANCELLED:
    'app-config.json differs from the server and --json cannot prompt for confirmation. Re-run without --json to review and confirm the update.',
  APP_SCAFFOLD_JSON_DIFFERENT_APP_CANCELLED:
    'This directory is linked to a different app and --json cannot prompt to choose a new path. Run from a different directory, or re-run without --json.',
  APP_SCAFFOLD_SUCCESS: (count: number) => `Test app scaffolded (${count} files)`,
  APP_SCAFFOLD_TARGET_IS_CWD: 'Scaffolding into the current directory.',
  APP_SCAFFOLD_CREATING_DIR: (dir: string) => `Creating ${dir} and moving into it...`,
  APP_SCAFFOLD_NEXT_STEPS_TITLE: 'Next steps',
  // `cdDir` is the path (relative to the shell the user actually typed the
  // command in) they need to `cd` into. It's undefined when scaffolding
  // landed in that same directory, since process.chdir() inside the CLI
  // only moves the CLI's own process, never the user's shell.
  APP_SCAFFOLD_NEXT_STEPS_LINES: (cdDir?: string) => [
    ...(cdDir ? [`1. cd ${cdDir}`] : []),
    `${cdDir ? 2 : 1}. yarn --cwd src/oauth`,
    `   (or: npm --prefix src/oauth install)`,
    `${cdDir ? 3 : 2}. ${CLI.APP_START('oauth')}`,
  ],
  APP_SCAFFOLD_SCOPES_TIP: `Tip: list available scopes with \`${CLI.APP_SCOPES}\`. Update scopes by editing \`auth.scopes\` in app-config.json and running \`${CLI.APP_UPLOAD}\`.`,

  // App start
  APP_START_FEATURE_NOT_FOUND: (entryFile: string) =>
    `Feature entry file not found.\n\n  Expected: ${entryFile}\n  Current directory: ${process.cwd()}\n\n  Make sure you are inside your scaffolded project directory.\n  Run \`cd <your-project-folder>\` and try again.`,
  APP_START_NO_DEPS: (featureDir: string) =>
    `Dependencies not installed. Run \`yarn --cwd ${featureDir}\` (or \`npm --prefix ${featureDir} install\`) first.`,
  APP_START_STOPPED: 'Process stopped.',
  APP_START_MISSING_FEATURE: (available: string) =>
    `Missing feature name.\n\nAvailable features:\n${available}\n\nUsage: ${CLI.APP_START()}`,
  APP_START_UNKNOWN_FEATURE: (feature: string, available: string) =>
    `Unknown feature "${feature}". Available features: ${available}`,
  APP_START_PORT_IN_USE: (port: number) =>
    `Port ${port} is already in use.\n\n  Either stop the process using port ${port}, use a different port with \`--port <port>\`,\n  or update your redirect URL by editing \`auth.redirectUrls\` in app-config.json and running \`${CLI.APP_UPLOAD}\`.`,
  APP_START_CUSTOM_PORT_IN_USE: (port: number) =>
    `Port ${port} is already in use.\n\n  Stop the process using port ${port}, or pick another port with \`--port <port>\`\n  and update your redirect URL by editing \`auth.redirectUrls\` in app-config.json and running \`${CLI.APP_UPLOAD}\`.`,
  APP_START_EXITED: (feature: string, code: number) => `${feature} exited with code ${code}`,
  APP_START_FAILED: (feature: string, error: string) => `Failed to start ${feature}: ${error}`,
  APP_START_REDIRECT_NOT_REGISTERED: (port: number) =>
    `Port ${port} isn't registered as a redirect URL for this app.`,
  APP_START_REDIRECT_REGISTER_PROMPT: (url: string) =>
    `Register ${url}? You can delete it later if you want.`,
  APP_START_REDIRECT_REGISTERING: 'Registering redirect URL...',
  APP_START_REDIRECT_REGISTERED: (url: string) => `Registered ${url}.`,
  APP_START_REDIRECT_DECLINED: (url: string) =>
    `Continuing without registering. The OAuth callback at ${url} will fail until you register it. Add it to \`auth.redirectUrls\` in app-config.json and run \`${CLI.APP_UPLOAD}\` to register later.`,
  APP_START_REDIRECT_NON_INTERACTIVE: (port: number, url: string) =>
    `Port ${port} is not registered as a redirect URL for this app, and we can't prompt in non-interactive mode. Add \`${url}\` to \`auth.redirectUrls\` in app-config.json and run \`${CLI.APP_UPLOAD}\` first, or re-run interactively.`,

  AUTH_LOGOUT_NON_INTERACTIVE:
    'Cannot prompt for confirmation in non-interactive mode. Use --force to skip.',

  // Errors
  ERR_NETWORK: 'Cannot reach Brevo API.',
  ERR_RATE_LIMITED: (retryAfter: number) => `Rate limited. Retrying in ${retryAfter} seconds...`,
  ERR_REGISTRY: 'Operation failed due to a registry error. Please try again.',
  ERR_AUTH_GATEWAY:
    'API is behind an authentication gateway (e.g. Cloudflare Access). Sign in via your browser first, or check your API base URL.',

  // Security warnings
  TLS_VERIFICATION_DISABLED:
    'TLS certificate verification is disabled (NODE_TLS_REJECT_UNAUTHORIZED=0). This is insecure — API keys and tokens can be intercepted on the network.',

  // Init
  INIT_WELCOME: 'Brevo CLI — Quick Setup',
  INIT_ALREADY_LOGGED_IN: 'Already authenticated.',
  INIT_STEP_LOGIN: '  Step 1: Authenticate with your Brevo account',
  INIT_STEP_CREATE: '  Step 2: Create your first OAuth app',
  INIT_APPS_EXIST: (count: number) => `You have ${count} app${count === 1 ? '' : 's'} already.`,
  INIT_APP_LINKED: (name: string) => `App "${name}" is linked to this project (app-config.json).`,
  INIT_APP_ACTION: 'What would you like to do?',
  INIT_DONE: `All set! Run \`${CLI.APP_START('oauth')}\` to test your OAuth flow, or \`${CLI.HELP}\` to see all commands.`,

  // Skill
  SKILL_INSTALL_SUCCESS: (name: string, version: string, dir: string) =>
    `Installed ${name}@${version} → ${dir}`,
  SKILL_INSTALL_CLAUDE_ONLY:
    'This skill is consumed by Claude Code. Other AI tools (Claude Desktop chat, Cursor, Copilot CLI, Gemini, etc.) should reference agent-context/AGENTS.md from the @getbrevo/cli npm package instead.',
  SKILL_INSTALL_ALREADY: (name: string, version: string) =>
    `${name}@${version} is already up to date.`,
  SKILL_UNINSTALL_SUCCESS: (name: string, dir: string) => `Uninstalled ${name} from ${dir}`,
  SKILL_UNINSTALL_NONE: 'No Brevo skills installed.',
  SKILL_AUTOREFRESHED: (name: string, oldVer: string, newVer: string) =>
    `↻ refreshed ${name} skill (v${oldVer} → v${newVer})`,
  SKILL_AUTOREFRESH_FAILED: (name: string, err: string) =>
    `⚠ failed to refresh ${name} skill: ${err}`,

  // App scopes
  APP_SCOPES_EMPTY: 'The IdP returned an empty scope list.',
  APP_SCOPES_USAGE_HINT: `Add a scope to an app by editing \`auth.scopes\` in app-config.json and running \`${CLI.APP_UPLOAD}\`.`,
  APP_SCOPES_DOCS_HINT: `Full CLI reference: ${BREVO_CLI_REFERENCE_URL}`,
  APP_SCOPES_CATALOG_DOCS_HINT: `Scope catalog docs: ${BREVO_OAUTH_SCOPES_DOCS_URL}`,
  APP_SCOPES_WEB_LISTENING: (url: string): string => `Open in browser: ${url} (Ctrl+C to stop)`,
  APP_SCOPES_WEB_TITLE: 'Brevo OAuth scopes',
  APP_SCOPES_WEB_INTRO: (count: number, sourceUrl: string): string =>
    `${count} scope${count === 1 ? '' : 's'} from ${sourceUrl}`,
  APP_SCOPES_WEB_SEARCH_PLACEHOLDER: 'Filter scopes…',
  APP_SCOPES_WEB_EMPTY: 'The IdP returned an empty scope list.',
  APP_SCOPES_WEB_FOOTER: 'Served locally by the Brevo CLI. Press Ctrl+C in the terminal to stop.',
  APP_SCOPES_WEB_REFRESH: 'Refresh',
  APP_SCOPES_WEB_REFRESHING: 'Refreshing…',
  APP_SCOPES_WEB_REFRESH_FAILED: `Refresh failed. Please restart \`${CLI.APP_SCOPES} --web\` to retry.`,
  APP_SCOPES_WEB_ENDPOINTS_LABEL: 'API endpoints',
  APP_SCOPES_WEB_NO_ENDPOINTS: 'No API endpoints listed for this scope.',
  APP_SCOPES_WEB_COPY: 'Copy',
  APP_SCOPES_WEB_COPIED: 'Copied!',
  // {category} / {scope} are replaced client-side in the web page script.
  APP_SCOPES_WEB_COPY_CATEGORY_ARIA: 'Copy {category} scopes',
  APP_SCOPES_WEB_SELECT_SCOPE_ARIA: 'Select {scope}',
  APP_SCOPES_WEB_COPY_SELECTED: 'Copy selected',
  APP_SCOPES_WEB_SELECTED_PLACEHOLDER: `Tick scopes to build a comma-separated list for app-config.json's \`auth.scopes\``,
  APP_SCOPES_WEB_LEGACY_BADGE: 'deprecated',
  APP_SCOPES_WEB_LEGACY_TITLE: `Legacy 'all' scope — replace with the granular scopes your integration uses.`,
  APP_SCOPES_WEB_DOCS_LINK: 'Full CLI reference',
  APP_SCOPES_WEB_CATALOG_DOCS_CTA: 'Read the scope catalog docs',
  OAUTH_METADATA_MISSING_SCOPES: 'IdP scopes response did not include a scopes array.',
  OAUTH_METADATA_FETCH_FAILED: (url: string, status: number): string =>
    `Failed to fetch OAuth scopes from ${url} (HTTP ${status}).`,

  // General
  ABORTED: 'Aborted.',
} as const;
