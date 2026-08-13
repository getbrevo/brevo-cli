import { CLI, BREVO_CLI_REFERENCE_URL, BREVO_OAUTH_SCOPES_DOCS_URL } from '../lib/constants';
import { previewMessages } from './preview-messages';

/**
 * How a scaffold report describes what it just did, given the files it wrote and the
 * files the project ends up with.
 *
 * They are equal on a fresh scaffold and diverge on a merge, which keeps existing files
 * and writes only the missing ones — so "wrote 0" and "the project has 5" are both true
 * and only the pair is informative. Saying just the first printed `(0 files)` above a
 * five-file tree; saying just the second would claim to have written files it left alone.
 */
function scaffoldFileCount(done: string, written: number, total: number): string {
  if (written === total) return `${done} (${total} files)`;
  if (written === 0) return `already in place (${total} files, nothing rewritten)`;
  return `${done} (${written} of ${total} files written)`;
}

const coreMessages = {
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

  // Pre-GA gate (BEX-405). One message for every gated command, prompt choice and
  // flag value — see `src/lib/preview.ts` for why this one is shared while the
  // capability refusals each keep their own wording.
  //
  // Deliberately says nothing about the internal-account escape hatch or the env
  // var: an end user cannot use either, so naming them would only invite an attempt.
  // Both are documented where the people who need them will look — the agent docs
  // and the README.
  PREVIEW_FEATURE_UNAVAILABLE:
    'That command is not available yet. It is part of a Brevo feature that has not been released.',

  // App create
  APP_CREATE_NAME_PROMPT: 'App name:',
  APP_CREATE_TYPE_PROMPT: 'Distribution type?',
  APP_CREATE_APP_TYPE_PROMPT: 'What type of app are you building?',
  APP_CREATE_APP_TYPE_OAUTH:
    'OAuth app  (Authorize against Brevo and call the API on a user’s behalf)',
  APP_CREATE_APP_TYPE_UI: 'UI app     (Render inside Brevo — opens your app from a record)',
  APP_CREATE_SUCCESS: 'App created.',
  APP_CREATE_NAME_TAKEN: 'That name is already taken. Try a different name.',
  // Shown only after every prompt has been answered — hence the reassurance:
  // the point of the re-login offer is that nothing typed so far is lost.
  APP_CREATE_SESSION_EXPIRED:
    'Your session expired while you were answering. Your answers are still here.',
  APP_CREATE_RELOGIN_CONFIRM: 'Log in again and create the app?',
  // The platform refuses a public-app create from the CLI (BEX-355). Three short
  // labelled lines rather than one paragraph: the fix, the caveat that stops the
  // user thinking they can flip it later, and the server's own sentence.
  //
  // `Brevo said:` is deliberate — the raw text is quoted rather than swallowed, so
  // if the platform ever rewords the rejection (and `isPublicDistributionRefusal`
  // stops recognising it) nothing was hidden in the meantime. The labels align at
  // one column so the three lines scan as a list.
  APP_CREATE_PUBLIC_REJECTED: (serverMessage: string): string =>
    "Public apps can't be created from the CLI yet — Brevo rejected this request.\n\n" +
    '  Do this:     re-run with `--distribution private`\n' +
    `  Note:        \`distribution_type\` is fixed at creation — \`${CLI.APP_UPLOAD}\` can't change it later\n` +
    `  Brevo said:  ${serverMessage}`,
  APP_CREATE_REDIRECT_PROMPT:
    'OAuth callback URL — where users are sent after authorizing your app:',
  APP_CREATE_REDIRECT_HINT: (cmd: string) =>
    `Tip: The default below is a local test-server callback URL, used when you run \`${cmd}\`. Keep it to test your app locally, then add your production callback URL when you go live.`,
  APP_CREATE_REDIRECT_ANOTHER: 'Add another redirect URL?',
  APP_CREATE_REDIRECT_EMPTY: 'Redirect URL cannot be empty',
  APP_CREATE_REDIRECT_INVALID: 'Invalid format. Must start with http:// or https://',
  // Kept under 80 columns *including* inquirer's `? ` prefix. The example URL this used
  // to carry pushed it to 83, and inquirer wraps a prompt without indenting the
  // continuation, so `skip):` landed alone and flush-left on any 80-column terminal —
  // which is the standard default, and this is now the second question in the flow.
  // The example lives in `APP_CREATE_LOGO_INVALID` instead, which is exactly when a
  // user needs to be shown the format.
  APP_CREATE_LOGO_PROMPT: 'App logo URL (optional — leave blank to skip):',
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
  // Names the feature while there is only one of them, because the picker that used
  // to name it is no longer asked (a list of one is not a question). With a second
  // feature in the manifest the label goes away and the picker returns — see
  // `promptFeatureType`.
  APP_SCAFFOLD_FEATURE_CONFIRM: (label?: string) =>
    label ? `Scaffold the ${label}?` : 'Do you want to scaffold a feature?',
  // `written` counts files actually put on disk, `total` the files the project has —
  // and they differ whenever a merge kept what was already there. Reporting only
  // `written` printed "created (0 files)" directly above a five-file tree, which read
  // as a failure. See `scaffoldFileCount`, which both scaffold reports share.
  APP_CREATE_BASE_SUCCESS: (written: number, total: number) =>
    `Project structure ${scaffoldFileCount('created', written, total)}`,
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
  APP_CREATE_UI_NEXT: (cdDir?: string): string[] => [
    ...(cdDir ? [`1. cd ${cdDir}`] : []),
    `${cdDir ? 2 : 1}. ${CLI.APP_UPLOAD}              (validate and save your configuration)`,
    `${cdDir ? 3 : 2}. ${CLI.APP_DEPLOY()}   (make it available in an account)`,
  ],

  // App list
  APP_LIST_EMPTY: `No apps found. Create one with: ${CLI.APP_CREATE}`,
  // Not "Your OAuth apps" — the listing can contain UI apps too (BEX-290), and
  // each row names its own type.
  APP_LIST_HEADER: 'Your apps:',

  // App type, as named on a rendered row. The presence of the `ui_app` block is
  // the discriminator (see isUiAppRecord) — there is no app-type field.
  APP_TYPE_OAUTH: 'OAuth app',
  APP_TYPE_UI: 'UI app',

  // Raised instead of opening the app picker when there is no terminal to draw
  // it on. The picker writes its choice list to stdout, so under --json it
  // would corrupt the single-document contract, and off a TTY inquirer aborts
  // with a raw ERR_USE_AFTER_CLOSE readline stack instead of anything readable.
  APP_SELECT_NON_INTERACTIVE: (command: string) =>
    `Cannot show the app picker in non-interactive mode. Name the app instead:\n\n      ${command}\n\n  \`${CLI.APP_LIST}\` shows the IDs.`,

  // App credentials
  APP_CREDENTIALS_REVEAL_CONFIRM: 'Are you sure you want to reveal the client secret?',
  APP_CREDENTIALS_SELECT: 'Select an app:',
  CLIENT_SECRET_HIDDEN_HUMAN: `[hidden — run \`${CLI.APP_CREDENTIALS_REVEAL()}\`]`,
  CLIENT_SECRET_HIDDEN_JSON: '[hidden]',
  CLIENT_SECRET_NOT_AVAILABLE: '[not available]',
  APP_CREDENTIALS_CONFIG_BACKFILLED: (fields: string[]) =>
    `Backfilled ${fields.join(', ')} into app-config.json.`,

  // App update — removed (BEX-250), kept only as a signpost to `app upload`.
  //
  // Names every flag `update` used to take, because the reason a script or a
  // half-remembered habit lands here is usually one of them, and the answer is the
  // same for all of them: there is no flag any more, edit the file. `distribution_type`
  // is deliberately not offered as editable — it is immutable after `app create`, and
  // `APP_UPLOAD_DISTRIBUTION_IMMUTABLE` is what says so if anyone tries.
  // The second paragraph covers `update --app-id`, which had no successor until
  // `scaffold --app-id` was restored: `upload` reads the linked project only, so a
  // user who drove `update` by ID from any directory would otherwise read "edit
  // app-config.json" while having no such file and no way to get one.
  //
  // Layout: `logError` prints `  ✗ ` in front of the first line, so the body is
  // indented 4 and the runnable commands 6 — the block hangs under the headline
  // instead of dangling two columns left of it, which is what a 2-space body does
  // to a message this long. The dead flags get their own line rather than sitting
  // mid-sentence: someone who arrived here by typing one is scanning for it, not
  // reading. Written a line per line (like `APP_CREATE_PUBLIC_REJECTED`) so the
  // wrapping is visible in the source — this is the longest message in the file
  // and the one where a stray long line is most likely to go unnoticed.
  APP_UPDATE_REMOVED:
    `\`brevo app update\` has been removed — use \`${CLI.APP_UPLOAD}\` instead.\n\n` +
    `    \`${CLI.APP_UPLOAD}\` pushes the whole of app-config.json and takes only\n` +
    '    --yes and --json. None of the old edit flags exist any more:\n\n' +
    '      --name   --redirect-uri   --scope   --logo-uri   --app-id\n\n' +
    "    To change the app's name, redirect URLs, scopes or logo, edit\n" +
    '    app-config.json, then run:\n\n' +
    `      ${CLI.APP_UPLOAD}\n\n` +
    '    No app-config.json here? Set up a project for an app you already\n' +
    `    have (\`${CLI.APP_LIST}\` shows their IDs), then edit and upload:\n\n` +
    `      ${CLI.APP_SCAFFOLD_APP_ID()}\n` +
    `      ${CLI.APP_UPLOAD}\n\n` +
    `    Docs: ${BREVO_CLI_REFERENCE_URL}`,

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
  // Both verbs identify the calling account by its organization ID, which is only
  // cached by a successful login. Numeric and UUID values are both forwarded as-is;
  // only an absent or blank one lands here, meaning the credentials predate the field
  // or were written by a partial login — re-authenticating rewrites them.
  APP_DEPLOY_MISSING_CLIENT_ID: `Could not determine your Brevo account's organization ID.\n\n  Run \`${CLI.LOGIN}\` to re-authenticate.`,
  APP_UPLOAD_DISTRIBUTION_IMMUTABLE: (current: string, next: string) =>
    `distribution_type cannot be changed via upload — this app is "${current}" on Brevo, but app-config.json says "${next}".\n  Edit \`distribution_type\` in app-config.json back to "${current}", or create a new ${next} app with \`${CLI.APP_CREATE}\`.`,
  LEGACY_ALL_SCOPE_START_BLOCK: `This app's auth.scopes in app-config.json still contains the legacy 'all' OAuth scope, which is being deprecated.\n  Replace 'all' with the specific scopes your integration uses (run \`${CLI.APP_SCOPES}\` to see the catalog),\n  migrate by editing \`auth.scopes\` and running \`${CLI.APP_UPLOAD}\`, then re-run \`${CLI.APP_START('oauth')}\`.`,
  LEGACY_ALL_SCOPE_LIST_TAG: ` (legacy 'all' — deprecated)`,
  LEGACY_ALL_SCOPE_SCAFFOLD_SUBSTITUTED: (writtenScopes: string): string =>
    `This app still has the legacy 'all' OAuth scope (deprecated). Wrote ${writtenScopes} to app-config.json instead of 'all'. Migrate the app by editing \`auth.scopes\` and running \`${CLI.APP_UPLOAD}\`.`,
  LEGACY_ALL_SCOPE_UPDATE_MIGRATING: `Migrating from legacy 'all' scope — 'all' will be removed.`,
  // Deliberately in core rather than `preview-messages`: the legacy-scope deprecation
  // (BEX-214) is GA, and `app upload` — the only reader — ships in every build. It lived
  // in `preview-messages` between BEX-405 and this fix, which meant a public build read
  // the key as `undefined` and `new CliError(undefined)` rendered as a bare `✗` with no
  // text. The build now refuses that class of leak; see `scripts/build.mjs`.
  LEGACY_ALL_SCOPE_DEPRECATED_BLOCK: `This app currently has the legacy 'all' OAuth scope, which is being deprecated.\n  Replace 'all' with the specific scopes your integration uses in app-config.json's \`auth.scopes\`.\n  Run \`${CLI.APP_SCOPES}\` to see the catalog, then run \`${CLI.APP_UPLOAD}\` to migrate.`,

  // App delete
  APP_DELETE_SELECT: 'Select an app to delete:',
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
  APP_SCAFFOLD_FEATURE_TYPE_PROMPT: 'What feature do you want to scaffold?',
  APP_SCAFFOLD_FEATURE_EXISTS:
    'This feature already has files in this project. What would you like to do?',
  APP_SCAFFOLD_FEATURE_EXISTS_OVERWRITE: 'Overwrite existing files',
  APP_SCAFFOLD_FEATURE_EXISTS_MERGE: 'Merge (keep existing, add missing)',
  APP_SCAFFOLD_FEATURE_EXISTS_CANCEL: 'Cancel',
  // Three ways out, in the order they're likely to apply: the user is in the wrong
  // directory, the user has an app but no project for it, or the user has no app.
  // The middle one is the migration path off `brevo app update --app-id` and is the
  // reason `--app-id` exists on this command at all — leaving it out of this message
  // strands exactly the users who need it, since it appears in no help screen they
  // would think to read.
  APP_SCAFFOLD_NO_CONFIG: `No app-config.json found in this directory, so there is no app to scaffold a feature into.\n\n  - cd into an existing project folder and try again, or\n  - run \`${CLI.APP_SCAFFOLD_APP_ID()}\` to set this directory up for an app you already have (\`${CLI.APP_LIST}\` shows their IDs), or\n  - run \`${CLI.APP_CREATE}\` to create a new app here.`,
  // Refuses rather than prompting: the two configs describe different apps, and every
  // resolution (overwrite, merge, pick another directory) is a decision the user is
  // better placed to make in their own shell than through a prompt that has to
  // summarise what would be lost.
  APP_SCAFFOLD_APP_ID_MISMATCH: (localAppId: string, requestedAppId: string) =>
    `This directory is already linked to app ${localAppId}, so it can't be set up for app ${requestedAppId}.\n\n  Run \`${CLI.APP_SCAFFOLD}\` (no --app-id) to work on app ${localAppId}, or cd into an empty directory and run \`${CLI.APP_SCAFFOLD_APP_ID(requestedAppId)}\` there.`,
  // The same refusal for the directory a bootstrap was *pointed at*, which is a
  // different directory from the one the command ran in — hence its own message
  // rather than a reuse of the one above, whose "This directory" would name the
  // wrong place. Reached when the answer to "Output directory:" turns out to hold
  // another app's project: without this, answering "Merge" there would leave that
  // app's app-config.json in place while writing this app's credentials into
  // src/oauth/.env.local beside it.
  APP_SCAFFOLD_TARGET_LINKED_ELSEWHERE: (
    targetDir: string,
    localAppId: string,
    requestedAppId: string,
  ) =>
    `${targetDir} is already a project for app ${localAppId}, so it can't be set up for app ${requestedAppId}.\n\n  - cd ${targetDir} and run \`${CLI.APP_SCAFFOLD}\` to work on app ${localAppId}, or\n  - run \`${CLI.APP_SCAFFOLD}\` again and choose a different directory for app ${requestedAppId}.`,
  // Deliberately doesn't say *which* directory: interactively the next prompt is
  // "Output directory:", so naming one here would promise a location the user is
  // about to be asked to choose. Under --json/non-TTY there is no prompt and the
  // answer is the current directory, but that run prints no messages either.
  APP_SCAFFOLD_BOOTSTRAP_INTRO: (appId: string) => `Setting up a project for app ${appId}...`,
  // Said before the confirm, not merged into it: the picker that follows lists the
  // account's apps, and a user who typed `scaffold` in the wrong directory needs to
  // know why they are suddenly being shown that list. The confirm is what makes the
  // list opt-in rather than something the command drops them into.
  APP_SCAFFOLD_BOOTSTRAP_OFFER:
    'No app-config.json in this directory, so there is no app to add a feature to.',
  APP_SCAFFOLD_BOOTSTRAP_CONFIRM: 'Set up a project for an app you already have?',
  // Declining is a normal answer, not a failure — but the user still has an empty
  // directory, so the two remaining routes go on screen instead of exiting silently.
  APP_SCAFFOLD_BOOTSTRAP_DECLINED: `Nothing to do here yet.\n\n  - run \`${CLI.APP_CREATE}\` to create a new app in this directory, or\n  - cd into an existing project folder and run \`${CLI.APP_SCAFFOLD}\` there.`,
  APP_SCAFFOLD_SELECT: 'Which app do you want to set a project up for?',
  // Refuses rather than bootstrapping a nested project. `readProjectConfig` reads cwd and
  // does not walk up, so this is the only thing standing between a mistyped `cd` and a
  // second app-config.json inside an existing project — after which `app upload` from that
  // directory pushes the wrong app and says nothing.
  APP_SCAFFOLD_INSIDE_PROJECT: (projectDir: string) =>
    `This directory is inside the Brevo app project at ${projectDir}, so setting it up as a second project would nest one inside the other.\n\n  - cd ${projectDir} and run \`${CLI.APP_SCAFFOLD}\` there to work on that app, or\n  - cd to a directory outside it to set up a different app.`,
  // A UI app's whole configuration is its `ui_app` block, so a record that comes back
  // without one has nothing to bootstrap from. Says so explicitly rather than writing a
  // config without the block: that config would read as a valid OAuth app (the block's
  // presence is the type discriminator), and the next upload would push `auth` where
  // `ui_app` belonged.
  //
  // This is an EDGE CASE, not the ordinary post-create state. An earlier version of this
  // message asserted the platform stores the block "only once you run `app upload`" —
  // that is false, and was corrected after reading app-store-bo-be: the CLI create
  // handler's `persistCreateResultTx` inserts an `app_versions` row at version `0.0.1`
  // *inside the create transaction*, with `Snapshot.UIApp` set from the request's block
  // (`http_cli_create_app.go`), and `GET /cli/apps/{id}` serves the block straight back
  // off the latest snapshot (`http_cli_get_app.go`). So a UI app created through this
  // CLI is recoverable immediately, with no upload. What reaches this message is a
  // record whose snapshot genuinely carries no UI block — an app predating that handler,
  // or one created through another path — which is why the copy no longer explains the
  // absence by blaming a missing upload.
  APP_SCAFFOLD_BOOTSTRAP_UNRECOVERABLE: (appId: string) =>
    `App ${appId} is a UI app, but the platform returned no \`ui_app\` configuration for it, so there is nothing to set this directory up from.\n\n  A UI app's configuration lives in the \`ui_app\` block of app-config.json. Normally the platform holds a copy from the moment the app is created, so this usually means the app was created outside this CLI, or before the platform stored the block.\n\n  - If you still have this app's project folder, cd into it and run \`${CLI.APP_UPLOAD}\` from there, or\n  - run \`${CLI.APP_CREATE}\` and choose "UI app" to author the configuration again.`,
  APP_SCAFFOLD_DIFF_INTRO: (name: string) =>
    `App "${name}" is linked here, but its local config differs from the server:`,
  APP_SCAFFOLD_DIFF_LINE: (field: string, local: string, server: string) =>
    `  ${field}: ${local} → ${server}`,
  APP_SCAFFOLD_DIFF_CONFIRM:
    'Scaffolding will update app-config.json to match the server. Continue?',
  APP_SCAFFOLD_CANCELLED: 'Scaffold cancelled.',
  // The no-drift outcome of a bootstrap pointed at a directory that was already a
  // project. Said rather than silently skipped: a bootstrap normally reports the files
  // it wrote, so writing none needs a reason on screen — otherwise it looks like the
  // same "did nothing" this branch exists to stop being silent about.
  APP_SCAFFOLD_BASE_IN_SYNC: 'app-config.json already matches the server — left as it is.',
  APP_SCAFFOLD_JSON_DIFF_CANCELLED:
    'app-config.json differs from the server and --json cannot prompt for confirmation. Re-run without --json to review and confirm the update.',
  // Shown when `app create`'s read-back of the app it just created comes back
  // empty or 404. The app exists — the server issued its ID — so this is a
  // read-path problem, not a missing app, and the create response has everything
  // the scaffold needs except `scopes` (which falls back to the defaults).
  APP_SCAFFOLD_SERVER_READBACK_FAILED: (appId: string) =>
    `App ${appId} was created but could not be read back from the server. Scaffolding from the create response instead — run \`${CLI.APP_SCAFFOLD}\` later to refresh app-config.json from the server.`,
  APP_SCAFFOLD_SUCCESS: (written: number, total: number) =>
    `Feature ${scaffoldFileCount('scaffolded', written, total)}`,
  APP_SCAFFOLD_NO_FEATURES_FOR_UI_APP: `This is a UI app — there are no features to scaffold (an action link has no local server to run). Edit the \`ui_app\` block in app-config.json, then run \`${CLI.APP_UPLOAD}\` and \`${CLI.APP_DEPLOY()}\`.`,
  APP_SCAFFOLD_TARGET_IS_CWD: 'Scaffolding into the current directory.',
  APP_SCAFFOLD_CREATING_DIR: (dir: string) => `Creating ${dir} and moving into it...`,
  // The directory was already there and the user has just said how to handle it —
  // reporting "Creating" then would contradict the prompt they answered one line up.
  APP_SCAFFOLD_USING_EXISTING_DIR: (dir: string) => `Moving into ${dir}...`,
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
  // Replaces the platform's `ui_app is not enabled for this account` (403,
  // `ui_app_not_enabled`) — a wire key is not something a partner can act on. Mapped
  // by API *code* rather than by copy, which is why this one does not quote the
  // server back the way `APP_CREATE_PUBLIC_REJECTED` does: the code is the stable
  // identifier, so there is no mismatch to leave an escape valve for, and the
  // server's sentence says nothing this line doesn't.
  //
  // Keyed centrally in `apiCodeMessages` because the same gate guards two commands:
  // `app create` (authoring a `ui_app` block) and `app upload` (pushing one). The
  // allowance is per account and shares the public-apps flag, so an enabled account
  // never sees this. `--json` consumers still get `code: "ui_app_not_enabled"`.
  ERR_UI_APP_NOT_ENABLED:
    "UI apps aren't enabled for this Brevo account yet.\n\n" +
    '  Why:       UI apps (action links) are still rolling out, and are enabled per account.\n' +
    '  Do this:   build an OAuth app instead, or ask Brevo to enable UI apps for this account.',
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
  // `init` ends by naming the obvious next command, and for a UI app that is not
  // `app start oauth`: an action link has no OAuth flow and no local server to run,
  // so the OAuth line pointed at a command that would fail. It also contradicted the
  // Next steps box printed directly above it, which already said upload → deploy.
  // Deliberately in core rather than `preview-messages`: `init` is not a gated command,
  // and a hand-edited `ui_app` block can reach this line in a published build.
  INIT_DONE_UI_APP: `All set! Follow the next steps above, or run \`${CLI.HELP}\` to see all commands.`,

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

// ELIMINATION SITE — the raw global rather than `isFeatureAvailable`, so esbuild folds
// the spread to `{}` and drops ./preview-messages entirely. `messages` is one object
// literal, so a property can only be removed by removing the whole object it arrived in.
// The `as typeof previewMessages` cast keeps every call site type-safe in both builds;
// see that module for why the lie is safe.
export const messages = {
  ...coreMessages,
  ...(__BREVO_PREVIEW__ ? previewMessages : ({} as typeof previewMessages)),
};
