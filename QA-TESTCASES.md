# QA Manual Test Cases — public apps

Manual test suite for public app distribution (BEX-405, **GA**): the review
lifecycle (`app status` / `app submit` / `app withdraw`) and `--distribution public`. It
sits at this branch's root alongside `docs.md` — **branch-local, never merge into
`main`** (see `CLAUDE.md`). `RELEASE-CHECKLIST.md` and `PUBLIC-APPS-RELEASE-STATUS.md`
were here too until public apps shipped; both were worked through and deleted. The public-apps halves of the working docs
moved here from the retired `docs/public-cli-ui-apps-feature-changes` branch on
2026-08-24; the UI-apps halves (Suite 12 included) live on `feat/bex-416-entry-size`.

> **Suite and case numbers are unchanged from the original combined plan**, which is why
> they are sparse here (2, 5.13–5.16, 6, 7, 10.2–10.3, 13.4). Renumbering would break
> every reference to a case in commit messages, PRs and `docs.md`. Suite 12 (UI apps)
> lives on `feat/bex-416-entry-size`; the private-app half was per-branch scratch on
> `features_set_public_cli`, recoverable from its history
> (`git show abedd75^:QA-TESTCASES.md`).

> **⚠️ Entry condition changed at GA — re-read before running any suite.** Every case
> here used to require `PREVIEW=1 yarn link:dev`, because the commands were eliminated
> from a published build and `--distribution public` was refused. **That is no longer
> true: `yarn link:dev` runs every suite below, and it is the only build there is** — the
> pre-GA gate was torn down after GA, so `PREVIEW=1` and `build:preview` no longer exist.
> Any case whose expected result was "refused" or "unknown command" on a published build
> is stale: those were assertions about the gate, not about the feature.
>
> **The recorded sweep results below were all taken on the old `PREVIEW=1` artifacts.**
> Those builds differed from the published one by a single unreachable byte, so the
> observations still stand, but re-baselining the sweep once is tracked in `docs.md`.
>
> **The distribution question offers both values now.** `Distribution type?` is asked in
> every build and lists `Private` then `Public`, with `Private` first so a bare Enter
> still selects the conservative default. A one-item list (the old gated behaviour) is
> now a defect, not expected. Off a TTY and under `--json` the question is not asked and
> the value defaults to `private`.
>
> If an end-to-end path isn't live in your environment yet, note it on the case rather
> than skipping the whole section.

---

## What these suites cover

| Area | Change |
|------|--------|
| **BEX-252** | `brevo app status` — shows an app's review status as a coloured card. |
| **BEX-253** | `brevo app withdraw` — withdraws an app from submission. |
| **Public apps** | `brevo app create --distribution public`; interactive picker offers Public. |
| **US-2** | `brevo app upload` is blocked while an app is `Submitted` / `In Review`. **Server-side only — there is no CLI-side check.** Verified absent in `src/commands/app/upload.ts`; if this case passes, the platform is enforcing it. Do not record a CLI refusal here. |
| **BEX-405** | Public apps are **GA**: `--distribution public` is accepted and all three review commands ship in the published bundle. The build now asserts they are *present* (`GA_MARKERS`) rather than absent. |
| **TC-6.3 fix** | `brevo app submit` refuses a never-uploaded app locally, naming the real cause, instead of relaying the server's misleading four-field message. `brevo app status` still relays it — see `docs.md`. |

---

## Test environment & global preconditions

