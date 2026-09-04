---
name: brevo-cli
description: Use when working in a project that uses the Brevo Developer CLI (the `brevo` binary from `@getbrevo/cli`) — managing OAuth apps, UI apps, and Brevo Functions, scaffolding integrations, running the local OAuth test server, or invoking any `brevo …` command. Activates on: brevo, brevo cli, brevo app, brevo function, app-config.json, OAuth Brevo, BREVO_API_KEY, getbrevo.
---

# Brevo CLI

This project uses the Brevo Developer CLI to create and manage Brevo applications (OAuth apps, UI apps, and Brevo Functions). Treat the `brevo` binary as the canonical entry point — don't shell out to `curl https://api.brevo.com/...` for things the CLI already covers.

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
- "Create an app" → `brevo app create --name "<name>" --distribution private --redirect-uri <url> --json` (add `--logo-uri <https://…>` to set the app logo at creation time; new apps default to scopes `contacts:read`, `contacts:write`, `crm:read`, `crm:write`). **Use `--distribution private`** — check `brevo app create --help` for the values your account accepts, and don't pass one it doesn't list. **Fails immediately if run from a directory that already has `app-config.json`** — `cd` elsewhere first, or use `brevo app scaffold` in that directory instead. Otherwise resolves (creates/`cd`s into) its target directory, creates the app, and writes the **basic project structure** (`app-config.json` + `.gitignore`/`AGENTS.md`/`CLAUDE.md`/`README.md`). It scaffolds a feature (the OAuth test server) **only** when the interactive confirm (*"Scaffold the Test OAuth App?"*, default yes) is answered yes — there is no separate "which feature?" question while the CLI ships one; **non-interactive runs (`--json` or piped) stay base-only** — run `brevo app scaffold` afterward to add the OAuth code. Under `--json`, the response's `directory` field is where it landed and `scaffolded` is the base file count; check for `scaffoldSkipped` instead of `scaffolded` if that directory already existed (both directory setup and scaffolding are skipped together in that case, but the app is still created).
- "Create a UI app" (an action link that renders inside Brevo CRM records) → run `brevo app create` **interactively** and pick *UI app* at the *"What type of app are you building?"* prompt, **or non-interactively** with `--ui-app --record-page <slug> --placement <surface_point_name> --label <text> --url <url> [--more-info <text>]`, or `--ui-config <file>` (a JSON file: `{ extension_type, record_page, surface_point_name, label, more_info?, redirect_link }`). There is still **no `--type` flag** — a plain non-interactive run with neither `--ui-config` nor `--ui-app` creates an OAuth app, exactly as before. Both non-interactive routes only support `extension_type: "actionLink"` today; an unknown `--record-page`/`--placement` fails with the valid options listed in the error. Interactively, the flow asks for the integration type, one record page, one placement on it, a label, optional supporting text, and the destination URL — every route authors exactly **one** placement; add more by hand as further `surface_point_list` entries in `app-config.json` (each with its own `label` and `redirect_link`), then `brevo app upload`.
- "Create a Function app" (a serverless function running on Brevo's infrastructure) → run `brevo app create` **interactively** and pick *Brevo Function* at the *"What type of app are you building?"* prompt. Private distribution only. Non-interactive runs (`--json` or piped) create an OAuth app as before — there is no `--type` flag for Function apps. The created `app-config.json` carries `brevo_function: {}` (a static discriminator, not authored content) and `app_type: "function"` (informational). A Function app has no `auth` block and no `ui_app` block.
- "Create a new function" → `brevo function init` (alias `brevo fn init`). **Interactive only** — refused under `--json` or piped input. Prompts for the parent Function app, then offers AI generation or template selection to create the function. Once generated, the function can be iterated on, previewed, and deployed.
- "Deploy a draft function" → `brevo function deploy --id <draft-id> [--app-id <id>] --json`. Deploys a draft function to production. `--app-id` links the deployed function to an app. Interactively, omitting `--id` shows a draft picker; under `--json` or off a TTY, `--id` is required. Omitting `--app-id` interactively shows an app picker (Function apps only).
- "List functions" → `brevo function list --json` (add `--draft` for draft functions only). Lists all deployed Brevo Functions in the account, or drafts with `--draft`.
- "Show function details" → `brevo function get --id <id> --json`. Interactively, omitting `--id` shows a picker; under `--json` or off a TTY, `--id` is required.
- "Activate a function" → `brevo function activate --id <id> --json`. Same picker behavior as `get`.
- "Deactivate a function" → `brevo function deactivate --id <id> --json`. Same picker behavior as `get`.
- "Delete a function" → `brevo function delete --id <id> --force --json`. Same picker behavior as `get`. `--force` skips the confirmation prompt.
- "Install a UI app into an account" → `brevo app install [account-id] --app-id <id> --force --json`. **UI apps only** — an OAuth app has nothing to install (it becomes usable when a user authorizes it) and the CLI refuses with exit `1`. The `[account-id]` positional is optional: omitted, a plain account installs into itself (no prompt, so `--json`/CI works) and a corporate account picks a sub-account interactively (non-interactive corporate runs must pass it explicitly). The app must have been validated with `brevo app upload` first — installing before an upload is refused locally. Interactively, omitting `--app-id` outside a linked project opens an app picker that lists **only UI apps**; with no UI app to offer, the command errors (exit `1`) naming `brevo app create`. That picker needs a terminal: under `--json` or off a TTY, omitting `--app-id` outside a linked project is refused with exit `1` — so always pass `--app-id` when scripting from an unlinked directory. Before it acts, `install` prints the configuration it will install **as stored on the server** — app ID, name, `version`, extension type and every placement — because that is what the account will render, not whatever the local `app-config.json` now says; under `--json` the same facts come back as `version` and `ui_app` on the result. If the linked project's `ui_app` block has drifted from the stored one, it warns and names `brevo app upload`, then installs anyway (exit `0`) — the stored configuration is a legitimate thing to install, so this is a notice, not a refusal.
- "Uninstall a UI app from an account" → `brevo app uninstall [account-id] --app-id <id> --force --json`. Same target resolution as `install`. Uninstalling an app that isn't installed is **informational, exit `0`** — not an error.
- "Update app metadata" → edit the relevant field(s) in `app-config.json` (`appName`, `auth.redirectUris`, `auth.scopes`, `logoUri`, `version`) (older projects may still say `auth.redirectUrls` — the CLI reads it and migrates the file to `redirectUris` on its next write), then run `brevo app upload --json` (no `--app-id`/`--name`/`--redirect-uri`/`--scope`/`--logo-uri` flags exist — `upload` always pushes the whole file, resolved only from cwd's `app-config.json`). **`distribution_type` is immutable** — it's set at `app create` time and cannot be changed via `upload`; if the local value differs from the server, `upload` errors and tells you to restore it (create a new app to get a different distribution). For a **UI app**, `upload` is also the way to change what an installed app renders — there is no re-install and no publish step: the diff prints every `ui_app` placement field by field (`before → after`, plus `(new)` / `(removed)` placements), then warns that the app may already be installed in Brevo accounts and asks *"Proceed with upload and update every account this app is installed in?"*. `--yes` skips the question but still prints the warning; `--json` prints neither and stays a single parseable document. **There is no `brevo app update`** — it was removed, with no shim and no flag-for-flag equivalent; if you find it in a user's script, CI job, README, or your own recollection, replace it with the edit-then-`upload` flow above. Invoking it — with any of the old flags, with `--help`, or as `brevo app help update` — prints a message naming `brevo app upload` and exits `1` **without uploading anything**, so a `1` from `brevo app update` means the command is gone, not that an upload failed.
- "Get client credentials" → `brevo app credentials --app-id <id> --json` (add `--reveal-secret` to print the secret). **`--app-id` is not optional here** — without it the command wants an interactive app picker, and under `--json`/off a TTY it refuses with exit `1` rather than prompting. **OAuth apps only** — a UI app has no OAuth credentials (no client ID, secret, scopes, or callbacks), so the command refuses it with exit `1` and points at `brevo app list` for the app's type.
- "Set up a project for an app that already exists" → `brevo app scaffold --app-id <id>` (`brevo app list` gives the IDs). Fetches the app and writes `app-config.json` + the base files, then adds a feature as below. Interactively it asks which directory to write into first (default `./<slugified app name>`); under `--json`/off a TTY it uses the current one. **This is the only way to get an `app-config.json` for an existing app** — `brevo app create` makes a *new* app, and `brevo app upload` only ever reads the project in the current directory. It refuses if the directory is already linked to a *different* app; pointing it at the app the directory is already linked to is a no-op. **Interactively you can omit `--app-id`**: plain `brevo app scaffold` in a directory with no `app-config.json` says so, asks *"Set up a project for an app you already have?"* (default yes), and on yes lists the account's apps so you can pick one — no need to look the ID up first. **Every interactive bootstrap (picker or `--app-id`) then asks `Output directory:`, defaulted to `./<the app's name slugified>`** — the same question `brevo app create` asks — creates that directory and `cd`s into it, so the files don't land in whatever folder you happened to be standing in; answer `.` to use the current directory instead. It then writes the project (`app-config.json` + the base files), shows what it wrote, and asks *"Scaffold the Test OAuth App?"* (default yes) — declining is normal and leaves the project in place, exit `0`. The *Next steps* box opens with `cd <dir>`, because the CLI can only move its own process, never your shell. **Under `--json` or off a TTY there is no directory question and the files go into the current directory**, so scripted `brevo app scaffold --app-id <id>` runs are unchanged — `mkdir` and `cd` yourself first if you want them somewhere specific. Answering **no** is a normal outcome, not an error: it exits `0` after printing the remaining routes (`brevo app create` here, or `cd` into an existing project). **Always pass `--app-id` when scripting** — the offer needs a terminal, so under `--json` or off a TTY the command errors instead of prompting. **If the directory you point it at already holds a project, the bootstrap is a refresh, not a fresh write**: the config found there is diffed against the server and rewritten only on consent (*"…will update app-config.json to match the server. Continue?"*, default yes) — answering **Merge** at the directory question does not suppress that, because merging keeps the file that exists and so would skip the very file a bootstrap is for. No drift means `app-config.json` is left alone with a one-line notice, and the feature still gets added. A directory holding a project for a **different** app is refused outright, naming both apps. Two refusals apply to both forms, before any write: that different-app case, and the directory must not be **inside** an existing project (a nested second `app-config.json` would make a later `brevo app upload` push the wrong app).
- "Add a feature (e.g. the OAuth test server) to an existing project" → `brevo app scaffold` (run **inside** the project directory; it reads the linked app from `app-config.json`, so `--app-id` is only needed to bootstrap a directory that has none). Not needed right after `app create` if you already accepted the feature prompt there. If feature files already exist it prompts Overwrite / Merge / Cancel (default Merge); pass `--overwrite` to force a full overwrite without prompting. **The scaffolded OAuth flow is the confidential-client flow:** `/auth/callback` authenticates the token exchange with the `CLIENT_SECRET` written into the scaffolded `.env.local`.
- "Run the OAuth test server" → `brevo app start oauth --port 3009` (must be inside the scaffolded directory)
- "Delete an app" → `brevo app delete --app-id <id> --force`. **`--app-id` is not optional here either** — omitting it means an interactive picker, which under `--json`/off a TTY is refused with exit `1`. Never script a delete without naming the app. `--force` skips the prompt but still prints the install-loss warning line; under `--json` stdout stays JSON only.
- "List supported OAuth scopes" → `brevo app available-scopes --json`
- "Sign out" → `brevo logout --force`

## Hard rules

1. **Always pass `--json`** when you intend to parse output. Every command supports it, **on success and on failure alike** — a failing `--json` run writes a single `{"error": {...}}` document to stdout (see *JSON errors* below), so you can read the reason instead of only seeing a non-zero exit.
2. **Never print, log, or commit** API keys (`xkeysib-…`), client secrets, refresh tokens, or contents of `~/.brevo/credentials.json` / `.env.local`. Redact before sharing diagnostics.
3. **Don't use `--api-key`** — the flag was removed. Use the `BREVO_API_KEY` env var.
4. **`brevo app create` refuses to run inside an already-linked directory** (`app-config.json` present) — `cd` elsewhere or use `brevo app scaffold` there instead. **`brevo app scaffold` requires an `app-config.json` in the current directory unless you pass `--app-id` or answer its bootstrap offer** (it adds a feature to an already-created project); with none present and no `--app-id` it offers to set the directory up for an existing app when interactive, and otherwise errors, listing the three ways out (`cd` into a project, `--app-id` to set this directory up for an app you already have, or `brevo app create` for a new one). With `--app-id <id>` in a directory that has no config it fetches that app, asks (interactively only) which directory to write into — default `./<slugified app name>`, `.` to stay put — writes `app-config.json` + the base files there, and continues; that is the migration path off the removed `brevo app update --app-id`, and off a TTY or under `--json` it writes into the current directory with no prompt. If the directory it is told to write into already holds a project for the **same** app, it diffs that config against the server and rewrites it only on consent — the directory prompt's **Merge** answer does not silently skip the refresh, and no drift leaves `app-config.json` untouched with a notice. It refuses (before any network call) if the directory is already linked to a *different* app — whether that is the directory the command ran in or the one it was pointed at — or if the directory is **inside** an existing app project (a nested second `app-config.json` would make a later `brevo app upload` from there push the wrong app — `cd` to the project root or outside it). It reads the linked app from that config, diffs the config against the server, and if fields drifted it tells you and (on consent) rewrites `app-config.json` to match before writing the feature files. When any feature file already exists it prompts **Overwrite / Merge / Cancel** (default **Merge** — existing, e.g. hand-edited, files are kept; Cancel aborts). Pass `--overwrite` to force a full overwrite and skip that prompt (works interactively and under `--json`). **Under `--json` it never prompts**: a config diff comes back as `{ "cancelled": true, "reason": "...", "diffs": [...] }`; otherwise it scaffolds the feature (merging existing files unless `--overwrite` is passed) and returns `{ "scaffolded": <n>, "directory": "..." }`.
5. **Prefer flag-driven over interactive** in agent contexts: `--name`, `--app-id`, `--force`, `--yes` so the command doesn't block on prompts.
6. **Write only the `app-config.json` keys this file documents.** `brevo app upload` validates the whole file and rejects keys it doesn't recognise, so an invented block fails at upload rather than doing anything useful.
7. **Never mix app types in one `app-config.json`.** The presence of `ui_app` or `brevo_function` is the app-type discriminator: an OAuth app has a populated `auth` block and no `ui_app` or `brevo_function`; a UI app has a `ui_app` block and an **empty** `auth: {}` (it has no OAuth callback, scopes, or credentials); a Function app has `brevo_function: {}` and no `auth` block. See *UI apps* and *Brevo Functions* below for each type's shape.

## UI apps

A **UI app** is an action link that renders inside Brevo CRM record pages (contact, company, deal). It is one of three app types (alongside OAuth apps and Brevo Functions) — created by the same `brevo app create` (interactive only, see the decision tree), pushed by the same `brevo app upload`, and made visible in an account with `brevo app install`.

A UI-app project is **configuration only**: there is no feature to scaffold and no `src/oauth/`, because an action link has no local server to run — `brevo app scaffold` inside one says so and exits `0`, and `brevo app start` does not apply. The base docs the scaffold writes (`AGENTS.md` / `CLAUDE.md` / `README.md`) describe whichever type the app is, so a UI app's copies document the `ui_app` block and the `upload` → `install` flow rather than an OAuth server.

The `ui_app` block in `app-config.json`:

- `extension_type` (root) — one of `actionLink`, `iframeExtension`, `legacyComponent` (camelCase; snake_case spellings like `action_link` are rejected).
- `surface_point_list` — one entry per placement. Each entry carries:
  - `surface_point_name` — the placement's dot-notation slug from the platform's registry (e.g. `contactDetails.header.menu`). The valid names come from the registry — the CLI prompts from it at create time, and `brevo app upload` validates against it (an unregistered name is a 400 naming the offender). Do **not** author the extension-point name (`contactDetails.headerMenu.action`, the `<location>.<place>.<kind>` grammar) — it is dotted too and looks right because specs quote it, but it is a different string and upload rejects it.
  - `label` — the menu entry's text (and the CTA button on a card). Required.
  - `more_info` — supporting text under the menu entry / a card's description. Optional.
  - `redirect_link` — the destination URL that entry opens; record context arrives as **query parameters** (the path is never templated).
  - `context` — optional narrowing of the record fields passed along; it can only narrow what the platform allows for that slot.
  - `size` — optional card size for the widget card this placement renders, e.g. `{ "width": "280px", "height": "160px" }`. `brevo app create` seeds it from the slot's registry default when the platform declares one (same mechanism as `context`) — edit or remove it freely, the entry's own value is what uploads. Each axis is a CSS length string — a positive integer with an explicit `px` unit, or `1%`–`100%` of the host slot's box (shrink-only; >100% is rejected). Both axes are optional; an omitted axis (or the whole key) stays on the host slot's default.
  - `modal_iframe_url` — `iframeExtension` entries only; rejected on an `actionLink`.
- Do **not** write `link_target` or `extension_point_name` anywhere in the file — both are wire/server-stamped values (`app upload` injects `link_target: "_blank"` itself) and the CLI strips them from server echoes.
- The old `heading`/`subheading` names are rejected with a migration hint — they are `label`/`more_info` now, and they live **per entry**, not at the `ui_app` root.

Install semantics worth knowing: only UI apps install into an account; the app must have a `version` (written by a successful `brevo app upload`) before `install` will proceed; `uninstall` of a not-installed app is informational (exit `0`).

**An installed UI app tracks the server's configuration, not the account's copy of it.** There is one stored snapshot per app, so `brevo app upload` changes what every account it is installed in renders, immediately and with no re-install — which is why `upload` warns and asks before pushing a UI app, and why `install` shows the stored configuration it is about to make visible. Tell a user to edit `app-config.json` and run `brevo app upload`; never tell them to uninstall and re-install to pick up a change.

## Brevo Functions

A **Brevo Function** is a serverless function that runs on Brevo's infrastructure. It is the third app type alongside OAuth apps and UI apps — created by `brevo app create` (interactive only, pick *Brevo Function* at the app-type prompt), and managed with the `brevo function` command group (alias `brevo fn`).

The `brevo_function` block in `app-config.json`:

- `brevo_function: {}` — a **static discriminator**, not authored content. Its presence marks the app as a Function app; there are no fields to write inside it. The server does not stamp additional keys onto it.
- `app_type: "function"` — an informational top-level field (`'oauth' | 'ui' | 'function'`). The actual discriminator is the `brevo_function` block, not this field.
- A Function app has **no `auth` block** (no OAuth callbacks, scopes, or credentials) and **no `ui_app` block**.

A Function-app project is **configuration only** at the `app-config.json` level — the functions themselves are created and deployed through the `brevo function` commands, not by editing the config file. `brevo app scaffold` inside a Function-app project has no feature to scaffold (no `src/oauth/`), and `brevo app start` does not apply.

### `brevo function` subcommands

All subcommands support `--json`. Commands that pick a function interactively (`get`, `activate`, `deactivate`, `delete`) show a picker when `--id` is omitted on a TTY, and refuse under `--json` or off a TTY — same convention as `brevo app credentials` and `brevo app delete`. **Always pass `--id` when scripting.**

| Command | Purpose |
|---|---|
| `brevo function list` | List deployed functions (`--draft` for drafts, `--json`) |
| `brevo function get` | Show function details (`--id <id>`, `--json`) |
| `brevo function init` | Create a new function via AI generation or template selection. **Interactive only** — refused under `--json` or piped input. Prompts for the parent Function app, creation method (AI or template), and iterates until deployed. |
| `brevo function deploy` | Deploy a draft function (`--id <draft-id>`, `--app-id <id>`, `--json`). Links the deployed function to an app via `--app-id`. Interactively, omitting `--id` shows a draft picker; `--app-id` omitted shows a Function-app picker. |
| `brevo function activate` | Activate a function (`--id <id>`, `--json`) |
| `brevo function deactivate` | Deactivate a function (`--id <id>`, `--json`) |
| `brevo function delete` | Delete a function (`--id <id>`, `--force`, `--json`). `--force` skips confirmation. |

## Locating the linked app

If `app-config.json` exists in the working directory, it pins the app — `brevo app upload` and `brevo app start` use it automatically. `brevo app start` accepts an `--app-id` override to target a different app; `upload` does **not** — it only ever reads cwd's `app-config.json`, hard-erroring if that file is missing, invalid, or lacks `appId`.

`app-config.json` carries an optional top-level `logoUri` string. When set, `brevo app upload` pushes it as `logo_uri`; when empty / absent, the field is left untouched on the API.

`app-config.json` also carries a top-level `version` string, shown by `brevo app create`/`brevo app list`. `brevo app upload` sends it on the wire as `version` (falling back to the server's current value if locally absent) and writes back whatever version the server confirms after a successful upload.

`brevo app credentials` also backfills a legacy `app-config.json` toward the current shape: when the file exists in cwd and its `appId` matches the app being inspected, any missing top-level `version` / `distribution_type` is filled in from the server (fill-only-when-missing — an existing local value is never overwritten). This runs silently in all modes; human output prints a one-line note when something was written. It's how projects that are never `upload`ed still converge.

## Scopes

- New apps created via `brevo app create` default to `contacts:read`, `contacts:write`, `crm:read`, `crm:write`. The CLI prints the default set on success and points to editing `app-config.json` + `brevo app upload` for changes.
- To add, remove, or change scopes: edit `auth.scopes` in `app-config.json` directly, then run `brevo app upload`. Comma- or whitespace-separated values are normalized on read, whether they sit in a single array entry (`["crm:read", "crm:write, campaigns:read"]`) or replace the array entirely (`"crm:write, campaigns:read"`) — either becomes two scopes. To see what's currently set, run `brevo app credentials --app-id <id> --json`.
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

## Update notice wording

The update banner's first line comes from the app-store service (`GET /cli/info`). It is called directly rather than through the v3 API gateway and requires no API key, so it works while logged out or with expired credentials. It runs once per invocation, **before** the command, and the response is cached at `~/.brevo/cli-info-cache.json` for **15 minutes**, keyed to the installed `cliVersion` — so reworded text or a new block reaches the CLI within minutes rather than after the old 12h npm-style TTL, without a network call on every single command. Whether an update banner appears is still decided from the npm registry, exactly as before, and a failed call just means the banner uses local wording (a failed call never overwrites a good cache entry). `BREVO_APP_STORE_URL` overrides that service's base URL for non-production testing.

## Server-side block

The same response may carry `"is_blocked": true`. When it does, every command except `--help` / `--version` prints a banner to stderr and exits `1` **without running** — a separate mechanism from the major-version gate above, and one the server can turn on without shipping a new CLI.

Those two are exempt from the **block**, not from the lookup: they still call `/cli/info` and still render the server's wording on their update banner. They simply never exit non-zero because of it, so a blocked CLI can always still report what version it is.

Two things to know when you hit this:

- **The notice opt-outs do not apply.** `BREVO_NO_UPDATE_NOTIFIER=1`, `--no-update-notifier`, CI, and a non-TTY all suppress the *notice*; none of them suppress a block. Don't suggest them as a workaround — the only fix is upgrading the CLI.
- **It fails open.** A timeout, a non-2xx, or an unparseable body lets the command run normally; only a literal `true` blocks. So a network problem never manifests as a block.
- **A block can persist up to 15 minutes after the server lifts it, and vice versa**, because the whole response is cached. If you need a verdict that reflects the server's *current* state, delete `~/.brevo/cli-info-cache.json` (or bump the version) before checking.

The soft (non-blocking) notice also prints after a command **fails**, not just after it succeeds — so stderr can hold the error message followed by the update box. This does not change exit codes: a failing command still exits with its own code, and the box is never printed twice in one run. A Ctrl-C abort skips it. If you parse stderr strictly, suppress the notice with `BREVO_NO_UPDATE_NOTIFIER=1` or `--no-update-notifier`.

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
