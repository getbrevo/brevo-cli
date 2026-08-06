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
  APP_CREATE_APP_TYPE_PROMPT: 'What type of app are you building?',
  APP_CREATE_APP_TYPE_OAUTH:
    'OAuth app  (Authorize against Brevo and call the API on a user’s behalf)',
  APP_CREATE_APP_TYPE_UI: 'UI app     (Render inside Brevo — opens your app from a record)',
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
  APP_CREATE_SCAFFOLD_FEATURE_PROMPT: 'Do you want to scaffold a feature?',
  APP_CREATE_BASE_SUCCESS: (count: number) => `Project structure created (${count} files)`,
  APP_CREATE_BASE_ONLY_NEXT: (cdDir?: string): string[] => [
    ...(cdDir ? [`1. cd ${cdDir}`] : []),
    `${cdDir ? 2 : 1}. ${CLI.APP_SCAFFOLD}   (add a feature — e.g. the OAuth test server)`,
  ],
  APP_CREATE_JSON_SCAFFOLD_DIR_EXISTS: (dir: string) =>
    `Skipped scaffold: directory already exists (${dir}). cd into it and run \`${CLI.APP_SCAFFOLD}\` to add a feature.`,
  APP_CREATE_DIR_EXISTS_SKIPPED: (dir: string) =>
    `Skipped scaffolding: directory already exists (${dir}). cd into it and run \`${CLI.APP_SCAFFOLD}\` to add a feature.`,
  APP_CREATE_ALREADY_LINKED: (name: string) =>
    `App "${name}" is already linked in this directory (app-config.json found). Move to a different directory to create a new app, or run \`${CLI.APP_SCAFFOLD}\` here to add a feature to this project.`,
  APP_CREATE_DIR_UNRESOLVED: 'Could not resolve the output directory for scaffolding.',

  // App create — UI app (BEX-290)
  // Placement choices are read from the platform's extension-point registry at prompt
  // time (BEX-361) — fetch-only, no local fallback, so a partner can never author a slot
  // the platform doesn't have. Two loads: the record pages, then the placements on the
  // pages that were picked.
  APP_CREATE_UI_PAGES_SPINNER: 'Loading record pages...',
  APP_CREATE_UI_POINTS_SPINNER: 'Loading placements...',
  APP_CREATE_UI_POINTS_FETCH_FAILED:
    'Could not load the available placements from the Brevo API — the UI-app flow needs them to offer where your app can appear. Check your connection and try again. Creating an OAuth app does not need this and still works.',
  APP_CREATE_UI_POINTS_EMPTY:
    'The Brevo API returned no available placements for UI apps. This usually means the extension-point registry has not been seeded in this environment — try again later.',
  // Raised when the registry has rows, but none of them can serve the chosen extension
  // type. Distinct from the empty case: the fix is a different integration type, not
  // waiting for a seed.
  APP_CREATE_UI_POINTS_NONE_FOR_TYPE: (extensionType: string) =>
    `None of the available placements can host a "${extensionType}" extension. This environment's extension-point registry may predate it — try again later.`,
  APP_CREATE_UI_SURFACE_PROMPT: 'Which record pages should it appear on?',
  APP_CREATE_UI_SURFACE_REQUIRED: 'Pick at least one record page.',
  // One prompt for every placement on every picked page, grouped by page. Replaces the
  // old kind-then-place pair: kind is a property of the slot, not a question — a partner
  // picking "Header menu" has already said they want a menu entry.
  APP_CREATE_UI_PLACEMENT_PROMPT: 'Where should it appear on those pages?',
  APP_CREATE_UI_PLACEMENT_REQUIRED: 'Pick at least one spot.',
  // Guards the one way the grouped prompt can quietly do less than the partner asked
  // for: picking three pages and then ticking spots on only one.
  APP_CREATE_UI_PLACEMENT_PAGE_MISSING: (pages: string[]) =>
    `Pick at least one spot on every page you chose — nothing selected for: ${pages.join(', ')}.`,
  // Printed BEFORE the prompt, as a warning, when the registry offers no spot on a page
  // that was picked. It cannot be a prompt rule: no answer would satisfy one.
  APP_CREATE_UI_PLACEMENT_PAGES_DROPPED: (pages: string[]) =>
    `No placements are available on: ${pages.join(', ')}. Those pages are skipped — the registry offers no spot there for this integration type.`,
  // Suffixes on each placement choice, so the shape a slot renders as is visible while
  // choosing rather than a surprise afterwards.
  APP_CREATE_UI_PLACEMENT_MENU_SUFFIX: 'menu entry',
  APP_CREATE_UI_PLACEMENT_CARD_SUFFIX: 'card',
  // Integration type — asked SECOND, before any placement, because it is the decision a
  // partner arrives with. Only Link is selectable; Iframe is shown disabled so the
  // roadmap is visible where the choice is being made rather than hidden.
  APP_CREATE_UI_INTEGRATION_PROMPT: 'Do you want to add a link or an iframe?',
  APP_CREATE_UI_INTEGRATION_EXTERNAL_LINK: 'Link            (Opens your URL in a new tab)',
  APP_CREATE_UI_INTEGRATION_MODAL_IFRAME: 'Iframe          (Embeds your page in a modal)',
  APP_CREATE_UI_INTEGRATION_COMING_SOON: 'coming soon',
  // Each field says what it renders as, so a partner filling the form knows what
  // they are writing. Both fields render in two places, and the prompt names both:
  // `label` is the menu entry's text AND a card's CTA button, `more_info` is the
  // menu entry's second line AND a card's description.
  APP_CREATE_UI_LABEL_PROMPT: 'Label — the menu entry text, and the button text on a card:',
  APP_CREATE_UI_MORE_INFO_PROMPT:
    'More info — supporting text under the menu entry, and a card’s description (optional):',
  APP_CREATE_UI_REDIRECT_LINK_PROMPT:
    'Redirect link — the destination URL your app opens (record context arrives as query parameters):',
  APP_CREATE_UI_BOX_TITLE: 'UI app created',
  // `label` labels the menu entry (BEX-290). The one piece of rendered text that has
  // no field is a CARD's title, which is the app name — worth saying, since it is now
  // the only place a partner might hunt for a field that doesn't exist.
  APP_CREATE_UI_BOX_LABEL_NOTE: (label: string, appName: string) =>
    `The menu entry is labelled "${label}". On a card that text becomes the button, and the card's title is the app name ("${appName}").`,
  // Record context reaches the partner's endpoint as query parameters only — there is
  // no path templating — so the summary prints the exact URL shape to build against.
  APP_CREATE_UI_BOX_EXAMPLE_URL_LABEL: 'Brevo will open, for example:',
  APP_CREATE_UI_BOX_EXAMPLE_URL_NOTE:
    'Values are placeholders. Read them as query parameters — the path is never templated.',
  APP_CREATE_UI_BOX_HINT: `Edit the \`ui_app\` block in app-config.json to change any of this, then run \`${CLI.APP_UPLOAD}\`.`,
  APP_CREATE_UI_NEXT: (cdDir?: string): string[] => [
    ...(cdDir ? [`1. cd ${cdDir}`] : []),
    `${cdDir ? 2 : 1}. ${CLI.APP_UPLOAD}              (validate and save your configuration)`,
    `${cdDir ? 3 : 2}. ${CLI.APP_DEPLOY()}   (make it available in an account)`,
  ],

  // App list
  APP_LIST_EMPTY: `No apps found. Create one with: ${CLI.APP_CREATE}`,
  APP_LIST_HEADER: 'Your OAuth apps:',

  // App credentials
  APP_CREDENTIALS_REVEAL_CONFIRM: 'Are you sure you want to reveal the client secret?',
  APP_CREDENTIALS_SELECT: 'Select an app:',
  CLIENT_SECRET_HIDDEN_HUMAN: `[hidden — run \`${CLI.APP_CREDENTIALS_REVEAL()}\`]`,
  CLIENT_SECRET_HIDDEN_JSON: '[hidden]',
  CLIENT_SECRET_NOT_AVAILABLE: '[not available]',
  APP_CREDENTIALS_CONFIG_BACKFILLED: (fields: string[]) =>
    `Backfilled ${fields.join(', ')} into app-config.json.`,

  // App upload
  APP_UPLOAD_NO_CONFIG: `No app-config.json found in this directory. Run \`${CLI.APP_UPLOAD}\` from the project directory that has your app's app-config.json, or run \`${CLI.APP_CREATE}\` / \`${CLI.APP_SCAFFOLD}\` to set one up.`,
  APP_UPLOAD_INVALID_JSON: `app-config.json contains invalid JSON. Fix the file, or run \`${CLI.APP_SCAFFOLD}\` to regenerate it.`,
  APP_UPLOAD_MISSING_APP_ID: `app-config.json is missing "appId". Fix the file, or run \`${CLI.APP_SCAFFOLD}\` to regenerate it.`,
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
  // UI apps have no OAuth callback, so the redirect-URL requirement is
  // OAuth-only — this message names the app type to make that explicit.
  APP_UPLOAD_NO_REDIRECT_URLS_OAUTH:
    'app-config.json has no redirect URLs configured. OAuth apps need at least one — add it to `auth.redirectUris`.',
  APP_UPLOAD_UI_APP_SUMMARY: 'UI app:',
  // app-config.json does not carry link_target — upload injects it — so the diff row
  // says where the value comes from rather than implying there is a field to edit.
  APP_UPLOAD_UI_LINK_TARGET_NOTE: '(added on upload; not a field in app-config.json)',
  // Auth-shape mismatches are hard errors, not silent ignores — the CLI is the
  // only layer that will ever tell the partner (see validateAuthShape).
  APP_UPLOAD_UI_APP_AUTH_EMPTY_REQUIRED:
    'This is a UI app (app-config.json has a `ui_app` block), so it uses no OAuth — set `auth` to `{}`.',
  APP_UPLOAD_UI_APP_AUTH_HAS_OAUTH_FIELDS:
    "UI apps don't use OAuth — remove `scopes` and `redirectUris` from `auth` and keep it empty (`{}`).",

  // App deploy / rollback — per-account availability for UI apps (BEX-290)
  APP_DEPLOY_SELECT: 'Select an app to deploy:',
  APP_DEPLOY_CONFIRM: (name: string, appId: string, accountId: string) =>
    `Deploy app "${name}" (${appId}) to account ${accountId}?`,
  APP_DEPLOY_CANCELLED: 'Deploy cancelled.',
  APP_DEPLOY_SUCCESS: (appId: string, accountId: string) =>
    `App ${appId} deployed to account ${accountId}.`,
  APP_DEPLOY_MISSING_ACCOUNT_ID: `Missing account ID.\n\n  Usage: ${CLI.APP_DEPLOY()}`,
  // The spec's installation flow requires deploy to refuse until the config has
  // been validated by an upload. `version` is only ever written by a successful
  // upload, so its absence is a reliable local signal.
  APP_DEPLOY_NOT_UPLOADED: `Please first validate your configuration with \`${CLI.APP_UPLOAD}\`.`,
  APP_ROLLBACK_SELECT: 'Select an app to roll back:',
  APP_ROLLBACK_CONFIRM: (name: string, appId: string, accountId: string) =>
    `Roll back app "${name}" (${appId}) from account ${accountId}?`,
  APP_ROLLBACK_CANCELLED: 'Rollback cancelled.',
  APP_ROLLBACK_SUCCESS: (appId: string, accountId: string) =>
    `App ${appId} rolled back from account ${accountId}.`,
  APP_ROLLBACK_MISSING_ACCOUNT_ID: `Missing account ID.\n\n  Usage: ${CLI.APP_ROLLBACK()}`,
  APP_ROLLBACK_NOT_DEPLOYED: (appId: string, accountId: string) =>
    `App ${appId} is not deployed to account ${accountId}.`,
  APP_DEPLOY_NON_INTERACTIVE:
    'Cannot prompt for confirmation in non-interactive mode. Use --force or --json to skip.',
  APP_UPLOAD_DISTRIBUTION_IMMUTABLE: (current: string, next: string) =>
    `distribution_type cannot be changed via upload — this app is "${current}" on Brevo, but app-config.json says "${next}".\n  Edit \`distribution_type\` in app-config.json back to "${current}", or create a new ${next} app with \`${CLI.APP_CREATE}\`.`,

  // App submit (BEX-221)
  APP_SUBMIT_CHECKING_STATUS: 'Checking app status...',
  APP_SUBMIT_FETCHING: 'Fetching app...',
  APP_SUBMIT_PICK_APP: 'Which app do you want to submit for review?',
  APP_SUBMIT_NO_APP_RESOLVED:
    'Cannot determine which app to submit. Provide --app-id or run from a directory with app-config.json.',
  APP_SUBMIT_NOT_FOUND: (appId: string): string => `App ${appId} not found.`,
  APP_SUBMIT_NOT_PUBLIC: (appId: string): string =>
    `App ${appId} is private. Private apps cannot be submitted for review. Only public apps are eligible for the approval process. Please make your app public before submitting it for review.`,
  APP_SUBMIT_OUT_OF_SYNC: (fields: string[], appId: string): string =>
    `Configuration mismatch detected — your local app-config.json differs from the app on Brevo (${fields.join(', ')}).\n  Please update your local configuration with the latest server values, or run \`${CLI.APP_UPLOAD}\` to upload your local changes to the server, then re-run \`${CLI.APP_SUBMIT(appId)}\`.`,
  APP_SUBMIT_OUT_OF_SYNC_DIFF: (diff: string, appId: string): string =>
    `Configuration mismatch detected — your local app-config.json differs from the app on Brevo:\n${diff}\n\n  Please update your local configuration with the latest server values, or run \`${CLI.APP_UPLOAD}\` to upload your local changes to the server, then re-run \`${CLI.APP_SUBMIT(appId)}\`.`,
  APP_SUBMIT_IN_SYNC:
    'No configuration mismatch detected. Showing the submission confirmation prompt with the complete app configuration below.',
  APP_SUBMIT_CONFIRM_HEADER: 'You are about to submit this app for review:',
  APP_SUBMIT_CONFIRM_PROMPT: 'Submit this app for review?',
  APP_SUBMIT_CANCELLED: 'Submission cancelled.',
  APP_SUBMIT_FORM_GATE:
    'Note: Your app will be submitted for review only after you complete and submit the Google Form.',
  APP_SUBMIT_BROWSER_OPENED: (url: string, appId: string): string =>
    `We've opened a browser tab with the submission form for app ${appId}:\n  ${url}`,
  APP_SUBMIT_BROWSER_FAILED: (url: string, appId: string): string =>
    `We couldn't open a browser automatically. Open the submission form for app ${appId} yourself:\n  ${url}`,
  APP_SUBMIT_NEXT_STEPS: `Please submit the form for review. You'll receive an email once your app has been reviewed — check its status anytime with \`${CLI.APP_STATUS}\`.`,
  APP_SUBMIT_NO_FORM_URL: `Review submission is currently unavailable. This may happen if your app has not been uploaded yet or if it has already been submitted and is under review. You can check the current status of your app using \`${CLI.APP_STATUS}\`.`,

  // App status
  APP_STATUS_SELECT: 'Select an app:',
  APP_STATUS_TITLE: 'App status',
  // Canned copy per review state (server-side `app_submission_states.state`).
  // Reviewer feedback is delivered by email, not surfaced here (BEX-252).
  APP_STATUS_MESSAGE: (state: string): string => {
    switch (state) {
      // Empty/missing state is normalized to the "unknown" sentinel upstream
      // (src/commands/app/status.ts); '' is kept as a defensive fallthrough.
      case '':
      case 'unknown':
        return `Status information isn't available for your app yet. Make sure your app is public and has been uploaded with \`${CLI.APP_UPLOAD}\`.`;
      case 'configured':
        return "Your app is set up but hasn't been submitted for review yet.";
      case 'submitted':
        return 'Your app has been submitted and is waiting to be reviewed.';
      case 'in_review':
        return 'Your app is currently being reviewed by our team.';
      case 'approved':
        return 'Your app has been approved.';
      case 'rejected':
        return 'Your app was not approved. Check your email for details.';
      case 'changes_requested':
        return 'Changes have been requested for your app. Check your email for details.';
      default:
        return `Your app is in state "${state}".`;
    }
  },

  // Legacy 'all' scope deprecation (BEX-214)
  LEGACY_ALL_SCOPE_DEPRECATED_BLOCK: `This app currently has the legacy 'all' OAuth scope, which is being deprecated.\n  Replace 'all' with the specific scopes your integration uses in app-config.json's \`auth.scopes\`.\n  Run \`${CLI.APP_SCOPES}\` to see the catalog, then run \`${CLI.APP_UPLOAD}\` to migrate.`,
  LEGACY_ALL_SCOPE_START_BLOCK: `This app's auth.scopes in app-config.json still contains the legacy 'all' OAuth scope, which is being deprecated.\n  Replace 'all' with the specific scopes your integration uses (run \`${CLI.APP_SCOPES}\` to see the catalog),\n  migrate by editing \`auth.scopes\` and running \`${CLI.APP_UPLOAD}\`, then re-run \`${CLI.APP_START('oauth')}\`.`,
  LEGACY_ALL_SCOPE_LIST_TAG: ` (legacy 'all' — deprecated)`,
  LEGACY_ALL_SCOPE_SCAFFOLD_SUBSTITUTED: (writtenScopes: string): string =>
    `This app still has the legacy 'all' OAuth scope (deprecated). Wrote ${writtenScopes} to app-config.json instead of 'all'. Migrate the app by editing \`auth.scopes\` and running \`${CLI.APP_UPLOAD}\`.`,
  LEGACY_ALL_SCOPE_UPDATE_MIGRATING: `Migrating from legacy 'all' scope — 'all' will be removed.`,

  // App delete
  APP_DELETE_SELECT: 'Select an app to delete:',
  APP_DELETE_CONFIRM: (name: string, id: string) =>
    `Delete app "${name}" (${id})? This cannot be undone.`,
  APP_DELETE_SUCCESS: (id: string) => `App ${id} deleted.`,
  APP_DELETE_CANCELLED: 'Delete cancelled.',
  APP_DELETE_FOLDER_CONFIRM: (dir: string) => `Delete the local project folder at ${dir}?`,
  APP_DELETE_FOLDER_SUCCESS: (dir: string) => `Project folder deleted: ${dir}`,
  APP_DELETE_FOLDER_FAILED: (dir: string) => `Could not delete folder ${dir}. Remove it manually.`,

  // App withdraw
  APP_WITHDRAW_SELECT: 'Select an app to withdraw:',
  APP_WITHDRAW_CONFIRM: (name: string, id: string) =>
    `Withdraw app "${name}" (${id}) from submission?`,
  APP_WITHDRAW_CANCELLED: 'Withdrawal cancelled.',
  APP_WITHDRAW_SUCCESS: (id: string) => `App ${id} withdrawn from submission.`,
  APP_WITHDRAW_NOT_SUBMITTED: (id: string) => `App ${id} has not been submitted yet.`,
  APP_WITHDRAW_SUBMIT_HINT: (id: string) => `Submit it first: ${CLI.APP_SUBMIT(id)}`,

  // App scaffold
  APP_SCAFFOLD_DIR_PROMPT: 'Output directory:',
  APP_SCAFFOLD_DIR_EXISTS: 'Directory already exists. What would you like to do?',
  APP_SCAFFOLD_FEATURE_TYPE_PROMPT: 'What feature do you want to scaffold?',
  APP_SCAFFOLD_FEATURE_EXISTS:
    'This feature already has files in this project. What would you like to do?',
  APP_SCAFFOLD_FEATURE_EXISTS_OVERWRITE: 'Overwrite existing files',
  APP_SCAFFOLD_FEATURE_EXISTS_MERGE: 'Merge (keep existing, add missing)',
  APP_SCAFFOLD_FEATURE_EXISTS_CANCEL: 'Cancel',
  APP_SCAFFOLD_NO_CONFIG: `No app-config.json found in this directory, so there is no app to scaffold a feature into. Run \`${CLI.APP_CREATE}\` to create an app here first, or cd into an existing project folder and try again.`,
  APP_SCAFFOLD_DIFF_INTRO: (name: string) =>
    `App "${name}" is linked here, but its local config differs from the server:`,
  APP_SCAFFOLD_DIFF_LINE: (field: string, local: string, server: string) =>
    `  ${field}: ${local} → ${server}`,
  APP_SCAFFOLD_DIFF_CONFIRM:
    'Scaffolding will update app-config.json to match the server. Continue?',
  APP_SCAFFOLD_CANCELLED: 'Scaffold cancelled.',
  APP_SCAFFOLD_JSON_DIFF_CANCELLED:
    'app-config.json differs from the server and --json cannot prompt for confirmation. Re-run without --json to review and confirm the update.',
  APP_SCAFFOLD_SUCCESS: (count: number) => `Feature scaffolded (${count} files)`,
  APP_SCAFFOLD_NO_FEATURES_FOR_UI_APP: `This is a UI app — there are no features to scaffold (an action link has no local server to run). Edit the \`ui_app\` block in app-config.json, then run \`${CLI.APP_UPLOAD}\` and \`${CLI.APP_DEPLOY()}\`.`,
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
    `Port ${port} is already in use.\n\n  Either stop the process using port ${port}, use a different port with \`--port <port>\`,\n  or update your redirect URL by editing \`auth.redirectUris\` in app-config.json and running \`${CLI.APP_UPLOAD}\`.`,
  APP_START_CUSTOM_PORT_IN_USE: (port: number) =>
    `Port ${port} is already in use.\n\n  Stop the process using port ${port}, or pick another port with \`--port <port>\`\n  and update your redirect URL by editing \`auth.redirectUris\` in app-config.json and running \`${CLI.APP_UPLOAD}\`.`,
  APP_START_EXITED: (feature: string, code: number) => `${feature} exited with code ${code}`,
  APP_START_FAILED: (feature: string, error: string) => `Failed to start ${feature}: ${error}`,
  APP_START_REDIRECT_NOT_REGISTERED: (port: number) =>
    `Port ${port} isn't registered as a redirect URL for this app.`,
  APP_START_REDIRECT_REGISTER_PROMPT: (url: string) =>
    `Register ${url}? You can delete it later if you want.`,
  APP_START_REDIRECT_REGISTERED: (url: string) =>
    `Added ${url} to app-config.json and uploaded the new config.`,
  APP_START_REDIRECT_UPLOAD_FAILED: (url: string) =>
    `${url} was saved to app-config.json but the upload failed. Fix the issue and run \`${CLI.APP_UPLOAD}\` to finish registering it.`,
  APP_START_REDIRECT_DECLINED: (url: string) =>
    `Continuing without registering. The OAuth callback at ${url} will fail until you register it. Add it to \`auth.redirectUris\` in app-config.json and run \`${CLI.APP_UPLOAD}\` to register later.`,
  APP_START_REDIRECT_NON_INTERACTIVE: (port: number, url: string) =>
    `Port ${port} is not registered as a redirect URL for this app, and we can't prompt in non-interactive mode. Add \`${url}\` to \`auth.redirectUris\` in app-config.json and run \`${CLI.APP_UPLOAD}\` first, or re-run interactively.`,

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
  INIT_VERIFY_UNAVAILABLE:
    "Couldn't verify your credentials right now — continuing with the stored session.",
  INIT_STEP_LOGIN: '  Step 1: Authenticate with your Brevo account',
  INIT_STEP_CREATE: '  Step 2: Create your first app',
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
