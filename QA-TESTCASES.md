# QA Manual Test Cases — `features_set_public_cli`

Manual test suite for QA to verify the user-visible changes on the `features_set_public_cli`
branch before merge to `main`. Covers **public and private apps**, the new commands, and
**backward compatibility** (existing apps / older `app-config.json` files must keep working
after upgrading the CLI).

> This file is per-branch working state — delete it before merging to `main`
> (same rule as `TODO.md` and the `## Per-branch verification` section of
> `RELEASE-CHECKLIST.md`).

> **⚠️ Public apps are not available to end users yet**, so the shipped agent docs tell
> AI agents not to create them (see `RELEASE-CHECKLIST.md`). **That does not apply to
> QA.** Run the public-app cases below (create `--distribution public`, `app submit`,
> `app status`, `app withdraw`) as written. Those docs skip the restriction for accounts
> whose `brevo whoami` email ends in `@brevo.com` / `@sendinblue.com` — so **log in with
> an internal account** when testing these cases. On a non-internal test account an AI
> assistant will (correctly) push back; run the commands directly in that case. If an
> end-to-end path isn't live in your environment yet, note it on the case rather than
> skipping the whole section.

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
| **`--help`** | Root help is column-aligned; `status`/`withdraw` grouped under "App-review commands (public apps only)". |

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

### TC-5.1 — `brevo app update` is gone
**Priority:** High
**Steps:** `brevo app update --help` and `brevo app update`.
**Expected:** Unknown-command error (help lists no `update`). `brevo --help` shows `upload`, not `update`. Exit non-zero.

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
**Expected:** Payload has `app_version` (top-level), `name`, `logo_uri`, and `auth: { distribution_type, scopes, redirect_urls }`. Note: **`redirect_urls`** (not `redirect_uris`) and `distribution_type` nested under `auth`. For an **OAuth** app `ui_app` is never sent — the key must be absent, not `null`. (UI apps do send it; see section 12.)

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
**Steps:** Put `ftp://x` into `auth.redirectUrls`, run `brevo app upload`.
**Expected:** Friendly invalid-redirect error; no push.

### TC-5.11 — Success writes server-confirmed values back to `app-config.json`
**Priority:** High
**Steps:** Change the name locally, `brevo app upload --yes`, then inspect `app-config.json`.
**Expected:** File updated with server-confirmed name, logo, `distribution_type`, `version`, scopes, redirectUrls. `brevo app list` reflects the new name (cached-name masking may apply briefly).

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
  "auth": { "scopes": ["contacts_read"], "redirectUrls": ["https://example.com/cb"] }
}
```
**Steps:** `brevo app upload` (make no changes first, then a small change).
**Expected:**
- CLI reads it without error; treats distribution as `public`.
- After a successful `upload`, the file is **migrated** on write to a top-level `distribution_type: "public"`, with the stray top-level `distribution` key gone and `auth` reduced to `{ scopes, redirectUrls }`.
- No crash, no data loss.

### TC-9.2 — Interim `auth.type` shape migrates
**Priority:** High
**Preconditions:** `app-config.json` with the never-released interim shape:
```json
{ "appId": "42", "appName": "Interim", "auth": { "type": "public", "scopes": ["contacts_read"], "redirectUrls": ["https://example.com/cb"] } }
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
**Expected:** `brevo app status` and `brevo app withdraw` appear under a heading like **"App-review commands (public apps only):"**. `status` is present (regression guard). `upload` is listed; `update` is not.

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
**Expected:** They describe `upload` (no `--app-id`, only `--yes`/`--json`), `status`, `withdraw`, `--distribution public`, the create/scaffold split, and the `version` field — and do **not** mention `brevo app update`.

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

### TC-11.6 — No stale `app update` reference in agent docs (US-6)
**Priority:** High
**Steps:** `grep -n "app update" agent-context/AGENTS.md agent-context/SKILL.md`.
**Expected:** **No matches** — the removed `brevo app update` command is not mentioned in either file.

### TC-11.7 — Agent docs stay consistent with each other (US-6)
**Priority:** Medium
**Steps:** Compare the shared command surface, hard rules, version-check procedure, and exit codes between `AGENTS.md` and `SKILL.md`.
**Expected:** The two docs agree on the shared surface. Any intentional divergence (e.g. `AGENTS.md` branching by agent type because `SKILL.md` is Claude-only) is called out as intentional, not a drift.

---

---

## 12 — UI apps / action links (BEX-290)

> **⚠️ UI apps are not available to end users yet**, so the shipped agent docs tell AI
> agents not to create them. **That does not apply to QA** — same internal-account rule
> as the public-app note at the top of this file. Run these cases directly.
>
> These cases exercise two **assumed** backend contracts: the `ui_app` field names and
> the `deploy`/`remove` endpoints. If TC-12.4 or TC-12.7 fails with a 4xx, that is the
> expected failure mode of an unconfirmed contract, not a CLI bug — record the exact
> response and flag it against `RELEASE-CHECKLIST.md` → *Before UI-apps GA*.

### TC-12.1 — Interactive create asks for the app type first
**Priority:** High
**Preconditions:** Logged in; TTY; cwd has **no** `app-config.json`.
**Steps:** Run `brevo app create`.
**Expected:** After "App name:", the next prompt is "What type of app are you building?" with **OAuth app** and **UI app**. Choosing **OAuth app** reproduces the previous flow exactly (distribution → redirect URL → logo → scaffold prompt).

