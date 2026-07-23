<!-- BREVO_CLI_AGENTS_BEGIN -->
# Brevo CLI

This project uses the [Brevo Developer CLI](https://www.npmjs.com/package/@getbrevo/cli) (`brevo` binary) to manage Brevo OAuth applications.

## AI agents — start here

Pick the path that matches your tooling:

- **You are Claude Code** (CLI or desktop app — any agent that reads `~/.claude/skills/`) — install the brevo-cli skill before doing other work, if it isn't already at `~/.claude/skills/brevo-cli/`:

  ```bash
  brevo skill:cli install
  ```

  The skill loads the canonical decision tree, hard rules, and exit codes in the format Claude consumes directly. Once installed it auto-refreshes on every `brevo` invocation so it stays in sync with the running CLI version (opt out with `BREVO_NO_SKILL_AUTOREFRESH=1`). Note: the install targets `~/.claude/skills/`, which only Claude Code surfaces read — the Claude Desktop **chat** app does not load skills from this directory.

- **You are any other AI agent** (Cursor, Copilot CLI, Gemini CLI, Codex, etc.) — **do not run `brevo skill:cli install`**. The skill format is Claude-specific and the install would land in a directory your tooling doesn't read. Use this `AGENTS.md` as your reference instead — it covers the same surface in less depth.

If installation isn't possible for a Claude agent (no write access to `~/.claude/skills/`, sandboxed environment), fall back to this `AGENTS.md`.

## Before starting a new session

Run two preflight checks before any other work.

### 1. Is `brevo` installed?

Run `brevo --version`. If you get `command not found` (or any "no such binary" error), the CLI isn't installed. **Stop and tell the user to install it:**

```bash
npm install -g @getbrevo/cli
# or
yarn global add @getbrevo/cli
```

Don't fall back to raw HTTP against `api.brevo.com` — the `brevo` binary is the canonical entry point. Only continue once `brevo --version` returns a version string.

### 2. Is your reference up to date with the installed CLI?

- **Claude agents (skill installed at `~/.claude/skills/brevo-cli/`):**
  1. Read the installed skill version from `~/.claude/skills/brevo-cli/.brevo-skill.json` (`version` field).
  2. Compare against `brevo --version` from step 1.
  3. **If they don't match, stop and tell the user to update** — ask them to run any `brevo` command (auto-refreshes the skill) or `brevo skill:cli install` to force-reinstall. Do not proceed with stale guidance.
- **Non-Claude agents (reading this `AGENTS.md` directly):** make sure you're reading the canonical bundled copy, not a stale fork.
  1. Locate the canonical `AGENTS.md`. It ships inside the installed `@getbrevo/cli` package:
     - Global npm install: `$(npm root -g)/@getbrevo/cli/agent-context/AGENTS.md`
     - Global yarn install: `$(yarn global dir)/node_modules/@getbrevo/cli/agent-context/AGENTS.md`
     - Local install: `node_modules/@getbrevo/cli/agent-context/AGENTS.md`
  2. If the `AGENTS.md` you're currently reading isn't that file, **switch to the canonical copy** — your current copy may be stale (e.g. one committed into the user's repo from an older CLI version). The bundled copy is always in lockstep with the running CLI version, so no separate version string check is needed once you're reading it.

## When to use it

- Create, list, update, or delete Brevo OAuth apps
- Scaffold a starter OAuth integration
- Run a local OAuth test server (`brevo app start oauth`)
- Inspect or rotate app credentials

## Common commands

| Command | Purpose |
|---|---|
| `brevo login` | Authenticate (`--browser` forces interactive; set `BREVO_API_KEY` for non-interactive; `--json`) |
| `brevo logout` | Clear stored credentials (`--force`, `--json`) |
| `brevo whoami` | Show the authenticated account (`--json`) |
| `brevo app init` | Guided setup (login, create, scaffold) |
| `brevo app list` | List OAuth apps (`--json`) |
| `brevo app create` | Create an app (`--name`, `--distribution <private\|public>`, `--redirect-uri`, `--logo-uri`, `--json`). `private` = used exclusively by your organisation; `public` = distributed to end users or marketplace listings — default to `private` when unspecified. Defaults to scopes `contacts:read`, `contacts:write`, `crm:read`, `crm:write`. **Errors immediately if `app-config.json` already exists in the working directory** — move elsewhere or use `brevo app scaffold` there instead. Otherwise prompts for (and creates/`cd`s into) a target directory right before creating the app, then always scaffolds starter OAuth code afterward — no confirmation prompt for either step. |
| `brevo app update` | Update name / redirect URLs / scopes / logo (`--app-id`, `--name`, `--redirect-uri`, `--scope` repeatable appends, `--logo-uri`, `--yes`, `--json`) |
| `brevo app credentials` | Show client ID / secret (`--app-id`, `--reveal-secret`, `--json`) |
| `brevo app delete` | Delete an app (`--app-id`, `--force`, `--json`) |
| `brevo app scaffold` | Generate starter OAuth code (`--app-id`, `--json`). Directory-aware: creates a fresh directory when none is linked in cwd; when cwd is linked to the *same* app, diffs the local config against the server and only asks to update+regenerate if they differ; when cwd is linked to a *different* app, requires picking a different directory. |
| `brevo app start oauth` | Run the scaffolded OAuth test server (`--port`) |
| `brevo app available-scopes` | List OAuth scopes supported by the IdP (`--json`, `--web`) |
| `brevo skill:cli install` | Install the brevo-cli Claude Code skill (Claude-only; auto-refreshes on every `brevo` run) |
| `brevo skill:cli uninstall` | Remove the brevo-cli skill from `~/.claude/skills/` (Claude-only) |

Run `brevo --help` or `brevo <command> --help` for the full set.

## Conventions

- **Every command supports `--json`** — prefer this when parsing output programmatically.
- **`brevo app create` refuses to run inside an already-linked directory.** If `app-config.json` exists in cwd, it throws immediately (no confirm, no override) — the error points at moving elsewhere or running `brevo app scaffold` there.
- **`brevo app create` resolves its target directory before creating the app**, then always scaffolds afterward — no confirmation prompt for either step, in interactive mode or `--json`. Interactive mode prompts for the target directory (default `./<slugified-app-name>`, `cd`s into it) before the API call, how to handle an existing one (overwrite / merge / choose a different path), and — after the app is created — which kind of project to scaffold (today, a single choice: *Test OAuth App*). Under `--json` there's no prompting: the same default directory is used, `cd`d into if it doesn't already exist; if it already exists, both directory setup and scaffolding are skipped (the app is still created). The JSON response always includes `directory` (absolute path) alongside the app fields, plus either `scaffolded` (file count, on success) or `scaffoldSkipped` (a message, when the directory already existed).
- **`brevo app scaffold` is directory-aware.** No `app-config.json` in cwd → same directory prompt as `create`. `app-config.json` in cwd for the *same* app → diffs the local config against the server; if they match, it re-scaffolds merge-only with no prompt; if they differ, it shows the differing fields and asks consent to fully regenerate every template file (not just `app-config.json`) — declining cancels with nothing written. `app-config.json` in cwd for a *different* app → must choose a different directory or cancel; it will never write one app's files into a directory linked to another app. **Under `--json`, none of the above ever prompts** — a directory conflict, a config diff, or a different-app-linked directory are each treated as declined and reported as `{ "cancelled": true, "reason": "...", "diffs": [...] }` (fields present only when relevant) instead of hanging on a prompt.
- **`app-config.json`** in the working directory pins the linked app — `brevo app update` and `brevo app start` read from it. The optional top-level `logoUri` string is pushed as `logo_uri` by a flagless `brevo app update`; leave it empty to keep the API value untouched. The top-level `version` string is server-assigned (set at `brevo app create`, shown by `brevo app create`/`brevo app list`/`brevo app update`) — the CLI never sends it and there is no flag to change it; `brevo app update` backfills it into `app-config.json` for projects scaffolded before this field existed.
- **Credentials** live at `~/.brevo/credentials.json`. Never commit this file or any `.env.local`.
- **Non-interactive auth:** `BREVO_API_KEY=xkeysib-... brevo login`. The legacy `--api-key` flag was removed because it leaks into shell history.
- **Skip prompts:** `--force` for delete/logout; `--yes` for `app update`.
- **Forced update:** when the installed CLI is a full **major** version behind the latest npm release, every command except `--help`/`--version` prints a blocking update banner to stderr and exits `1` without running. Update with `npm install -g @getbrevo/cli` (or `yarn global add`). The gate honors the same opt-outs as the soft update notice (`BREVO_NO_UPDATE_NOTIFIER=1`, `--no-update-notifier`, CI, non-TTY), so it never fires in those contexts.
- **Exit codes:** `0` success · `1` general error · `2` aborted · `3` auth · `4` network · `5` not found.

## Scopes

- New apps created via `brevo app create` default to `contacts:read`, `contacts:write`, `crm:read`, `crm:write`. The CLI prints these on success.
- `brevo app update --scope <scope>` is repeatable and appends, mirroring `--redirect-uri`. De-duped, order-preserving. Writes back to `app-config.json` when that file describes the target app. A single flag value may contain multiple comma- or whitespace-separated tokens (`--scope "crm:read, crm:write"` is equivalent to `--scope crm:read --scope crm:write`). Same normalization is applied to `auth.scopes` when read from `app-config.json`.
- `brevo app available-scopes [--json] [--web]` lists the OAuth scopes the IdP currently supports. It reads a **public** catalog and works **without `brevo login`** (no API key needed). Text output groups names by category (e.g. `account`, `data_crm`, `messaging`); `--json` returns a flat `{ scopes: string[] }` of names. OIDC-reserved scopes (`openid`, `profile`, `email`, `offline_access`) and magic wildcards are excluded. The CLI validates scope **format** locally (must match `[A-Za-z0-9][A-Za-z0-9:_.-]*`) but does **not** validate that a scope is recognized by the IdP — server returns 400 on unknown scopes.
- Passing `--web` to `brevo app available-scopes` additionally starts a short-lived loopback HTTP server on `127.0.0.1:<ephemeral>` rendering the same catalog as a styled HTML page and opens the user's browser. It stays in the foreground until Ctrl+C. Without `--web` the command exits after printing the list — TTY detection no longer triggers the browser. `--json` always suppresses the browser (`--json` returns before `--web` is evaluated).

### Legacy `'all'` scope deprecation

The legacy catch-all `'all'` OAuth scope is deprecated. The CLI **blocks** `brevo app update` and `brevo app start oauth` when scopes still contain `'all'` (no escape hatch, no silent rewrite); the only mutating path that proceeds is an explicit `--scope` migration. To handle a legacy app:

1. **Detect** `'all'` in `auth.scopes` of a local `app-config.json`, or on a remote app via `brevo app list --json` — affected apps carry `"legacy_all_scope": true` (text output appends `(legacy 'all' — deprecated)` to the scopes line).
2. **Prompt the user to pick granular scopes** — use `brevo app available-scopes --json` for the catalog, or fall back to the four defaults (`contacts:read`, `contacts:write`, `crm:read`, `crm:write`).
3. **Migrate** with `brevo app update --scope <scope> --scope <scope> ...` — passing `--scope` drops `'all'` from the outgoing scope set and applies the new granular scopes (the summary shows a "Migrating from legacy 'all' scope" line and `all (removed)`).

`brevo app scaffold` against an app whose remote scopes contain `'all'` never propagates it: the new `app-config.json` keeps the app's remaining granular scopes (or the four default scopes when `'all'` was the only scope), with a one-line substitution notice (suppressed under `--json`). Note the substitution is local-only — the remote app still needs the `--scope` migration above.

## Environment variables

| Variable | Purpose |
|---|---|
| `BREVO_API_KEY` | Non-interactive login |
| `BREVO_API_URL` | Override API base (HTTPS required, except `localhost`) |
| `BREVO_OAUTH_PROXY_URL` | Override OAuth proxy used by browser login |
| `BREVO_CONFIG_HOME` | Override credentials directory (default `~/.brevo/`) |
| `BREVO_CLAUDE_HOME` | Override Claude Code home used by `skill:cli` (default `~/.claude/`) |
| `BREVO_NO_SKILL_AUTOREFRESH` | Set to `1` to suppress automatic skill refresh on `brevo` runs |
| `BREVO_NO_UPDATE_NOTIFIER` | Set to `1` to suppress the npm update-available notice **and** the blocking major-version force-update gate |
| `BREVO_DEBUG=1` or `--debug` | Verbose HTTP and error logging |

## Safety

- Never echo, log, or commit API keys (`xkeysib-…`), client secrets, refresh tokens, or contents of `~/.brevo/credentials.json` / `.env.local`.
- For destructive operations (`app delete`, `logout`), prefer the interactive flow unless running in CI; pass `--force` only when intentional.

## Reference

- npm: <https://www.npmjs.com/package/@getbrevo/cli>
- Repo: <https://github.com/getbrevo/brevo-cli>
- Brevo developer docs: <https://developers.brevo.com>
- CLI reference: <https://developers.brevo.com/docs/cli-reference>
<!-- BREVO_CLI_AGENTS_END -->
