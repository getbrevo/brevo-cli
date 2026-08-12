# QA Manual Test Cases — `features_set_public_cli`

Manual test suite for QA to verify the user-visible changes on the `features_set_public_cli`
branch before merge to `main`. Covers **public and private apps**, the new commands, and
**backward compatibility** (existing apps / older `app-config.json` files must keep working
after upgrading the CLI).

> This file is per-branch working state — delete it before merging to `main`, the same
> rule that applies to `RELEASE-CHECKLIST.md`'s `## Per-branch verification` section.
> Anything here that must outlive the branch belongs in `docs.md` first.

> **⚠️ Public apps and UI apps are not in a published build (BEX-405).** Their commands
> are eliminated at build time, so `app submit` / `app status` / `app withdraw` /
> `app deploy` / `app rollback` answer `unknown command`, `--distribution public` is
> refused, and the app-type prompt is never asked.
>
> **Build the CLI with `PREVIEW=1 yarn link:dev` before running any of those suites**
> (2, 6, 7 and 12). Nothing else unlocks them — the interim `@brevo.com` /
> `@sendinblue.com` account exception and `BREVO_ENABLE_PREVIEW=1` were both removed when
> the guard moved into the build. Against a published build their refusals are the
> correct result, not a bug.
>
> The rest of the suites run against either build. If an end-to-end path isn't live in
> your environment yet, note it on the case rather than skipping the whole section.

---

## What changed on this branch (feature summary)

| Area | Change |
|------|--------|
| **BEX-250** | `brevo app update` **removed**; replaced by `brevo app upload` (pushes `app-config.json`, always shows a local-vs-server diff). |
| **BEX-252** | New `brevo app status` — shows an app's review status as a coloured card. |
| **BEX-253** | New `brevo app withdraw` — withdraws an app from submission. |
| **Public apps** | `brevo app create --distribution public` now works (no "coming soon" block); interactive picker offers Public. |
| **App version** | Server `version` is tracked in `app-config.json`, shown in `create`/`list`, and **backfilled** into legacy configs on `upload`. |
| **create/scaffold split** | `create` writes only base files then offers to scaffold a feature; `scaffold` adds a feature into an already-created project and refreshes config against the server. |
| **Config migration** | `distribution_type` moved to a top-level key; legacy `distribution` / `auth.type` shapes are read and migrated on write. |
| **`--help`** | Root help is column-aligned; `status`/`submit` grouped under "App-review commands (public apps only)". `withdraw` is **unlisted on purpose** — it is registered and fully callable, just not advertised on either help screen. |

---

## Test environment & global preconditions

- **Node.js** ≥ 20.15.0, **Yarn** ≥ 1.19.1.
- Build the branch locally and use the local binary:
  ```bash
  yarn install && yarn build && yarn link:dev
  brevo --version    # confirm the branch build is on PATH
  ```
- A **Brevo test/staging account** you are authorised to use. Do **not** use production
  customer data.
- Authenticated session: `brevo login` completed (or `BREVO_API_KEY=xkeysib-test-… brevo login`).
- Placeholder conventions in this doc: API keys `xkeysib-test-…`, app IDs like `42` / `<APP_ID>`,
  hosts `localhost` / `example.com`. Substitute real test-account values when running.
- Terminal is a **TTY** unless a case says "non-TTY / piped".

### Exit-code reference (`src/lib/exit-codes.ts`)

| Code | Meaning |
|------|---------|
| `0` | Success (also: withdraw of a not-submitted app, up-to-date upload) |
| `1` | Generic error (`CliError`, 403, generic API error) |
| `2` | Aborted |
| `3` | Auth failure (HTTP 401) |
| `4` | Network error |
| `5` | Not found (HTTP 404) |

Check the exit code after any command with `echo $?`.

---

## Suite 1 — `brevo app create`: private apps

### TC-1.1 — Create a private app interactively
**Priority:** High
**Preconditions:** Authenticated; run from an **empty directory** with no `app-config.json`.
**Steps:**
1. Run `brevo app create`.
2. At the name prompt, enter `QA Private App`.
3. At the distribution prompt, select **Private**.
4. Accept the default redirect URL (localhost callback).
5. Leave logo URL empty.
6. Accept the default output directory.
7. At "Do you want to scaffold a feature? (Y/n)" press Enter (yes), select the OAuth feature.

**Expected:**
- "App created" box shows App name, App ID, Client ID, `Client secret: [hidden …]`, Redirect URL(s), `Default scopes:` line, and — if the API returns one — an `App version:` line.
- Base project files + the OAuth feature files are written into `./qa-private-app`.
- Next-steps box includes a `cd qa-private-app` step (relative to where you started).
- `app-config.json` exists in the new directory with `"distribution_type": "private"`.
- Exit code `0`.

### TC-1.2 — Create a private app non-interactively with flags
**Priority:** High
**Preconditions:** Authenticated; empty directory.
**Steps:**
```bash
brevo app create --name "QA Flags App" --distribution private \
  --redirect-uri http://localhost:3009/auth/callback \
  --redirect-uri https://example.com/callback
```
**Expected:**
- No prompts for name/distribution/redirect. App created with both redirect URLs.
- Feature-scaffold prompt still appears (TTY). Exit `0`.

### TC-1.3 — `--logo-uri` accepted and recorded
**Priority:** Medium
**Steps:** `brevo app create --name "QA Logo" --distribution private --logo-uri https://example.com/logo.png`
**Expected:** "App created" box shows `Logo URL: https://example.com/logo.png`; `app-config.json` records `logoUri`. Exit `0`.

### TC-1.4 — Invalid `--distribution` value rejected
**Priority:** High
**Steps:** `brevo app create --name "QA Bad" --distribution enterprise`
**Expected:** Validation error naming `--distribution`; **no API call**; **no app created**; exit `1`.

### TC-1.5 — Invalid redirect URL rejected
**Priority:** Medium
**Steps:** `brevo app create --name "QA Bad URL" --distribution private --redirect-uri ftp://nope`
**Expected:** Rejected (must be http/https); no app created.

---

## Suite 2 — `brevo app create`: public apps

> **⚠️ BEX-405 changed the entry condition for this whole suite — read before running it.**
> Public distribution is gated at **build time**. A published build (`npm i -g
> @getbrevo/cli`, or plain `yarn build`) refuses `--distribution public` with *"That
> command is not available yet…"*, exit `1`, and never asks the distribution prompt — it
> goes straight to a private app.
>
> **Every case below requires a preview build: `PREVIEW=1 yarn link:dev`.** There is no
> account, flag or environment variable that unlocks a published build — the
> `@brevo.com` / `@sendinblue.com` exception and `BREVO_ENABLE_PREVIEW=1` both existed in
> an interim version and were removed. Against a published build the correct result for
> TC-2.1 is the refusal, not an app; that is not a bug to file.
>
> The platform *also* refuses public creates from the CLI, so even a preview build may hit
> the server's own rejection (TC-2.4).

