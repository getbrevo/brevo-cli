# Brevo Developer CLI

Command-line tool to create, manage, and test [Brevo](https://www.brevo.com/) OAuth integrations from your terminal.

> 📖 Full command and option documentation: **[Brevo CLI reference](https://developers.brevo.com/docs/cli-reference)**

> [!WARNING]
> **Upgrade to the latest released version.** All versions from **1.1.1** up to (but not including) **2.0.0** should be migrated to at least **2.1.0**. The `2.0.0` release introduced **breaking changes**, so some CLI commands may not work as expected on older versions. **`2.1.0` and above** also carry further `app-config.json` migrations (e.g. legacy `auth.redirectUrls` → `auth.redirect_uris`, and the camelCase keys `appId` / `appName` / `logoUri` / `appType` / `auth.redirectUris` → their snake_case spellings) that are applied automatically the next time the CLI writes your config (`brevo app upload`, `brevo app start`, …).
>
> Upgrade with `npm install -g @getbrevo/cli@latest` (or `yarn global add @getbrevo/cli@latest`, or `brew upgrade brevo`), then confirm with `brevo --version`.

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
   brevo app create --name "My App" --distribution private
   brevo app scaffold --app-id 3f8c1a2e-5b47-4d9c-8e10-6a2b7d4f0c93
   brevo app start oauth --port 3000
   ```

Run `brevo --help` or `brevo <command> --help` for full command and option lists. Every command supports `--json` for machine-readable output.

## Commands

| Command | Description |
| --- | --- |
| `brevo login` | Authenticate — browser sign-in by default, or `BREVO_API_KEY` for CI |
| `brevo logout` | Clear stored credentials (`--force` to skip confirmation) |
| `brevo whoami` | Show the authenticated user |
| `brevo app init` | Guided setup — login, create app, and scaffold in one go |
| `brevo app create` | Create an app — an OAuth app (`--name`, `--distribution private`, repeatable `--redirect-uri`, `--logo-uri`), or a UI app via the interactive prompts (there is no `--type` flag; non-interactive runs always create an OAuth app) |
| `brevo app list` | List apps in your account (each row names its type) |
| `brevo app credentials` | Show client ID and secret (`--app-id`, `--reveal-secret`) |
| `brevo app upload` | Push `app-config.json` to Brevo after showing a local-vs-server diff — field by field, including every `ui_app` placement (`--yes`) |
| `brevo app delete` | Delete an app (`--app-id`, `--force`) |
| `brevo app scaffold` | Add a feature to the app in the current directory, or set an empty directory up for an app you already have — picked interactively, or named with `--app-id` (`--overwrite`, `--json`) |
| `brevo app start` | Run a scaffolded feature locally (e.g. `brevo app start oauth --port 3000`) |
| `brevo app install` | Install a UI app into a Brevo account, after showing the configuration and version it will install (`[account-id]` optional — a regular account installs into itself; a corporate account is prompted to pick a sub-account, so pass the ID explicitly in scripts; `--app-id`, `--force`) |
| `brevo app uninstall` | Uninstall a UI app from a Brevo account (same arguments as `install`) |
| `brevo app available-scopes` | List the OAuth scopes the IdP supports (`--web` opens the catalog in a browser) |

Most commands require a successful `brevo login` first, except authentication/help flows (`brevo login`, `brevo logout`, `brevo app init`, `--help`). Every command accepts `--json` for machine-readable output.

The table above is the complete command surface of a published release. Features that aren't live on the Brevo platform yet aren't built into the package — `brevo --help` always lists everything the binary can do, so there is nothing hidden behind a flag or an environment variable.

### UI apps

`brevo app create`'s interactive prompt can build two kinds of app: an OAuth app, or a **UI app**
that renders directly inside a Brevo CRM record (interactive-only — there is no `--type` flag, so
`--json` and piped runs always create an OAuth app).

Today the prompt authors one integration type, an **action link** (`extension_type: "actionLink"`).
In short: it's a clickable menu entry or card CTA button that Brevo renders on a record page — no
embed, no iframe — and clicking it just opens a URL you host, with the record's data passed along
as query parameters, never in the path. Each authored placement lives in `app-config.json` under
`ui_app.surface_point_list` and carries:

- `surface_point_name` — which slot on which record page, chosen from Brevo's live registry at
  create time
- `label` — the menu entry's text, or the card's CTA button
- `more_info` *(optional)* — a supporting line under the menu entry / card description
- `redirect_link` — the destination URL
- `context` *(optional)* — which record fields to pass along as query parameters, narrowed from
  whatever that slot allows
- `size` *(optional)* — card sizing, e.g. `{ "width": "280px", "height": "160px" }`; seeded from
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

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | General error |
| `2` | Aborted (Ctrl+C or SIGTERM) |
| `3` | Authentication failure (401) |
| `4` | Network error (API unreachable) |
| `5` | Not found (404) |

## Configuration

| Variable | Purpose | Default |
| --- | --- | --- |
| `BREVO_API_KEY` | API key used for non-interactive `brevo login` | – |
| `BREVO_API_URL` | API base URL (HTTPS required, except for `localhost`) | `https://api.brevo.com` |
| `BREVO_OAUTH_PROXY_URL` | OAuth proxy used by browser login (HTTPS required, except for `localhost`) | `https://oauth-cli.brevo.com` |
| `BREVO_OAUTH_BASE_URL` | OAuth realm used for scope lookups and scaffolded project templates (HTTPS required, except for `localhost`) | `https://oauth.brevo.com` |
| `BREVO_CONFIG_HOME` | Override for the credentials directory | `~/.brevo/` |
| `BREVO_NO_SKILL_AUTOREFRESH` | Set to `1` to suppress automatic skill refresh on `brevo` runs | off |
| `NO_COLOR` / `FORCE_COLOR` | Disable / force ANSI colour output | – |
| `DEBUG` or `--debug` | Verbose HTTP and error logging | off |

Credentials are stored at `~/.brevo/credentials.json`; per-app client secrets are cached under an `apps` key. Linked project config lives in `./.brevo.json` (gitignored).

## AI agent integration

If you use Claude Code, Cursor, Aider, Copilot CLI, or another agent that reads project context, the package ships ready-to-use context files so agents know how to call `brevo` correctly:

- `node_modules/@getbrevo/cli/agent-context/AGENTS.md` — overview, command list, conventions, and safety rules. Compatible with the [agents.md](https://agents.md) format.
- `node_modules/@getbrevo/cli/agent-context/SKILL.md` — Claude Code skill (with YAML frontmatter and trigger keywords) for auto-activation when a conversation touches the Brevo CLI.

### Claude Code skill (recommended)

The CLI installs and maintains the skill for you:

```bash
brevo skill:cli install
```

This copies `SKILL.md` into `~/.claude/skills/brevo-cli/`. Every subsequent `brevo` invocation auto-refreshes it when the bundled version is newer than the installed one — you'll see a `↻ refreshed brevo-cli skill (vX → vY)` notice on stderr when that happens. Opt out with `BREVO_NO_SKILL_AUTOREFRESH=1`. Remove with `brevo skill:cli uninstall`.

On the first interactive `brevo` invocation after install, you'll also see a one-time banner on stderr inviting you to install the skill. The notice records itself at `~/.brevo/skill-banner.json` and never repeats. Skipped under CI, non-TTY, `--json`, or any `brevo skill:cli` command.

### Manual install (escape hatch)

If you prefer not to install via the CLI, copy the files in directly:

```bash
# AGENTS.md — append into your existing AGENTS.md, or copy if you don't have one
cat node_modules/@getbrevo/cli/agent-context/AGENTS.md >> AGENTS.md

# Claude Code skill — note the directory name matches what `brevo skill:cli install` uses
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
