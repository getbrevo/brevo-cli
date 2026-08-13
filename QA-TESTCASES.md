# QA Manual Test Cases — `features_set_public_cli`

Manual test suite for QA to verify the user-visible changes on the `features_set_public_cli`
branch before merge to `main`. Covers **private (OAuth) apps**, the create/scaffold split,
`brevo app upload`, and **backward compatibility** (existing apps / older `app-config.json`
files must keep working after upgrading the CLI).

> This file is per-branch working state — delete it before merging to `main`, the same
> rule that applies to `RELEASE-CHECKLIST.md`'s `## Per-branch verification` section.
> Anything here that must outlive the branch belongs in `docs.md` first.

> **Suite numbers are sparse (1, 3, 4, 5, 8, 9, 10, 11, 13) and that is deliberate.** The
> public-app and UI-app suites — 2, 6, 7, 12, plus TC-5.13–5.16, TC-10.2/10.3 and TC-13.4 —
> were moved to their own plan, since those features are pre-GA and outlive any one branch.
> Renumbering what is left would break every reference to a case. Read a gap as "that case
> covers a pre-GA feature", not as a missing case.

> Everything here runs against **either** build — nothing in this file needs a preview
> build. `brevo app create` still asks `Distribution type?` and `What type of app are you
> building?` in a published build; it gates the **choices** down to `Private` only and
> `OAuth app` only, so a one-item list showing inquirer's `(Use arrow keys)` hint is
> expected, not a defect. Off a TTY and under `--json` neither question is asked.

---

## What changed on this branch (feature summary)

| Area | Change |
|------|--------|
| **BEX-250** | `brevo app update` **removed**; replaced by `brevo app upload` (pushes `app-config.json`, always shows a local-vs-server diff). |
| **App version** | Server `version` is tracked in `app-config.json`, shown in `create`/`list`, and **backfilled** into legacy configs on `upload`. |
| **create/scaffold split** | `create` writes only base files then offers to scaffold a feature; `scaffold` adds a feature into an already-created project and refreshes config against the server. |
| **Config migration** | `distribution_type` moved to a top-level key; legacy `distribution` / `auth.type` shapes are read and migrated on write. |
| **`--help`** | Root help is column-aligned. |

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
| `0` | Success (also: an up-to-date upload, a declined bootstrap offer) |
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
3. At `App logo URL (optional — leave blank to skip):` press Enter (the logo is asked
   **second**, before distribution — it moved there on 2026-08-13).
4. At the distribution prompt, select **Private**.
5. At `What type of app are you building?` select **OAuth app**.
6. Accept the default redirect URL (localhost callback) and answer `n` to "Add another
   redirect URL?".
7. Accept the default output directory.
8. At "Scaffold the Test OAuth App? (Y/n)" press Enter (yes).

**Expected:**
- Prompt order is **name → logo → distribution → app type → redirect → output directory**. Nothing else is asked in between.
- "App created" box shows App name, App ID, Client ID, `Client secret: [hidden …]`, Redirect URL(s), `Default scopes:` line, and — if the API returns one — an `App version:` line.
- Base project files + the OAuth feature files are written into `./qa-private-app`.
- Next-steps box includes a `cd qa-private-app` step (relative to where you started).
- `app-config.json` exists in the new directory with `"distribution_type": "private"`, `auth.redirectUris` (never `redirectUrls`), and no `cliVersion` / `permittedUrls` / `support` keys.
- Exit code `0`.

**Result:** ✅ Pass — 2026-08-13, published build, production account, real TTY. Order,
box contents (real 32-hex Client ID, one `Redirect URL 1` line, `App version: 0.0.1`,
four default scopes), `5 files` base + `6 files` feature, and the `cd <dir>` next-steps
box all as written. The single-choice distribution and app-type lists rendered with
inquirer's `(Use arrow keys)` hint — expected.

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

## Suite 3 — create → scaffold split & `brevo app scaffold`