### TC-2.1 — Create a public app with the flag
**Priority:** High
**Preconditions:** Authenticated; empty directory.
**Steps:** `brevo app create --name "QA Public App" --distribution public`
**Expected:**
- **No "coming soon"/unavailable error** and no early exit before the API call.
- App is created as **public**; API receives `distribution_type: "public"`.
- `app-config.json` records `"distribution_type": "public"`.
- Exit `0`.

### TC-2.2 — Public is selectable in the interactive picker
**Priority:** High
**Steps:** Run `brevo app create` interactively; at the distribution prompt inspect the choices.
**Expected:** Two choices — **Private** and **Public** — both selectable (Public is **not** disabled/greyed as "coming soon"). Selecting Public creates a public app.

### TC-2.3 — Public app appears correctly in `list`
**Priority:** Medium
**Steps:** After TC-2.1, `brevo app list --json`.
**Expected:** The public app is present with the public distribution reflected in server data.

---

## Suite 3 — create → scaffold split & `brevo app scaffold`

### TC-3.1 — Decline the feature prompt → base files only
**Priority:** High
**Steps:** `brevo app create` interactively; at "Do you want to scaffold a feature? (Y/n)" enter `n`.
**Expected:**
- Only base project files are written (no `src/oauth/*`).
- A lighter next-steps box points at `brevo app scaffold` to add a feature later.
- Exit `0`.

### TC-3.2 — `brevo app scaffold` with no `app-config.json` → friendly error
**Priority:** High
**Preconditions:** `cd` into a directory with **no** `app-config.json`.
**Steps:** `brevo app scaffold`
**Expected:** Friendly `CliError` (not a raw stack); **no server fetch**; exit `1`.

### TC-3.2b — bootstrap asks where to put the project
**Priority:** High
**Preconditions:** A TTY, logged in, at least one app on the account. `cd` into a directory with **no** `app-config.json` — ideally one that already holds other folders, e.g. the folder you keep your app projects in.
**Steps:** `brevo app scaffold`; accept the offer; pick an app; accept the default at `Output directory:`. Then repeat, answering `.` instead. Then repeat with `brevo app scaffold --app-id <id> --json`.
**Expected:** No *"What feature do you want to scaffold?"* list appears at any point — the CLI ships one feature, so it is named in a confirm (*"Scaffold the Test OAuth App? (Y/n)"*) that comes **after** the project is written and listed. Answering `n` leaves `app-config.json` and the base files on disk, writes no `src/oauth/*`, and exits `0`. The default is `./<the app's name, slugified>`. Accepting it creates that directory, writes **nothing** into the directory you started in, and the *Next steps* box opens with `cd <dir>` — verify your shell is still in the original directory afterwards, and that `cd <dir> && brevo app upload` works. Answering `.` writes into the current directory (an "already exists" prompt appears first — Merge keeps existing files) and the *Next steps* box has **no** `cd` step, starting at `1. yarn --cwd src/oauth`. The `--json` run asks **nothing** and writes into the current directory, with `directory` in its output pointing there — this is the scripted contract and must not move.

### TC-3.2c — an existing directory isn't reported as "Creating"
**Priority:** Medium
**Preconditions:** A directory that already exists next to your cwd, e.g. `mkdir test-app`.
**Steps:** `brevo app create` (or a bootstrap per TC-3.2b) and answer `./test-app` at `Output directory:`; choose **Overwrite** at *"Directory already exists. What would you like to do?"*.
**Expected:** The next line is `Moving into test-app...`, not `Creating test-app and moving into it...` — the old wording contradicted the prompt just answered. Choosing **Merge** prints the same line and keeps existing files.

### TC-3.3 — `scaffold` adds the feature into a created project (same app, no drift)
**Priority:** High
**Preconditions:** In a project dir created via TC-3.1 (base only), `app-config.json` matches the server.
**Steps:** `brevo app scaffold`, choose the OAuth feature.
**Expected:** No config-drift prompt (config matches server); OAuth feature files written (merged). Exit `0`.

### TC-3.4 — `scaffold` reports drift and refreshes config on consent
**Priority:** High
**Preconditions:** In a project dir; **hand-edit** `app-config.json` (e.g. change `appName`).
**Steps:** `brevo app scaffold`; observe the reported differing fields; **consent** to refresh.
**Expected:** The differing fields are listed as differing "from the server"; on consent, `app-config.json` is rewritten to match the server, then the feature is written. Declining writes nothing. Exit `0`.

### TC-3.5 — `scaffold` feature-file conflict: Merge / Overwrite / Cancel
**Priority:** Medium
**Preconditions:** Feature files already exist in the project.
**Steps:** Run `brevo app scaffold` interactively and test each choice; then test `brevo app scaffold --overwrite`.
**Expected:**
- **Merge** → existing files kept, only missing ones added.
- **Overwrite** → existing files rewritten.
- **Cancel** → nothing written, "Scaffold cancelled." printed.
- `--overwrite` → no conflict prompt, files rewritten.

### TC-3.6 — `scaffold --json` never blocks on a prompt
**Priority:** High
**Preconditions:** Any project dir with `app-config.json`.
**Steps:** `brevo app scaffold --json` in each of: no-drift, config-drift, and directory-exists situations (pipe/redirect if needed to force non-TTY).
**Expected:** Command **never hangs on `inquirer`**; always emits a single valid JSON blob. Drift/cancel cases emit `{ "cancelled": true, … }`; success emits `{ "scaffolded": …, "directory": … }`. Exit `0`.

---

## Suite 4 — `brevo app create` guardrails & JSON

### TC-4.1 — Refuse to create when a project is already linked here
**Priority:** High
**Preconditions:** `cd` into a directory that already has an `app-config.json`.
**Steps:** `brevo app create`
**Expected:** Immediate hard error naming the linked app: `App "<name>" is already linked in this directory …`; **no prompts, no API call, no app created**; exit `1`.

### TC-4.2 — `--json` create is fully non-interactive
**Priority:** High
**Preconditions:** Empty directory; authenticated.
**Steps:** `brevo app create --name "QA Json" --distribution private --json`
**Expected:**
- Single JSON blob only (no stray human text before/after it), containing `appId`, `appName`, `clientId`, `clientSecret: "[hidden]"`, `redirectUri`, `directory`, `scaffolded` (base file count), and `version` **only if** the API returned one.
- **Base files only** written — no OAuth feature (JSON mode never scaffolds a feature).
- Exit `0`.

### TC-4.3 — `--json` create when the target directory already exists → skipped
**Priority:** Medium
**Preconditions:** `./qa-json` already exists.
**Steps:** `brevo app create --name "QA Json" --distribution private --json`
**Expected:** App is still created; JSON carries `scaffoldSkipped` (message) + `directory` **instead of** `scaffolded`; directory contents not overwritten. Exit `0`.

