---
name: brevo-cli
description: Use when working in a project that uses the Brevo Developer CLI (the `brevo` binary from `@getbrevo/cli`) — managing OAuth apps, scaffolding integrations, running the local OAuth test server, or invoking any `brevo …` command. Activates on: brevo, brevo cli, brevo app, app-config.json, OAuth Brevo, BREVO_API_KEY, getbrevo.
---

# Brevo CLI

This project uses the Brevo Developer CLI to create and manage Brevo OAuth applications. Treat the `brevo` binary as the canonical entry point — don't shell out to `curl https://api.brevo.com/...` for things the CLI already covers.

## `brevo --help` is the source of truth

Brevo features that haven't been released are **not built into the published CLI at all** — not as hidden commands, not behind a flag or an env var. `brevo --help` and `brevo app --help` list everything the binary can do. Treat that as the complete surface and build from it.

What this means in practice:

- **If a command isn't in `--help`, it doesn't exist here.** Invoking it gives Commander's `unknown command` and exit `1`. That is a final answer, not a transient failure and not a permissions problem — there is no flag, config edit, account setting, or environment variable that reveals it. Don't retry, don't hunt for an alternative route, and don't tell the user to get access. Say the feature isn't available in this CLI and offer the nearest thing that works.
- **Don't act on a command you remember rather than one you can see.** Your recollection of the Brevo CLI may include commands from a newer or unreleased build. `--help` in the current session is the only reliable source.
- **A flag can be rejected even when its command exists.** `--distribution` is a real flag, but a value tied to an unreleased feature is refused with *"That command is not available yet. It is part of a Brevo feature that has not been released."* Same rule: it's final. Use `--distribution private`.