### TC-3.1 — Decline the feature prompt → base files only
**Priority:** High
**Steps:** `brevo app create` interactively; at "Scaffold the Test OAuth App? (Y/n)" enter `n`. (The confirm names the one feature the CLI ships; the generic "Do you want to scaffold a feature?" wording only appears if a second feature is ever added.)
**Expected:**
- Only base project files are written (no `src/oauth/*`).
- A lighter next-steps box points at `brevo app scaffold` to add a feature later.
- Exit `0`.

### TC-3.2 — `brevo app scaffold` with no `app-config.json`, off a TTY → friendly error
**Priority:** High
**Preconditions:** `cd` into a directory with **no** `app-config.json`.
**Steps:** `brevo app scaffold --json`, and `brevo app scaffold < /dev/null` (non-TTY).
**Expected:** Friendly `CliError` (`APP_SCAFFOLD_NO_CONFIG`, not a raw stack); **no server
fetch**; exit `1`.

> **Narrowed 2026-08-13 — this case used to say plain `brevo app scaffold` errors.** It no
> longer does **on a TTY**: the bootstrap offer added on 2026-08-12 asks *"Set up a project
> for an app you already have?"* first, and declining exits **`0`**. The error is now the
> scripted path only, which is exactly the point of the offer being interactive-only. The
> TTY behaviour is TC-3.2b.

### TC-3.2b — bootstrap asks where to put the project
**Priority:** High
**Preconditions:** A TTY, logged in, at least one app on the account. `cd` into a directory with **no** `app-config.json` — ideally one that already holds other folders, e.g. the folder you keep your app projects in.
**Steps:** `brevo app scaffold`; accept the offer; pick an app; accept the default at `Output directory:`. Then repeat, answering `.` instead. Then repeat with `brevo app scaffold --app-id <id> --json`.
**Expected:** No *"What feature do you want to scaffold?"* list appears at any point — the CLI ships one feature, so it is named in a confirm (*"Scaffold the Test OAuth App? (Y/n)"*) that comes **after** the project is written and listed. Answering `n` leaves `app-config.json` and the base files on disk, writes no `src/oauth/*`, and exits `0`. The default is `./<the app's name, slugified>`. Accepting it creates that directory, writes **nothing** into the directory you started in, and the *Next steps* box opens with `cd <dir>` — verify your shell is still in the original directory afterwards, and that `cd <dir> && brevo app upload` works. Answering `.` writes into the current directory (an "already exists" prompt appears first — Merge keeps existing files) and the *Next steps* box has **no** `cd` step, starting at `1. yarn --cwd src/oauth`. The `--json` run asks **nothing** and writes into the current directory, with `directory` in its output pointing there — this is the scripted contract and must not move.