### TC-4.4 — App-limit reached → friendly message
**Priority:** Medium
**Preconditions:** A test account already at the max OAuth-app limit.
**Steps:** `brevo app create --name "QA Overflow" --distribution private`
**Expected:** Friendly message: "You have reached the maximum number of OAuth apps allowed …" (not a raw API fallback string). With `--json`, `{ "error": "APP_LIMIT_REACHED", … }`.
> **Regression note (US-1):** verify this also fires when the API returns the code in **lowercase** (`app_limit_reached`). If a raw fallback string appears instead, log it — this is the known case-sensitivity gap.

---

## Suite 5 — `brevo app upload` (replaces `brevo app update`)

### TC-5.1 — `brevo app update` is gone, and says so
**Priority:** High
**Steps:** Run each of:
- `brevo app update`
- `brevo app update --name "My App" --redirect-uri http://localhost:3009/auth/callback`
- `brevo app update --app-id 42 --scope contacts:read --logo-uri https://example.com/logo.png`
- `brevo app update --help`
- `brevo app help update`
- `brevo app update --json`
- `brevo app update` while **logged out** (`brevo logout` first)

**Expected:** Every one prints the same removal message — it names `brevo app upload`, states that `upload` takes only `--yes`/`--json`, and says to edit `app-config.json` instead of reaching for a flag. Exit `1` in all cases. Specifically:
- **No** `unknown command 'update'` and **no** `(Did you mean create?)`.
- **No** `unknown option '--name'` (or any other removed flag) — the flags are swallowed, the message is what comes back.
- Neither `--help` nor `brevo app help update` prints a usage screen, and neither exits `0`. (`brevo app help create` must still print `create`'s help and exit `0` — the help command itself is untouched.)
- `--json` writes the `{"error":{"name":"CliError",…,"exitCode":1}}` envelope to stdout.
- Logged out, it still prints the removal message — **not** `Not authenticated`.
- **Nothing is uploaded.** It is a signpost, not a forwarding shim; no API call is made.

**Also:** `brevo --help` and `brevo app --help` list `upload` and mention no `update` at all (it is registered hidden).

### TC-5.2 — `upload` outside a usable project dir → hard error, no API call
**Priority:** High
**Steps:** Run `brevo app upload` in each situation:
- directory with **no** `app-config.json`
- `app-config.json` with **invalid JSON**
- `app-config.json` **missing `appId`**

**Expected:** A distinct friendly `CliError` for each (no config / invalid JSON / missing appId); **no API call**; exit `1`.

### TC-5.3 — Diff is always shown, even with `--yes`
**Priority:** High
**Preconditions:** In a valid project dir with at least one local change vs the server.
**Steps:** `brevo app upload --yes`
**Expected:** The **"Upload summary:"** diff (App ID, Name, Distribution, Redirect URLs, Scopes, Version — with `→`/`(new)`/`(removed)` markers) is printed **before** pushing; then it uploads without a confirm prompt. Exit `0`.

### TC-5.4 — No differences → up-to-date, no push
**Priority:** High
**Preconditions:** `app-config.json` matches the server exactly.
**Steps:** `brevo app upload`
**Expected:** "Already up to date at version X." printed; **no upload API call**; exit `0`. With `--json`: `{ "appId": …, "upToDate": true, "version": …, "current": {…}, "next": {…} }`.

### TC-5.5 — Confirm prompt on changes (interactive)
**Priority:** High
**Preconditions:** Local change vs server; TTY; no `--yes`/`--json`.
**Steps:** Run `brevo app upload`; at "Proceed with upload?" answer **No**, then rerun and answer **Yes**.
**Expected:** **No** → "Upload cancelled.", nothing pushed, exit `0`. **Yes** → "App uploaded." + `Version: …`, exit `0`.

### TC-5.6 — Non-TTY without `--yes`/`--json` → refuses
**Priority:** High
**Preconditions:** Local change vs server.
**Steps:** `echo "" | brevo app upload` (or run in CI/non-TTY).
**Expected:** Errors with "Cannot prompt for confirmation in non-interactive mode. Use --yes or --json to skip." No upload. Exit `1`.

### TC-5.7 — Outgoing payload contract
**Priority:** High
**Preconditions:** Ability to observe the request (proxy/network log) OR verify via server state.
**Steps:** Make a change and `brevo app upload --yes`.
**Expected:** Payload has `version`, `name`, `logo_uri`, and `distribution_type` all top-level, plus `auth: { scopes, redirect_uris }`. Note: **`version`** (not `app_version`) and `distribution_type` at the top level, not under `auth` — the same structure `POST /apps` sends at create. For an **OAuth** app `ui_app` is never sent — the key must be absent, not `null`. (UI apps do send it; see section 12.)

### TC-5.8 — Legacy `all` scope blocks upload
**Priority:** High
**Preconditions:** `app-config.json` `auth.scopes` contains `all`.
**Steps:** `brevo app upload`
**Expected:** Blocked with the legacy-scope deprecation message pointing at editing `auth.scopes` + `brevo app upload`; no push. Exit `1`.

### TC-5.9 — No redirect URLs configured → error
**Priority:** Medium
**Steps:** Remove all redirect URLs from `app-config.json`, run `brevo app upload`.
**Expected:** "app-config.json has no redirect URLs configured." No push. Exit `1`.

### TC-5.10 — Invalid redirect URL/protocol → error
**Priority:** Medium
**Steps:** Put `ftp://x` into `auth.redirectUris`, run `brevo app upload`.
**Expected:** Friendly invalid-redirect error; no push.

### TC-5.11 — Success writes server-confirmed values back to `app-config.json`
**Priority:** High
**Steps:** Change the name locally, `brevo app upload --yes`, then inspect `app-config.json`.
**Expected:** File updated with server-confirmed name, logo, `distribution_type`, `version`, scopes, redirectUris. `brevo app list` reflects the new name (cached-name masking may apply briefly).

### TC-5.12 — Server rejection propagates
**Priority:** Medium
**Preconditions:** Force a server-side rejection if possible (e.g. outdated version).
**Steps:** `brevo app upload --yes`
**Expected:** Error surfaced; exit `1` (non-zero). No silent success.

### TC-5.13 — Upload blocked while app is `Submitted` (US-2)
**Priority:** High
**Preconditions:** A public app currently in the `submitted` state (verify with `brevo app status`); a local change vs the server.
**Steps:** `brevo app upload --yes`
**Expected:**
- `upload` reads the app's current state **before** any push.
- Blocked with a friendly `CliError` explaining the app can't be modified while under review, plus a hint to withdraw first (`brevo app withdraw --app-id <APP_ID>`).
- **No upload API call** is made; server state is unchanged.
- Exit `1`.

### TC-5.14 — Upload blocked while app is `In Review` (US-2)
**Priority:** High
**Preconditions:** A public app currently in the `in_review` state; a local change vs the server.
**Steps:** `brevo app upload --yes`
**Expected:** Same as TC-5.13 — blocked with the friendly under-review `CliError` + withdraw hint; no push; exit `1`.

### TC-5.15 — Blocked-state upload with `--json` surfaces structured reason (US-2)
**Priority:** High
**Preconditions:** A public app in `submitted` or `in_review`; a local change vs the server.
**Steps:** `brevo app upload --yes --json`
**Expected:** A single valid JSON blob describing the blocked reason (e.g. `{ "uploaded": false, "reason": "UNDER_REVIEW", "state": "<state>", "message": …, "withdrawCommand": "brevo app withdraw --app-id <id>" }`) — **not** a thrown stack trace. No push. `jq .` parses cleanly.

### TC-5.16 — Allowed states still upload normally (US-2)
**Priority:** High
**Preconditions:** A public app in a non-blocking state (e.g. `configured`, `changes_requested`, `rejected`, `approved`) or a private app with no review state; a local change vs the server.
**Steps:** `brevo app upload --yes`
**Expected:** The state check passes through; the normal upload flow runs (diff shown, then push); "App uploaded." + `Version: …`; exit `0`. Confirms the block is scoped to `Submitted`/`In Review` only.

---

## Suite 6 — `brevo app status`

### TC-6.1 — Status via `--app-id`
**Priority:** High
**Steps:** `brevo app status --app-id <APP_ID>`
**Expected:** An aligned card: bold **App status** title, a `─` rule, a coloured icon + label, then the message indented under the label. Exit `0`.

### TC-6.2 — State → tone/label mapping
**Priority:** Medium
**Steps:** Inspect status for apps in different states (use whatever states your test account can reach).
**Expected (label / colour / icon):**
- `approved` → "Approved" / green ✓
- `rejected` → "Rejected" / red ✗
- `changes_requested` → "Changes Requested" / yellow ⚠
- `in_review` → "In Review" / yellow ◐
- `submitted` → "Submitted" / blue ◔
- `configured` → "Configured" / cyan ◇
- unknown/other → gray ○
Messages match the canned copy per state (e.g. `submitted` → "Your app has been submitted and is waiting to be reviewed.").

### TC-6.3 — Empty/missing state → friendly "Unknown"
**Priority:** High
**Preconditions:** An app with no review state (e.g. a private app never submitted).
**Steps:** `brevo app status --app-id <APP_ID>`
**Expected:** Header "App status: Unknown"; message "Status information isn't available for your app yet. Make sure your app is public and has been uploaded with `brevo app upload`." Exit `0`.

### TC-6.4 — `--json` output
**Priority:** High
**Steps:** `brevo app status --app-id <APP_ID> --json`
**Expected:** `{ "state": "<state>", "message": "<friendly copy>" }`. Empty state serialises as `"state": "unknown"`. Exit `0`.

### TC-6.5 — App resolution: linked config, then picker
**Priority:** Medium
**Steps:**
1. Inside a project dir (no `--app-id`): `brevo app status`.
2. Outside any project dir (no `--app-id`): `brevo app status`.
**Expected:** (1) auto-uses `appId` from `app-config.json`, no picker. (2) shows the interactive app picker.

### TC-6.6 — Colour honours `NO_COLOR` / `FORCE_COLOR`
**Priority:** Low
**Steps:** `NO_COLOR=1 brevo app status --app-id <APP_ID>` and `FORCE_COLOR=1 brevo app status --app-id <APP_ID>`.
**Expected:** `NO_COLOR=1` → no raw ANSI codes; `FORCE_COLOR=1` → coloured even when piped.

---

## Suite 7 — `brevo app withdraw`

> **Unlisted, not unavailable.** `app withdraw` is marked `hidden` so it appears on
> neither help screen (see TC-10.3). Every case below still runs exactly as written —
> type the command and it works. Discovery is the only thing that changed.

### TC-7.1 — Withdraw a submitted app (force)
**Priority:** High
**Preconditions:** An app currently in `submitted`/`in_review`.
**Steps:** `brevo app withdraw --app-id <APP_ID> --force`
**Expected:** POST to `/v3/app-store/apps/<id>/withdraw`; "App `<id>` withdrawn from submission." Exit `0`.

### TC-7.2 — Confirmation prompt (default No)
**Priority:** High
**Steps:** `brevo app withdraw --app-id <APP_ID>`; press Enter (default), then rerun and confirm `y`.
**Expected:** Default is **No** → "Withdrawal cancelled.", no API call, exit `0`. Confirming → withdrawn.

### TC-7.3 — Withdraw a not-submitted app → hint, exit 0
**Priority:** High
**Preconditions:** An app that was never submitted (server returns HTTP 422).
**Steps:** `brevo app withdraw --app-id <APP_ID> --force`
**Expected:** "App `<id>` has not been submitted yet." + "Submit it first: brevo app submit --app-id `<id>`". **Exit `0`** (verify with `echo $?`).

### TC-7.4 — Not-submitted with `--json`
**Priority:** Medium
**Steps:** `brevo app withdraw --app-id <APP_ID> --force --json` (on a not-submitted app).
**Expected:** `{ "withdrawn": false, "appId": "<id>", "reason": "NOT_SUBMITTED", "message": …, "submitCommand": "brevo app submit --app-id <id>" }`. Exit `0`.

### TC-7.5 — Success `--json`
**Priority:** Medium
**Steps:** `brevo app withdraw --app-id <APP_ID> --force --json` (on a submitted app).
**Expected:** `{ "withdrawn": true, "appId": "<id>" }`. Exit `0`.

### TC-7.6 — App resolution (linked config vs picker) and `--app-id` override
**Priority:** Medium
**Steps:**
1. Inside a project dir, no `--app-id`: `brevo app withdraw`.
2. Outside a project dir, no `--app-id`: `brevo app withdraw`.
3. Inside a project dir, explicit `--app-id <OTHER_ID>`.
**Expected:** (1) auto-picks `appId` from `app-config.json`, no picker. (2) interactive picker. (3) explicit flag overrides the config.

### TC-7.7 — Unknown app → not found
**Priority:** Medium
**Steps:** `brevo app withdraw --app-id 999999 --force`
**Expected:** "App 999999 not found." (HTTP 404 → exit `5`).

---

## Suite 8 — `brevo app list` & version display

### TC-8.1 — Human list shows a Version line
**Priority:** Medium
**Steps:** `brevo app list`
**Expected:** Each app block shows `Version:       <version>` or `Version:       (none)` when absent; also Client ID, Redirect URL(s), Logo URL, Scopes. Exit `0`.

### TC-8.2 — `--json` list includes version
**Priority:** Medium
**Steps:** `brevo app list --json`
**Expected:** Each app object includes `version`; no `client_secret` field; apps with the legacy `all` scope carry `"legacy_all_scope": true`.

### TC-8.3 — Empty account
**Priority:** Low
**Preconditions:** Account with zero apps.
**Steps:** `brevo app list`
**Expected:** "No apps found. Create one with: brevo app create". Exit `0`.

---

## Suite 9 — Backward compatibility & migration (upgrade must not break existing users)

> These are the highest-value cases for QA: a user who created apps with an **older** CLI
> upgrades to this build and must not see breakage. Use hand-crafted `app-config.json` fixtures
> to simulate older shapes. All values are placeholders.

### TC-9.1 — Legacy config with top-level `distribution` still works
**Priority:** High
**Preconditions:** `app-config.json` in the oldest shipped shape:
```json
{
  "appId": "42",
  "appName": "Legacy App",
  "distribution": "public",
  "auth": { "scopes": ["contacts_read"], "redirectUris": ["https://example.com/cb"] }
}
```
**Steps:** `brevo app upload` (make no changes first, then a small change).
**Expected:**
- CLI reads it without error; treats distribution as `public`.
- After a successful `upload`, the file is **migrated** on write to a top-level `distribution_type: "public"`, with the stray top-level `distribution` key gone and `auth` reduced to `{ scopes, redirectUris }`.
- Same migration applies to the redirect key: a config still saying `auth.redirectUrls` uploads fine, and after any write-back the file says `auth.redirectUris` (old key gone). New key wins if both are present.
- No crash, no data loss.

### TC-9.2 — Interim `auth.type` shape migrates
**Priority:** High
**Preconditions:** `app-config.json` with the never-released interim shape:
```json
{ "appId": "42", "appName": "Interim", "auth": { "type": "public", "scopes": ["contacts_read"], "redirectUris": ["https://example.com/cb"] } }
```
**Steps:** `brevo app upload --yes` (with a change), then inspect the file.
**Expected:** Distribution read as `public`; after write, `auth.type` is dropped and `distribution_type: "public"` is at top level.

### TC-9.3 — Distribution precedence when multiple shapes coexist
**Priority:** Medium
**Preconditions:** A config that (artificially) has all three: top-level `distribution_type`, `auth.type`, and top-level `distribution` with **different** values.
**Steps:** Read via any command that loads config (e.g. `brevo app upload` dry run / status from that dir).
**Expected:** Precedence is `distribution_type` > `auth.type` > legacy `distribution`. No shape "wins" out of order.

### TC-9.4 — Missing distribution defaults to private
**Priority:** Medium
**Preconditions:** `app-config.json` with **no** distribution field of any kind.
**Steps:** Load config via `brevo app upload` (no change).
**Expected:** Treated as `private` by default; no error.

### TC-9.5 — Legacy config missing `version` is backfilled on upload
**Priority:** High
**Preconditions:** `app-config.json` from before the `version` field existed (no `version` key), matching an existing server app.
**Steps:** `brevo app upload` (even with no other changes if the server has a version).
**Expected:** The server's `version` is written back into `app-config.json`; subsequent `brevo app list`/`status` are consistent. A **failed** version fetch must **not** fail the command — the push still succeeds and `version` is just left as-is.

### TC-9.6 — No redundant rewrite when version already matches
**Priority:** Low
**Preconditions:** `app-config.json` whose `version` already equals the server.
**Steps:** `brevo app upload` with no changes.
**Expected:** "Already up to date" path; no unnecessary file churn / no second network call just for version.

### TC-9.7 — Malformed config does not crash unrelated reads
**Priority:** Medium
**Preconditions:** `app-config.json` with bad JSON, a non-object `auth`, or an empty `distribution`.
**Steps:** Run a command that reads config from that directory (e.g. `brevo app status` with no `--app-id`).
**Expected:** No unhandled exception / raw stack trace. `readProjectConfig` returns null gracefully; the command falls back (picker) or errors with a friendly message.

### TC-9.8 — Hand-edited comma-separated scopes are split
**Priority:** Low
**Preconditions:** `auth.scopes` contains a single string like `"contacts_read, campaigns_read"`.
**Steps:** `brevo app upload`.
**Expected:** Read as two scopes; upload proceeds (charset validation still enforced at upload).

### TC-9.9 — Numeric `appId` from legacy config accepted
**Priority:** Low
**Preconditions:** `app-config.json` with `"appId": 42` (a **number**, not a string).
**Steps:** `brevo app upload` / `brevo app status` from that dir.
**Expected:** Coerced to the string `"42"`; command works.

### TC-9.10 — Legacy credentials file shapes still load
**Priority:** Medium
**Preconditions:** `~/.brevo/credentials.json` in an older shape (flat `{ "apiKey": "xkeysib-test-…" }`, or the multi-profile `{ "profiles": … }` shape, or plain-string `appNames`).
**Steps:** `brevo whoami` / any authenticated command.
**Expected:** Migrated transparently to the current shape; auth still works; no crash. Plain-string cached app names are treated as expired (server wins on next `list`).

### TC-9.11 — Existing scaffolded project keeps running
**Priority:** High
**Preconditions:** A project scaffolded by an older CLI (has `src/oauth/*` + old `app-config.json`).
**Steps:** `brevo app start oauth` (and `brevo app scaffold` to refresh).
**Expected:** The OAuth test server still starts; `scaffold` refreshes base files/config against the server without destroying the existing feature code (Merge behaviour by default).

---

## Suite 10 — `brevo --help` layout

### TC-10.1 — Aligned columns
**Priority:** Low
**Steps:** `node dist/bin/index.js --help` (or `brevo --help`).
**Expected:** Command signatures and descriptions are column-aligned; long signatures wrap their description onto an indented line.

### TC-10.2 — Public-app command grouping
**Priority:** Low
**Steps:** `brevo --help`.
**Expected:** `brevo app status` and `brevo app submit` appear under a heading like **"App-review commands (public apps only):"**. `status` is present (regression guard). `upload` is listed; `update` is not.

### TC-10.3 — `withdraw` is hidden from help but still works
**Priority:** Medium
**Steps:** `brevo --help`, then `brevo app --help`, then `brevo app withdraw --help`.
**Expected:** Neither the root screen nor `brevo app --help` mentions `withdraw` anywhere — it is marked `hidden`, not gated. `brevo app withdraw --help` still prints its own usage (`Usage: brevo app withdraw [options]`) with `--app-id`, `--force` and `--json`, exit `0`, and Suite 7 passes unchanged.

---

## Suite 11 — Cross-cutting / regression

### TC-11.1 — Global `--json` cleanliness
**Priority:** High
**Steps:** Run each command with `--json` and pipe to `jq .`: `create`, `list`, `upload`, `status`, `withdraw`, `credentials`.
**Expected:** Each emits a **single** parseable JSON document with **no** human log lines, spinners, or prompts mixed in. `jq` parses without error.

### TC-11.2 — No secrets leak in output
**Priority:** High
**Steps:** Review `create` / `credentials` human + JSON output.
**Expected:** Client secret shown as `[hidden …]` (human) / `[hidden]` (JSON) unless `--reveal-secret` is explicitly used. No API keys, refresh tokens, or credential-file contents printed.

### TC-11.3 — Automated suite green
**Priority:** High
**Steps:** `yarn test && yarn lint && yarn build`
**Expected:** All pass on the branch (baseline before manual sign-off).

### TC-11.4 — Docs match behaviour
**Priority:** Medium
**Steps:** Skim `agent-context/AGENTS.md` and `agent-context/SKILL.md`.
**Expected:** They describe `upload` (no `--app-id`, only `--yes`/`--json`), `status`, `withdraw`, `--distribution public`, the create/scaffold split, and the `version` field. `brevo app update` appears **only** as removed — the migration note pointing at `upload` — never as a command an agent could run.

### TC-11.5 — Agent docs cover the full current command surface (US-6)
**Priority:** High
**Steps:** In both `agent-context/AGENTS.md` and `agent-context/SKILL.md`, confirm each of these is documented:
- `brevo app withdraw` (BEX-253)
- `brevo app upload` replacing `brevo app update` (BEX-250)
- the `--overwrite` flag on `scaffold`
- public-app distribution (`--distribution public`)
- the `version` field
- `brevo app status` (BEX-252)

**Expected:** Every item above is present in **both** files. Exit criteria is a documentation review, not a command run.

### TC-11.6 — `app update` appears in agent docs only as removed (US-6)
**Priority:** High
**Steps:** `grep -n "app update" agent-context/AGENTS.md agent-context/SKILL.md`.
**Expected:** Matches **only** inside the migration note in each file — `AGENTS.md`'s *There is no `brevo app update`* bullet under **Conventions**, and the tail of `SKILL.md`'s *"Update app metadata"* decision-tree row. Both say it was removed, name `brevo app upload` as the replacement, and describe the `exit 1` / nothing-uploaded behaviour.

> **Why this changed:** this case previously expected **no matches at all**. The command is now registered hidden purely to print a signpost, so an agent that meets a stale `brevo app update` in a user's script needs to recognise the `exit 1` and know the fix. What must stay absent is the command presented as *usable* — no command-table row, no example, no decision-tree entry recommending it. Grep hits are fine; a hit that reads like an instruction to run it is a fail.

### TC-11.7 — Agent docs stay consistent with each other (US-6)
**Priority:** Medium
**Steps:** Compare the shared command surface, hard rules, version-check procedure, and exit codes between `AGENTS.md` and `SKILL.md`.
**Expected:** The two docs agree on the shared surface. Any intentional divergence (e.g. `AGENTS.md` branching by agent type because `SKILL.md` is Claude-only) is called out as intentional, not a drift.

---

---

## 12 — UI apps / action links (BEX-290)

> **⚠️ UI apps are not available to end users yet**, and BEX-405 removes them from the
> published build entirely — `app deploy` / `app rollback` answer `unknown command` and
> the app-type prompt is never asked. **Every case below requires a preview build:
> `PREVIEW=1 yarn link:dev`**, the same entry condition as the public-app suite. No
> account or env var unlocks a published build.
>
> **Field names in the `ui_app` block are confirmed** against the platform
> (its manifest read path and its extensibility UI kit — BEX-308 / BEX-350). What is
> **not** yet built is the write path: nothing on the platform stores that snapshot today.
> So if TC-12.4 or TC-12.7 fails with a 4xx, that is the expected failure mode of an
> unbuilt endpoint, not a CLI bug — record the exact response and flag it against
> `RELEASE-CHECKLIST.md` → *Before UI-apps GA*.
>
> **TC-12.7 also depends on the BEX-350 registry reseed.** Until the platform's
> extension-point registry carries the twelve `.widget`/`.action` entries, an authored slot name resolves to nothing
> and the action link won't render — silently, with a 200. Confirm the reseed has run in
> your environment before treating a non-rendering link as a CLI defect.
>
> **The whole UI-app create flow depends on BEX-361** (`GET /cli/surface-points`, served
> to the CLI as `/v3/app-store/surface-points`). The placement prompts are built from that
> endpoint with **no offline fallback** — until it ships in your environment, choosing
> **UI app** fails at "Loading record pages..." with an actionable error. That is the
> expected pre-BEX-361 behaviour, not a CLI bug (see TC-12.2b). OAuth-app creation is
> unaffected.
>
> The flow calls that endpoint **twice**: once unfiltered (for the record-page prompt),
> then `?location=<comma-separated>` for the placements on the pages that were picked. A
> failure or an empty response on the **second** call is *not* fatal — the CLI falls back
> to the rows it already holds, which are a superset. Only the first call aborts.
>
> **The block shape changed (BEX-290).** `surface_point_list` is now a list of
> `{ surface_point_name, context? }` objects — the key takes the registry's **kebab-case
> slug** (`contact-details-header-menu`), not the dotted slot name — the text fields are
> `label` / `more_info` (was
> `heading` / `subheading`), there is no top-level `context`, and `link_target` is no
> longer in `app-config.json` at all — `brevo app upload` injects `_blank`. A config
> written by an earlier build of this branch is **rejected** by upload with a migration
> hint; that is deliberate, see TC-12.5b.
>
> **Only five context field names exist** on the platform's registry: `recordId`,
> `recordName`, `userId`, `locale`, `accountId`. Anything else is refused at upload.

### TC-12.1 — Interactive create asks for the app type after name and distribution
**Priority:** High
**Preconditions:** Logged in; TTY; cwd has **no** `app-config.json`.
**Steps:** Run `brevo app create`.
**Expected:** Prompt order is "App name:" → "Distribution type?" → "What type of app are you building?" with **OAuth app** and **UI app**. Choosing **OAuth app** reproduces the previous flow from there (redirect URL → logo → scaffold prompt).

### TC-12.2 — Prompt order, and the Iframe choice shown as disabled
**Priority:** High
**Preconditions:** BEX-361 endpoint available (see the section preamble).
**Steps:** `brevo app create`, choose **UI app**, and walk the whole flow.
**Expected:** The order is **"Do you want to add a link or an iframe?"** → "Which record pages should it appear on?" → "Where should it appear on those pages?" (one prompt **per picked page** — see TC-12.2c) → "Label — …" → "More info — … (optional)" → "Redirect link — …" → **"App logo URL"** (optional) → "Output directory". The logo and output-directory prompts are easy to miss when scripting the walkthrough: they belong to the shared create flow rather than the UI-app one, so they come after every UI-specific question. The first lists **Link** as selectable and **Iframe** as visibly disabled ("coming soon"), and the disabled entry cannot be selected. There is **no** "How should it appear on those pages?" (kind) question, **no** separate "Where on those pages?" (place) question, and **no** record-context question anywhere.

### TC-12.2c — One single-select placement prompt per picked page
**Priority:** High
**Preconditions:** BEX-361 endpoint available.
**Steps:** `brevo app create` → **UI app** → **Link** → tick **contact** and **deal** at the pages prompt.
**Expected:** **One prompt per picked page**, asked in turn — a `contact` placement prompt, then a `deal` one — each a **single-select list**, not a checkbox. Choices read as page regions plus the shape they render as — e.g. `Header "More" (•••) menu — menu entry`, `Sidebar — card`. **No kebab-case slug** (like `contact-details-header-menu`) appears anywhere in the prompt. Picking a menu entry on one page and a card on the other is allowed — one app can mix both.

One placement per page is enforced *structurally*: a single-select cannot be left empty and cannot take two values, so there is no "pick at least one spot" or "you missed a page" validation message to see — those were deleted along with the grouped prompt. Note the platform is more permissive than this (it rejects only a *duplicate* slot), so a hand-edited config with two spots on one page still uploads; the single-per-page rule is the CLI's, and is deliberate.

A page the registry offers no usable placement on is **skipped with a warning** rather than prompted for — the page prompt cannot know in advance, because a location listing carries no extension-type information.

### TC-12.2b — UI-app create aborts when the surface-points fetch fails
**Priority:** High
**Preconditions:** BEX-361 endpoint absent or unreachable (e.g. point `BREVO_API_URL` at a dead host, or run against an environment without the endpoint).
**Steps:** `brevo app create`, choose **UI app**, then **Link**.
**Expected:** The flow stops at "Loading record pages..." with an error explaining the UI-app flow needs the platform's placements and that OAuth apps still work. Exit non-zero, **no app is created** (no create request goes out). Re-running and choosing **OAuth app** completes normally.

### TC-12.2d — A failing narrowed load is not fatal
**Priority:** Medium
**Preconditions:** An environment whose surface-points endpoint answers the unfiltered call but 400s (or returns `[]`) for `?location=…` — the likely shape of an early build.
**Steps:** `brevo app create` → **UI app** → **Link** → pick pages → continue.
**Expected:** "Loading placements..." completes and the placement prompt still lists the placements for the picked pages, built from the first call's rows. The run finishes normally; the partner is never sent back to re-answer the page prompt.

### TC-12.3 — UI-app create writes the block shape and no redirect URLs
**Priority:** High
**Preconditions:** BEX-361 endpoint available.
**Steps:** Complete the UI-app flow — **Link**, one or more record pages, one or more placements, then a label, a `more_info` line and a redirect link (`https://…`).
**Expected:** A "UI app created" box shows extension type, each placement with its seeded record context, the label, more info and redirect link — and **no** `Redirect URL` lines. It states that the menu entry is labelled with **the label you typed**, and that on a card that text becomes the button while the card's *title* is the app name. It also prints an **example URL** — the redirect link with the seeded context fields as query parameters and placeholder values. The generated `app-config.json` is valid JSON with a top-level `ui_app` containing exactly `extension_type: "actionLink"`, `surface_point_list` (a list of `{ surface_point_name, context? }` **objects**, the name being the registry's kebab-case slug), `label`, `more_info`, `redirect_link` — and **no** `link_target`, `heading`, `subheading`, top-level `context`, `properties`, `trigger`, `surface`, `placement` or `contextProperties` keys. Every context field name is one of `recordId`, `recordName`, `userId`, `locale`, `accountId`. `auth` is exactly the empty object `{}` — **no** `scopes`, **no** `redirectUris`, **no** `type` key — and there are **no** `permittedUrls`/`support` sections. No `src/oauth/` directory, no feature prompt.

