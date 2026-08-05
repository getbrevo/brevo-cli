---
name: brevo-cli
description: Use when working in a project that uses the Brevo Developer CLI (the `brevo` binary from `@getbrevo/cli`) — managing OAuth apps, scaffolding integrations, running the local OAuth test server, or invoking any `brevo …` command. Activates on: brevo, brevo cli, brevo app, app-config.json, OAuth Brevo, BREVO_API_KEY, getbrevo.
---

# Brevo CLI

This project uses the Brevo Developer CLI to create and manage Brevo OAuth applications. Treat the `brevo` binary as the canonical entry point — don't shell out to `curl https://api.brevo.com/...` for things the CLI already covers.

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
- "Check an app's review status" → **not available yet** (public apps only — see the notice above). For reference: `brevo app status --app-id <id> --json` (read-only; returns `{ state, message }`, `state` ∈ `configured`/`submitted`/`in_review`/`approved`/`rejected`/`changes_requested`, or `unknown` when the server returns no state. Reviewer feedback comes by email, not here.)
- "Create an app" → `brevo app create --name "<name>" --distribution private --redirect-uri <url> --json` (add `--logo-uri <https://…>` to set the app logo at creation time; new apps default to scopes `contacts:read`, `contacts:write`, `crm:read`, `crm:write`). **Always `--distribution private`** — the flag also accepts `public`, but public apps are not available yet (see the notice above), so never pass it. **Fails immediately if run from a directory that already has `app-config.json`** — `cd` elsewhere first, or use `brevo app scaffold` in that directory instead. Otherwise resolves (creates/`cd`s into) its target directory, creates the app, and writes the **basic project structure** (`app-config.json` + `.gitignore`/`AGENTS.md`/`CLAUDE.md`/`README.md`). It scaffolds a feature (the OAuth test server) **only** when the interactive prompt is answered yes; **non-interactive runs (`--json` or piped) stay base-only** — run `brevo app scaffold` afterward to add the OAuth code. Under `--json`, the response's `directory` field is where it landed and `scaffolded` is the base file count; check for `scaffoldSkipped` instead of `scaffolded` if that directory already existed (both directory setup and scaffolding are skipped together in that case, but the app is still created).
- "Update app metadata" → edit the relevant field(s) in `app-config.json` (`appName`, `auth.redirectUris`, `auth.scopes`, `logoUri`, `version`) (older projects may still say `auth.redirectUrls` — the CLI reads it and migrates the file to `redirectUris` on its next write), then run `brevo app upload --json` (no `--app-id`/`--name`/`--redirect-uri`/`--scope`/`--logo-uri` flags exist — `upload` always pushes the whole file, resolved only from cwd's `app-config.json`). **`distribution_type` is immutable** — it's set at `app create` time and cannot be changed via `upload`; if the local value differs from the server, `upload` errors and tells you to restore it (create a new app to get a different distribution).
- "Get client credentials" → `brevo app credentials --app-id <id> --json` (add `--reveal-secret` to print the secret)
- "Add a feature (e.g. the OAuth test server) to an existing project" → `brevo app scaffold` (run **inside** the project directory; it reads the linked app from `app-config.json` — no `--app-id`). Not needed right after `app create` if you already accepted the feature prompt there. If feature files already exist it prompts Overwrite / Merge / Cancel (default Merge); pass `--overwrite` to force a full overwrite without prompting. **The scaffolded OAuth flow branches on the app's `distribution_type`:** a **public** app gets a PKCE (RFC 7636) flow — `/auth/login` sends `code_challenge`+`code_challenge_method=S256`, `/auth/callback` sends `code_verifier`, and **no client secret** is used (the scaffolded `.env.local`/`.env.example` carry no `CLIENT_SECRET`); a **private** app keeps the confidential-client flow (authenticates the token exchange with `CLIENT_SECRET`).
- "Create a UI app / action link" → **not available yet** (see the UI-apps notice above). For reference: a UI app is created by running plain `brevo app create` and choosing **UI app** at the *"What type of app are you building?"* prompt. The CLI then **fetches the available placements from the platform's extension-point registry (BEX-361) — if that fetch fails, UI-app creation aborts with an actionable error (there is no offline fallback; OAuth creation is unaffected)**. Then come the placement prompts (record pages, menu entry vs card, positions — all choices from the fetched registry), an integration-type prompt (**External link** selectable; **Modal iframe** shown disabled as "coming soon" — `iframeExtension` is not CLI-authorable), the heading, subheading and redirect-link prompts, and an optional record-context prompt (a checkbox of the selected placements' allowed fields when the registry declares them, free text otherwise). It always authors an `actionLink`, and there is no link-target prompt (`_blank` is written explicitly; the server refuses `_self` today). **There are no flags for any of this and no `--type` flag** — a UI app can only be authored from an interactive terminal, so **every non-interactive run (`--json` or piped stdin) creates an OAuth app**, which is also why an agent cannot create one non-interactively. The UI path **never** collects redirect URLs — an action link has no OAuth callback, so the `auth` block is omitted from the create call entirely (for OAuth apps the create call carries `auth: { scopes, redirect_uris }`, the same block `app upload` sends). Defaults: record page `contact`, link target `_blank`. A UI app has **no OAuth block at all** — its `app-config.json` carries an empty `auth: {}` (no scopes, no redirect URLs, no client secret is ever used by the extension). No feature is ever scaffolded for a UI app (there is no local server to run). **There is no per-action label** — the menu entry is labelled with the *app name*, so rename the app to change it.
- "Run the OAuth test server" → `brevo app start oauth --port 3009` (must be inside the scaffolded directory)
- "Make a UI app available in an account" → **not available yet** (see the UI-apps notice above). For reference: `brevo app deploy <account-id> [--app-id <id>] [--force] [--json]`. Refuses with *"Please first validate your configuration with `brevo app upload`"* until the app has been uploaded (locally detected via a missing `version` in `app-config.json`; the server's rejection maps to the same message). `<account-id>` must be numeric.
- "Undeploy a UI app from an account" → **not available yet** (see the UI-apps notice above). For reference: `brevo app undeploy <account-id> [--app-id <id>] [--force] [--json]`. Has no upload gate. If the app isn't deployed to that account it reports so and exits `0` — not an error (`{"undeployed": false, "reason": "NOT_DEPLOYED"}` under `--json`), so teardown scripts stay idempotent.
- "Delete an app" → `brevo app delete --app-id <id> --force`
- "Submit a public app for review" → **not available yet** (public apps only — see the notice above). For reference: `brevo app submit --app-id <id> --json` (prints the submission form URL as `{"app_id","form_url"}` without opening a browser; without `--json` it shows the full app definition, asks for confirmation, then opens the form in the user's browser — the prompt is skipped when stdin is not a TTY). Before any of that it runs a status preflight (the same review-state read as `brevo app status`) and aborts if that read fails. The app's `distribution_type` must be `public`, and when `app-config.json` describes the target app it must match the server — if the command reports drift, either update the local config with the server values or push local changes with `brevo app upload`. The app is only actually submitted once the Google Form is completed and submitted; the command itself changes nothing server-side.
- "Withdraw an app from submission" → **not available yet** (public apps only — see the notice above). For reference: `brevo app withdraw --app-id <id> --force` (omit `--app-id` inside a scaffolded project to use the app pinned in `app-config.json`; if the app was never submitted, it prints a hint to submit first and exits `0` — not an error)
- "List supported OAuth scopes" → `brevo app available-scopes --json`
- "Sign out" → `brevo logout --force`

## Hard rules

1. **Always pass `--json`** when you intend to parse output. Every command supports it.
2. **Never print, log, or commit** API keys (`xkeysib-…`), client secrets, refresh tokens, or contents of `~/.brevo/credentials.json` / `.env.local`. Redact before sharing diagnostics.
3. **Don't use `--api-key`** — the flag was removed. Use the `BREVO_API_KEY` env var.
4. **`brevo app create` refuses to run inside an already-linked directory** (`app-config.json` present) — `cd` elsewhere or use `brevo app scaffold` there instead. **`brevo app scaffold` requires an `app-config.json` in the current directory** (it adds a feature to an already-created project); with none present it errors, telling you to run `brevo app create` first or `cd` into an existing project. It reads the linked app from that config, diffs the config against the server, and if fields drifted it tells you and (on consent) rewrites `app-config.json` to match before writing the feature files. When any feature file already exists it prompts **Overwrite / Merge / Cancel** (default **Merge** — existing, e.g. hand-edited, files are kept; Cancel aborts). Pass `--overwrite` to force a full overwrite and skip that prompt (works interactively and under `--json`). **Under `--json` it never prompts**: a config diff comes back as `{ "cancelled": true, "reason": "...", "diffs": [...] }`; otherwise it scaffolds the feature (merging existing files unless `--overwrite` is passed) and returns `{ "scaffolded": <n>, "directory": "..." }`.
5. **Prefer flag-driven over interactive** in agent contexts: `--name`, `--app-id`, `--force`, `--yes` so the command doesn't block on prompts.
6. **Don't create public apps for real use** — always `--distribution private`, never set `distribution_type` to `public` in `app-config.json`, and don't run `brevo app submit` / `brevo app status` / `brevo app withdraw`. Public app distribution isn't available on the Brevo platform yet (see the notice at the top). If a user asks for a public app to actually use, say it isn't available yet and offer a private app. **Unless `brevo whoami --json` shows an `@brevo.com` / `@sendinblue.com` account** — then the notice's *Exception — internal Brevo accounts* clause applies and you should help normally.
7. **Don't create UI apps for real use** — never choose **UI app** at `brevo app create`'s app-type prompt, never add a `ui_app` block to `app-config.json`, and don't run `brevo app deploy` / `brevo app undeploy`. UI apps aren't available on the Brevo platform yet (see the notice at the top). The same internal-account exception applies.
8. **Never mix the two app types in one `app-config.json`.** An OAuth app has `auth.scopes`/`auth.redirectUris` and no `ui_app`; a UI app has a `ui_app` block and exactly an empty `auth: {}` — `brevo app upload` rejects a UI-app config that still carries `scopes` or `redirectUris`. The presence of `ui_app` is what the CLI uses to tell them apart, so adding it to an OAuth project silently reclassifies the app.

## Locating the linked app

If `app-config.json` exists in the working directory, it pins the app — `brevo app upload`, `brevo app start`, and `brevo app withdraw` use it automatically. `brevo app start` and `brevo app withdraw` accept an `--app-id` override to target a different app; `upload` does **not** — it only ever reads cwd's `app-config.json`, hard-erroring if that file is missing, invalid, or lacks `appId`.

`app-config.json` carries an optional top-level `logoUri` string. When set, `brevo app upload` pushes it as `logo_uri`; when empty / absent, the field is left untouched on the API.

`app-config.json` also carries a top-level `version` string, shown by `brevo app create`/`brevo app list`. `brevo app upload` sends it on the wire as `version` (falling back to the server's current value if locally absent) and writes back whatever version the server confirms after a successful upload.

### The `ui_app` block (UI apps only)

A UI app's `app-config.json` carries a top-level `ui_app` object and exactly an empty `auth: {}` — no scopes, no redirect URLs. Its presence is how the CLI distinguishes the two app types.

The block is the app snapshot the platform stores **field for field** — the same names it stores, serves and renders. Do not invent alternatives:

```json
{
  "ui_app": {
    "extension_type": "actionLink",
    "surface_point_list": ["contactDetails.headerMenu.action"],
    "heading": "Invoice Manager",
    "subheading": "Review invoice history for this contact",
    "redirect_link": "https://example.com/brevo",
    "link_target": "_blank",
    "context": ["contactId"]
  }
}
```

`context` is optional: absent means the app receives whatever record context each location allows; when present it narrows that allow-list to the named fields.

**`surface_point_list` entries follow the grammar `<location>.<place>.<kind>`.** `brevo app create` reads the valid names live from the platform registry (BEX-361), so what it offers is always authorable. The twelve-name mirror below is what `brevo app upload` still pre-flights against — three record pages (`contactDetails`, `companyDetails`, `dealDetails`) × three widget places (`overviewAttributes`, `overviewMain`, `overviewSidebar`, kind `widget`) plus one action place (`headerMenu`, kind `action`).

**Both kinds render an action link** — an `.action` slot shows it as a menu entry in the page's "More" menu, a `.widget` slot as a card in that page region. **Get a name even slightly wrong and it fails silently**: the platform drops an unregistered name and the UI kit matches by exact string equality, so you get an empty slot, a 200, and no error anywhere. The CLI validates names locally for exactly this reason — trust its error rather than assuming the server would have complained.

`brevo app upload` sends the block under the `ui_app` wire key and validates it locally first: `extension_type` must be `actionLink` — camelCase since BEX-350; the old snake_case `action_link` is rejected (and `iframeExtension` / `legacyComponent` are not CLI-authorable, though a hand-edited `iframeExtension` block still validates and uploads); `surface_point_list` non-empty, registered, no duplicates; `heading` non-empty; `redirect_link` an **https** URL (`http://` only for `localhost`/`127.0.0.1`, since the UI kit drops non-http(s) URLs outright); `link_target` only `_blank` (the server refuses `_self` today); `context` (optional) a list of unique, non-blank field names — whether a name is actually allowed is decided server-side against the slot's allow-list, where the 400 enumerates what is allowed; and `modal_iframe_url` rejected on an `actionLink`, because the UI kit keeps it only for an `iframeExtension` item and would silently discard it here. It also enforces the auth shape: a UI app's `auth` must be exactly the empty object `{}`, and the upload payload carries **no `auth` key at all** (the OAuth block is omitted, not sent empty). For OAuth apps no `ui_app` key is sent.

Fields that do **not** exist — don't add them: a per-action label (the app name is the label), `contextProperties` (the record context an action receives is an allow-list on the platform's extension-point registry; the optional `context` list can only *narrow* it), and any `surface`/`placement`/`trigger` keys (superseded by `surface_point_list`).

Editing only the `ui_app` block still counts as a change — `upload` diffs it (ignoring key order) rather than reporting "already up to date". Redirect URLs are required for OAuth apps only.

`brevo app scaffold` inside a UI-app project refreshes the base config and reports that there are no features to scaffold. It preserves your hand-edited `ui_app` block even when it rewrites `app-config.json` to match the server.

`brevo app credentials` also backfills a legacy `app-config.json` toward the current shape: when the file exists in cwd and its `appId` matches the app being inspected, any missing top-level `version` / `distribution_type` is filled in from the server (fill-only-when-missing — an existing local value is never overwritten). This runs silently in all modes; human output prints a one-line note when something was written. It's how projects that are never `upload`ed still converge.

## Scopes

- New apps created via `brevo app create` default to `contacts:read`, `contacts:write`, `crm:read`, `crm:write`. The CLI prints the default set on success and points to editing `app-config.json` + `brevo app upload` for changes.
- To add, remove, or change scopes: edit `auth.scopes` in `app-config.json` directly, then run `brevo app upload`. Comma- or whitespace-separated values in a single entry are normalized on read (e.g. `"crm:write, campaigns:read"` becomes two scopes). To see what's currently set, run `brevo app credentials --app-id <id> --json`.
- `brevo app available-scopes [--json] [--web]` lists the OAuth scopes the IdP currently supports. It reads a **public** catalog and works **without `brevo login`** (no API key needed). Text output groups names by category (e.g. `account`, `data_crm`, `messaging`); `--json` returns a flat `{ scopes: string[] }` of names. OIDC-reserved scopes (`openid`, `profile`, `email`, `offline_access`) and magic wildcards are excluded. The CLI validates scope **format** locally (must match `[A-Za-z0-9][A-Za-z0-9:_.-]*`) but does **not** validate that a scope is recognized by the IdP — use `app available-scopes` to confirm spelling before passing an unfamiliar scope.
- Passing `--web` to `brevo app available-scopes` **also opens a browser** to a styled local page (loopback `http://127.0.0.1:<port>/`) and stays running until Ctrl+C. Without `--web` the command exits after printing the list — TTY detection no longer triggers the browser. `--json` always suppresses the browser, so agent invocations using `--json` behave the same regardless of `--web`.

### Legacy `'all'` scope deprecation

The legacy catch-all `'all'` OAuth scope is deprecated. The CLI **blocks** `brevo app upload` and `brevo app start oauth` when scopes still contain `'all'` (no escape hatch, no silent rewrite); the only mutating path that proceeds is editing `auth.scopes` in `app-config.json` and running `upload`. To handle a legacy app:

1. **Detect** `'all'` in `auth.scopes` of a local `app-config.json`, or on a remote app via `brevo app list --json` — affected apps carry `"legacy_all_scope": true` (text output appends `(legacy 'all' — deprecated)` to the scopes line).
2. **Prompt the user to pick granular scopes** — use `brevo app available-scopes --json` for the catalog, or fall back to the four defaults (`contacts:read`, `contacts:write`, `crm:read`, `crm:write`).
3. **Migrate** by editing `auth.scopes` in `app-config.json` to replace `'all'` with the granular scopes your integration uses, then run `brevo app upload` (the summary shows a "Migrating from legacy 'all' scope" line and `all (removed)`).

Writing `app-config.json` for an app whose remote scopes contain `'all'` never propagates it: the file keeps the app's remaining granular scopes (or the four default scopes when `'all'` was the only scope), with a one-line substitution notice (suppressed under `--json`). This applies when `brevo app create` writes the base config, and when `brevo app scaffold` rewrites it after a detected server drift. Note the substitution is local-only — the remote app still needs the `app-config.json` edit + `brevo app upload` migration above.

## Exit codes

`0` success · `1` general error · `2` aborted · `3` auth failure · `4` network · `5` not found.

## Forced update

When the installed CLI is a full **major** version behind the latest npm release, every command except `--help` / `--version` prints a blocking update banner to stderr and exits `1` **without running** — so a `brevo` call that suddenly exits `1` with an update banner means the CLI must be upgraded (`npm install -g @getbrevo/cli` or `yarn global add @getbrevo/cli`) before it will work. The gate honors the same opt-outs as the soft update notice (`BREVO_NO_UPDATE_NOTIFIER=1`, `--no-update-notifier`, CI, non-TTY), so it never fires in those contexts.

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