**Result:** ◐ Partial pass — 2026-08-13, preview build, production, real TTY. Ran twice
back to back from a folder holding other app projects. Both runs: the offer appeared
(*"No app-config.json in this directory, so there is no app to add a feature to."* → *"Set
up a project for an app you already have?"*), the picker listed the account's apps, the
default was `./<app name>` (`./test12`, `./test-pubic1`) and accepting it printed
`Creating <dir> and moving into it...`, wrote `5 files`, and **then** asked *"Scaffold the
Test OAuth App? (Y/n)"* — no feature *list* at any point, and the confirm came after the
base files were listed. Answering `n` left the base files and `app-config.json` on disk
with no `src/oauth/*` and exited `0`; answering `y` wrote the `6` feature files. The
*Next steps* box opened with `cd <dir>` both times, and **the shell was still in the
original directory afterwards** (the prompt stayed on `test1`). Not run: the `.`
answer, and the `--json` run.

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

**Result:** ◐ Partial pass — 2026-08-13. **Overwrite** only: in a project whose
`src/oauth/*` already existed, `brevo app scaffold` asked *"This feature already has files
in this project. What would you like to do?"* and Overwrite rewrote all `6` files, printing
the feature list and a *Next steps* box with **no** `cd` step (already in the project).
Merge, Cancel and `--overwrite` were not exercised.

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

**Result:** ✅ Pass — 2026-08-13. In a project linked to `test-pubic`, `brevo app create`
printed the refusal naming that app, mentioned `app-config.json`, and offered both exits
(move to a different directory, or run `brevo app scaffold` here to add a feature). No
prompt appeared.

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

**Result:** ◐ Partial pass — 2026-08-13. The **bare** `brevo app update` printed the full
removal message (names `brevo app upload`, lists the five dead flags, points at editing
`app-config.json`), and the root help listed `upload` with no `update` row. The other six
invocations in the step list were not run manually — they are covered against the built
artifact in `RELEASE-CHECKLIST.md`. Bonus confirmation that the interception is scoped:
`brevo app uplaod` still fell through to Commander's own `(Did you mean upload?)`.

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

**Result:** ✅ Pass (human path) — 2026-08-13. Immediately after a create: summary
printed, then `Already up to date at version 0.0.1.`, no confirm prompt. `--json` not
run.

### TC-5.5 — Confirm prompt on changes (interactive)
**Priority:** High
**Preconditions:** Local change vs server; TTY; no `--yes`/`--json`.
**Steps:** Run `brevo app upload`; at "Proceed with upload?" answer **No**, then rerun and answer **Yes**.
**Expected:** **No** → "Upload cancelled.", nothing pushed, exit `0`. **Yes** → "App uploaded." + `Version: …`, exit `0`.

**Result:** ◐ Partial pass — 2026-08-13. **Yes** confirmed three times (name change,
scope additions, logo), each printing `✓ App uploaded.` + the bumped `Version:`. The
**No** branch was not exercised.

### TC-5.6 — Non-TTY without `--yes`/`--json` → refuses
**Priority:** High
**Preconditions:** Local change vs server.
**Steps:** `echo "" | brevo app upload` (or run in CI/non-TTY).
**Expected:** Errors with "Cannot prompt for confirmation in non-interactive mode. Use --yes or --json to skip." No upload. Exit `1`.

### TC-5.7 — Outgoing payload contract
**Priority:** High
**Preconditions:** Ability to observe the request (proxy/network log) OR verify via server state.
**Steps:** Make a change and `brevo app upload --yes`.
**Expected:** Payload has `version`, `name`, `logo_uri`, and `distribution_type` all top-level, plus `auth: { scopes, redirect_uris }`. Note: **`version`** (not `app_version`) and `distribution_type` at the top level, not under `auth` — the same structure `POST /apps` sends at create. For an **OAuth** app `ui_app` is never sent — the key must be absent, not `null`.

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

**Result:** ◐ Partial pass — 2026-08-13. Confirmed indirectly and reliably: each upload's
bumped version became the *base* version of the next run's summary (`0.0.2` → `0.0.3` →
`0.0.4`), and name / scopes / logo each stopped appearing as drift once uploaded. The
file itself was not inspected in that run, and `brevo app list` was not run.

### TC-5.12 — Server rejection propagates
**Priority:** Medium
**Preconditions:** Force a server-side rejection if possible (e.g. outdated version).
**Steps:** `brevo app upload --yes`
**Expected:** Error surfaced; exit `1` (non-zero). No silent success.

**Result:** ✅ Pass — 2026-08-13, with the version case. `version` hand-edited to `0.0.2`
while the server held `0.0.1`: the summary showed `Version: 0.0.1 → 0.0.2`, the upload
was confirmed, and the platform answered *"app version is outdated; pull the latest
version of the app before uploading"*. Non-zero, nothing written; reverting the file to
`0.0.1` uploaded cleanly.
> **Two rough edges recorded, not defects for this case:** the summary presents
> server-owned `version` as an authored field, and the server's copy tells the user to
> "pull the latest version", which is not a command this CLI has. Tracked in
> `RELEASE-CHECKLIST.md` → *Manual QA sweep*.

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
**Steps:** Run a command that reads config from that directory (e.g. `brevo app credentials` with no `--app-id`).
**Expected:** No unhandled exception / raw stack trace. `readProjectConfig` returns null gracefully; the command falls back (picker) or errors with a friendly message.