The Brevo API enforces the same boundaries independently, so nothing is gained by trying to route around the CLI — a hand-rolled `curl` hits the platform's own refusal.

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
- "Create an app" → `brevo app create --name "<name>" --distribution private --redirect-uri <url> --json` (add `--logo-uri <https://…>` to set the app logo at creation time; new apps default to scopes `contacts:read`, `contacts:write`, `crm:read`, `crm:write`). **Use `--distribution private`** — check `brevo app create --help` for the values your account accepts, and don't pass one it doesn't list. **Fails immediately if run from a directory that already has `app-config.json`** — `cd` elsewhere first, or use `brevo app scaffold` in that directory instead. Otherwise resolves (creates/`cd`s into) its target directory, creates the app, and writes the **basic project structure** (`app-config.json` + `.gitignore`/`AGENTS.md`/`CLAUDE.md`/`README.md`). It scaffolds a feature (the OAuth test server) **only** when the interactive prompt is answered yes; **non-interactive runs (`--json` or piped) stay base-only** — run `brevo app scaffold` afterward to add the OAuth code. Under `--json`, the response's `directory` field is where it landed and `scaffolded` is the base file count; check for `scaffoldSkipped` instead of `scaffolded` if that directory already existed (both directory setup and scaffolding are skipped together in that case, but the app is still created).
- "Update app metadata" → edit the relevant field(s) in `app-config.json` (`appName`, `auth.redirectUris`, `auth.scopes`, `logoUri`, `version`) (older projects may still say `auth.redirectUrls` — the CLI reads it and migrates the file to `redirectUris` on its next write), then run `brevo app upload --json` (no `--app-id`/`--name`/`--redirect-uri`/`--scope`/`--logo-uri` flags exist — `upload` always pushes the whole file, resolved only from cwd's `app-config.json`). **`distribution_type` is immutable** — it's set at `app create` time and cannot be changed via `upload`; if the local value differs from the server, `upload` errors and tells you to restore it (create a new app to get a different distribution). **There is no `brevo app update`** — it was removed, with no shim and no flag-for-flag equivalent; if you find it in a user's script, CI job, README, or your own recollection, replace it with the edit-then-`upload` flow above. Invoking it — with any of the old flags, with `--help`, or as `brevo app help update` — prints a message naming `brevo app upload` and exits `1` **without uploading anything**, so a `1` from `brevo app update` means the command is gone, not that an upload failed.
- "Get client credentials" → `brevo app credentials --app-id <id> --json` (add `--reveal-secret` to print the secret)
- "Set an empty directory up for an app that already exists" → `brevo app scaffold --app-id <id>` (`brevo app list` gives the IDs). Fetches the app and writes `app-config.json` + the base files, then adds a feature as below. **This is the only way to get an `app-config.json` for an existing app** — `brevo app create` makes a *new* app, and `brevo app upload` only ever reads the project in the current directory. It refuses if the directory is already linked to a *different* app; pointing it at the app the directory is already linked to is a no-op. **Interactively you can omit `--app-id`**: plain `brevo app scaffold` in a directory with no `app-config.json` says so, asks *"Set this directory up for an app you already have?"* (default yes), and on yes lists the account's apps so you can pick one — no need to look the ID up first. Answering **no** is a normal outcome, not an error: it exits `0` after printing the remaining routes (`brevo app create` here, or `cd` into an existing project). **Always pass `--app-id` when scripting** — the offer needs a terminal, so under `--json` or off a TTY the command errors instead of prompting. Two refusals apply to both forms, before any write: the directory must not be **inside** an existing project (a nested second `app-config.json` would make a later `brevo app upload` push the wrong app), and a **UI app that has never been uploaded** cannot be set up at all — the platform stores its `ui_app` block only from an upload snapshot, so there is nothing to recover and the command says so rather than writing a config that would read as an OAuth app.
- "Add a feature (e.g. the OAuth test server) to an existing project" → `brevo app scaffold` (run **inside** the project directory; it reads the linked app from `app-config.json`, so `--app-id` is only needed to bootstrap a directory that has none). Not needed right after `app create` if you already accepted the feature prompt there. If feature files already exist it prompts Overwrite / Merge / Cancel (default Merge); pass `--overwrite` to force a full overwrite without prompting. **The scaffolded OAuth flow branches on the app's `distribution_type`:** a **public** app gets a PKCE (RFC 7636) flow — `/auth/login` sends `code_challenge`+`code_challenge_method=S256`, `/auth/callback` sends `code_verifier`, and **no client secret** is used (the scaffolded `.env.local`/`.env.example` carry no `CLIENT_SECRET`); a **private** app keeps the confidential-client flow (authenticates the token exchange with `CLIENT_SECRET`).
- "Run the OAuth test server" → `brevo app start oauth --port 3009` (must be inside the scaffolded directory)
- "Delete an app" → `brevo app delete --app-id <id> --force`
- "List supported OAuth scopes" → `brevo app available-scopes --json`
- "Sign out" → `brevo logout --force`

## Hard rules

1. **Always pass `--json`** when you intend to parse output. Every command supports it, **on success and on failure alike** — a failing `--json` run writes a single `{"error": {...}}` document to stdout (see *JSON errors* below), so you can read the reason instead of only seeing a non-zero exit.
2. **Never print, log, or commit** API keys (`xkeysib-…`), client secrets, refresh tokens, or contents of `~/.brevo/credentials.json` / `.env.local`. Redact before sharing diagnostics.
3. **Don't use `--api-key`** — the flag was removed. Use the `BREVO_API_KEY` env var.
4. **`brevo app create` refuses to run inside an already-linked directory** (`app-config.json` present) — `cd` elsewhere or use `brevo app scaffold` there instead. **`brevo app scaffold` requires an `app-config.json` in the current directory unless you pass `--app-id` or answer its bootstrap offer** (it adds a feature to an already-created project); with none present and no `--app-id` it offers to set the directory up for an existing app when interactive, and otherwise errors, listing the three ways out (`cd` into a project, `--app-id` to set this directory up for an app you already have, or `brevo app create` for a new one). With `--app-id <id>` in a directory that has no config it fetches that app, writes `app-config.json` + the base files, and continues — the migration path off the removed `brevo app update --app-id`. It refuses (before any network call) if the directory is already linked to a *different* app, if the directory is **inside** an existing app project (a nested second `app-config.json` would make a later `brevo app upload` from there push the wrong app — `cd` to the project root or outside it), or if the named app is a **UI app that has never been uploaded** (the platform keeps a UI app's `ui_app` block only from an upload snapshot, so there is nothing to recover — it refuses rather than writing a config that would silently read as an OAuth app). It reads the linked app from that config, diffs the config against the server, and if fields drifted it tells you and (on consent) rewrites `app-config.json` to match before writing the feature files. When any feature file already exists it prompts **Overwrite / Merge / Cancel** (default **Merge** — existing, e.g. hand-edited, files are kept; Cancel aborts). Pass `--overwrite` to force a full overwrite and skip that prompt (works interactively and under `--json`). **Under `--json` it never prompts**: a config diff comes back as `{ "cancelled": true, "reason": "...", "diffs": [...] }`; otherwise it scaffolds the feature (merging existing files unless `--overwrite` is passed) and returns `{ "scaffolded": <n>, "directory": "..." }`.
5. **Prefer flag-driven over interactive** in agent contexts: `--name`, `--app-id`, `--force`, `--yes` so the command doesn't block on prompts.
6. **Don't hand-write config for a command you don't have.** The published CLI has no `ui_app` support and no public-app distribution, so adding a `ui_app` block to `app-config.json`, or setting `distribution_type` to `public`, produces a config that `brevo app upload` rejects — and that the Brevo API refuses independently. Neither is a workaround for a missing command; both just fail later and less clearly.
7. **Never mix the two app types in one `app-config.json`.** An OAuth app has `auth.scopes`/`auth.redirectUris` and no `ui_app`; a UI app has a `ui_app` block and exactly an empty `auth: {}` — `brevo app upload` rejects a UI-app config that still carries `scopes` or `redirectUris`. The presence of `ui_app` is what the CLI uses to tell them apart, so adding it to an OAuth project silently reclassifies the app.

## Locating the linked app

If `app-config.json` exists in the working directory, it pins the app — `brevo app upload` and `brevo app start` use it automatically. `brevo app start` accepts an `--app-id` override to target a different app; `upload` does **not** — it only ever reads cwd's `app-config.json`, hard-erroring if that file is missing, invalid, or lacks `appId`.

`app-config.json` carries an optional top-level `logoUri` string. When set, `brevo app upload` pushes it as `logo_uri`; when empty / absent, the field is left untouched on the API.

`app-config.json` also carries a top-level `version` string, shown by `brevo app create`/`brevo app list`. `brevo app upload` sends it on the wire as `version` (falling back to the server's current value if locally absent) and writes back whatever version the server confirms after a successful upload.

### The `ui_app` block (UI apps only)

A UI app's `app-config.json` carries a top-level `ui_app` object and exactly an empty `auth: {}` — no scopes, no redirect URLs. Its presence is how the CLI distinguishes the two app types.

On the wire, a UI app's app record has **no OAuth material at all**: `brevo app list --json` returns it with `client_id: ""` and `redirect_uris: null` (null, not `[]`) — so guard before iterating either one, and don't read the empty client ID as a broken app. The text output labels each row `UI app` or `OAuth app` and omits the client-ID/callback/scope rows for a UI app.

The block is the app snapshot the platform stores **field for field** — the same names it stores, serves and renders. Do not invent alternatives:

```json
{
  "ui_app": {
    "extension_type": "actionLink",
    "surface_point_list": [
      { "surface_point_name": "contact-details-header-menu", "context": ["recordId"] },
      { "surface_point_name": "deal-details-header-menu", "context": ["recordId", "recordName"] }
    ],
    "label": "View in CRM",
    "more_info": "Open this contact in your connected CRM to see full activity history.",
    "redirect_link": "https://example.com/view"
  }
}
```

`label` and `more_info` each render in **two** places: `label` is the menu entry's text on an `.action` slot and the CTA button on a `.widget` slot's card; `more_info` is the menu entry's second line and the card's description. A card's **title** is the *app name* — there is no field for it.

Each entry's `context` is optional and per placement: absent means the app receives whatever record context that slot allows, and when present it *narrows* that allow-list to the named fields (it can never widen it). It is per entry because the allow-list belongs to the slot, not the app — a contact page and a deal page can forward different fields. The only field names the platform's registry allows are `recordId`, `recordName`, `userId`, `locale`, `accountId`. The context reaches your app as **query parameters** on `redirect_link` — there is no path templating, so read them from the query string. `brevo app create` seeds each entry from the registry's own default for that slot.

There is **no `link_target`** in the file: `brevo app upload` injects `_blank` into the payload. Don't add it back — the server refuses `_self`, so the only value you could write is the one upload already sends.

**Each entry's `surface_point_name` is the registry's kebab-case slug** — `contact-details-header-menu`, not the dotted `contactDetails.headerMenu.action`. Both name the same slot and the dotted form is what the platform ultimately renders (it serves it back as `extensionPoint`), but only the slug is authorable: the platform resolves an entry by matching the slug column. Write the dotted form and the upload endpoint answers `400 … contains unregistered extension point(s)`. `brevo app create` reads the valid slugs live from the platform registry (BEX-361), so what it offers is always authorable. `brevo app upload` does **not** check names locally — the endpoint validates them and names every offender. The registry currently holds twelve slugs: `{contact,company,deal}-details-{header-menu,overview-main,overview-sidebar,overview-attributes}`. Treat that list as a guide, not a rule — the platform's copy is the one that decides.

**Both slot kinds render an action link** — a header-menu slot shows it as an entry in the page's "More" menu, an overview slot as a card in that page region. **Get a name even slightly wrong and it fails silently at render time**: the platform drops an unregistered name and the UI kit matches by exact string equality, so you get an empty slot, a 200, and no error anywhere. Author from `brevo app create`'s prompts rather than hand-writing slugs, and read the upload error rather than assuming a clean `create` meant a valid slot.

`brevo app upload` sends the block under the `ui_app` wire key (adding `link_target: "_blank"` for an `actionLink`; an `iframeExtension` gets none — it embeds its URL rather than navigating) and validates it locally first: `extension_type` must be `actionLink` — camelCase since BEX-350; the old snake_case `action_link` is rejected (and `iframeExtension` / `legacyComponent` are not CLI-authorable, though a hand-edited `iframeExtension` block still validates and uploads); `surface_point_list` non-empty, every entry an **object** whose `surface_point_name` is a non-blank string (whether it is *registered* is checked server-side, where the 400 names the offenders), no duplicate slots, each entry's optional `context` a list of unique non-blank field names; `label` non-empty and at most 48 characters; `more_info` at most 255; `redirect_link` an **https** URL (`http://` only for `localhost`/`127.0.0.1`, since the UI kit drops non-http(s) URLs outright); and `modal_iframe_url` rejected on an `actionLink`, because the UI kit keeps it only for an `iframeExtension` item and would silently discard it here. Whether a context *name* is allowed is decided server-side against that slot's allow-list, where the 400 enumerates what is allowed. It also enforces the auth shape: a UI app's `auth` must be exactly the empty object `{}`, and the upload payload carries **no `auth` key at all** (the OAuth block is omitted, not sent empty). For OAuth apps no `ui_app` key is sent.

**The pre-BEX-290 field names are rejected with a migration hint**, so an older hand-written config fails loudly instead of uploading and rendering nothing: `heading` → rename to `label`, `subheading` → rename to `more_info`, a top-level `context` → move each list into the matching `surface_point_list` entry, and a `surface_point_list` of bare strings → wrap each one as `{ "surface_point_name": "…" }`.

Fields that do **not** exist — don't add them: a card *title* (it is the app name), `contextProperties` (record context is an allow-list on the platform's extension-point registry; an entry's `context` can only *narrow* it), `link_target` (upload injects it), and any `surface`/`placement`/`trigger` keys (superseded by `surface_point_list`).

Editing only the `ui_app` block still counts as a change — `upload` diffs it (ignoring key order, placement order, and the fields the server manages) rather than reporting "already up to date". Redirect URLs are required for OAuth apps only.

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

## JSON errors

Under `--json`, a command that fails writes **one** JSON document to stdout describing the failure, and the human-readable message still goes to stderr. The `error` key is the discriminator — no success payload has one:

```json
{ "error": { "name": "CliError", "message": "Not authenticated. Run: brevo login", "exitCode": 1 } }
```

`name` is the error class (`CliError`, `ApiError`, `AuthExpiredError`, `AbortError`), `message` is the same text printed to stderr, and `exitCode` matches the process exit code. An `ApiError` adds `statusCode` (the HTTP status) and, when the API classified the failure, `code` — one of `AUTH_INVALID`, `AUTH_EXPIRED`, `ACCESS_DENIED`, `APP_NOT_FOUND`, `REDIRECT_INVALID`, `PORT_IN_USE`, `NETWORK_ERROR`, `RATE_LIMITED`, `APP_LIMIT_REACHED`, `REGISTRY_ERROR`, `AUTH_GATEWAY`:

```json
{ "error": { "name": "ApiError", "message": "App not found", "exitCode": 5, "code": "APP_NOT_FOUND", "statusCode": 404 } }
```

Two things to rely on: stdout is always **exactly one** parseable document, and commands that describe their own failure keep doing so instead of emitting this envelope — `brevo whoami --json` still returns `{"authenticated": false, "reason": "no_key"}` (exit `1`). Check for `error` first, then fall back to the command's own shape.

## Command help

`brevo --help` prints the grouped overview of every command. `brevo <command> --help` prints that command's own usage line, arguments, flags, and examples — e.g. `brevo app scaffold --help` documents `--app-id` / `--overwrite` / `--json`. When you need to confirm a flag exists on the version actually installed, read it from there rather than assuming from this file.

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
