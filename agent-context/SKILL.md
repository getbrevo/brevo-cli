---
name: brevo-cli
description: Use when working in a project that uses the Brevo Developer CLI (the `brevo` binary from `@getbrevo/cli`) — managing OAuth apps, scaffolding integrations, running the local OAuth test server, or invoking any `brevo …` command. Trigger keywords - brevo, brevo cli, brevo app, app-config.json, OAuth Brevo, BREVO_API_KEY, getbrevo.
---

# Brevo CLI

This project uses the Brevo Developer CLI to create and manage Brevo OAuth applications. Treat the `brevo` binary as the canonical entry point — don't shell out to `curl https://api.brevo.com/...` for things the CLI already covers.

## Decision tree

- "Set me up from scratch" → `brevo app init`
- "Authenticate" → `brevo login` (or `BREVO_API_KEY=xkeysib-... brevo login` for CI)
- "Show / pick an app" → `brevo app list --json`
- "Create an app" → `brevo app create --name "<name>" --distribution private --redirect-uri <url> --json`
- "Update app metadata" → `brevo app update --app-id <id> --name "<name>"` and/or `--redirect-uri <url>` (repeatable)
- "Get client credentials" → `brevo app credentials --app-id <id> --json` (add `--reveal-secret` to print the secret)
- "Generate starter OAuth code" → `brevo app scaffold --app-id <id>`
- "Run the OAuth test server" → `brevo app start oauth --port 3009` (must be inside the scaffolded directory)
- "Delete an app" → `brevo app delete --app-id <id> --force`
- "Sign out" → `brevo logout --force`

## Hard rules

1. **Always pass `--json`** when you intend to parse output. Every command supports it.
2. **Never print, log, or commit** API keys (`xkeysib-…`), client secrets, refresh tokens, or contents of `~/.brevo/credentials.json` / `.env.local`. Redact before sharing diagnostics.
3. **Don't use `--api-key`** — the flag was removed. Use the `BREVO_API_KEY` env var.
4. **Don't run `brevo app scaffold` inside an existing scaffolded project** — it refuses if `app-config.json` exists in cwd. Use `brevo app update` to push config changes.
5. **Prefer flag-driven over interactive** in agent contexts: `--name`, `--app-id`, `--force`, `--yes` so the command doesn't block on prompts.

## Locating the linked app

If `app-config.json` exists in the working directory, it pins the app — `brevo app update` and `brevo app start` use it automatically. To target a different app, pass `--app-id`.

## Exit codes

`0` success · `1` general error · `2` aborted · `3` auth failure · `4` network · `5` not found.

## How this skill stays current

This SKILL.md is installed into `~/.claude/skills/brevo-cli/` by `brevo skill install`. Once installed, **every `brevo` invocation auto-refreshes it** if the bundled CLI ships a newer version — you'll see a `↻ refreshed brevo-cli skill (vX → vY)` notice on stderr when that happens. Hand-editing the installed copy is not durable; the CLI overwrites it on the next run. Opt out with `BREVO_NO_SKILL_AUTOREFRESH=1`. The manual escape hatch is `brevo skill uninstall`.

## More

- Help: `brevo --help`, `brevo <command> --help`
- npm: <https://www.npmjs.com/package/@getbrevo/cli>
- Repo: <https://github.com/getbrevo/brevo-cli>
- Brevo developer docs: <https://developers.brevo.com>
- CLI reference: <https://developers.brevo.com/docs/cli-reference>