### TC-9.8 — Hand-edited comma-separated scopes are split
**Priority:** Low
**Preconditions:** `auth.scopes` contains a single string like `"contacts_read, campaigns_read"`.
**Steps:** `brevo app upload`.
**Expected:** Read as two scopes; upload proceeds (charset validation still enforced at upload).

### TC-9.9 — Numeric `appId` from legacy config accepted
**Priority:** Low
**Preconditions:** `app-config.json` with `"appId": 42` (a **number**, not a string).
**Steps:** `brevo app upload` / `brevo app credentials` from that dir.
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

**Result:** ✅ Pass — 2026-08-13, on both builds. `brevo`, `brevo -h` and `brevo --help` render identically.

---

## Suite 11 — Cross-cutting / regression

### TC-11.1 — Global `--json` cleanliness
**Priority:** High
**Steps:** Run each command with `--json` and pipe to `jq .`: `create`, `list`, `upload`, `credentials`, `scaffold`.
**Expected:** Each emits a **single** parseable JSON document with **no** human log lines, spinners, or prompts mixed in. `jq` parses without error.

### TC-11.2 — No secrets leak in output
**Priority:** High
**Steps:** Review `create` / `credentials` human + JSON output.
**Expected:** Client secret shown as `[hidden …]` (human) / `[hidden]` (JSON) unless `--reveal-secret` is explicitly used. No API keys, refresh tokens, or credential-file contents printed.

**Result:** ✅ Pass (human path) — 2026-08-13. The created-app box and `brevo app
credentials` both printed `Client secret: [hidden — run \`brevo app credentials
--reveal-secret\`]`. `--reveal-secret` additionally asked *"Are you sure you want to
reveal the client secret?"* before printing it. JSON path not run.

### TC-11.3 — Automated suite green
**Priority:** High
**Steps:** `yarn test && yarn lint && yarn build`
**Expected:** All pass on the branch (baseline before manual sign-off).

### TC-11.4 — Docs match behaviour
**Priority:** Medium
**Steps:** Skim `agent-context/AGENTS.md` and `agent-context/SKILL.md`.
**Expected:** They describe `upload` (no `--app-id`, only `--yes`/`--json`), the create/scaffold split, and the `version` field — and, per BEX-405, **only** what a published build ships, so no `status` / `submit` / `withdraw` / `deploy` / `rollback` and no `--distribution public`. `brevo app update` appears **only** as removed — the migration note pointing at `upload` — never as a command an agent could run.

### TC-11.5 — Agent docs cover the full current command surface (US-6)
**Priority:** High
**Steps:** In both `agent-context/AGENTS.md` and `agent-context/SKILL.md`, confirm each of these is documented:
- `brevo app upload` replacing `brevo app update` (BEX-250)
- the `--overwrite` flag on `scaffold`
- the `version` field
- `brevo app available-scopes`

**Expected:** Every item above is present in **both** files. Exit criteria is a documentation review, not a command run.

> The pre-GA commands (`status`, `submit`, `withdraw`, `deploy`, `rollback`) and
> `--distribution public` were removed from this list on purpose — BEX-405 deleted their
> reference text from both docs, because a published build does not ship them. Finding them
> documented is now the failure, not the pass. Restoring them is a GA step, tracked in the
> pre-GA `RELEASE-CHECKLIST.md`.

### TC-11.6 — `app update` appears in agent docs only as removed (US-6)
**Priority:** High
**Steps:** `grep -n "app update" agent-context/AGENTS.md agent-context/SKILL.md`.
**Expected:** Matches **only** inside the migration note in each file — `AGENTS.md`'s *There is no `brevo app update`* bullet under **Conventions**, and the tail of `SKILL.md`'s *"Update app metadata"* decision-tree row. Both say it was removed, name `brevo app upload` as the replacement, and describe the `exit 1` / nothing-uploaded behaviour.

> **Why this changed:** this case previously expected **no matches at all**. The command is now registered hidden purely to print a signpost, so an agent that meets a stale `brevo app update` in a user's script needs to recognise the `exit 1` and know the fix. What must stay absent is the command presented as *usable* — no command-table row, no example, no decision-tree entry recommending it. Grep hits are fine; a hit that reads like an instruction to run it is a fail.

