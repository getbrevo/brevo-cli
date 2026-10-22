# Brevo Developer CLI

Command-line tool to build [Brevo](https://www.brevo.com/) integrations from your terminal — OAuth apps, UI apps that render inside Brevo, and Brevo Functions.

> 📖 Full command and option documentation: **[Brevo CLI reference](https://developers.brevo.com/docs/cli-reference)**

> [!WARNING]
> **Upgrade to the latest released version.** All versions from **1.1.1** up to (but not including) **2.0.0** should be migrated to at least **2.3.0**. The `2.0.0` release introduced **breaking changes**, so some CLI commands may not work as expected on older versions. **`2.3.0`** also carries further `app-config.json` migrations — legacy `auth.redirectUrls` → `auth.redirect_uris`, and the camelCase keys `appId` / `appName` / `logoUri` / `appType` / `auth.redirectUris` → their snake_case spellings — that are applied automatically the next time the CLI writes your config (`brevo app upload`, `brevo app start`, …). Older configs keep working: both spellings are still read, and the migration never changes a value.
>
> **`2.3.0` also begins a `--json` key deprecation.** Every JSON document now carries each camelCase key alongside its snake_case twin (`appId` **and** `app_id`, `clientId` **and** `client_id`, `exitCode` **and** `exit_code`, …). Nothing is removed yet — the camelCase spellings go away in the next major release, so point new scripts at the snake_case ones.
>
> Upgrade with `npm install -g @getbrevo/cli@latest` (or `yarn global add @getbrevo/cli@latest`, or `brew upgrade brevo`), then confirm with `brevo --version`.

## What's new in 2.5.0

- **Public app distribution and the review lifecycle are GA.** `brevo app create --distribution public`
  is accepted, and `brevo app submit`, `brevo app status` and `brevo app withdraw` ship in the
  published package — see [Public apps and the review lifecycle](#public-apps-and-the-review-lifecycle).
  Note that the platform currently refuses public app _creation_ from the CLI (the API answers `400`);
  the CLI side is in place and will work as soon as the platform allows it.
- **Consent gates for public apps.** Creating a public app requires agreeing to the
  [Brevo Developer Terms](https://developers.brevo.com/docs/apps-developer-terms), and submitting one
  for review requires confirming the Submission Process statement. Non-interactive runs pass the new
  `--accept-developer-terms` (create) / `--accept-submission-terms` (submit) flags as explicit consent.
- **PKCE for scaffolded public apps.** The scaffolded OAuth flow branches on distribution: a public
  app gets Authorization Code + PKCE (RFC 7636, `S256`) with no `client_secret` — the generated
  `.env.local` / `.env.example` carry none. Private apps keep the confidential-client flow unchanged.

Full detail for every release is in [CHANGELOG.md](CHANGELOG.md).

## Requirements

- **Node.js** 20.15.0 or newer (required to run the CLI)
- **Yarn** 1.19.1 or newer (only required for developing/building from source; not needed when installing via `npm install -g @getbrevo/cli`)

## Installation

### Homebrew (macOS/Linux)

```bash
brew tap getbrevo/tap
brew install getbrevo/tap/brevo
brevo --version
```

(`brew install getbrevo/tap/brevo` adds the tap automatically if you skip the first command — the formula lives in [`getbrevo/homebrew-tap`](https://github.com/getbrevo/homebrew-tap).)

### npm

```bash
npm install -g @getbrevo/cli
# or:
yarn global add @getbrevo/cli
```

This puts the `brevo` binary on your PATH. Verify:

```bash
brevo --version
```

To upgrade later: `brew update && brew upgrade brevo` (Homebrew) or `npm install -g @getbrevo/cli@latest` (npm).

> Building from source? See [Development](#development) below.

## Quick start

The fastest path is `brevo app init`, which walks you through login, creating your first app, and generating starter code:

```bash
brevo app init
```

Or step by step:

1. **Authenticate.** `brevo login` defaults to a browser sign-in; you can also pick API-key auth from the prompt or pass `--browser` to skip it:

   ```bash
   brevo login              # interactive — choose browser (default) or API key
   brevo login --browser    # force the browser flow
   ```

   For non-interactive use (CI), set `BREVO_API_KEY` ([create or copy a key](https://app.brevo.com/settings/keys/api)) before running `brevo login`:

   ```bash
   export BREVO_API_KEY=xkeysib-...
   brevo login
   ```

2. **Confirm** the active account:

   ```bash
   brevo whoami
   ```

3. **Manage OAuth apps** (examples):

   ```bash
   brevo app list
   brevo app create --name "My App" --distribution private   # or --distribution public (asks you to agree to the Brevo Developer Terms)
   brevo app scaffold --app-id 3f8c1a2e-5b47-4d9c-8e10-6a2b7d4f0c93
   brevo app start oauth --port 3000
   ```

Run `brevo --help` or `brevo <command> --help` for full command and option lists. Every command supports `--json` for machine-readable output.

## Commands

| Command                      | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `brevo login`                | Authenticate — browser sign-in by default, or `BREVO_API_KEY` for CI                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `brevo logout`               | Clear stored credentials (`--force` to skip confirmation)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `brevo whoami`               | Show the authenticated user                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `brevo app init`             | Guided setup — login, create app, and scaffold in one go                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `brevo app create`           | Create an app — a consent-based OAuth app (`--name`, `--distribution private\|public`, repeatable `--redirect-uri`), a **machine-to-machine** OAuth app (`--m2m --scopes "…"`, private only — creates the app and stops, writing no project files), a UI app (`--ui-app …` / `--ui-config <file>`), or a Brevo Function (interactive prompt only). **A public app requires agreeing to the [Brevo Developer Terms](https://developers.brevo.com/docs/apps-developer-terms)**: interactively the CLI opens the terms and asks a y/N question (default No — declining cancels the create); non-interactively (`--json` or piped) a `--distribution public` create is refused unless `--accept-developer-terms` is passed, which also skips the question interactively. Private apps never see this. There is no `--type` flag on this command (`brevo app list --type` is a filter, not a creator); a run with none of those flags creates a consent-based OAuth app. `distribution_type` is immutable after create. **There is no logo input at creation time** — set `logo_uri` in `app-config.json` and run `brevo app upload` afterward |
| `brevo app list`             | List apps in your account (each row names its type). `--type <oauth\|ui\|function\|m2m>` shows one kind only — `oauth` covers both OAuth flows, so use `m2m` to isolate machine-to-machine apps                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `brevo app credentials`      | Show client ID and secret (`--app-id`, `--reveal-secret`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `brevo app upload`           | Push `app-config.json` to Brevo after showing a local-vs-server diff — field by field, including every `ui_app` placement (`--yes`). This is how an app's name, redirect URLs, scopes and `logo_uri` are changed after creation: edit the field, then upload                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `brevo app delete`           | Delete an app (`--app-id`, `--force`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `brevo app scaffold`         | Add a feature to the app in the current directory, or set an empty directory up for an app you already have — picked interactively, or named with `--app-id` (`--overwrite`, `--json`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `brevo app start`            | Run a scaffolded feature locally (e.g. `brevo app start oauth --port 3000`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `brevo app install`          | Install a UI app into a Brevo account, after showing the configuration and version it will install (`[account-id]` optional — a regular account installs into itself; a corporate account is prompted to pick a sub-account, so pass the ID explicitly in scripts; `--app-id`, `--force`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `brevo app uninstall`        | Uninstall a UI app from a Brevo account (same arguments as `install`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `brevo app submit`           | Submit a public app for review — opens the submission form after checking the app is complete, public, and in sync with `app-config.json`, and after you confirm the Submission Process statement (non-interactively, pass `--accept-submission-terms`; `--app-id`, `--json`). Nothing is submitted until the form itself is completed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `brevo app status`           | Show an app's review state: `draft`, `submitted`, `in_review`, `approved`, `rejected` or `changes_requested` (`--app-id`, `--json`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `brevo app withdraw`         | Withdraw an app from submission (`--app-id`, `--force`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `brevo app available-scopes` | List the OAuth scopes the IdP supports (`--web` opens the catalog in a browser)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `brevo function init`        | Create a Brevo Function — from a template or generated from a description, previewed on sample contacts before it deploys (interactive only)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `brevo function list`        | List the functions in your account (`--draft` for drafts only)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `brevo function get`         | Show one function's details (`--id`, or pick from a list)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `brevo function deploy`      | Deploy a draft, optionally linking it to an app (`--id`, `--app-id`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `brevo function activate`    | Activate a function so it processes live data (`--id`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `brevo function deactivate`  | Stop a function from processing (`--id`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `brevo function delete`      | Permanently delete a deployed function (`--id`, `--force`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

Most commands require a successful `brevo login` first, except authentication/help flows (`brevo login`, `brevo logout`, `brevo app init`, `--help`). Every command accepts `--json` for machine-readable output.

The table above is the complete command surface of a published release, and `brevo --help` always lists everything the binary can do — there is nothing hidden behind a flag, an environment variable, or an account setting. (Public app distribution and the review lifecycle were once built but withheld from published packages; they ship in every build now.) If a command listed here is missing from your install, it is older than this README — upgrade with `npm install -g @getbrevo/cli`.

### Machine-to-machine (M2M) apps

A **private** OAuth app can use the `client_credentials` grant instead of user consent — your
server calls the Brevo API as itself, with no Brevo user to redirect and no callback to register:

```bash
brevo app create --name "Ledger Sync" --distribution private \
  --m2m --scopes "contacts:read,crm:read"
```

Interactively, pick _Machine to Machine_ at the **Which OAuth flow does this app use?** prompt.

M2M apps are **create-only** — the command creates the app, prints the credentials, and stops.
No directory and no `app-config.json` are written, so `brevo app upload`, `brevo app scaffold`
and `brevo app start` don't apply. **Scopes are fixed at creation** (there is no config to edit
afterwards), and the credentials stay retrievable with
`brevo app credentials --app-id <id> --reveal-secret`.

### Public apps and the review lifecycle

An OAuth app's `distribution_type` is chosen at `brevo app create` and is **immutable afterwards**:
`private` for apps used exclusively by your own organisation, `public` for apps distributed to end
users or marketplace listings. Only a public app can be submitted for review.

> [!NOTE]
> The platform currently refuses public app **creation** from the CLI — `brevo app create
--distribution public` sends the request and the API answers `400`, which the CLI reports as
> _"Public apps can't be created from the CLI yet"_ with the server's own message quoted. The
> CLI-side commands below are all in place and will work as soon as the platform allows it.

Public apps carry two consent gates. Creating one requires agreeing to the
[Brevo Developer Terms](https://developers.brevo.com/docs/apps-developer-terms); submitting one for
review requires confirming the Submission Process statement. Interactively each command asks a y/N
question (default No — declining cancels with exit `0` and nothing is sent), and `brevo app create`
also opens the terms in the browser. Non-interactive runs (`--json` or piped stdin) must pass
`--accept-developer-terms` (create) or `--accept-submission-terms` (submit) as explicit consent, or
the run is refused; either flag also skips the question interactively. Private, M2M, UI and
Function apps are unaffected.

The review lifecycle itself is three commands, each resolving the target app from `--app-id`, the
linked `app-config.json`, or an interactive picker:

```bash
brevo app submit     # opens the review submission form (app must be public, uploaded, and in sync)
brevo app status     # draft | submitted | in_review | approved | rejected | changes_requested
brevo app withdraw   # withdraw an app from submission
```

`brevo app submit` changes nothing server-side — **the app is submitted only once the form it opens
is completed**. Reviewer feedback is delivered by email, not through `brevo app status`.

### UI apps

`brevo app create`'s interactive prompt can build three kinds of app: an OAuth app, a **UI app**
that renders directly inside a Brevo CRM record, or a [Brevo Function](#brevo-functions)
(interactive-only). There is no `--type` flag on `brevo app create` — the `--type` flag on
`brevo app list` filters the listing, it does not pick what to create — so a run with none of
`--ui-app`, `--ui-config` or `--m2m` creates a consent-based OAuth app.

Today the prompt authors one integration type, an **action link** (`extension_type: "actionLink"`).
In short: it's a clickable menu entry or card CTA button that Brevo renders on a record page — no
embed, no iframe — and clicking it just opens a URL you host, with the record's data passed along
as query parameters, never in the path. Each authored placement lives in `app-config.json` under
`ui_app.surface_point_list` and carries:

- `surface_point_name` — which slot on which record page, chosen from Brevo's live registry at
  create time
- `label` — the menu entry's text, or the card's CTA button
- `more_info` _(optional)_ — a supporting line under the menu entry / card description
- `redirect_link` — the destination URL
- `context` _(optional)_ — which record fields to pass along as query parameters, narrowed from
  whatever that slot allows
- `size` _(optional)_ — card sizing, e.g. `{ "width": "280px", "height": "160px" }`; seeded from
  the slot's own registry default when it declares one, and freely editable afterwards

The interactive flow authors exactly one placement per run. More placements — or edits to any
field above — are hand-added as further `surface_point_list` entries in `app-config.json` and
pushed with `brevo app upload`, which validates every entry against the registry before it goes
live. See [Uploading a UI app that is already installed](#uploading-a-ui-app-that-is-already-installed)
below for what that push looks like.

### Uploading a UI app that is already installed

A UI app's `ui_app` block is what every account it is installed in renders, and there is no
separate publish step — an upload is live in those accounts as soon as it succeeds. So the two
commands show you what you are about to change:

- **`brevo app upload`** diffs the block against the server placement by placement, printing
  each changed value as `before → after` and tagging placements as `(new)` / `(removed)`. It
  then warns that the app may already be installed in Brevo accounts and asks for confirmation
  naming that consequence. `--yes` skips the question, not the warning; `--json` prints neither
  and stays a single parseable document.
- **`brevo app install`** prints the configuration it is about to install — **as stored on the
  server**, since that is what the install makes visible — with the app's version, extension
  type and every placement, before asking to confirm. If the `app-config.json` in the current
  directory has drifted from it, the command says so and points at `brevo app upload`; the
  install still proceeds, because the stored configuration is a legitimate thing to install.
  Under `--json` the same information comes back as `version` and `ui_app`.

To change what an installed app renders: edit `app-config.json`, run `brevo app upload`, and the
accounts it is installed in pick the change up — no re-install needed.

### Brevo Functions

> [!NOTE]
> Brevo Functions are rolling out **on an invite basis**. The commands ship in every release and
> `brevo --help` always lists them, but they only work on accounts that have been given access — so
> if they fail on your account, that is why. Ask your Brevo contact to have it enabled.

A **Brevo Function** is a serverless function that runs on Brevo's own infrastructure and processes
your account's data in real time — no server of yours to host or deploy to. It is a third app type
alongside OAuth and UI apps: `brevo app create` offers it in the app-type prompt, and a Function app
is recorded in `app-config.json` by a `brevo_function` block (`app_type: "function"`).

The `function` group (aliased to `fn`) is the whole lifecycle:

```bash
brevo function init                       # create one — template, or generated from a description
brevo function list --draft               # drafts waiting to be deployed
brevo function deploy --id draft-001      # deploy a draft, optionally --app-id to link it to an app
brevo function list                       # everything deployed, with its status
brevo function deactivate --id fn-001     # stop it processing, without deleting it
```

`brevo function init` is interactive only — it previews the function against sample contacts from
your account and lets you iterate on it before anything is deployed, which is not something `--json`
or a piped run can do. Deploying activates the function against **real, live data**, so both `init`
and `deploy` confirm that before they go ahead. Every other command supports `--json`, and the ones
that act on a single function take `--id`, so a script never has to reach the interactive picker.

### Browser login

`brevo login` defaults to a browser-based sign-in. The CLI starts a temporary loopback server, opens your browser to the Brevo CLI login service, and stores the returned tokens in `~/.brevo/credentials.json`. Access tokens refresh automatically on expiry.

Flags:

- `--browser` — force browser flow.

For non-interactive use (CI), set `BREVO_API_KEY=<key>` before running `brevo login`. The legacy `--api-key <key>` flag was removed because it leaks the secret into process listings and shell history; the env var is the only supported way to pass an API key non-interactively.

Environment overrides:

- `BREVO_API_URL` — points the CLI at a different Brevo API (defaults to `https://api.brevo.com`).
- `BREVO_OAUTH_PROXY_URL` — points the browser-login flow at a different OAuth proxy (defaults to `https://oauth-cli.brevo.com`; useful for local development or non-default environments).
- `BREVO_OAUTH_BASE_URL` — points scope lookups and scaffolded project templates at a different OAuth realm (defaults to `https://oauth.brevo.com`).

## Exit codes

| Code | Meaning                         |
| ---- | ------------------------------- |
| `0`  | Success                         |
| `1`  | General error                   |
| `2`  | Aborted (Ctrl+C or SIGTERM)     |
| `3`  | Authentication failure (401)    |
| `4`  | Network error (API unreachable) |
| `5`  | Not found (404)                 |

## Configuration

| Variable                     | Purpose                                                                                                      | Default                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| `BREVO_API_KEY`              | API key used for non-interactive `brevo login`                                                               | –                                                 |
| `BREVO_API_URL`              | API base URL (HTTPS required, except for `localhost`)                                                        | `https://api.brevo.com`                           |
| `BREVO_OAUTH_PROXY_URL`      | OAuth proxy used by browser login (HTTPS required, except for `localhost`)                                   | `https://oauth-cli.brevo.com`                     |
| `BREVO_OAUTH_BASE_URL`       | OAuth realm used for scope lookups and scaffolded project templates (HTTPS required, except for `localhost`) | `https://oauth.brevo.com`                         |
| `BREVO_CONFIG_HOME`          | Override for the credentials directory                                                                       | `~/.brevo/`                                       |
| `BREVO_CLAUDE_HOME`          | Override the Claude Code home `brevo skill install` writes into                                              | `~/.claude/`                                      |
| `BREVO_AGENTS_HOME`          | Override the shared agents home `brevo skill install --agent codex,gemini` writes into                       | `~/.agents/`                                      |
| `BREVO_SKILL_AUTOREFRESH`    | Set to `1` to reinstall outdated skills after `brevo` runs instead of only printing the update notice        | off                                               |
| `BREVO_NO_SKILL_AUTOREFRESH` | Set to `1` to suppress the skill update notice (and the reinstall) on `brevo` runs                           | off                                               |
| `BREVO_SKILLS_CATALOG_URL`   | Replace the skills catalog URL (tests and forks)                                                             | the latest `brevo-skills` release                 |
| `BREVO_SKILLS_FILES_URL`     | Replace the base URL skill files are fetched from                                                            | `raw.githubusercontent.com/getbrevo/brevo-skills` |
| `NO_COLOR` / `FORCE_COLOR`   | Disable / force ANSI colour output                                                                           | –                                                 |
| `DEBUG` or `--debug`         | Verbose HTTP and error logging                                                                               | off                                               |

Credentials are stored at `~/.brevo/credentials.json`; per-app client secrets are cached under an `apps` key. Linked project config lives in `./.brevo.json` (gitignored).

## AI agent integration

If you use Claude Code, Codex, Gemini CLI, Cursor, Aider, Copilot CLI, or another agent that reads project context, the package ships ready-to-use context files so agents know how to call `brevo` correctly:

- `node_modules/@getbrevo/cli/agent-context/AGENTS.md` — overview, command list, conventions, and safety rules. Compatible with the [agents.md](https://agents.md) format.
- `node_modules/@getbrevo/cli/agent-context/SKILL.md` — an [Agent Skills](https://agentskills.io) skill (with YAML frontmatter and trigger keywords) for auto-activation when a conversation touches the Brevo CLI.

### Agent skills (recommended)

The CLI installs and maintains Brevo's agent skills for you, from the [brevo-skills](https://github.com/getbrevo/brevo-skills) catalog. That catalog carries the `brevo-cli` skill above and the other Brevo skills (a router that picks the right skill for a request, email-template and test-send helpers, and so on):

```bash
brevo skill install                          # every skill, for Claude Code (default)
brevo skill install brevo-cli                # one skill (the router, marked default, always comes along)
brevo skill install --agent codex,gemini     # Codex and Gemini CLI
brevo skill install --agent all --mcp        # all agents, and register the Brevo MCP server with each
brevo skill update                           # reinstall skills that are behind the catalog
brevo skill list                             # what is installed, per agent, and what the catalog offers
brevo skill check                            # outdated or modified skills; exit code 1 when something is off
brevo skill uninstall [names...]             # remove skills the CLI installed
```

| Command                            | Does                                                                                                                                     |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `brevo skill install [names...]`   | Installs the named skills, or every skill in the catalog when none is named. Skills marked `default` in the catalog are always included. |
| `brevo skill update [names...]`    | Reinstalls installed skills whose version is behind the catalog.                                                                         |
| `brevo skill uninstall [names...]` | Removes the named skills, or every skill the CLI installed. Only directories carrying the CLI's `.brevo-skill.json` marker are touched.  |
| `brevo skill list`                 | Installed skills per agent with versions, and the catalog's available skills.                                                            |
| `brevo skill check`                | Reports outdated or tampered skills (marker hash vs files on disk) and changes nothing. Exit code 1 when something is off.               |

Options shared by `install` and `update`:

- `--agent claude,codex,gemini|all` (default `claude`). Claude Code reads `~/.claude/skills/<name>/`; Codex and Gemini CLI both read `~/.agents/skills/<name>/`, so one copy there serves the two. A skill is installed for an agent only when the catalog lists that agent's platform for it.
- `--pin <release>` installs from a specific `brevo-skills` release instead of the latest and records the pin; `update` stays on it until `--pin latest` clears it.
- `--mcp` registers the Brevo MCP server with each agent whose CLI is on the `PATH` (`claude mcp add`, `codex mcp add`, `gemini mcp add`), using the catalog's endpoint for that agent. Without `--mcp` the command is printed for you to run. Never required: agents also connect through their own settings.
- `--force` reinstalls even when the version matches.
- `--dry-run` prints what would change, per agent directory, and writes nothing (exit code 0; `check` is the command that signals drift).
- `--json` for machine-readable output.

Every skill's files are downloaded from the release tag, hashed, and written only when the hash matches the catalog's `sha256`; a mismatch skips that skill and the command exits 1 at the end. A skill whose `min_cli_version` is newer than the running CLI is skipped with the version to upgrade to. Each installed skill directory gets a `.brevo-skill.json` marker, and `~/.brevo/skills.lock.json` records what is installed where and any pin.

After any `brevo` command, when the cached catalog (`~/.brevo/skills-catalog.json`) is older than 12 hours, the CLI refetches it (2-second timeout) and, if an installed, unpinned skill is behind it, prints one line on stderr: `↑ Brevo skill update available: <name> (vX → vY). Run \`brevo skill update\`.`Nothing on disk changes until you run that command. Set`BREVO_SKILL_AUTOREFRESH=1` to have those skills reinstalled right away instead (`↻ refreshed <name> skill (vX → vY)`per skill). Both are skipped under CI,`--json`, any `brevo skill`command, and with`BREVO_NO_SKILL_AUTOREFRESH=1`; silent when the network is down.

When the brevo-skills repository is not reachable, `brevo skill install` stops with a message saying so, and points to the hidden `brevo skill:cli install` group for the CLI skill alone. `brevo skill install brevo-cli` does the same thing: it installs the copy of the skill bundled with the CLI (`agent-context/SKILL.md`), with the CLI version as its version; the other skills need the network. `brevo skill:cli install` and `brevo skill:cli uninstall` keep working as aliases of `brevo skill install brevo-cli` and `brevo skill uninstall brevo-cli`.

### Manual install (escape hatch)

If you prefer not to install via the CLI, copy the files in directly:

```bash
# AGENTS.md — append into your existing AGENTS.md, or copy if you don't have one
cat node_modules/@getbrevo/cli/agent-context/AGENTS.md >> AGENTS.md

# Skill — note the directory name matches what `brevo skill install` uses.
# Claude Code reads .claude/skills/; Codex and Gemini CLI read .agents/skills/.
mkdir -p .claude/skills/brevo-cli
cp node_modules/@getbrevo/cli/agent-context/SKILL.md .claude/skills/brevo-cli/SKILL.md
```

The `AGENTS.md` content is wrapped in `<!-- BREVO_CLI_AGENTS_BEGIN -->` / `<!-- BREVO_CLI_AGENTS_END -->` markers — when you upgrade the CLI, delete the existing block (markers included) before re-running the append so the section isn't duplicated.

## Development

```bash
git clone https://github.com/getbrevo/brevo-cli.git
cd brevo-cli
yarn install
yarn build          # compile TypeScript + copy templates to dist/
yarn link:dev       # build and yarn link the binary for local testing
yarn dev            # watch mode (rebuilds on save)
yarn test           # run jest
yarn test:ci        # jest --coverage
yarn lint           # ESLint on src/
yarn format         # prettier --write
yarn smoke          # end-to-end smoke test against the real API (see below)
yarn clean          # remove dist/
```

A husky pre-commit hook runs prettier and eslint on staged `.ts` files and then runs the full test suite.

### Smoke test

`yarn smoke` exercises the full CLI lifecycle (login → app create → scaffold → start → delete → logout) against the real Brevo API. App creation, scaffold, and start always run via the individual commands (`brevo app create`, `brevo app scaffold`, `brevo app start`). The interactive `brevo app init` wizard is **not** part of the default run — pass `--with-init` to also exercise it as an extra step (which creates and deletes a second app).

```bash
yarn smoke                       # default run (no init wizard)
yarn smoke --with-init           # also exercise `brevo app init`
yarn smoke --skip-auth           # assume already logged in
yarn smoke --ci                  # API-key auth via BREVO_API_KEY (non-interactive)
yarn smoke --against=published   # run against the published npm package instead of local build
yarn smoke --help                # full flag list
```

### Publishing

Releases use [changesets](https://github.com/changesets/changesets) and publish to npm via CI. Merging a changeset to `main` opens a "Version Packages" PR; merging that PR publishes. Pushes to `release-*` branches publish alpha prereleases.

## Reporting issues

Bugs and feature requests: [open an issue](https://github.com/getbrevo/brevo-cli/issues/new/choose) or email [support@brevo.com](mailto:support@brevo.com). Include CLI version (`brevo --version`), Node version, and the command output. Redact any credentials.

For security issues, use [private vulnerability reporting](https://github.com/getbrevo/brevo-cli/security/advisories/new) — do not file a public issue.

## Resources

- [Brevo Developers](https://developers.brevo.com)
- [CLI reference](https://developers.brevo.com/docs/cli-reference) — full command and option documentation
- [Package on npm](https://www.npmjs.com/package/@getbrevo/cli)
- [Repository](https://github.com/getbrevo/brevo-cli)
- [Issue tracker](https://github.com/getbrevo/brevo-cli/issues)
- [Email Support](mailto:support@brevo.com)
- [Changelog](./CHANGELOG.md)

## License

[MIT](./LICENSE)
