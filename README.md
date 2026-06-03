# Brevo Developer CLI

Command-line tool to create, manage, and test [Brevo](https://www.brevo.com/) OAuth integrations from your terminal.

> 📖 Full command and option documentation: **[Brevo CLI reference](https://developers.brevo.com/docs/cli-reference)**

## Requirements

- **Node.js** 20.15.0 or newer (required to run the CLI)
- **Yarn** 1.19.1 or newer (only required for developing/building from source; not needed when installing via `npm install -g @getbrevo/cli`)

## Installation

### Homebrew (macOS/Linux)

```bash
brew install getbrevo/tap/brevo
```

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
   brevo app scaffold --app-id 42
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
| `brevo app create` | Create an OAuth app (`--name`, `--distribution private\|public`, repeatable `--redirect-uri`, `--logo-uri`) |
| `brevo app list` | List OAuth apps in your account |
| `brevo app credentials` | Show client ID and secret (`--app-id`, `--reveal-secret`) |
| `brevo app update` | Update app name, redirect URLs, or logo (`--app-id`, `--name`, repeatable `--redirect-uri`, `--logo-uri`, `--yes`) |
| `brevo app delete` | Delete an app (`--app-id`, `--force`) |
| `brevo app scaffold` | Generate starter code for an app (`--app-id`) |
| `brevo app start` | Run a scaffolded feature locally (e.g. `brevo app start oauth --port 3000`) |

Most commands require a successful `brevo login` first, except authentication/help flows (`brevo login`, `brevo logout`, `brevo app init`, `--help`). Every command accepts `--json` for machine-readable output.

### Browser login

`brevo login` defaults to a browser-based sign-in. The CLI starts a temporary loopback server, opens your browser to the Brevo CLI login service, and stores the returned tokens in `~/.brevo/credentials.json`. Access tokens refresh automatically on expiry.

Flags:

- `--browser` — force browser flow.

For non-interactive use (CI), set `BREVO_API_KEY=<key>` before running `brevo login`. The legacy `--api-key <key>` flag was removed because it leaks the secret into process listings and shell history; the env var is the only supported way to pass an API key non-interactively.

Environment overrides:

- `BREVO_API_URL` — points the CLI at a different Brevo API (defaults to `https://api.brevo.com`).
- `BREVO_OAUTH_PROXY_URL` — points the browser-login flow at a different OAuth proxy (defaults to `https://oauth-cli.brevo.com`; useful for local development or non-default environments).

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