### TC-11.7 — Agent docs stay consistent with each other (US-6)
**Priority:** Medium
**Steps:** Compare the shared command surface, hard rules, version-check procedure, and exit codes between `AGENTS.md` and `SKILL.md`.
**Expected:** The two docs agree on the shared surface. Any intentional divergence (e.g. `AGENTS.md` branching by agent type because `SKILL.md` is Claude-only) is called out as intentional, not a drift.

### TC-11.8 — `brevo app available-scopes`, terminal and `--web`
**Priority:** Medium
**Why it's here:** the command is on the root help screen and in both agent docs but had
no case; added 2026-08-13 after it was exercised.
**Steps:** `brevo app available-scopes`, then `brevo app available-scopes --web`, then
`Ctrl+C`. Also `brevo app available-scopes --json | jq .`.
**Expected:** Scopes printed grouped by category (`account`, `campaigns`,
`contacts_crm`, `conversations`, `custom_objects`, `ecommerce`, `events`, `loyalty`,
`transactional`), followed by the "edit `auth.scopes` … then `brevo app upload`" hint and
the two docs links. `--web` prints the same listing **and** serves the catalog on a
`http://127.0.0.1:<port>/` loopback URL (loopback http is deliberate, not a defect), and
`Ctrl+C` shuts it down with "Received SIGINT, shutting down." and exit `0`. `--json`
emits one parseable document with no human lines.

**Result:** ◐ Partial pass — 2026-08-13. Human and `--web` paths both as written,
including the clean SIGINT shutdown. `--json` not run.

---

## Suite 13 — commands with no prior coverage (`init`, `credentials`, `delete`)

> Added 2026-08-13. These three ship in the CLI and had **no test case anywhere in this
> file**, yet two of them are destructive or credential-revealing and `init` is the
> command the docs point a new user at first. All three were exercised in the second sweep;
> the cases are written from what was observed so the expectations are now pinned.
> (`brevo app submit`, the fourth, is a public-app command and its case moved with them.)

### TC-13.1 — `brevo app init` runs the whole guided setup
**Priority:** High
**Preconditions:** Authenticated; TTY; run from a directory with no `app-config.json`.
**Steps:** `brevo app init`, answer the prompts through to the feature confirm.
**Expected:** A `Brevo CLI — Quick Setup` header, then `✓ Already authenticated.` when a
session exists (it must **not** re-run the browser login), then `Step 2: Create your first
app` and the ordinary `app create` prompt sequence — name → logo → distribution → app type
→ redirect → add-another → output directory. The created-app box, base-file list, feature
confirm and *Next steps* box are the same ones `app create` prints. Exit `0`.

**Result:** ✅ Pass — 2026-08-13, preview build, production. Exactly as above, for a
**public** OAuth app: the auth step short-circuited to `✓ Already authenticated.`, prompt
order held, and the run ended at the *Next steps* box (`cd` → install → `brevo app start
oauth`) plus the scopes tip and the `All set!` line. The app-created box carried a real
32-hex Client ID, `[hidden …]` secret and `App version: 0.0.1`.