- **Node.js** ≥ 20.15.0, **Yarn** ≥ 1.19.1.
- **Build the binary** — one build runs every suite here; there is no `PREVIEW=1` variant
  any more (the gate that needed one is gone):
  ```bash
  yarn install && yarn link:dev
  brevo --version    # confirm the branch build is on PATH
  brevo app --help   # status / submit / withdraw must all be listed
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

## Suite 2 — `brevo app create`: public apps

> **⚠️ Entry condition changed at GA — read before running this suite.** Public
> distribution *was* gated at build time: a published build refused
> `--distribution public` with *"That command is not available yet…"*, exit `1`, and
> asked the distribution prompt with `Private` as its only choice. **All of that is
> gone.** A plain build accepts `--distribution public` and offers both choices, so:
>
> - TC-2.1's correct result is **an app**, on any build. A refusal is now a defect.
> - TC-2.4 (the refusal path) no longer has a CLI-side trigger. What remains is the
>   *server's* refusal for an account without `app-store-bo-be-public-apps` — still worth
>   testing, but the expected error is the platform's, relayed as `ERR_UI_APP_NOT_ENABLED`
>   or a `400`, not the CLI's unreleased-feature message.
> - There is one build, so nothing in this suite depends on which one you have.
>
> The platform used to refuse public creates from the CLI independently of the build, so
> even a preview build could hit the server's own rejection. That was lifted before GA —
> public creates are accepted on production for every account — which is what makes
> TC-2.1 a live end-to-end case rather than a preview-only one. TC-2.4 still needs an
> account the flag was never rolled out to, if one can still be found.

### TC-2.1 — Create a public app with the flag
**Priority:** High
**Preconditions:** Authenticated; empty directory.
**Steps:** `brevo app create --name "QA Public App" --distribution public`
**Expected:**
- **No "coming soon"/unavailable error** and no early exit before the API call.
- App is created as **public**; API receives `distribution_type: "public"`.
- `app-config.json` records `"distribution_type": "public"`.
- Exit `0`.

> **Account-dependent.** The platform allows a CLI public create only for accounts
> carrying the `app-store-bo-be-public-apps` flag. On an account **without** it the
> correct result is the mapped refusal (TC-2.4 / `APP_CREATE_PUBLIC_REJECTED`), not an
> app — record which kind of account you ran on.

**Result:** ✅ Pass — 2026-08-13, preview build, internal production account (flag
enabled). Evidence is the written project: `distribution_type: "public"` and
`version: "0.0.2"`, i.e. created *and* uploaded. Not re-run on a flag-less account, so
the refusal half is untested.

### TC-2.2 — Public is selectable in the interactive picker
**Priority:** High
**Steps:** Run `brevo app create` interactively; at the distribution prompt inspect the choices.
**Expected:** Two choices — **Private** and **Public** — both selectable (Public is **not** disabled/greyed as "coming soon"). Selecting Public creates a public app.

### TC-2.3 — Public app appears correctly in `list`
**Priority:** Medium
**Steps:** After TC-2.1, `brevo app list --json`.
**Expected:** The public app is present with the public distribution reflected in server data.

### TC-2.4 — The platform's own refusal is explained, not dumped
**Priority:** High
**Why it's here:** the preamble above has always pointed at TC-2.4; the case itself was
missing. Added 2026-08-13.
**Preconditions:** An account **without** the
`app-store-bo-be-public-apps` flag — i.e. the opposite of TC-2.1's precondition. The two
cases are mutually exclusive on any one account.
**Steps:** `brevo app create --name "QA Public Refused" --distribution public`, then the
same with `--json`.
**Expected:** The CLI **still attempts the create** (it deliberately does not mirror the
platform's per-account policy locally), then translates the `400`: a lead line saying
public apps can't be created from the CLI yet, a `Do this:` line naming
`--distribution private`, a `Note:` that `distribution_type` is fixed at creation, and a
`Brevo said:` line quoting the server verbatim. Exit non-zero. Under `--json`, the same
text arrives inside the single `{"error": {…}}` document on stdout. An unrelated `400` on
a public create must keep its own text — the translation is narrowed to messages naming
`distribution_type`.

---

## Suite 5 (public-app subset) — `brevo app upload` under review states

> The rest of Suite 5 — the diff, the confirm prompt, the payload contract, the legacy-scope
> and redirect-URL refusals — is private-app behaviour and stays in the feature branch's
> `QA-TESTCASES.md`. Only the four review-state cases are here, because only a public app
> has a review state.

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
**Preconditions:** A public app in a non-blocking state (e.g. `draft`, `changes_requested`, `rejected`, `approved`) or a private app with no review state; a local change vs the server.
**Steps:** `brevo app upload --yes`
**Expected:** The state check passes through; the normal upload flow runs (diff shown, then push); "App uploaded." + `Version: …`; exit `0`. Confirms the block is scoped to `Submitted`/`In Review` only.

---

## Suite 6 — `brevo app status`

### TC-6.1 — Status via `--app-id`
**Priority:** High
**Steps:** `brevo app status --app-id <APP_ID>`
**Expected:** An aligned card: bold **App status** title, a `─` rule, a coloured icon + label, then the message indented under the label. Exit `0`.

**Result:** ✅ Pass — 2026-08-13, preview build, on a public app resolved from the linked
`app-config.json` (no `--app-id`, so this covers TC-6.5 case 1 too). Rendered exactly as
written: bold `App status`, the `─` rule, `◇ Configured`, and *"Your app is set up but
hasn't been submitted for review yet."* indented under the label. Ran **after** an upload
— before one it fails, see TC-6.3.

### TC-6.2 — State → tone/label mapping
**Priority:** Medium
**Steps:** Inspect status for apps in different states (use whatever states your test account can reach).
**Expected (label / colour / icon):**
- `approved` → "Approved" / green ✓
- `rejected` → "Rejected" / red ✗
- `changes_requested` → "Changes Requested" / yellow ⚠
- `in_review` → "In Review" / yellow ◐
- `submitted` → "Submitted" / blue ◔
- `draft` → "Draft" / cyan ◇  ← **renamed from `configured` on the wire by BEX-382** (clean rename, no alias; the server migration renamed every existing row). A card reading *Configured* means the CLI is talking to a backend that predates the rename.
- unknown/other → gray ○
Messages match the canned copy per state (e.g. `submitted` → "Your app has been submitted and is waiting to be reviewed.").

### TC-6.3 — Empty/missing state → friendly "Unknown"
**Priority:** High
**Preconditions:** An app with no review state (e.g. a private app never submitted).
**Steps:** `brevo app status --app-id <APP_ID>`
**Expected:** Header "App status: Unknown"; message "Status information isn't available for your app yet. Make sure your app is public and has been uploaded with `brevo app upload`." Exit `0`.

**Result:** ✗ **Fail — 2026-08-13. A never-uploaded app does not reach this path at all.**
On a public app freshly created by `brevo app init` and not yet uploaded, both
`brevo app status` and `brevo app submit` printed a **raw server message**:

```
✗ Please ensure your app is correctly configured with the following required data: name, logo_uri, scopes and redirect_uris
```

Not the friendly Unknown card. The cause is that `statusCommand` only reaches its
`state ?? 'unknown'` normalization when `fetchAppState` **resolves** — here
`GET` the state endpoint *rejects*, so `withCommandHandler` surfaces the `ApiError`
copy verbatim and the card never renders. Two separate problems:

1. **The message is unmapped.** It is server copy reaching the user directly, which
   `src/lang/en.ts` exists to prevent. Nothing in `apiCodeMessages` covers it.
2. **The message is misleading** — it names four fields that were all present (the
   upload summary immediately afterwards showed a name, a server-defaulted
   `logo_uri`, four scopes and one redirect URI). The real precondition is *"has never
   been uploaded"*, i.e. the app has no `app_versions` row for the state endpoint to
   read. Running `brevo app upload` once made the same command answer `◇ Configured`.

**So TC-6.3 as written is unreachable via "never submitted"** — the app must be
*uploaded* but unsubmitted, which is the `draft` state (TC-6.1, recorded above as
`configured` before BEX-382 renamed it), not `unknown`.

**Resolved for `app submit`, still open for `app status`.** The precondition was the
wrong half of the diagnosis: the real cause is the absent `app_versions` row, and the
server's copy for that failure names four fields that can all be present. `app submit`
now refuses locally on the certain signal — an app with no `version` has never been
uploaded — before the review-state read happens at all (`APP_SUBMIT_NOT_UPLOADED`).
`app status` reads the state directly and never fetches the app, so it still relays the
server text; closing that needs the server's error `code` and HTTP status from a live
repro, then one line in `apiCodeMessages`. Tracked in `docs.md`. Exit code was not
captured (`echo $?` not run) — it is whatever
`ApiError` maps to, not the documented `0`. Tracked in the sweep entry in
`RELEASE-CHECKLIST.md`.

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

## Suite 10 (public-app subset) — `brevo --help` layout

> TC-10.1 (column alignment) was build-agnostic, private-half scratch (dropped with that
> half — recover from `features_set_public_cli` history). These two
> cases are the ones that read the gate: run them on **both** builds, since the useful
> assertion is the difference between them.

### TC-10.2 — Public-app command grouping
**Priority:** Low
**Steps:** `brevo --help`.
**Expected:** `brevo app submit`, `brevo app status` **and `brevo app withdraw`** all appear under **"App-review commands (public apps only):"**, in that order. `app create` advertises `--distribution private|public`. `upload` is listed; `update` is not. There is one build, so there is nothing to compare against — the `PREVIEW=1` artifact this case used to be run twice for no longer exists.

**Result (predates both GA flips and the `install`/`uninstall` rename — re-baseline
needed):** ✅ Pass — 2026-08-13, both builds. **Preview:** the *App-review commands
(public apps only)* heading carried `status` + `submit` and no `withdraw` (TC-10.3), the
then-gated UI-apps heading carried `deploy` + `rollback`, and `app create` advertised
`--distribution private|public`. **Published:** both headings and all four commands were
absent, and `app create` read `--distribution private` / *"Create a new OAuth app"*.

**That build-to-build difference no longer exists** — it was the whole thing this case
measured, and public-apps GA removed it. Re-baseline the case as written above: one
expected screen, asserted on either build, with `withdraw` now listed.

### TC-10.3 — `withdraw` is advertised on both help screens
**Priority:** Medium
**Steps:** `brevo --help`, then `brevo app --help`, then `brevo app withdraw --help`.
**Expected:** `withdraw` appears on **both** screens — the hand-aligned root screen (under *App-review commands*) and Commander's generated `brevo app --help`. `brevo app withdraw --help` prints its own usage (`Usage: brevo app withdraw [options]`) with `--app-id`, `--force` and `--json`, exit `0`.

**Inverted at GA.** This case used to assert the opposite: `withdraw` carried
`hidden: true` while the review lifecycle was being finished, so it was callable but
advertised nowhere. Both suppressions are gone — the flag, and the matching hand-made
omission in `formatRootHelp`. **Check both screens, not one:** Commander's `hidden`
governs only its own output and cannot reach the root screen's string, so the two are
independent and a half-done change is exactly what this case catches.

---

## Suite 13 (public-app subset) — `brevo app submit`

> TC-13.1–13.3 (`init`, `credentials`, `delete`) were build-agnostic, private-half scratch
> (dropped with that half — recover from `features_set_public_cli` history). `app submit`
> is a public-app command, eliminated from a published build.

### TC-13.4 — `brevo app submit` previews the config and opens the form
**Priority:** High
**Preconditions:** A **public**, uploaded app (see TC-6.3 — a never-uploaded app fails
first). Preview build.
**Steps:** `brevo app submit` from the linked project.
**Expected:** `No configuration mismatch detected.` when the local config matches the
server, then the full config preview (App ID, Name, Distribution, Redirect URLs, Scopes,
Logo URL, Version), then `Submit this app for review?`. Confirming opens a browser tab and
prints the form URL plus the caveat that **the app is only submitted once the form is
completed** and that `brevo app status` tracks it. Exit `0`.

**Result:** ◐ Partial pass — 2026-08-13, preview build. As written, twice in a row. Note
what this means and what it does not: `app submit` is a **signpost to a Google Form**, not
an API submission, so it is idempotent and repeatable and never moves the app's state —
`brevo app status` still reported `◇ Configured` after it. **The mismatch branch was not
exercised** (no drift was introduced), and the form was not completed, so no `submitted` /
`in_review` state was ever reached — which is why TC-5.13–5.16, TC-6.2's later states and
all of Suite 7 remain unrunnable on this account.

---

## Sign-off

Cases carrying a **Result:** line were run on 2026-08-13 against **production** on a real
TTY, in **sweep 2** of the two manual sweeps run on `features_set_public_cli` — a
**preview** build covering `app init` on a public app, `status`, `submit`, `delete`, and
`scaffold` in both modes. (Sweep 1 was a published build and exercised the OAuth happy
path only, so it contributes nothing here except the published half of TC-10.2. The same
sweep's UI-app results live with Suite 12 on `feat/bex-416-entry-size`.)

A Result line says which build it ran on when it matters. Nothing here is signed off.

| Suite | Owner | Result (Pass/Fail) | Notes |
|-------|-------|--------------------|-------|
| 2 — create: public | Piyush | ◐ Partial pass | TC-2.1 ✅ — created live on a preview build + flag-enabled account, then uploaded to `0.0.2`. TC-2.4's refusal path still untested (needs an account **without** `app-store-bo-be-public-apps`); TC-2.2 / TC-2.3 not run. |
| 5 (subset) — upload under review | | **Blocked** | TC-5.13–5.16 not runnable on this account — see Suite 7. |
| 6 — status | Piyush | ✗ **Fail** (partly fixed at GA) | TC-6.1 ✅ (`◇ Configured` — **note the state is `Draft` now**, BEX-382 renamed it on the wire; aligned card, resolved from the linked config — also TC-6.5 case 1). **TC-6.3:** the `app submit` half is **fixed** — a never-uploaded app is refused locally naming the real cause, before the review-state read. The `app status` half still fails: it reads the state directly, so the raw misleading server message still reaches the user. Closing it needs the server's error `code` + HTTP status from a live repro, then one line in `apiCodeMessages` — tracked in `docs.md`. TC-6.2's other states, 6.4 (`--json`) and 6.6 (colour) not run. |
| 7 — withdraw | | **Blocked** | Not run, and **not runnable on this account**: `app submit` only opens a Google Form, so no app can be driven into `submitted`/`in_review` from the CLI. Reaching Suite 7 (and TC-5.13–5.16, and TC-6.2's review states) needs the form completed or the state set server-side. |
| 10 (subset) — help layout | Piyush | ✅ Pass | TC-10.2 / 10.3 confirmed on **both** builds, which is what makes the BEX-405 elimination visible. |
| 13 (subset) — submit | Piyush | ◐ Partial pass | TC-13.4 ◐ — ran twice, but the mismatch branch was not exercised and the form was never completed. |

**Overall verdict:** ☐ Ready for GA  ☑ Not yet signed off.

What sweep 2 establishes: a public app can be created, uploaded and previewed for
submission end to end.

What still blocks sign-off, in priority order:

1. **TC-6.3 is a confirmed failure** — an unmapped, misleading server message on a
   never-uploaded app. It needs a decision (map the message, or fix the case's
   precondition and delete the dead empty-state path).
2. **Suite 7 and TC-5.13–5.16 are blocked, not merely unrun** — they need a submitted
   app, which the CLI cannot produce on its own.
3. **No `--json` / non-TTY path has been run** for any public-app suite.
4. **TC-2.4's refusal path is untested** — it needs an account without the public-apps
   flag, which is mutually exclusive with TC-2.1's precondition on any one account.
