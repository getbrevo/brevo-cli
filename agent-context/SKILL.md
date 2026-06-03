---
name: brevo-cli
description: Use when working in a project that uses the Brevo Developer CLI (the `brevo` binary from `@getbrevo/cli`) — managing OAuth apps, scaffolding integrations, running the local OAuth test server, or invoking any `brevo …` command. Activates on: brevo, brevo cli, brevo app, app-config.json, OAuth Brevo, BREVO_API_KEY, getbrevo.
---

# Brevo CLI

This project uses the Brevo Developer CLI to create and manage Brevo OAuth applications. Treat the `brevo` binary as the canonical entry point — don't shell out to `curl https://api.brevo.com/...` for things the CLI already covers.

> **Reading this from the repo rather than `~/.claude/skills/brevo-cli/`?**
>
> - **If you're Claude Code** (CLI or desktop app — any agent that reads `~/.claude/skills/`): install it as a skill with `brevo skill:cli install` so your tooling loads it natively and keeps it auto-refreshed. The repo copy is bundled with the npm package; the installed copy is what Claude actually consumes. Note: the Claude Desktop **chat** app does not read `~/.claude/skills/`, so the installed skill won't load there — only Claude Code surfaces pick it up.
> - **If you're any other AI agent** (Cursor, Copilot CLI, Gemini, Codex, etc.): **don't run `brevo skill:cli install`** — the skill format is Claude-specific and would land in a directory your tooling doesn't read. Use `agent-context/AGENTS.md` as your reference instead; it covers the same surface in less depth.

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

### 2. Is this skill up to date?

* [ ] Read the installed skill version from `~/.claude/skills/brevo-cli/.brevo-skill.json` (`version` field).
* [ ] Compare against `brevo --version` from step 1.
* [ ] If they don't match, **stop and tell the user to update** — running any `brevo` command auto-refreshes the skill, or `brevo skill:cli install` force-reinstalls. Do not proceed with stale guidance.

## Decision tree

- "Set me up from scratch" → `brevo app init`
- "Authenticate" → `brevo login` (or `BREVO_API_KEY=xkeysib-... brevo login` for CI)
- "Who am I logged in as?" → `brevo whoami --json`
- "Show / pick an app" → `brevo app list --json`
- "Create an app" → `brevo app create --name "<name>" --distribution private --redirect-uri <url> --json` (add `--logo-uri <https://…>` to set the app logo at creation time; new apps default to scopes `contacts:read`, `contacts:write`, `crm:read`, `crm:write`). Only `private` distribution is available today — the CLI rejects `--distribution public` with a "coming soon" error, so never suggest it.
- "Update app metadata" → `brevo app update --app-id <id> --name "<name>"` and/or `--redirect-uri <url>` (repeatable) and/or `--scope <scope>` (repeatable, appends) and/or `--logo-uri <https://…>`
- "Get client credentials" → `brevo app credentials --app-id <id> --json` (add `--reveal-secret` to print the secret)
- "Generate starter OAuth code" → `brevo app scaffold --app-id <id>`
- "Run the OAuth test server" → `brevo app start oauth --port 3009` (must be inside the scaffolded directory)
- "Delete an app" → `brevo app delete --app-id <id> --force`
- "List supported OAuth scopes" → `brevo app available-scopes --json`
- "Sign out" → `brevo logout --force`

## Hard rules

1. **Always pass `--json`** when you intend to parse output. Every command supports it.
2. **Never print, log, or commit** API keys (`xkeysib-…`), client secrets, refresh tokens, or contents of `~/.brevo/credentials.json` / `.env.local`. Redact before sharing diagnostics.
3. **Don't use `--api-key`** — the flag was removed. Use the `BREVO_API_KEY` env var.
4. **Don't run `brevo app scaffold` inside an existing scaffolded project** — it refuses if `app-config.json` exists in cwd. Use `brevo app update` to push config changes.
5. **Prefer flag-driven over interactive** in agent contexts: `--name`, `--app-id`, `--force`, `--yes` so the command doesn't block on prompts.

## Locating the linked app

If `app-config.json` exists in the working directory, it pins the app — `brevo app update` and `brevo app start` use it automatically. To target a different app, pass `--app-id`.

`app-config.json` carries an optional top-level `logoUri` string. When set, a flagless `brevo app update` pushes it as `logo_uri` in the PUT body; when empty / absent, the field is left untouched on the API.

## Scopes