### TC-13.2 — `brevo app credentials` hides the secret until asked twice
**Priority:** High
**Steps:** `brevo app credentials`, then `brevo app credentials --reveal-secret`.
**Expected:** Without the flag, `Client secret: [hidden — run \`brevo app credentials
--reveal-secret\`]`. With it, a confirm prompt (*"Are you sure you want to reveal the
client secret?"*) gates the value — the flag alone is not enough. Both print App name, App
ID, Client ID, Scopes and numbered `Redirect URL n:` lines. Exit `0`.

**Result:** ✅ Pass — 2026-08-13. Both forms run against an app chosen from the picker
(whose choice line itself shows App ID + Client ID, never the secret). The 64-hex secret
appeared **only** after the flag *and* the confirm. Ten scopes and one redirect URL
rendered on the aligned rows.

### TC-13.3 — `brevo app delete` offers to remove the local project too
**Priority:** High
**Preconditions:** A disposable app, ideally with a local project directory linked to it.
**Steps:** `brevo app delete` from inside that project; confirm both prompts.
**Expected:** App picker → a confirm naming the app **and** its ID and stating
`This cannot be undone.` (default must not be destructive) → `✓ App <id> deleted.` Then a
**second, separate** prompt offering to delete the local project folder, printing its
**absolute path**; confirming prints `✓ Project folder deleted: <path>`. Declining the
second must leave the folder. Exit `0`.

**Result:** ◐ Partial pass — 2026-08-13. Both prompts appeared in that order with the app
name + ID in the first and the absolute path in the second, and both confirmations
completed with the two `✓` lines. **Not verified:** declining the folder prompt, the
default answers, `--force`, `--json`, and deleting from outside a linked project.

---

## Sign-off

Cases carrying a **Result:** line were run on 2026-08-13 against **production** on a real
TTY, across **two sweeps**:

- **Sweep 1** — a **published** build: the OAuth happy path (`login` → `create` → `start
  oauth` → `upload` ×4), `available-scopes`, `credentials`, both help screens. It ran one
  commit behind `HEAD`, so the logo prompt still showed the pre-`b75315c` long form.
- **Sweep 2** — a **preview** build: `app init`, `delete`, and `scaffold` in **both** modes.
  (Its public-app and UI-app coverage is recorded in the pre-GA plan, not here.)

A Result line says which build it ran on when it matters.

| Suite | Owner | Result (Pass/Fail) | Notes |
|-------|-------|--------------------|-------|
| 1 — create: private | Piyush | ◐ Partial pass | TC-1.1 ✅. TC-1.2–1.5 (flags, `--logo-uri`, bad values) not run — **no non-interactive create has been run at all**, in either sweep. |
| 3 — create/scaffold split | Piyush | ◐ Partial pass | TC-3.2b ✅ both branches (decline leaves base files + exit `0`; accept writes the feature), TC-3.5 **Overwrite** ✅. TC-3.2 narrowed to the non-TTY path and **not** re-run; Merge/Cancel/`--overwrite`, TC-3.3, TC-3.4 (drift refresh) and TC-3.6 (`--json`) not run. |
| 4 — create guardrails/JSON | Piyush | ◐ Partial pass | TC-4.1 ✅ (already-linked directory refuses with no prompt). TC-4.2–4.4 not run — still **no `--json` or non-TTY coverage anywhere**. |
| 5 — upload | Piyush | ◐ Partial pass | TC-5.1 (bare), 5.4, 5.5 (yes-branch), 5.11 (indirect), 5.12 ✅, plus the distribution-immutability refusal. `--json`, `--yes` and non-TTY not run. |
| 8 — list/version | | | Not run. |
| 9 — backward compat/migration | | | Not run — no legacy fixtures exercised. **Still the highest-value gap**: it is the only suite whose failures land on existing users. |
| 10 — help layout | Piyush | ✅ Pass | TC-10.1 confirmed on **both** builds. |
| 11 — cross-cutting/regression | Piyush | ◐ Partial pass | TC-11.2 (human) ✅ twice, TC-11.8 ✅. TC-11.1 (`--json` cleanliness) not run; doc cases 11.4–11.7 are a review, not a run. |
| 13 — init/credentials/delete | Piyush | ◐ Partial pass | TC-13.1 ✅, TC-13.2 ✅, TC-13.3 ◐. New suite — these commands had no coverage before 2026-08-13. |

**Overall verdict:** ☐ Ready to merge  ☑ Not yet signed off.

What the two sweeps establish: a private app can be created, scaffolded and uploaded end
to end, and the OAuth flow completes a real token exchange.

What still blocks sign-off, in priority order:

1. **Suite 9 (backward compatibility) has not been touched.** Highest user-facing risk
   and it needs no special account — only hand-written fixtures.
2. **No `--json` / non-TTY path has been run in either sweep** (TC-3.6, 4.2, 4.3, 5.6,
   11.1). This is the scripted contract; it is also the cheapest gap to close.
3. **No non-interactive create has been run at all** (TC-1.2–1.5), so the whole flag
   surface of `app create` is unexercised.
