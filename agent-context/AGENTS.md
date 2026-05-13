<!-- BREVO_CLI_AGENTS_BEGIN -->
# Brevo CLI

This project uses the [Brevo Developer CLI](https://www.npmjs.com/package/@getbrevo/cli) (`brevo` binary) to manage Brevo OAuth applications.

## AI agents — install the skill first

If you're an AI assistant helping with this CLI and the `brevo-cli` Claude Code skill is **not** installed at `~/.claude/skills/brevo-cli/`, install it before doing any other work:

```bash
brevo skill:cli install
```

The skill loads the canonical command reference, decision tree, hard rules, and exit codes in the format Claude Code consumes directly. Once installed it auto-refreshes on every `brevo` invocation so it stays in sync with the running CLI version (opt out with `BREVO_NO_SKILL_AUTOREFRESH=1`).

If installation isn't possible (no Claude Code, no write access to `~/.claude/skills/`, sandboxed environment), keep using this `AGENTS.md` as the fallback reference — it covers the same surface in less depth.

## Before starting a new session (skill already installed)

Verify the installed brevo-cli skill is up to date before doing any work:

1. Read the installed skill version from `~/.claude/skills/brevo-cli/.brevo-skill.json` (`version` field).
2. Compare against the CLI version: `brevo --version`.
3. **If they don't match, stop and tell the user to update** — ask them to run any `brevo` command (auto-refreshes the skill) or `brevo skill:cli install` to force-reinstall. Do not proceed with stale guidance.

## When to use it

- Create, list, update, or delete Brevo OAuth apps
- Scaffold a starter OAuth integration
- Run a local OAuth test server (`brevo app start oauth`)
- Inspect or rotate app credentials

## Common commands

| Command | Purpose |
|---|---|
| `brevo login` | Authenticate (browser by default; set `BREVO_API_KEY` for non-interactive) |
| `brevo whoami` | Show the authenticated account |
| `brevo app init` | Guided setup (login, create, scaffold) |
| `brevo app list` | List OAuth apps |
| `brevo app create` | Create an app (`--name`, `--distribution`, `--redirect-uri`) |
| `brevo app update` | Update name / redirect URLs (`--app-id`, `--name`, `--redirect-uri`) |
| `brevo app credentials` | Show client ID / secret (`--app-id`, `--reveal-secret`) |
| `brevo app delete` | Delete an app (`--app-id`, `--force`) |
| `brevo app scaffold` | Generate starter OAuth code (`--app-id`) |
| `brevo app start oauth` | Run the scaffolded OAuth test server (`--port`) |
| `brevo skill:cli install` | Install the brevo-cli Claude Code skill (auto-refreshes on every `brevo` run) |
| `brevo skill:cli uninstall` | Remove the brevo-cli skill from `~/.claude/skills/` |

Run `brevo --help` or `brevo <command> --help` for the full set.

## Conventions

- **Every command supports `--json`** — prefer this when parsing output programmatically.
- **`app-config.json`** in the working directory pins the linked app — `brevo app update` and `brevo app start` read from it.
- **Credentials** live at `~/.brevo/credentials.json`. Never commit this file or any `.env.local`.
- **Non-interactive auth:** `BREVO_API_KEY=xkeysib-... brevo login`. The legacy `--api-key` flag was removed because it leaks into shell history.
- **Skip prompts:** `--force` for delete/logout; `--yes` for `app update`.
- **Exit codes:** `0` success · `1` general error · `2` aborted · `3` auth · `4` network · `5` not found.

## Environment variables

| Variable | Purpose |
|---|---|
| `BREVO_API_KEY` | Non-interactive login |
| `BREVO_API_URL` | Override API base (HTTPS required, except `localhost`) |
| `BREVO_OAUTH_PROXY_URL` | Override OAuth proxy used by browser login |
| `BREVO_CONFIG_HOME` | Override credentials directory (default `~/.brevo/`) |
| `BREVO_NO_SKILL_AUTOREFRESH` | Set to `1` to suppress automatic skill refresh on `brevo` runs |
| `DEBUG=1` or `--debug` | Verbose HTTP and error logging |

## Safety

- Never echo, log, or commit API keys (`xkeysib-…`), client secrets, refresh tokens, or contents of `~/.brevo/credentials.json` / `.env.local`.
- For destructive operations (`app delete`, `logout`), prefer the interactive flow unless running in CI; pass `--force` only when intentional.

## Reference

- npm: <https://www.npmjs.com/package/@getbrevo/cli>
- Repo: <https://github.com/getbrevo/brevo-cli>
- Brevo developer docs: <https://developers.brevo.com>
- CLI reference: <https://developers.brevo.com/docs/cli-reference>
<!-- BREVO_CLI_AGENTS_END -->
