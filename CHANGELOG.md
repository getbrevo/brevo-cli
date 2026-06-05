# @getbrevo/cli

## 1.2.0

### Minor Changes

- a4533d9: The CLI now identifies itself to the Brevo API on every request via a single `User-Agent` header: `brevo-cli/<version> (<os>)`, extended with `; auth=api_key` or `; auth=oauth` when the request carries credentials. No personal data is sent — only the CLI version, operating system family, and authentication method already in use.

## 1.1.1

### Patch Changes

- e7ffaa6: Deprecate the legacy `'all'` OAuth scope and improve scope tooling:
  - `brevo app update` and `brevo app start oauth` now block when scopes contain `'all'`. Pass `--scope` on `brevo app update` to migrate (drops `'all'`, applies the new granular scopes). `brevo app list` flags legacy apps (text tag + `legacy_all_scope: true` in `--json`); `brevo app scaffold` drops `'all'` when scaffolding from a legacy app, keeping its granular scopes (or the default scopes when `'all'` was the only one).
  - `brevo app available-scopes` no longer requires authentication — it only reads the public IdP scope catalog, so it now works before `brevo login` (previously exited with "Not authenticated").
  - `brevo app available-scopes --web` page improvements: per-category "Copy" CTA, per-scope checkboxes that build a copyable selection list, a `deprecated` badge on the legacy `'all'` scope (excluded from copy/selection), a hero CTA linking the scope catalog docs (https://developers.brevo.com/docs/oauth-scopes#scope-catalog), and a footer link to the CLI reference docs. The terminal output also prints the scope catalog docs URL. Copied scope lists are double-quoted and comma-separated (`"contacts:read","contacts:write"`) — ready to paste into `app-config.json`'s `auth.scopes` array or `brevo app update --scope`.
  - added user-agent for cli-version, os and auth type

- ab05546: Add Homebrew as an install channel: `brew install getbrevo/tap/brevo`. The
  formula in `getbrevo/homebrew-tap` is auto-bumped on every npm release. No CLI
  behavior, command, flag, or env var changed.

## 1.1.0

### Minor Changes

- 0896225: Granular OAuth scopes (BEX-197) and `logo_uri` support (BEX-194):
  - `brevo app create` now creates apps with `contacts:read`, `contacts:write`, `crm:read`, `crm:write` instead of the legacy `all`. The CLI prints a one-line notice listing the defaults and how to change them.
  - `brevo app update --scope <scope>` (new, repeatable) appends scopes to an app's existing set, de-duped, order-preserving. Writes back to `app-config.json` when applicable. A single flag value may contain multiple comma- or whitespace-separated tokens (`--scope "crm:read, crm:write"` is equivalent to two `--scope` flags); the same normalization heals comma-embedded entries when reading `auth.scopes` from `app-config.json`. Each resulting token is validated locally against `[A-Za-z0-9][A-Za-z0-9:_.-]*` to catch typos before the API call.
  - `brevo app available-scopes [--json] [--web]` (new) prints the IdP's supported-scopes catalog. Text output groups scopes by category (`account`, `data_crm`, `messaging`); `--json` returns a flat array of names. OIDC-reserved scopes and magic wildcards are excluded. Sourced from `/realms/partner/scopes`.
  - Passing `--web` to `brevo app available-scopes` additionally starts a short-lived loopback HTTP server on `127.0.0.1` and opens the user's browser to a self-contained HTML page listing every supported scope grouped by category, with a search filter. Each scope is expandable to reveal its API endpoints (chip list). A "Refresh" button on the page re-fetches scopes from the IdP without restarting the command. The server runs in the foreground until Ctrl+C (SIGINT or SIGTERM closes it cleanly). Without `--web` the command exits after printing the list — TTY detection no longer triggers the browser. `--json` always suppresses the browser.
  - Add `logo_uri` support to `brevo app create` (`--logo-uri`), `brevo app update` (`--logo-uri`), and the `logoUri` top-level field in `app-config.json`. Flagless `brevo app update` pushes `logoUri` from the config file when present. The interactive `brevo app create` flow (also reached via `brevo app init`) now prompts for an optional logo URL; the prompt is skipped under `--json` or when `--logo-uri` is passed. The interactive prompt and its invalid-format hint now advertise the expected `https://` form.

  Other changes:
  - `brevo app create` and `brevo app update` now send the CLI's own version as `cli_version` in the request body, so the backend can track which CLI release performed each write.
  - Removed the dormant `minCliVersion` mechanism. `brevo app scaffold` no longer writes `minCliVersion` into `app-config.json` (the constant had been `0.0.0` since introduction, so the runtime check never fired). The npm-registry update-notifier already covers the "you should upgrade" nudge. Existing `app-config.json` files keep their `minCliVersion` field harmlessly — it is now ignored. `cliVersion` (informational provenance) is unchanged.

## 1.0.1

### Patch Changes

- 6aeb15a: Add `brevo skill:cli` command group for installing the brevo-cli Claude Code skill into `~/.claude/skills/`. The `skill:<name>` shape reserves a namespace for future Brevo-authored skills (each gets its own top-level group rather than positional args).

  **Commands**
  - `brevo skill:cli install [--json]` — installs the brevo-cli skill, idempotently. If the skill is already at the bundled version it reports "already up to date".
  - `brevo skill:cli uninstall [--json]` — removes the brevo-cli skill. Marker-gated, so it never touches a directory the CLI didn't create. Reports a friendly no-op when nothing is installed.

  **Auto-refresh**

  The skill version tracks the CLI version (read from `package.json` at module-init). Every CLI release effectively bumps the bundled skill version too, so installed copies auto-refresh after a CLI upgrade — even when `SKILL.md` itself didn't change. The refresh emits a single stderr line: `↻ refreshed brevo-cli skill (v1.0.0 → v1.0.1)`. Skipped under `CI=true`, `--json`, any `brevo skill:cli *` invocation, and when `BREVO_NO_SKILL_AUTOREFRESH=1` is set.

  **Onboarding**

  Discovery is doc-driven rather than interrupting interactive runs: `agent-context/AGENTS.md` opens with an "AI agents — install the skill first" section telling any agent helping with the CLI to run `brevo skill:cli install` before doing other work. Humans run `brevo skill:cli install` once when they want the AI assist; otherwise the CLI never nags. No first-run banner, no `~/.brevo/skill-banner.json` state file.

  **Implementation notes**
  - The skill catalog is bundled inline so installs work fully offline.
  - `agent-context/SKILL.md` is the single source of truth — the CLI reads it directly via `SKILLS_BUNDLE_DIR`; manual-copy users and `brevo skill:cli install` users see the same file.
  - Installs are tracked with a `.brevo-skill.json` marker so auto-refresh and uninstall stay safe.
  - Skill test fixtures route through a repo-local `src/__tests__/**/__sandbox__/` directory (gitignored) instead of `os.tmpdir()` — addresses SonarCloud `S5443`.

  **Docs**
  - Fix `AGENTS.md` env-var table: the debug toggle is `BREVO_DEBUG=1`, not `DEBUG=1` (the latter never enabled debug logging — `src/lib/logger.ts` only reads `BREVO_DEBUG`).
  - Document previously undocumented env vars in `AGENTS.md`: `BREVO_CLAUDE_HOME` (override Claude Code home used by `skill:cli`) and `BREVO_NO_UPDATE_NOTIFIER` (suppress the npm update-available notice).
  - Round out `AGENTS.md` command table: add the missing `brevo logout` row and the `--yes` flag on `app update`; list `--json` consistently across every command that supports it.
  - Add the missing `whoami` mapping to the `SKILL.md` decision tree.
  - Disambiguate Claude vs non-Claude agents across docs and command surface:
    - `SKILL.md` intro callout splits the "reading this from the repo" guidance — Claude installs the skill, other agents read `AGENTS.md` instead.
    - `brevo skill:cli {install,uninstall} --help` descriptions now flag the commands as Claude-only.
    - `brevo skill:cli install` prints a follow-up hint after a fresh install pointing non-Claude tools at `AGENTS.md`.
  - Add a two-step preflight to both `SKILL.md` and `AGENTS.md`. Before any other work, agents must (1) confirm `brevo --version` returns a string — otherwise stop and ask the user to `npm install -g @getbrevo/cli` — and (2) verify their reference matches the running CLI: Claude compares `~/.claude/skills/brevo-cli/.brevo-skill.json` to `brevo --version`; non-Claude agents read the canonical bundled `AGENTS.md` from `$(npm root -g)/@getbrevo/cli/agent-context/AGENTS.md` (or yarn/local equivalent) so the doc is always in lockstep with the installed CLI.

- d4335f5: Wipe the per-app credential cache on `brevo login` when the new account differs from the previously-stored one. Cached `clientId`/`clientSecret` values belong to the prior account's apps and would mislead the new session. Same-account re-logins keep the cache intact.
- d4335f5: Internal: hardened scaffold test fixtures by routing the mocked `outputDir` strings through a sandbox path under `__dirname` instead of `os.tmpdir()` / hardcoded `/tmp/...`. Addresses SonarCloud `S5443` (publicly-writable directories) at all 9 callsites. Test-only change — no runtime behavior is affected.

## 1.0.0

### Major Changes

- 93dad27: Initial release of `@getbrevo/cli` — the Brevo Developer CLI for creating, managing, and testing OAuth integrations from the terminal. Published to the public npm registry (`registry.npmjs.org`) under `@getbrevo/cli`.

  **Authentication & setup**
  - `brevo login` / `brevo logout` / `brevo whoami` — authenticate with a Brevo API key, stored at `~/.brevo/credentials.json`. Invalid keys surface a single, consistent `Invalid API key. Please check and try again.` message on first attempt and on retry.
  - `brevo init` — link a local project to a Brevo app via `app-config.json`.

  **App management**
  - `brevo app create` — interactive and flag-driven app creation. Probes both `0.0.0.0` and `127.0.0.1` to detect wildcard listeners before suggesting a default redirect port. Prints a one-line tip pointing at `brevo app start oauth` for local testing (suppressed under `--json` and skipped when `--redirect-uri` is passed). `--help` examples use `http://localhost:3009/auth/callback` to match the scaffolded handler.
  - `brevo app list` — lists apps; locally caches names updated via `brevo app update` so renames reflect immediately despite server-side eventual consistency. Cache refreshes on `app credentials` and clears on `app delete`.
  - `brevo app update` — supports `--name`, `--redirect-uri` (repeatable, appends), and `--app-id` flags. Without flags, pushes the full `app-config.json`. With flags, merges values over `app-config.json` or the API. Writes back to `app-config.json` after a successful update when the app ID matches.
  - `brevo app credentials` — reveals client credentials. `--json` includes `redirectUris`. Consistent placeholders: human output uses `[hidden — run \`brevo app credentials --reveal-secret\`]`, `--json`uses`[hidden]`, missing values use `[not available]`.
  - `brevo app delete` — deletes an app; reports `App <id> not found.` instead of generic `Request failed with status 404`.

  **Scaffolding & local OAuth testing**
  - `brevo app scaffold` — generates a working OAuth project with templates referencing both `npm` and `yarn`. Stamps `cliVersion` and `minCliVersion` into `app-config.json` so projects can warn at startup when run with an older CLI (suppressed under `--json` and for unpublished local builds). `brevo app update` does not touch these fields.
  - `brevo app start oauth` — runs the scaffolded local OAuth server. Self-registers the local redirect URL when the resolved port has no matching `http://localhost:<port>/...` (or `127.0.0.1`) entry on the app: interactively prompts (default Yes) to add `http://localhost:<port>/auth/callback`, pushes to the remote app, and writes back to `app-config.json`. Decline continues with a warning. In non-TTY mode, hard-fails with a structured error suggesting `brevo app update --redirect-uri` rather than silently mutating the remote app.
  - `--port <port>` propagation — `REDIRECT_URI` is forwarded to the child process whenever a registered localhost redirect URL exists on the resolved port (preserving `localhost` vs `127.0.0.1` for Brevo's exact-string match), so the authorization URL and the listener agree on the port. Declined registrations leave `.env.local` untouched.
  - After a successful flow, both the CLI and the scaffolded handler print a next-steps hint (`/auth/refresh` URL, pointers to call the Brevo API or open `src/oauth/handler.js`). The Authorization URL preview renders `state=[random]` instead of `<random>` so the browser doesn't strip it as an unknown HTML tag.

  **General CLI behaviour**
  - Unknown top-level commands report `error: unknown command '<x>'` and exit 1 instead of being intercepted by the auth guard.
  - Validation errors (`--distribution invalid`, malformed URLs, etc.) print once. The top-level error handler renders messages; `validateEnum` / `validateUrl` no longer log before throwing.
  - Every command supports `--json` via `jsonOutput()`. Diagnostic log lines (`APP_CREATE_PORT_IN_USE`, `APP_CREATE_PORT_SCAN_FAILED`, etc.) are gated under `!--json` to keep machine output clean.
  - All user-facing strings live in `src/lang/en.ts`; CLI command references live in `src/lib/constants.ts` as `CLI.*`.

  **Update notifier**
  - After every command, the CLI checks the npm registry for a newer release and shows a non-intrusive banner if one is available. The check runs asynchronously, caches at `~/.brevo/update-check.json` with a 24h TTL, and is skipped in CI, non-TTY sessions, when `--no-update-notifier` is passed, or when `BREVO_NO_UPDATE_NOTIFIER=1` / `NO_UPDATE_NOTIFIER=1` is set. Implemented in-tree (no `simple-update-notifier` dependency).