### TC-12.2 — UI-app trigger prompt shows unsupported options as disabled
**Priority:** Medium
**Steps:** `brevo app create`, choose **UI app**.
**Expected:** "What type of app are you integrating to Brevo?" lists **External link** as selectable, and **Modal card**, **Widget**, **Cloud function** as visibly disabled ("not yet supported"). They cannot be selected.

### TC-12.3 — UI-app create writes a `ui_app` block and no redirect URLs
**Priority:** High
**Steps:** Complete the UI-app flow (title, description ≤60 chars, external `https://` URL, action label).
**Expected:** A "UI app created" box shows type/record type/title/description/action label/external URL — and **no** `Redirect URL` lines. The generated `app-config.json` has a top-level `ui_app` object, `auth.scopes` of `["contacts:read","contacts:write"]`, and **no** `auth.redirectUrls`. It is valid JSON. No `src/oauth/` directory is created and no feature prompt appears.

### TC-12.4 — UI-app upload sends `ui_app` and is accepted
**Priority:** High
**Preconditions:** TC-12.3 done; ability to observe the request.
**Steps:** `brevo app upload` from the project directory.
**Expected:** The summary includes a `UI app:` block listing the fields. Payload carries `ui_app` alongside `app_version`/`name`/`logo_uri`/`auth`. The server **accepts** it; `Version:` is printed and written back to `app-config.json`. No redirect-URL error despite the config having none.

### TC-12.5 — Editing only `ui_app` is detected as a change
**Priority:** High
**Steps:** After a successful upload, change only `ui_app.properties.title` in `app-config.json`, then `brevo app upload`.
**Expected:** The diff shows the UI-app block as `(changed)` and the upload proceeds. It must **not** say "Already up to date". Reordering keys without changing values must report up to date.

### TC-12.6 — UI-app validation rejections
**Priority:** High
**Steps:** For each, edit `app-config.json` and run `brevo app upload`:
1. `description` of 61 characters
2. `trigger.externalUrl` set to `http://example.com` (plain http, non-loopback)
3. `properties.surface` set to `invoice`
4. `trigger.type` set to `modal`
5. `contextProperties` set to `[]`
**Expected:** Each fails before any network call with a specific message naming the field; exit `1`. `http://localhost:3000/...` must be **accepted** (loopback exemption).

### TC-12.7 — Deploy to an account, and the action link renders
**Priority:** High
**Preconditions:** TC-12.4 succeeded; a test account ID.
**Steps:** `brevo app deploy <account-id>`, confirm the prompt. Then open a contact record in that account.
**Expected:** "App … deployed to account …". The action link appears in the record's action menu with the configured label, opens the external URL in a **new tab**, and the URL carries the declared context properties.

### TC-12.8 — Deploy refuses before an upload
**Priority:** High
**Steps:** In a UI-app project whose `app-config.json` has no `version` (or a freshly created, never-uploaded app), run `brevo app deploy <account-id>`.
**Expected:** Refuses with "Please first validate your configuration with `brevo app upload`"; exit `1`; nothing deployed.

### TC-12.9 — Remove from an account, and idempotency
**Priority:** High
**Steps:** `brevo app remove <account-id>` on a deployed app; then run it again.
**Expected:** First run: "App … removed from account …", and the action link disappears from the record. Second run: reports the app is not deployed to that account and exits **`0`** (not an error). Under `--json`: `{"removed": false, "reason": "NOT_DEPLOYED", …}`.

### TC-12.10 — Account ID validation and missing argument
**Priority:** Medium
**Steps:** `brevo app deploy abc`; then `brevo app deploy` with no argument.
**Expected:** First errors with "not a numeric Brevo account ID"; second errors with "Missing account ID" and the usage line. Both exit `1`, neither calls the API.

### TC-12.11 — Non-interactive UI-app create
**Priority:** Medium
**Steps:** `brevo app create --type ui --name "QA Link" --title "QA Link" --description "QA action link" --external-url https://example.com/qa --json`; then the same without `--title`.
**Expected:** First succeeds; JSON includes `appType: "ui"` and a `uiApp` object, and **omits** `redirectUri`. Second errors asking for `--title, --description, and --external-url`.

### TC-12.12 — `app scaffold` in a UI-app project
**Priority:** High
**Steps:** From a UI-app project, hand-edit `ui_app.properties.description`, then rename the app on the server (or edit `appName` locally to force drift) and run `brevo app scaffold`, consenting to the refresh.
**Expected:** No feature-type prompt and no `src/oauth/` files. Reports that there are no features to scaffold. **Critically: the hand-edited `ui_app` block survives the refresh** — it must still be in `app-config.json` afterwards, unchanged.

### TC-12.13 — OAuth regression sweep
**Priority:** High
**Steps:** Create a private OAuth app end to end (`brevo app create` → accept the feature prompt → `yarn --cwd src/oauth` → `brevo app start oauth`), then `brevo app upload`.
**Expected:** Byte-for-byte the same experience as before this branch: redirect-URL prompts, four default scopes, `src/oauth/` scaffold, working OAuth flow, and an upload payload with **no** `ui_app` key. A public OAuth app must still get the PKCE scaffold.

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