### TC-12.3b — Record context is seeded per placement, and reaches the URL as query params
**Priority:** High
**Preconditions:** TC-12.3 done against a registry whose rows carry `default_context_field`.
**Steps:** Inspect `ui_app.surface_point_list` in `app-config.json`; compare each entry's `context` against the registry row for that slot. Then follow the example URL printed by create.
**Expected:** Each entry's `context` equals that slot's own `default_context_field` (rows can differ), and an entry whose row declares no default has **no** `context` key at all (not `[]`). The example URL carries exactly those names as query parameters, merged after any `?` already in the redirect link and inserted **before** any `#` fragment. The path is never templated.

### TC-12.4 — Upload sends the block, injects link_target, and is accepted
**Priority:** High
**Preconditions:** TC-12.3 done; ability to observe the request.
**Steps:** `brevo app upload` from the project directory.
**Expected:** The summary includes a `UI app:` block listing extension type, each placement with its context, label, more info and redirect link — and **no** "Redirect URLs" row, and **no** `Link target:` row (that row was deliberately removed; `link_target` is injected into the payload but is not a field the partner authors, so showing it in a local-vs-server diff only invited someone to try editing it). The payload carries the block under the **`ui_app`** key **with `link_target: "_blank"` added**, alongside `version`/`name`/`logo_uri`, and has **no `auth` key at all** (UI apps carry no OAuth block). The server accepts it; `Version:` is printed and written back to `app-config.json` with `auth` restored as exactly the empty object `{}`. **Critically: `app-config.json` must still have no `link_target` afterwards** — the server defaults and echoes that field, and the write-back strips it.

