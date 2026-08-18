<!-- BREVO_CLI_AGENTS_BEGIN -->
# Brevo CLI

This project uses the [Brevo Developer CLI](https://www.npmjs.com/package/@getbrevo/cli) (`brevo` binary) to manage Brevo OAuth applications.

## `brevo --help` is the source of truth

Brevo features that haven't been released are **not built into the published CLI at all** — not as hidden commands, not behind a flag or an env var. `brevo --help` and `brevo app --help` list everything the binary can do. Treat that as the complete surface and build from it.

What this means in practice:

- **If a command isn't in `--help`, it doesn't exist here.** Invoking it gives Commander's `unknown command` and exit `1`. That is a final answer, not a transient failure and not a permissions problem — there is no flag, config edit, account setting, or environment variable that reveals it. Don't retry, don't hunt for an alternative route, and don't tell the user to request access. Say the feature isn't available in this CLI and offer the nearest thing that works.
- **Don't act on a command you remember rather than one you can see.** Your training data may include commands from a newer or unreleased build of this CLI. `--help` in the current session is the only reliable source, and the table below documents only what a published build ships.
- **A flag can be rejected even when its command exists.** `--distribution` is a real flag, but a value tied to an unreleased feature is refused with *"That command is not available yet. It is part of a Brevo feature that has not been released."* Same rule: it's final. Use `--distribution private`.

The Brevo API enforces the same boundaries independently, so nothing is gained by routing around the CLI — a hand-rolled `curl` hits the platform's own refusal.

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
| `brevo app list` | List apps (`--json`). Each row names its type. |
| `brevo app create` | Create an app (`--name`, `--distribution private`, `--redirect-uri`, `--logo-uri`, `--json`). **Pass `--distribution private`** — run `brevo app create --help` for the values this build accepts and don't pass one it doesn't list. Defaults to scopes `contacts:read`, `contacts:write`, `crm:read`, `crm:write`. Interactively it asks for the name before the OAuth prompts. **Errors immediately if `app-config.json` already exists in the working directory** — move elsewhere or use `brevo app scaffold` there instead. Otherwise resolves (creates/`cd`s into) a target directory, creates the app, and writes the basic project structure (`app-config.json` + `.gitignore`/`AGENTS.md`/`CLAUDE.md`/`README.md`). It scaffolds a feature (OAuth test server) only when the interactive confirm (*"Scaffold the Test OAuth App?"*, default yes) is answered yes; non-interactive runs (`--json` or piped) stay base-only — add the feature afterward with `brevo app scaffold`. |
| `brevo app upload` | Push `app-config.json` to Brevo (`--yes`, `--json`). No edit flags — change name/redirect URLs/scopes/logo/version by editing `app-config.json` directly, then run `upload`. **`distribution_type` is immutable** — set at `app create` time; if the local value differs from the server, `upload` errors before pushing (restore the local value, or create a new app). Always fetches the remote app first and shows a local-vs-server diff (even under `--yes`/`--json`); exits 0 with no network push if nothing differs. |
| `brevo app credentials` | Show client ID / secret (`--app-id`, `--reveal-secret`, `--json`). **`--app-id` is required when scripting** — see the picker note below. Also backfills a missing top-level `version` / `distribution_type` into cwd's `app-config.json` when its `appId` matches (fill-only-when-missing, silent). |
| `brevo app delete` | Delete an app (`--app-id`, `--force`, `--json`). **`--app-id` is required when scripting** — see the picker note below. |
| `brevo app scaffold` | Add a feature to the app in the current directory (`--app-id`, `--overwrite`, `--json`). Requires an `app-config.json` in cwd **unless `--app-id <id>` is passed or you accept its bootstrap offer**; reads the linked app from it. `--app-id` in a directory with no config fetches that app and writes `app-config.json` + the base files first — the only way to get a config for an app that already exists, and the migration path off the removed `brevo app update --app-id`. Interactively, omitting `--app-id` in a config-less directory prints *"No app-config.json in this directory…"*, asks **"Set up a project for an app you already have?"** (default yes) and on yes shows an app picker; answering no exits `0` with the remaining routes on screen. Every interactive bootstrap (picker or `--app-id`) then asks `Output directory:` defaulted to `./<slugified app name>`, creates it and `cd`s into it — answer `.` to stay in the current directory — and the *Next steps* box opens with `cd <dir>`. Under `--json` or off a TTY there is no offer — it errors, listing the three ways out. It refuses, before any network call: if the directory is already linked to a different app — either the one the command ran in or the one it was pointed at (naming the app it is already linked to is a no-op), if the directory is **inside** an existing app project (a nested second config would make a later `brevo app upload` from there push the wrong app). Diffs the local config against the server and, on drift, updates `app-config.json` to match (on consent) before writing the feature files — including when a bootstrap is pointed at a directory that already holds a project, where answering **Merge** to the directory question does *not* skip that refresh. When feature files already exist, prompts Overwrite / Merge / Cancel (default Merge — existing files kept); `--overwrite` forces overwrite and skips the prompt. The scaffolded OAuth flow is the confidential-client flow: the token exchange is authenticated with the `CLIENT_SECRET` written into the generated `.env.local`. |
| `brevo app start oauth` | Run the scaffolded OAuth test server (`--port`) |
| `brevo app available-scopes` | List OAuth scopes supported by the IdP (`--json`, `--web`) |
| `brevo skill:cli install` | Install the brevo-cli Claude Code skill (Claude-only; auto-refreshes on every `brevo` run) |
| `brevo skill:cli uninstall` | Remove the brevo-cli skill from `~/.claude/skills/` (Claude-only) |

Run `brevo --help` or `brevo <command> --help` for the full set.

## Conventions

- **Every command supports `--json`** — prefer this when parsing output programmatically. It applies to failures too: a failing `--json` run writes a single `{"error": {...}}` document to stdout (see *JSON errors* below) while the human message goes to stderr.
- **`app-config.json` describes an OAuth app.** It carries `auth.scopes` / `auth.redirectUris` alongside the top-level `appId` / `appName` / `logoUri` / `version` / `distribution_type`. Write only the keys documented here — `brevo app upload` validates the whole file and rejects anything it doesn't recognise.
- **`brevo app create` refuses to run inside an already-linked directory.** If `app-config.json` exists in cwd, it throws immediately (no confirm, no override) — the error points at moving elsewhere or running `brevo app scaffold` there.
- **`brevo app create` resolves its target directory before creating the app**, then writes the **basic project structure only** (`app-config.json` + `.gitignore`/`AGENTS.md`/`CLAUDE.md`/`README.md`) — the OAuth server code is a *feature*, not part of the base. Interactive mode prompts for the target directory (default `./<slugified-app-name>`, `cd`s into it) before the API call, how to handle an existing one (overwrite / merge / choose a different path), and — after the app is created — whether to scaffold a feature (*"Scaffold the Test OAuth App?"*, default **yes**). There is no follow-up "which feature?" question while the CLI ships one: a list of one is not asked, and the confirm names it instead. A second feature would bring the picker back. Non-interactive runs stay base-only: `--json` (and piped, non-TTY) create the app and write the base files but never scaffold a feature — run `brevo app scaffold` afterward for the OAuth code. Under `--json` the same default directory is used and `cd`d into if it doesn't already exist; if it already exists, both directory setup and scaffolding are skipped (the app is still created). The JSON response always includes `directory` (absolute path) alongside the app fields, plus either `scaffolded` (base file count, on success) or `scaffoldSkipped` (a message, when the directory already existed).
- **`brevo app scaffold` adds a feature to an already-created project, or sets an empty directory up for an app that already exists.** It **requires** an `app-config.json` in cwd unless `--app-id` is passed or its bootstrap offer is accepted, and only the bootstrap mode ever creates a directory (the feature-add mode always writes into the project it was run in). **`--app-id <id>` bootstraps a project for an app that already exists**: it fetches the app, writes `app-config.json` + the base files, and then continues into the feature flow. That is the only command that produces a config for an existing app (`app create` creates a new one, `app upload` only reads the linked project), which makes it the migration path off the removed `brevo app update --app-id`. **Interactively, `--app-id` is optional**: in a config-less directory the command explains there is no app here, asks *"Set up a project for an app you already have?"* (default **yes**), and on yes runs the same app picker `app delete` uses — because a user who has lost their project folder has the app but not necessarily its ID. Declining is a normal outcome that exits `0` after printing the remaining routes; the offer is skipped entirely under `--json` or off a TTY, where the no-config error (naming all three ways out: `cd` into a project, `--app-id`, `brevo app create`) is raised instead, so scripts behave exactly as before. **An interactive bootstrap also asks where to put the project** — `Output directory:`, defaulted to `./<slugified app name>`, the same prompt (and the same overwrite / merge / choose-a-different-path follow-up on an existing directory) `app create` uses; it creates the directory, `cd`s the CLI process into it, writes and reports the project, then asks *"Scaffold the Test OAuth App?"* (default yes; declining leaves the project and exits `0`), and opens *Next steps* with `cd <dir>` since the user's shell stayed behind. Answering `.` keeps the current directory and drops that step. This too is interactive-only: under `--json` or off a TTY the files go into the current directory as they always have, which is what makes `scaffold --app-id` safe to script. In bootstrap mode the config is written from the server's copy of the app, since there is nothing local to read it from. Bootstrapping is refused, before any network call or write, in two cases: a directory already linked to a **different** app (passing the app it is already linked to changes nothing), and a directory **inside** an existing app project — `readProjectConfig` reads cwd only and never walks up, so without that check a stray `cd` would nest a second `app-config.json` inside the first and a later `app upload` from there would push the wrong app silently. The different-app check applies to the answer to `Output directory:` as well as to cwd, and there it is the only thing standing between you and a project whose `app-config.json` and `src/oauth/.env.local` name two different apps. **A target directory that already holds a project for the same app makes the bootstrap a refresh**: its config is diffed against the server and rewritten only on consent, and the directory question's **Merge** answer does not suppress that. The two answers address different things — Merge means "don't clobber my own files" and is implemented by skipping any path that already exists, which `app-config.json` always does here, so letting it govern the base write meant the command fetched the app, discarded every field, wrote nothing, and still printed its success box. No drift leaves `app-config.json` as it is with a one-line notice; the feature is still offered either way. It otherwise reads the linked app id from that config (no picker — the picker is only for the config-less bootstrap), diffs the local config against the server, and if fields drifted it shows them and asks consent to update `app-config.json` (and the other base files) to match before writing the feature files. When any feature file already exists it prompts **Overwrite / Merge / Cancel** (default **Merge** — existing, e.g. hand-edited, files are kept and only missing files added; Cancel aborts without writing). The `--overwrite` flag forces a full overwrite of feature files and skips that prompt (works interactively and under `--json`). **Under `--json` it never prompts**: a config diff comes back as `{ "cancelled": true, "reason": "...", "diffs": [...] }`; otherwise it writes the feature (merging existing files unless `--overwrite` is passed) and returns `{ "scaffolded": <n>, "directory": "..." }`.
- **`app-config.json`** in the working directory pins the linked app — `brevo app upload` and `brevo app start` read from it. `upload` is the *only* command that pushes config changes, and it has no `--app-id` override (it always resolves the app from cwd's `app-config.json`, hard-erroring if that file is missing/invalid/lacks `appId`); `brevo app start` accepts `--app-id` to target a different app. The top-level `logoUri` string is pushed as `logo_uri`; leave it empty to keep the API value untouched. The top-level `version` string is round-tripped as `version` on the wire — `upload` sends the local value (falling back to the server's current value if locally absent) and writes back whatever the server confirms. `brevo app credentials` additionally backfills a missing top-level `version` / `distribution_type` into cwd's `app-config.json` when its `appId` matches the inspected app — fill-only-when-missing (never overwrites an existing local value), silent in all modes — so legacy projects that are never `upload`ed still converge to the current shape.
- **Commands that pick an app interactively refuse to do so when scripted.** `brevo app credentials` and `brevo app delete` fall back to an interactive app picker when `--app-id` is absent. Under `--json` **or** off a TTY that picker is refused up front — before any network call — with a `CliError` naming the exact command to run (`brevo app credentials --app-id <id>`) and exiting `1`. **Always pass `--app-id` when scripting these.** The refusal exists because the picker renders its choice list to stdout, which would otherwise corrupt the single-JSON-document contract below and leak app ids into whatever is parsing it. `brevo app delete` is the one that matters most: it is destructive, so a script that relied on the picker was never doing what its author thought.
- **There is no `brevo app update`.** It was removed and replaced by `brevo app upload`, with no shim and no flag-for-flag equivalent — change an app's name, redirect URLs, scopes or logo by editing `app-config.json`, then run `brevo app upload`. That is what to replace it with wherever you find it: a user's script, a CI job, a README, or your own recollection. Invoking it — with any of the old flags (`--name`, `--redirect-uri`, `--scope`, `--logo-uri`, `--app-id`), with `--help`, or as `brevo app help update` — prints a message naming `upload` and exits `1` **without uploading anything**, so a `1` from `brevo app update` means the command is gone, not that an upload failed. It is absent from every help screen, and needs no login to reach.
- **Credentials** live at `~/.brevo/credentials.json`. Never commit this file or any `.env.local`.
- **Non-interactive auth:** `BREVO_API_KEY=xkeysib-... brevo login`. The legacy `--api-key` flag was removed because it leaks into shell history.
- **Skip prompts:** `--force` for `app delete` and `logout`; `--yes` for `app upload`.
- **Forced update:** when the installed CLI is a full **major** version behind the latest npm release, every command except `--help`/`--version` prints a blocking update banner to stderr and exits `1` without running. Update with `npm install -g @getbrevo/cli` (or `yarn global add`). The gate honors the same opt-outs as the soft update notice (`BREVO_NO_UPDATE_NOTIFIER=1`, `--no-update-notifier`, CI, non-TTY), so it never fires in those contexts.
- **Update notice wording:** the update/force-update banners take their first line from the app-store service (`GET /cli/info`). It is called directly, not through the v3 API gateway, and needs no API key — so it works while logged out or with expired credentials. It runs once per invocation, **before** the command, and the response is cached at `~/.brevo/cli-info-cache.json` for **15 minutes**, keyed to the installed `cliVersion` — so reworded text or a new block reaches the CLI within minutes rather than after the old 12h npm-style TTL. Whether an update banner appears is still decided from the npm registry, and if the call fails the banner still appears with local wording (a failed call never overwrites a good cache entry).
- **Soft update notice on failures:** the non-blocking update banner also prints after a command *fails*, not just after it succeeds — so stderr may hold the error message followed by the update box. Exit codes are unchanged (still the command's own), the box never appears twice in one run, and a Ctrl-C abort skips it. Parse stderr accordingly, or set `BREVO_NO_UPDATE_NOTIFIER=1` / pass `--no-update-notifier`.
- **Server-side block:** `GET /cli/info` may answer `"is_blocked": true`, in which case every command except `--help` / `--version` prints a banner to stderr and exits `1` **without running** — independently of the npm major-version gate. Unlike the update notice, this is **not** suppressed by `BREVO_NO_UPDATE_NOTIFIER=1`, `--no-update-notifier`, CI, or a non-TTY: a hidden banner must never mean a hidden block. It fails open — a timeout, a non-2xx, or an unparseable body lets the command run, and only a literal `true` blocks. So a `brevo` call that suddenly exits `1` with an update banner may mean either a major-version gap or a server-side block; both are cleared by upgrading. Because the verdict is cached for 15 minutes, a lifted block can take up to 15 minutes to clear on a machine that already cached the blocked answer — delete `~/.brevo/cli-info-cache.json` for an immediate re-check. Note `--help` / `--version` are exempt from the block only, not from the lookup: they still fetch `/cli/info` and still show the server's wording on their update banner, they just never exit non-zero because of it.
- **Exit codes:** `0` success · `1` general error · `2` aborted · `3` auth · `4` network · `5` not found.

## JSON errors

Under `--json`, a failing command writes **one** JSON document to stdout describing the failure; the human-readable message still goes to stderr. The `error` key is the discriminator — no success payload has one:

```json
{ "error": { "name": "CliError", "message": "Not authenticated. Run: brevo login", "exitCode": 1 } }
```

| Field | Always present | Meaning |
| --- | --- | --- |
| `name` | yes | Error class — `CliError`, `ApiError`, `AuthExpiredError`, `AbortError` |
| `message` | yes | Same text written to stderr |
| `exitCode` | yes | Matches the process exit code |
| `statusCode` | `ApiError` only | HTTP status behind the failure |
| `code` | `ApiError`, when classified | `AUTH_INVALID`, `AUTH_EXPIRED`, `ACCESS_DENIED`, `APP_NOT_FOUND`, `REDIRECT_INVALID`, `PORT_IN_USE`, `NETWORK_ERROR`, `RATE_LIMITED`, `APP_LIMIT_REACHED`, `REGISTRY_ERROR`, `AUTH_GATEWAY` |

Stdout is always **exactly one** parseable document. Commands that already describe their own failure keep their shape rather than emitting this envelope — `brevo whoami --json` returns `{"authenticated": false, "reason": "no_key"}` (exit `1`). Check for `error` first, then fall back to the command's own shape.

## Command help

`brevo --help` prints the grouped overview of every command. `brevo <command> --help` prints that command's own usage line, arguments, flags, and examples — e.g. `brevo app scaffold --help` documents `--app-id` / `--overwrite` / `--json`. Use it to confirm a flag exists on the installed version rather than assuming from this file.

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
| `BREVO_APP_STORE_URL` | Override the app-store service base used for the update notice and the server-side block check (HTTPS required, except `localhost`) |
| `BREVO_CONFIG_HOME` | Override credentials directory (default `~/.brevo/`) |
| `BREVO_CLAUDE_HOME` | Override Claude Code home used by `skill:cli` (default `~/.claude/`) |
| `BREVO_NO_SKILL_AUTOREFRESH` | Set to `1` to suppress automatic skill refresh on `brevo` runs |
| `BREVO_NO_UPDATE_NOTIFIER` | Set to `1` to suppress the npm update-available notice **and** the blocking major-version force-update gate. Does **not** suppress a server-side `is_blocked` block. |
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
