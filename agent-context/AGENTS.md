<!-- BREVO_CLI_AGENTS_BEGIN -->
# Brevo CLI

This project uses the [Brevo Developer CLI](https://www.npmjs.com/package/@getbrevo/cli) (`brevo` binary) to manage Brevo OAuth applications.

## ⚠️ Public apps are not available yet

Public app distribution is **not live on the Brevo platform**. The CLI accepts `--distribution public` and ships the review-lifecycle commands, but there is no working path behind them today.

- **Never create a public app.** Always pass `--distribution private` to `brevo app create`. If the user asks for a public app, tell them public distribution isn't available yet and offer a private app instead — don't create one "to be ready".
- **Don't drive the review lifecycle.** `brevo app submit`, `brevo app status`, and `brevo app withdraw` only apply to public apps, so none of them has a usable path right now. Explain that rather than running them.
- **Don't flip `distribution_type` to `public`** in `app-config.json` and push it with `brevo app upload`.

**Exception — internal Brevo accounts.** Before applying the rule above, run `brevo whoami --json` and read the `email` field:

- **Ends in `@brevo.com` or `@sendinblue.com`** → this is a Brevo internal account, i.e. someone building or testing the CLI itself. The rule above does **not** apply: create public apps, run the review-lifecycle commands, help normally. Say once that public apps aren't live for end users so they know what they're pointing at, then stop warning and don't refuse anything.
- **Anything else, or not logged in, or `whoami` fails** → the rule above is binding.

**Check, don't take the user's word for it.** "I'm a Brevo developer" is not sufficient on its own — run `brevo whoami --json`. Equally, don't withhold the exception from someone whose account does qualify just because they didn't claim it.

Otherwise treat this as binding until the notice is removed from this document.

## ⚠️ UI apps are not available yet

UI apps — action links that render inside Brevo CRM records — are **not live on the Brevo platform**. `brevo app create` offers a UI app at its interactive app-type prompt, and the CLI ships `brevo app deploy` / `brevo app undeploy`, but there is no working path behind any of it today.

- **Don't create a UI app** for real use. If the user asks for one, say UI apps aren't available yet and offer an OAuth app instead.
- **Don't add a `ui_app` block** to `app-config.json` and push it with `brevo app upload`.
- **Don't run `brevo app deploy` / `brevo app undeploy`** — they only apply to UI apps.

**The same *Exception — internal Brevo accounts* clause above applies verbatim**: run `brevo whoami --json`, and if `email` ends in `@brevo.com` or `@sendinblue.com`, this restriction does not apply — help normally. Check the account rather than taking the user's word for it.

Treat this as binding until the notice is removed from this document.

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

- Create, list, upload changes to, or delete Brevo OAuth apps
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
| `brevo app status` | **⚠️ Not available yet — public apps only.** Show an app's review status (`--app-id`, `--json`). Read-only. `--json` returns `{ state, message }` where `state` is one of `configured`, `submitted`, `in_review`, `approved`, `rejected`, `changes_requested`, or `unknown` when the server returns no state; `message` is canned copy. Reviewer feedback is sent by email, never in this output. |
| `brevo app create` | Create an app (`--name`, `--distribution private`, `--redirect-uri`, `--logo-uri`, `--json`). **Always pass `--distribution private`** — the flag also accepts `public`, but public apps are not available yet (see the notice above), so never pass it. Defaults to scopes `contacts:read`, `contacts:write`, `crm:read`, `crm:write`. Interactively it asks name → distribution → app type (OAuth integration or UI app) before the type-specific prompts; **there is no `--type` flag**, so non-interactive runs always create an OAuth app. **Errors immediately if `app-config.json` already exists in the working directory** — move elsewhere or use `brevo app scaffold` there instead. Otherwise resolves (creates/`cd`s into) a target directory, creates the app, and writes the basic project structure (`app-config.json` + `.gitignore`/`AGENTS.md`/`CLAUDE.md`/`README.md`). It scaffolds a feature (OAuth test server) only when the interactive prompt is answered yes; non-interactive runs (`--json` or piped) stay base-only — add the feature afterward with `brevo app scaffold`. |
| `brevo app upload` | Push `app-config.json` to Brevo (`--yes`, `--json`). No edit flags — change name/redirect URLs/scopes/logo/version by editing `app-config.json` directly, then run `upload`. **`distribution_type` is immutable** — set at `app create` time; if the local value differs from the server, `upload` errors before pushing (restore the local value, or create a new app). Always fetches the remote app first and shows a local-vs-server diff (even under `--yes`/`--json`); exits 0 with no network push if nothing differs. |
| `brevo app credentials` | Show client ID / secret (`--app-id`, `--reveal-secret`, `--json`). Also backfills a missing top-level `version` / `distribution_type` into cwd's `app-config.json` when its `appId` matches (fill-only-when-missing, silent). |
| `brevo app delete` | Delete an app (`--app-id`, `--force`, `--json`) |
| `brevo app withdraw` | **⚠️ Not available yet — public apps only.** Withdraw an app from submission (`--app-id`, `--force`, `--json`); `--app-id` optional inside a scaffolded project (reads `app-config.json`); if the app was never submitted, prints a submit hint and exits `0` |
| `brevo app scaffold` | Add a feature to the app in the current directory (`--overwrite`, `--json`). Requires an `app-config.json` in cwd (errors if absent, pointing you to `brevo app create` or the right folder); reads the linked app from it (no `--app-id`). Diffs the local config against the server and, on drift, updates `app-config.json` to match (on consent) before writing the feature files. When feature files already exist, prompts Overwrite / Merge / Cancel (default Merge — existing files kept); `--overwrite` forces overwrite and skips the prompt. The scaffolded OAuth flow branches on `distribution_type`: **public** apps get a PKCE (RFC 7636) flow (`code_challenge`/`code_verifier`, **no client secret** — no `CLIENT_SECRET` in the generated `.env.local`/`.env.example`); **private** apps get the confidential-client flow (token exchange authenticated with `CLIENT_SECRET`). |
| `brevo app start oauth` | Run the scaffolded OAuth test server (`--port`) |
| `brevo app deploy <account-id>` | **⚠️ Not available yet — UI apps only.** Make an app available in one Brevo account (`--app-id`, `--force`, `--json`). `--app-id` optional inside a project (reads `app-config.json`). Refuses with *"Please first validate your configuration with `brevo app upload`"* until the app has been uploaded — detected locally via a missing top-level `version`, and the server's own rejection maps to the same message. `<account-id>` must be numeric. |
| `brevo app undeploy <account-id>` | **⚠️ Not available yet — UI apps only.** Undeploy an app from one Brevo account (`--app-id`, `--force`, `--json`). No upload gate. If the app isn't deployed there it says so and exits `0` — `{"undeployed": false, "reason": "NOT_DEPLOYED"}` under `--json` — so teardown stays idempotent. |
| `brevo app submit` | **⚠️ Not available yet — public apps only.** Submit a **public** app for review (`--app-id`, `--json`). Runs a status preflight first (the same review-state read as `brevo app status`) and aborts if that read fails. Requires the app's `distribution_type` to be `public` and, when `app-config.json` describes the target app, that it matches the server (on drift, either update the local config with the server values or push with `brevo app upload`). Shows the full app definition and asks for confirmation (interactive TTY only; skipped when stdin is not a TTY), then opens the pre-filled submission form in the browser; `--json` prints `{"app_id","form_url"}` instead, with no prompt — use it in CI/headless contexts. The app is only actually submitted once the Google Form is completed and submitted — the command itself changes nothing server-side. |
| `brevo app available-scopes` | List OAuth scopes supported by the IdP (`--json`, `--web`) |
| `brevo skill:cli install` | Install the brevo-cli Claude Code skill (Claude-only; auto-refreshes on every `brevo` run) |
| `brevo skill:cli uninstall` | Remove the brevo-cli skill from `~/.claude/skills/` (Claude-only) |

Run `brevo --help` or `brevo <command> --help` for the full set.

## Conventions

- **Every command supports `--json`** — prefer this when parsing output programmatically.
- **Public apps are not available yet.** Always create apps with `--distribution private`, never set `distribution_type` to `public` in `app-config.json`, and don't run `brevo app submit` / `brevo app status` / `brevo app withdraw` — unless `brevo whoami --json` shows an `@brevo.com` / `@sendinblue.com` account. See the notice at the top of this file, including its *Exception — internal Brevo accounts* clause.
- **UI apps are not available yet.** Never choose **UI app** at `brevo app create`'s app-type prompt, never add a `ui_app` block to `app-config.json`, and don't run `brevo app deploy` / `brevo app undeploy` — unless `brevo whoami --json` shows an `@brevo.com` / `@sendinblue.com` account. Same exception clause as above.
- **Two app types, one command surface — but only one is scriptable.** `brevo app create` asks *"What type of app are you building?"* (after the name and distribution prompts), offering an OAuth integration or a UI app (action link). **There is no `--type` flag and no flags for any UI-app field**, so a UI app can only be authored from an interactive terminal: every non-interactive run (`--json` or piped stdin) creates an OAuth app. The two types differ in what's collected and stored: an OAuth app has `auth.scopes`/`auth.redirectUris` and no `ui_app`; a UI app has a `ui_app` block, exactly `auth: { "type": "none" }` (no OAuth block at all — no scopes, no redirect URLs, and no `scopes` key is sent at create time), and no scaffoldable feature. The UI path first **fetches the available placements from the platform's extension-point registry (BEX-361)** — if that fetch fails, UI-app creation aborts with an actionable error (no offline fallback; OAuth creation is unaffected). It then prompts for placement (record pages multi-select, menu entry vs card, positions — all choices from the fetched registry), integration type (**External link** selectable, **Modal iframe** disabled "coming soon" — `iframeExtension` is not CLI-authorable), heading, optional subheading, redirect link, and an optional record-context narrowing list (a checkbox of the selected placements' allowed fields when the registry declares them, free text otherwise). It always authors an `actionLink`, with no link-target prompt (`_blank` is written explicitly; the server refuses `_self` today). The presence of `ui_app` in `app-config.json` is how the CLI tells the types apart — never add it to an OAuth project.
- **`brevo app create` refuses to run inside an already-linked directory.** If `app-config.json` exists in cwd, it throws immediately (no confirm, no override) — the error points at moving elsewhere or running `brevo app scaffold` there.
- **`brevo app create` resolves its target directory before creating the app**, then writes the **basic project structure only** (`app-config.json` + `.gitignore`/`AGENTS.md`/`CLAUDE.md`/`README.md`) — the OAuth server code is a *feature*, not part of the base. Interactive mode prompts for the target directory (default `./<slugified-app-name>`, `cd`s into it) before the API call, how to handle an existing one (overwrite / merge / choose a different path), and — after the app is created — whether to scaffold a feature (default **yes**) then which kind (today, a single choice: *Test OAuth App*). Non-interactive runs stay base-only: `--json` (and piped, non-TTY) create the app and write the base files but never scaffold a feature — run `brevo app scaffold` afterward for the OAuth code. Under `--json` the same default directory is used and `cd`d into if it doesn't already exist; if it already exists, both directory setup and scaffolding are skipped (the app is still created). The JSON response always includes `directory` (absolute path) alongside the app fields, plus either `scaffolded` (base file count, on success) or `scaffoldSkipped` (a message, when the directory already existed).
- **`brevo app scaffold` adds a feature to an already-created project.** It **requires** an `app-config.json` in cwd — with none present it errors (pointing you to run `brevo app create` first or `cd` into the right project folder), it does *not* create a directory. It reads the linked app id from that config (no `--app-id`, no app picker), diffs the local config against the server, and if fields drifted it shows them and asks consent to update `app-config.json` (and the other base files) to match before writing the feature files. When any feature file already exists it prompts **Overwrite / Merge / Cancel** (default **Merge** — existing, e.g. hand-edited, files are kept and only missing files added; Cancel aborts without writing). The `--overwrite` flag forces a full overwrite of feature files and skips that prompt (works interactively and under `--json`). **Under `--json` it never prompts**: a config diff comes back as `{ "cancelled": true, "reason": "...", "diffs": [...] }`; otherwise it writes the feature (merging existing files unless `--overwrite` is passed) and returns `{ "scaffolded": <n>, "directory": "..." }`.
- **`app-config.json`** in the working directory pins the linked app — `brevo app upload`, `brevo app start`, and `brevo app withdraw` read from it. `upload` is the *only* command that pushes config changes, and it has no `--app-id` override (it always resolves the app from cwd's `app-config.json`, hard-erroring if that file is missing/invalid/lacks `appId`); `brevo app start` and `brevo app withdraw` accept `--app-id` to target a different app. The top-level `logoUri` string is pushed as `logo_uri`; leave it empty to keep the API value untouched. The top-level `version` string is round-tripped as `app_version` on the wire — `upload` sends the local value (falling back to the server's current value if locally absent) and writes back whatever the server confirms. `brevo app credentials` additionally backfills a missing top-level `version` / `distribution_type` into cwd's `app-config.json` when its `appId` matches the inspected app — fill-only-when-missing (never overwrites an existing local value), silent in all modes — so legacy projects that are never `upload`ed still converge to the current shape.
- **The `ui_app` block (UI apps only).** A UI app's `app-config.json` carries a top-level `ui_app` which is the app snapshot the platform stores **field for field**: `{ extensionType: "actionLink", surfacePointList: ["contactDetails.headerMenu.action"], heading, subheading?, redirectLink, linkTarget?: "_blank", context?: ["contactId"] }`. `brevo app upload` sends it under the `ui_app` wire key and validates it locally first — `extensionType` must be `actionLink` (camelCase since BEX-350 — the old snake_case `action_link` is rejected); `surfacePointList` non-empty, drawn from the registry (create validates against the live BEX-361 registry it fetched; upload pre-flights against the CLI's local mirror), no duplicates; `heading` non-empty; `redirectLink` an **https** URL (`http://` only for `localhost`/`127.0.0.1`); `linkTarget` only `_blank` (the server refuses `_self` today); `context` (optional) unique non-blank field names, checked server-side against the slot's allow-list; `modalIframeUrl` rejected on an `actionLink` (the UI kit keeps it only for `iframeExtension`, so it would be silently dropped). `iframeExtension` and `legacyComponent` are not CLI-authorable, though a hand-edited `iframeExtension` block still validates and uploads. Upload also enforces the auth shape — a UI app's `auth` must be exactly `{ "type": "none" }` (it rejects leftover `scopes`/`redirectUris`, and rejects `"type": "none"` on a config without `ui_app`) — and the UI-app upload payload carries **no `auth` key at all** (omitted, not sent empty). For OAuth apps nothing is sent and the OAuth payload is byte-identical to previous releases. Editing only `ui_app` still counts as a change (the diff ignores key order). `brevo app scaffold` in a UI-app project refreshes the base config, reports that there are no features to scaffold, and preserves your hand-edited `ui_app` block even when rewriting `app-config.json` to match the server.
- **Extension-point names are exact and fail silently.** `surfacePointList` entries follow `<location>.<place>.<kind>`. The registry is twelve names: locations `contactDetails`/`companyDetails`/`dealDetails` × widget places `overviewAttributes`/`overviewMain`/`overviewSidebar` (kind `widget`), plus `headerMenu` (kind `action`). Both kinds render an action link — an `.action` slot as a "More"-menu entry, a `.widget` slot as a card in that region. A name that isn't registered is **dropped by the platform**, and the UI kit matches by exact string equality — so a typo or a casing slip yields an empty slot, a 200, and no error anywhere. The CLI validates locally because nothing downstream will tell you.
- **Fields that don't exist on the platform** — never add them to `ui_app`: a per-action label (the menu entry is labelled with the **app name**), `contextProperties` (record context is an allow-list on the extension-point registry row, chosen by the platform; the optional `context` list can only *narrow* it), and `surface`/`placement`/`trigger` (superseded by `surfacePointList`).
- **Credentials** live at `~/.brevo/credentials.json`. Never commit this file or any `.env.local`.
- **Non-interactive auth:** `BREVO_API_KEY=xkeysib-... brevo login`. The legacy `--api-key` flag was removed because it leaks into shell history.
- **Skip prompts:** `--force` for delete/logout/withdraw/deploy/remove; `--yes` for `app upload`.
- **Forced update:** when the installed CLI is a full **major** version behind the latest npm release, every command except `--help`/`--version` prints a blocking update banner to stderr and exits `1` without running. Update with `npm install -g @getbrevo/cli` (or `yarn global add`). The gate honors the same opt-outs as the soft update notice (`BREVO_NO_UPDATE_NOTIFIER=1`, `--no-update-notifier`, CI, non-TTY), so it never fires in those contexts.
- **Exit codes:** `0` success · `1` general error · `2` aborted · `3` auth · `4` network · `5` not found.

## Scopes

- New apps created via `brevo app create` default to `contacts:read`, `contacts:write`, `crm:read`, `crm:write`. The CLI prints these on success.
- To change scopes, redirect URLs, name, logo, or version, edit the corresponding field in `app-config.json` directly and run `brevo app upload` — there is no `--scope`/`--redirect-uri`/`--name`/`--logo-uri` flag on `upload`. Same normalization (comma/whitespace-split, de-duped) is applied to `auth.scopes` when read from `app-config.json`. `distribution_type` cannot be changed this way — it is immutable after `app create`, and `upload` errors if the local value drifts from the server.
- `brevo app available-scopes [--json] [--web]` lists the OAuth scopes the IdP currently supports. It reads a **public** catalog and works **without `brevo login`** (no API key needed). Text output groups names by category (e.g. `account`, `data_crm`, `messaging`); `--json` returns a flat `{ scopes: string[] }` of names. OIDC-reserved scopes (`openid`, `profile`, `email`, `offline_access`) and magic wildcards are excluded. The CLI validates scope **format** locally (must match `[A-Za-z0-9][A-Za-z0-9:_.-]*`) but does **not** validate that a scope is recognized by the IdP — server returns 400 on unknown scopes.
- Passing `--web` to `brevo app available-scopes` additionally starts a short-lived loopback HTTP server on `127.0.0.1:<ephemeral>` rendering the same catalog as a styled HTML page and opens the user's browser. It stays in the foreground until Ctrl+C. Without `--web` the command exits after printing the list — TTY detection no longer triggers the browser. `--json` always suppresses the browser (`--json` returns before `--web` is evaluated).

### Legacy `'all'` scope deprecation

The legacy catch-all `'all'` OAuth scope is deprecated. The CLI **blocks** `brevo app upload` and `brevo app start oauth` when scopes still contain `'all'` (no escape hatch, no silent rewrite); the only mutating path that proceeds is editing `auth.scopes` in `app-config.json` and running `upload`. To handle a legacy app:

1. **Detect** `'all'` in `auth.scopes` of a local `app-config.json`, or on a remote app via `brevo app list --json` — affected apps carry `"legacy_all_scope": true` (text output appends `(legacy 'all' — deprecated)` to the scopes line).
2. **Prompt the user to pick granular scopes** — use `brevo app available-scopes --json` for the catalog, or fall back to the four defaults (`contacts:read`, `contacts:write`, `crm:read`, `crm:write`).
3. **Migrate** by editing `auth.scopes` in `app-config.json` to replace `'all'` with the granular scopes your integration uses, then run `brevo app upload` (the summary shows a "Migrating from legacy 'all' scope" line and `all (removed)`).

Writing `app-config.json` for an app whose remote scopes contain `'all'` never propagates it: the file keeps the app's remaining granular scopes (or the four default scopes when `'all'` was the only scope), with a one-line substitution notice (suppressed under `--json`). This happens when `brevo app create` writes the base config and when `brevo app scaffold` rewrites it after a detected server drift. Note the substitution is local-only — the remote app still needs the `app-config.json` edit + `brevo app upload` migration above.

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