### TC-12.5 — Editing only the block is detected as a change
**Priority:** High
**Steps:** After a successful upload, (a) run `brevo app upload` again with nothing changed; (b) change only `ui_app.label` and upload; (c) reorder the keys inside `ui_app` and reorder the `surface_point_list` entries, without changing any value, and upload.
**Expected:** (a) "Already up to date" — this is the regression to watch: the server echo carries a `link_target` (and possibly a `version`) the file does not, and those must not read as drift. (b) The diff shows the UI-app block as `(changed)` and the upload proceeds. (c) "Already up to date" — neither key order nor placement order is a change.

### TC-12.5b — The pre-BEX-290 block shape is rejected with a migration hint
**Priority:** High
**Why this matters:** the deployed upload endpoint 200s on a top-level `context` and ignores it, and no longer reads `heading`/`subheading` at all — so an unmigrated config would upload "successfully" and render an app with no text and no record context. The CLI is the only layer that will report it.
**Steps:** For each, hand-edit `app-config.json` and run `brevo app upload`:
1. rename `label` back to `heading`
2. add a `subheading`
3. add a top-level `ui_app.context: ["recordId"]`
4. replace `surface_point_list` with a list of bare strings
**Expected:** Each fails before any network call, exit `1`, naming the field and the fix — (1) renamed to `ui_app.label`; (2) renamed to `ui_app.more_info`; (3) move it into each `surface_point_list` entry; (4) entries must be objects.

