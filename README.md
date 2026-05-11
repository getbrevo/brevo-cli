# Brevo Developer CLI

Command-line tool to create, manage, and test [Brevo](https://www.brevo.com/) OAuth integrations from your terminal.

## Requirements

- **Node.js** 20.15.0 or newer (required to run the CLI)
- **Yarn** 1.19.1 or newer (only required for developing/building from source; not needed when installing via `npm install -g @getbrevo/cli`)

## Installation

Install globally from the public npm registry:

```bash
npm install -g @getbrevo/cli
# or:
yarn global add @getbrevo/cli
```

This puts the `brevo` binary on your PATH. Verify:

```bash
brevo --version
```

To upgrade later: `npm install -g @getbrevo/cli@latest`.

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
| `brevo app create` | Create an OAuth app (`--name`, `--distribution private\|public`, repeatable `--redirect-uri`) |
| `brevo app list` | List OAuth apps in your account |
| `brevo app credentials` | Show client ID and secret (`--app-id`, `--reveal-secret`) |
| `brevo app update` | Update app name or redirect URLs (`--app-id`, `--name`, repeatable `--redirect-uri`, `--yes`) |
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
| `NO_COLOR` / `FORCE_COLOR` | Disable / force ANSI colour output | – |
| `DEBUG` or `--debug` | Verbose HTTP and error logging | off |

Credentials are stored at `~/.brevo/credentials.json`; per-app client secrets are cached under an `apps` key. Linked project config lives in `./.brevo.json` (gitignored).

## AI agent integration

If you use Claude Code, Cursor, Aider, Copilot CLI, or another agent that reads project context, the package ships ready-to-use context files so agents know how to call `brevo` correctly:

- `node_modules/@getbrevo/cli/agent-context/AGENTS.md` — overview, command list, conventions, and safety rules. Compatible with the [agents.md](https://agents.md) format.
- `node_modules/@getbrevo/cli/agent-context/SKILL.md` — Claude Code skill (with YAML frontmatter and trigger keywords) for auto-activation when a conversation touches the Brevo CLI.

Most agents only read context from your project root, so copy or symlink the files in once:

```bash
# AGENTS.md — append into your existing AGENTS.md, or copy if you don't have one
cat node_modules/@getbrevo/cli/agent-context/AGENTS.md >> AGENTS.md

# Claude Code skill
mkdir -p .claude/skills/brevo
cp node_modules/@getbrevo/cli/agent-context/SKILL.md .claude/skills/brevo/SKILL.md
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

Releases use [changesets](https://github.com/changesets/changesets) and ship to the public npm registry under `@getbrevo`. **Prefer the CI flow** — pushing changesets to `main` opens a "Version Packages" PR (`.github/workflows/release.yaml`); pushing to a `release-*` branch publishes alpha prereleases (`.github/workflows/pre-release.yaml`). CI provides npm provenance via OIDC. Publish locally only when CI is unavailable.

Prerequisites for any local publish:

- `npm whoami` shows an account with `publish` permission on `@getbrevo`
- A clean working tree on the branch you intend to release from
- If your `~/.npmrc` maps `@getbrevo` to a non-public registry (e.g. GitHub Packages), the scope override wins over `publishConfig.registry` in `package.json`. Either pass `--registry=https://registry.npmjs.org/` explicitly, or comment out the `@getbrevo:registry=...` line for the duration of the publish. Confirm the `npm notice Publishing to <url>` line before continuing.

#### Stable release

```bash
yarn changeset                # describe the change (interactive)
yarn version:packages         # consume changesets, bump version, update CHANGELOG
git commit -am "chore(release): version packages"
yarn publish:packages         # runs prepublishOnly (clean + build + test) then publishes
git push --follow-tags
```

#### Prerelease (alpha)

```bash
yarn changeset pre enter alpha   # enter prerelease mode (creates .changeset/pre.json)
yarn changeset                   # describe the change
yarn version:packages            # bumps to e.g. 0.1.0-alpha.0
git commit -am "chore(release): version packages (alpha)"
yarn publish:packages            # publishes under the `alpha` dist-tag
git push --follow-tags
yarn changeset pre exit          # exit prerelease mode when the alpha cycle ends
git commit -am "chore: exit prerelease mode"
```

Verify the result with `npm view @getbrevo/cli versions --json` (stable) or `npm view @getbrevo/cli dist-tags` (prerelease). Install an alpha for smoke-testing with `npm install -g @getbrevo/cli@alpha`.

## Reporting issues

Found a bug or have a feature request? Please [open an issue](https://github.com/getbrevo/brevo-cli/issues/new/choose) on GitHub.

When filing a bug, please include:

- CLI version (`brevo --version`)
- Node.js version (`node --version`) and OS
- The command you ran and the full output (run with `--debug` for verbose logging if relevant)
- **Never paste real credentials** — redact API keys, client secrets, and access tokens before sharing

For security vulnerabilities, please **do not open a public issue**. Email the Brevo security team or use GitHub's [private vulnerability reporting](https://github.com/getbrevo/brevo-cli/security/advisories/new) instead.

## Contributing

Contributions are welcome. See [`AGENTS.md`](./AGENTS.md) and [`CLAUDE.md`](./CLAUDE.md) for the project structure, conventions, and what to check before opening a PR.

## Resources

- [Brevo Developers](https://developers.brevo.com)
- [Package on npm](https://www.npmjs.com/package/@getbrevo/cli)
- [Repository](https://github.com/getbrevo/brevo-cli)
- [Issue tracker](https://github.com/getbrevo/brevo-cli/issues)
- [Changelog](./CHANGELOG.md)

## License

[MIT](./LICENSE)