- New apps created via `brevo app create` default to `contacts:read`, `contacts:write`, `crm:read`, `crm:write`. The CLI prints the default set on success and points to `brevo app update --scope` for changes.
- `brevo app update --scope <scope>` is **repeatable and appends** — passing `--scope X --scope Y` adds both to the app's existing scope set, de-duped, order-preserving. A single flag value may also contain multiple comma- or whitespace-separated tokens (`--scope "crm:read, crm:write"` ≡ `--scope crm:read --scope crm:write`); the same normalization is applied to `auth.scopes` when read from `app-config.json`, so a malformed entry like `"crm:write, campaigns:read"` is split into two scopes on read. To see what's currently set, run `brevo app credentials --app-id <id> --json`. To remove a scope, edit `app-config.json` and run `brevo app update` without `--scope`.
- `brevo app available-scopes [--json] [--web]` lists the OAuth scopes the IdP currently supports. It reads a **public** catalog and works **without `brevo login`** (no API key needed). Text output groups names by category (e.g. `account`, `data_crm`, `messaging`); `--json` returns a flat `{ scopes: string[] }` of names. OIDC-reserved scopes (`openid`, `profile`, `email`, `offline_access`) and magic wildcards are excluded. The CLI validates scope **format** locally (must match `[A-Za-z0-9][A-Za-z0-9:_.-]*`) but does **not** validate that a scope is recognized by the IdP — use `app available-scopes` to confirm spelling before passing an unfamiliar scope.
- Passing `--web` to `brevo app available-scopes` **also opens a browser** to a styled local page (loopback `http://127.0.0.1:<port>/`) and stays running until Ctrl+C. Without `--web` the command exits after printing the list — TTY detection no longer triggers the browser. `--json` always suppresses the browser, so agent invocations using `--json` behave the same regardless of `--web`.

### Legacy `'all'` scope deprecation

The legacy catch-all `'all'` OAuth scope is deprecated. The CLI **blocks** `brevo app update` and `brevo app start oauth` when scopes still contain `'all'` (no escape hatch, no silent rewrite); the only mutating path that proceeds is an explicit `--scope` migration. To handle a legacy app:

1. **Detect** `'all'` in `auth.scopes` of a local `app-config.json`, or on a remote app via `brevo app list --json` — affected apps carry `"legacy_all_scope": true` (text output appends `(legacy 'all' — deprecated)` to the scopes line).
2. **Prompt the user to pick granular scopes** — use `brevo app available-scopes --json` for the catalog, or fall back to the four defaults (`contacts:read`, `contacts:write`, `crm:read`, `crm:write`).
3. **Migrate** with `brevo app update --scope <scope> --scope <scope> ...` — passing `--scope` drops `'all'` from the outgoing scope set and applies the new granular scopes (the summary shows a "Migrating from legacy 'all' scope" line and `all (removed)`).

`brevo app scaffold` against an app whose remote scopes contain `'all'` never propagates it: the new `app-config.json` keeps the app's remaining granular scopes (or the four default scopes when `'all'` was the only scope), with a one-line substitution notice (suppressed under `--json`). Note the substitution is local-only — the remote app still needs the `--scope` migration above.

## Exit codes

`0` success · `1` general error · `2` aborted · `3` auth failure · `4` network · `5` not found.

## Before sharing or committing output

* [ ] No `xkeysib-…` API keys, client secrets, refresh tokens, or contents of `~/.brevo/credentials.json` / `.env.local` in messages, logs, or diffs.
* [ ] Real production account / org / app IDs redacted to placeholders before sharing diagnostics.

## How this skill stays current

This SKILL.md is installed into `~/.claude/skills/brevo-cli/` by `brevo skill:cli install`. Once installed, **every `brevo` invocation auto-refreshes it** if the bundled CLI ships a newer version — you'll see a `↻ refreshed brevo-cli skill (vX → vY)` notice on stderr when that happens. Hand-editing the installed copy is not durable; the CLI overwrites it on the next run. Opt out with `BREVO_NO_SKILL_AUTOREFRESH=1`. The manual escape hatch is `brevo skill:cli uninstall`.

## More

- Help: `brevo --help`, `brevo <command> --help`
- npm: <https://www.npmjs.com/package/@getbrevo/cli>
- Repo: <https://github.com/getbrevo/brevo-cli>
- Brevo developer docs: <https://developers.brevo.com>
- CLI reference: <https://developers.brevo.com/docs/cli-reference>