### TC-12.6 — Extension-point validation (the silent-failure guard)
**Priority:** High
**Why this matters:** the platform *drops* an unregistered slot name and the UI kit matches names by exact string equality — both silently. These rejections are the only place a bad name is ever reported.
**A slot has two names, and the authored one is the slug.** Each registry row carries a dotted `extension_point_name` (`contactDetails.headerMenu.action`) *and* a kebab-case `surface_point_name` slug (`contact-details-header-menu`), 1:1. The authored key is **`surface_point_name`** and it takes the **slug**. The dotted form is what renders and what every spec quotes, which makes it the natural thing to try — and authoring it is rejected. Watch for that specifically.

**The CLI no longer holds a list of valid slot names.** Local validation is deliberately *shape-only*; the registry is the sole authority, so an unregistered name passes locally and is rejected by the **server**. Do not expect "Unknown extension point" from the CLI — that local mirror was removed because a copy can only lag the registry, and it failed in both directions.

**Steps:** For each, set `ui_app.surface_point_list` and run `brevo app upload`:
1. `[{"surface_point_name":"contactDetails.headerMenu.action"}]` — the dotted name where the slug belongs
2. `[{"surface_point_name":"contact-header"}]` — a slug with no registry row
3. `[{"surface_point_name":""}]` — blank
4. `[{"surface_point":"contact-details-header-menu"}]` — the pre-rename key
5. `[]` — empty list
6. the same `surface_point_name` twice — duplicates
7. `[{"surface_point_name":"contact-details-header-menu","context":"recordId"}]` — context not an array
8. `[{"surface_point_name":"contact-details-header-menu","context":["recordId","recordId"]}]` — duplicated context field

**Expected:** Split by who rejects them.

- **Cases 1 and 2 reach the server** — they are well-formed strings, so the CLI sends them. The upload endpoint answers **400**, naming the offending slot(s) (`ui_app.surface_point_list contains unregistered extension point(s)`). Exit `1`. This is the intended division of labour, not a missing check.
- **Cases 3–8 fail locally**, before any network call, naming the field; exit `1`. (3) blank slot name; (4) entries must carry `surface_point_name` — the bare `surface_point` spelling is used nowhere and should be reported as an unrecognised entry shape; (5) at least one placement; (6) duplicate slots; (7)–(8) the offending entry's `context`.
- A **widget** slot is **accepted** for an action link — it renders as a card, so there is no kind rule to break.

### TC-12.7 — Deploy to an account, and the action link renders
**Priority:** High
**Preconditions:** TC-12.4 succeeded; a test account ID; the BEX-350 registry reseed has run.
**Steps:** `brevo app deploy <account-id>`, confirm the prompt. Open a contact record in that account and open the header **More** (•••) menu.
**Expected:** "App … deployed to account …". A menu entry appears **labelled with `ui_app.label`**, with `ui_app.more_info` as its second line, and clicking it opens the redirect link in a new tab, carrying that entry's `context` fields as **query parameters**. On a `.widget` slot the same app renders as a card whose title is the app name, whose description is `more_info`, and whose button is `label`. Then `brevo app rollback <account-id>` and confirm it disappears. **Note the sequencing:** labelling the menu entry from `label` is a frontend change — if the menu entry still shows the app name, check that the UI-kit change has shipped in your environment before filing it as a CLI defect.

### TC-12.8 — Multiple record pages from one app
**Priority:** Medium
**Steps:** `brevo app create`, choose **UI app**, tick **all three** record pages at the multi-select, finish the prompts, then upload and deploy.
**Expected:** `surface_point_list` has one entry per selected placement, covering all three `<location>.headerMenu.action` names, each with its own seeded `context`; the entry appears in the More menu on contact, deal **and** company records.

### TC-12.9 — Deploy refuses before an upload
**Priority:** High
**Steps:** In a UI-app project whose `app-config.json` has no `version` (or a freshly created, never-uploaded app), run `brevo app deploy <account-id>`.
**Expected:** Refuses with "Please first validate your configuration with `brevo app upload`"; exit `1`; nothing deployed.

### TC-12.10 — Roll back from an account, and idempotency
**Priority:** High
**Steps:** `brevo app rollback <account-id>` on a deployed app; then run it again.
**Expected:** First run: the app is rolled back from the account and the entry is gone from the record. Second run: reports the app is not deployed to that account and exits **`0`** (not an error). Under `--json`: `{"rolledBack": false, "reason": "NOT_DEPLOYED", …}`.

Note the second run relies on the uninstall route answering **404** for both "no such install" and "no such app" — it has no `installation_id` to delete by, so it cannot distinguish them. `rollback` therefore maps *any* 404 to this informational path. Do not treat a 404 here as a failure.

### TC-12.11 — Field validation and account-ID validation
**Priority:** Medium
**Steps:** (a) set `ui_app.redirect_link` to `http://example.com/x` and upload; (b) set it to `http://localhost:3000/x` and upload; (c) blank `ui_app.label` and upload; (d) set `ui_app.label` to 49 characters and upload; (e) set `ui_app.more_info` to 256 characters and upload; (f) add `ui_app.modal_iframe_url` and upload; (g) `brevo app deploy abc`; (h) `brevo app deploy` with no argument.
**Expected:** (a) rejected — must use https; (b) **accepted** (loopback exemption); (c) rejected — label cannot be empty; (d) rejected — at most 48 characters; (e) rejected — at most 255 characters; (f) rejected — only used by `iframeExtension`; (g) "not a numeric Brevo account ID". Rejections (a)–(g) exit `1` with no API call. Also check the prompts themselves reject (c)–(e) during `brevo app create`, before anything is written.

(h) is **not** an error: `[account-id]` is optional on both `deploy` and `rollback`. Omitted, the target resolves from the authenticated account — a plain account deploys into itself with no prompt (so `--json`/CI still work), a corporate account is offered a picker of its sub-accounts. Expect a successful deploy into your own account, not "Missing account ID". The explicit positional is still checked first and remains the only way to reach an account the listing won't show, notably a deactivated sub-account.

### TC-12.12 — A UI app cannot be created non-interactively
**Priority:** High
**Steps:** (a) `brevo app create --name "QA Link" --distribution private --json`; (b) the same command piped from `/dev/null` (non-TTY); (c) `brevo app create --type ui`; (d) `brevo app create --surface contact`.
**Expected:** (a) and (b) create an **OAuth** app without ever showing the app-type prompt — JSON reports `appType: "oauth"`, includes `redirectUri`, and has **no** `uiApp` key; no `ui_app` block is written to `app-config.json`. (c) and (d) fail with commander's `unknown option` and exit non-zero — neither flag exists. `brevo app create --help` lists neither, nor `--label`/`--more-info`/`--redirect-link`/`--link-target`.

### TC-12.13 — `app scaffold` in a UI-app project
**Priority:** High
**Steps:** From a UI-app project, hand-edit `ui_app.more_info`, then force drift (rename the app locally or on the server) and run `brevo app scaffold`, consenting to the refresh.
**Expected:** No feature-type prompt, no `src/oauth/` files, and a message that there are no features to scaffold. **Critically: the hand-edited `ui_app` block survives the refresh** — still present and unchanged in `app-config.json` afterwards.

### TC-12.14 — OAuth regression sweep
**Priority:** High
**Steps:** Create a private OAuth app end to end (`brevo app create` → accept the feature prompt → `yarn --cwd src/oauth` → `brevo app start oauth`), then `brevo app upload`.
**Expected:** Byte-for-byte the same experience as before this branch: redirect-URL prompts, four default scopes, `src/oauth/` scaffold, working OAuth flow, and an upload payload with **no** `snapshot` (and no `ui_app`) key. A public OAuth app must still get the PKCE scaffold.

---

## Sign-off

| Suite | Owner | Result (Pass/Fail) | Notes |
|-------|-------|--------------------|-------|
| 1 — create: private | | | |
| 2 — create: public | | | |
| 3 — create/scaffold split | | | |
| 4 — create guardrails/JSON | | | |
| 5 — upload | | | |
| 6 — status | | | |
| 7 — withdraw | | | |
| 8 — list/version | | | |
| 9 — backward compat/migration | | | |
| 10 — help layout | | | |
| 11 — cross-cutting/regression | | | |
| 12 — UI apps / action links | | | |

**Overall verdict:** ☐ Ready to merge  ☐ Blocked (see notes)
