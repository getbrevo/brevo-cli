# QA Manual Test Cases — public apps & UI apps

Manual test suite for two features: public app distribution (BEX-405, still **pre-GA**)
and UI apps / action links (BEX-290, **out of the pre-GA gate** — the GA code is in
review as CLI PR #68 after the #56 merge was reverted in #66; npm `latest` is still
`2.1.0`, which predates it). It sits at this branch's root alongside `docs.md` and
`RELEASE-CHECKLIST.md` — **branch-local, never merge into `main`** (see `CLAUDE.md` →
*Branch-local working docs*). The three lived on the retired
`docs/public-cli-ui-apps-feature-changes` branch until 2026-08-24.

The private-app half of the plan (OAuth create, scaffold, upload, list, backward
compatibility, help layout, cross-cutting regression) was per-branch scratch on
`features_set_public_cli` and was deleted there once worked — recover it from that
branch's history if ever needed (`git show abedd75^:QA-TESTCASES.md`).

> **Suite and case numbers are unchanged from the original combined plan**, which is why
> they are sparse here (2, 5.13–5.16, 6, 7, 10.2–10.3, 12, 13.4). Renumbering would break
> every reference to a case in commit messages, PRs and `docs.md`. Read a gap as "that case
> lived in the dropped private-app half", not as a missing case.

> **⚠️ The two features have different entry conditions now.**
>
> **Public apps are not in any published build (BEX-405).** The commands are eliminated
> at build time, so `app submit` / `app status` / `app withdraw` answer `unknown command`
> and `--distribution public` is refused. **Suites 2, 5, 6, 7, 10 and 13 need
> `PREVIEW=1 yarn link:dev`** — nothing else unlocks them: the interim `@brevo.com` /
> `@sendinblue.com` account exception and `BREVO_ENABLE_PREVIEW=1` were both removed when
> the guard moved into the build. Against a published build their refusals are the
> correct result, not a bug.
>
> **UI apps ship in every build of the GA code (BEX-290)** — the *UI app* app-type
> choice and `app install` / `app uninstall` are asserted present at build time
> (`GA_MARKERS`). **Suite 12 needs a build of the GA branch (CLI PR #68), plain
> `yarn link:dev`, no `PREVIEW`** — but note the published `2.1.0` on npm predates the
> flip and still gates UI apps, so Suite 12 cannot run against it.
>
> **The gated questions are still asked.** A build without a feature asks
> `Distribution type?` (and, pre-GA-code, `What type of app are you building?`) like any
> other build, and gates the **choices**: `Private` only / `OAuth app` only. A one-item
> list showing inquirer's `(Use arrow keys)` hint is expected, not a defect. Off a TTY
> and under `--json` neither question is asked, in any build.
>
> If an end-to-end path isn't live in your environment yet, note it on the case rather than
> skipping the whole section.

---

## What these suites cover

| Area | Change |
|------|--------|
| **BEX-252** | `brevo app status` — shows an app's review status as a coloured card. |
| **BEX-253** | `brevo app withdraw` — withdraws an app from submission. |
| **Public apps** | `brevo app create --distribution public`; interactive picker offers Public. |
| **US-2** | `brevo app upload` is blocked while an app is `Submitted` / `In Review`. |
| **BEX-290** | UI apps / action links: the *UI app* app-type choice, `app install`, `app uninstall` (named `deploy` / `rollback` until 2026-08). Reshaped since by BEX-416 (per-entry `size`), BEX-422 (type-narrowed registry reads) and BEX-426 (per-entry CTA fields, single-placement create). |
| **BEX-405** | The public-apps surface is eliminated from the published bundle; the gate itself shows up in `--help`. |

---

## Test environment & global preconditions

- **Node.js** ≥ 20.15.0, **Yarn** ≥ 1.19.1.
- **Build the right binary.** The public-app suites need the preview build; Suite 12
  needs any build of the GA code (npm's `2.1.0` predates it):
  ```bash
  yarn install && PREVIEW=1 yarn link:dev
  brevo --version    # confirm the branch build is on PATH
  brevo app --help   # install / uninstall always listed; status / submit only on PREVIEW=1
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

> **⚠️ BEX-405 changed the entry condition for this whole suite — read before running it.**
> Public distribution is gated at **build time**. A published build (`npm i -g
> @getbrevo/cli`, or plain `yarn build`) refuses `--distribution public` with *"That
> command is not available yet…"*, exit `1`, and asks the distribution prompt with
> **`Private` as its only choice** — it no longer skips the question and applies
> `private` silently (changed 2026-08-13).
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
**Preconditions:** A **preview** build, and an account **without** the
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
**Preconditions:** A public app in a non-blocking state (e.g. `configured`, `changes_requested`, `rejected`, `approved`) or a private app with no review state; a local change vs the server.
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
- `configured` → "Configured" / cyan ◇
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
*uploaded* but unsubmitted, which is the `configured` state (TC-6.1), not `unknown`.
Either the precondition is wrong or the empty-state path is dead code; worth deciding
which before merge. Exit code was not captured (`echo $?` not run) — it is whatever
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

> TC-10.1 (column alignment) is build-agnostic and stays on the feature branch. These two
> cases are the ones that read the gate: run them on **both** builds, since the useful
> assertion is the difference between them.

### TC-10.2 — Public-app command grouping
**Priority:** Low
**Steps:** `brevo --help`.
**Expected:** `brevo app status` and `brevo app submit` appear under a heading like **"App-review commands (public apps only):"**. `status` is present (regression guard). `upload` is listed; `update` is not.

**Result (predates UI-apps GA and the `install`/`uninstall` rename):** ✅ Pass —
2026-08-13, both builds, and the pair is the useful part. **Preview:** the *App-review
commands (public apps only)* heading carried `status` + `submit` and no `withdraw`
(TC-10.3), the then-gated UI-apps heading carried `deploy` + `rollback`, and `app create`
advertised `--distribution private|public`. **Published:** both headings and all four
commands were absent, and `app create` read `--distribution private` / *"Create a new
OAuth app"* — i.e. the build-time elimination showed up in the help exactly where BEX-405
says it should. **On a build of the GA branch, re-baseline:** `install` / `uninstall` are
listed in *every* build now, so the build-to-build difference this case reads is the
public-app surface only.

### TC-10.3 — `withdraw` is hidden from help but still works
**Priority:** Medium
**Steps:** `brevo --help`, then `brevo app --help`, then `brevo app withdraw --help`.
**Expected:** Neither the root screen nor `brevo app --help` mentions `withdraw` anywhere — it is marked `hidden`, not gated. `brevo app withdraw --help` still prints its own usage (`Usage: brevo app withdraw [options]`) with `--app-id`, `--force` and `--json`, exit `0`, and Suite 7 passes unchanged.

---

## 12 — UI apps / action links (BEX-290)

> **Rewritten 2026-08-24** for the surface the GA branch (CLI PR #68) ships: the
> `install` / `uninstall` command names, per-entry CTA fields (BEX-426), per-entry `size`
> (BEX-416), type-narrowed registry reads and the single-placement create flow (BEX-422 /
> BEX-426), and the registry's dot-notation slugs (renamed from kebab-case by a
> 2026-08-18 platform migration, verified applied on prod 2026-08-24). **Result:** lines
> recorded on 2026-08-13 predate all of that; each says what it did and didn't cover.
>
> **Entry condition: a build of the GA branch** — plain `yarn link:dev`, no `PREVIEW`
> needed; UI apps are asserted present in every build of that code. The published `2.1.0`
> predates the flip and still gates them. Server-side, create/upload of a `ui_app` block
> is gated on bo-be until BEX-437 lands — against an environment without it, expect the
> server's refusal, not a CLI bug.
>
> **Field names in the `ui_app` block are confirmed** against the platform (its manifest
> read path and its extensibility UI kit — BEX-308 / BEX-350), and so is the **write
> path**: `POST /v3/app-store/apps` persists the block inside the create transaction and
> `GET /v3/app-store/apps/{id}` echoes it back, which is exactly what TC-12.5(a)'s
> **Result** line demonstrates from the terminal. **So treat a 4xx here as a defect to
> file** (BEX-437 gating aside), not as an expected failure mode — record the exact
> response either way.
>
> **TC-12.7 also depends on the registry being seeded in your environment.** An authored
> slot name with no registry row resolves to nothing and the action link won't render —
> silently, with a 200. Production is verified seeded (twelve rows, both identities,
> dotted slugs — 2026-08-24); **staging is not yet verified**. Confirm before treating a
> non-rendering link as a CLI defect.
>
> **The create flow reads the registry live** (BEX-361; both handlers confirmed deployed)
> with **no offline fallback**: `GET /v3/app-store/surface-points/locations` for the
> record-page prompt, then `?location=<page>` for the placements on the picked page —
> both narrowed by the chosen extension type (BEX-422). Where the endpoint is absent or
> the registry unseeded, choosing **UI app** fails at "Loading record pages..." with an
> actionable error; that is correct behaviour, not a CLI bug (see TC-12.2b). OAuth-app
> creation is unaffected.
>
> **The block shape (as of BEX-426).** `surface_point_list` entries are objects carrying
> `surface_point_name` — the registry's **dot-notation slug** (`contactDetails.header.menu`),
> NOT the `<location>.<place>.<kind>` extension-point name (`contactDetails.headerMenu.action`),
> which is dotted too but a different string — plus, **per entry**: `context`, `label`,
> optional `more_info`, `redirect_link` (or `modal_iframe_url` on an `iframeExtension`),
> and optional `size`. `extension_type` is the only field at the `ui_app` root.
> `link_target` is not in `app-config.json` at all — `brevo app upload` injects `_blank`
> per entry. A config with the pre-BEX-290 spellings (`heading` / `subheading`, top-level
> `context`) **or** the pre-BEX-426 root CTA fields is rejected by upload with a
> migration hint; that is deliberate, see TC-12.5b.
>
> **The registry owns the context field names — do not check them against a list in this
> file.** Corrected 2026-08-13: earlier revisions said *"only five context field names
> exist — `recordId`, `recordName`, `userId`, `locale`, `accountId`; anything else is
> refused at upload"*, and **both halves were wrong.** A live create against the
> company-page header-menu slot seeded **six**, the sixth being `clientId`, so the
> enumeration was incomplete; and the CLI refuses nothing by name —
> `validateUiAppContext` is non-empty-and-unique only, deliberately, because the
> allow-list lives on the registry row (`allowed_context_field`) and a local copy can only
> lag it. `brevo app create` seeds each entry from that row's own `default_context_field`,
> so a created app is always within the allow-list. Expect whatever the row carries; the
> only wrong answer is a field the row doesn't allow, and the **server** is what reports
> that.

### TC-12.1 — Interactive create asks for the app type after name, logo and distribution
**Priority:** High
**Preconditions:** Logged in; TTY; cwd has **no** `app-config.json`.
**Steps:** Run `brevo app create`.
**Expected:** Prompt order is "App name:" → "App logo URL (optional — leave blank to skip):" → "Distribution type?" → "What type of app are you building?" with **OAuth app** and **UI app**. The three record-level questions come first and the app type is the last thing asked before the flow branches (the logo moved here on 2026-08-13 — it used to be asked *inside* each branch, after the redirect URLs / placements). Choosing **OAuth app** reproduces the previous flow from there (redirect URL → "Add another redirect URL?" → output directory → scaffold confirm).

### TC-12.2 — Prompt order, and the integration-type prompt offers Link only
**Priority:** High
**Preconditions:** Registry endpoint available (see the section preamble).
**Steps:** `brevo app create`, choose **UI app**, and walk the whole flow.
**Expected:** The order is **"What type of integration are you adding?"** → "Which record page should it appear on?" (**single-select, one page** — see TC-12.2c) → "Where should it appear on the *page* page?" (single-select) → "Label — …" → "More info — … (optional)" → "Redirect link — …" → "Output directory". **The logo prompt is no longer here** — it moved to second in the shared opening (name → logo → distribution → app type) on 2026-08-13, so by the time this branch starts it has already been answered; the output-directory prompt still belongs to the shared flow and still comes last. The integration-type prompt lists **Link** only — the **Iframe** choice (previously shown disabled as "coming soon") was removed on 2026-08-19 until iframe authoring is ready; a hand-edited `iframeExtension` block still validates and uploads. There is **no** "How should it appear?" (kind) question, **no** separate place question, and **no** record-context question anywhere.

### TC-12.2c — One page, one placement, both single-select
**Priority:** High
**Preconditions:** Registry endpoint available.
**Steps:** `brevo app create` → **UI app** → **Link** → pick a page at the page prompt.
**Expected:** The page prompt is a **single-select list** (one page, not a checkbox — changed at BEX-426, when the CTA fields moved per entry and N placements would have meant re-asking three questions each), followed by **one** single-select placement prompt for that page, named after it (`Where should it appear on the <page> page?`). Placement choices are labelled with the registry's **own values** — `<section_name> — <component_type>`, e.g. `headerMenu — action` — since BEX-426 replaced the CLI's local label map with the registry's vocabulary (the map could lag the registry; the raw values are verifiable against it). **No slug** (like `contactDetails.header.menu`) appears anywhere in the prompt.

Exactly one placement is enforced *structurally*: a single-select cannot be left empty and cannot take two values, so there is no "pick at least one spot" validation message to see. The platform is more permissive (it rejects only a *duplicate* slot), so a hand-edited config with several entries — even two spots on one page — still uploads; one-placement-at-create is the CLI's rule, and is deliberate. More placements are hand-authored in `app-config.json` and pushed with `brevo app upload` — the created-app box's hint says exactly that.

A page whose every placement is un-hostable for the chosen extension type **aborts with a precise error** at the placement read (`APP_CREATE_UI_POINTS_NONE_FOR_TYPE` rather than the generic empty-registry error) — the old skip-with-warning went with the multi-select, since there is no other picked page left to continue with. The page prompt cannot pre-filter (a location listing carries no extension-type information), which is why the dead end surfaces only at the second read.

**Result (predates BEX-426 — recorded against the per-picked-page multi-select flow):**
◐ Partial pass — 2026-08-13, preview build, production. Ran with **one** page ticked
(`companyDetails`): a single `Where should it appear on the companyDetails page?` list,
phrased per page and naming it, with no slug anywhere in the prompt. The choice taken
read `Header "More" (•••) menu — menu entry` — the CLI's local label map, since
**replaced** by the registry's own `section_name — component_type` values, so a re-run
should read differently. The multi-page fan-out that run left uncovered no longer
exists; the case above needs a fresh run as written.

Incidental confirmation, still valid: the production registry **is** seeded and
`location_name` is populated for at least `companyDetails` — the page prompt offered it
by that name and the placement read resolved a row for it. (Since re-verified directly:
twelve rows, both identities, dotted slugs — 2026-08-24.)

### TC-12.2b — UI-app create aborts when the surface-points fetch fails
**Priority:** High
**Preconditions:** Registry endpoint absent or unreachable (e.g. point `BREVO_API_URL` at a dead host, or run against an environment without the endpoint).
**Steps:** `brevo app create`, choose **UI app**, then **Link**.
**Expected:** The flow stops at "Loading record pages..." with an error explaining the UI-app flow needs the platform's placements and that OAuth apps still work. Exit non-zero, **no app is created** (no create request goes out). Re-running and choosing **OAuth app** completes normally.

### TC-12.2d — A failing narrowed load retries unfiltered before giving up
**Priority:** Medium
**Preconditions:** An environment whose surface-points endpoint answers an unfiltered row read but 400s (or returns `[]`) for the narrowed one (`?location=…` + extension type) — the likely shape of a build predating either filter.
**Steps:** `brevo app create` → **UI app** → **Link** → pick a page → continue.
**Expected:** "Loading placements..." completes and the placement prompt still lists the placements for the picked page — the CLI retries the read **unfiltered** (no location and no extension-type parameter, so a build that 400s on either still answers) and narrows the rows locally to the picked page. The run finishes normally; the partner is never sent back to re-answer the page prompt. Only both reads failing aborts. Rows that declare an `extension_type_list` excluding the chosen type are still filtered out locally, so the unfiltered retry cannot reintroduce an un-hostable slot.

### TC-12.3 — UI-app create writes the block shape and no redirect URLs
**Priority:** High
**Preconditions:** Registry endpoint available.
**Steps:** Complete the UI-app flow — **Link**, one record page, one placement, then a label, a `more_info` line and a redirect link (`https://…`).
**Expected:** A "UI app created" box shows extension type, the placement with its seeded record context, the label, more info and redirect link — and **no** `Redirect URL` lines. It states that the menu entry is labelled with **the label you typed**, and that on a card that text becomes the button while the card's *title* is the app name. It prints an **example URL** — the redirect link with the seeded context fields as query parameters and placeholder values — and the hint that **more placements are added by hand** as further `surface_point_list` entries and pushed with `brevo app upload`. The generated `app-config.json` is valid JSON with a top-level `ui_app` containing exactly `extension_type: "actionLink"` and `surface_point_list` — a list of **one object** carrying `surface_point_name` (the registry's dot-notation slug), `context`, `label`, `more_info`, `redirect_link`, **all per entry** — and **no** `label`/`more_info`/`redirect_link`/`modal_iframe_url` at the `ui_app` root, **no** `link_target` or `extension_point_name` anywhere, and **no** `heading`, `subheading`, root `context`, `properties`, `trigger`, `surface`, `placement` or `contextProperties` keys. Every context field name is one the registry seeded for that slot (see the preamble — do **not** check them against a fixed list; the company-page header-menu slot seeds six, including `clientId`). `auth` is exactly the empty object `{}` — **no** `scopes`, **no** `redirectUris`, **no** `type` key — and there are **no** `permittedUrls`/`support` sections. No `src/oauth/` directory, no feature prompt.

**Result (predates BEX-426 — the CTA fields were still at the `ui_app` root):** ◐ Partial
pass (box confirmed, file not inspected) — 2026-08-13, preview build, production. A
private UI app (`actionLink`, on the company-page header-menu slot — then slugged
`company-details-header-menu`; the registry has since renamed the slugs to dot notation)
rendered the `UI app created` box with App name, App ID, `Extension type: actionLink`,
the placement with all six seeded context fields, `Label`, `More info`, `Redirect link`,
`App version: 0.0.1` — and **no `Redirect URL` lines and no credential rows**. The box
printed the example URL with all six context fields as query parameters and placeholder
values, the *"Values are placeholders… the path is never templated"* note, and the label
explanation naming the app name as a card's title. Base project wrote `5 files`, **no
`src/oauth/`, no feature prompt** — correct for a UI app.

Two things this run did **not** verify, and both are the actual assertions of this case:
`app-config.json` was never opened, so the block's key set is unconfirmed on disk (and
the per-entry key set of the current shape has *never* been seen on disk); and
`~/.brevo/credentials.json` was not checked for an absent `apps` entry. The example URL
**wrapped mid-token** inside the box (`…&clientId=CLIEN` / `T_ID`) — that is the boxed-output
wrapping from `3280138` working as designed on a long unbreakable URL, not a defect.

### TC-12.3b — Record context is seeded per placement, and reaches the URL as query params
**Priority:** High
**Preconditions:** TC-12.3 done against a registry whose rows carry `default_context_field`.
**Steps:** Inspect `ui_app.surface_point_list` in `app-config.json`; compare each entry's `context` against the registry row for that slot. Then follow the example URL printed by create.
**Expected:** Each entry's `context` equals that slot's own `default_context_field` (rows can differ), and an entry whose row declares no default has **no** `context` key at all (not `[]`). The example URL carries exactly those names as query parameters, merged after any `?` already in the redirect link and inserted **before** any `#` fragment. The path is never templated.

### TC-12.4 — Upload sends the block, injects link_target, and is accepted
**Priority:** High
**Preconditions:** TC-12.3 done; ability to observe the request.
**Steps:** `brevo app upload` from the project directory.
**Expected:** The summary includes a `UI app:` block listing extension type, each placement with its context, label, more info and redirect link — and **no** "Redirect URLs" row, and **no** `Link target:` row (that row was deliberately removed; `link_target` is injected into the payload but is not a field the partner authors, so showing it in a local-vs-server diff only invited someone to try editing it). The payload carries the block under the **`ui_app`** key with **`link_target: "_blank"` added to every entry** (it moved per entry with BEX-426), alongside `version`/`name`/`logo_uri`, and has **no `auth` key at all** (UI apps carry no OAuth block). The server accepts it; `Version:` is printed and written back to `app-config.json` with `auth` restored as exactly the empty object `{}`. **Critically: `app-config.json` must still have no `link_target` (and no `extension_point_name`) afterwards, at any depth** — the server echoes `link_target` per entry and stamps the dotted `extension_point_name` on its stored copy, and the write-back strips both.

### TC-12.5 — Editing only the block is detected as a change
**Priority:** High
**Steps:** After a successful upload, (a) run `brevo app upload` again with nothing changed; (b) change only one entry's `label` (`ui_app.surface_point_list[0].label`) and upload; (c) reorder the keys inside `ui_app` and reorder the `surface_point_list` entries, without changing any value, and upload.
**Expected:** (a) "Already up to date" — this is the regression to watch: the server echo carries a per-entry `link_target` (and possibly a `version`) the file does not, and those must not read as drift. (b) The diff shows the UI-app block as `(changed)` and the upload proceeds. (c) "Already up to date" — neither key order nor placement order is a change.

**Result (predates BEX-426 — `label` was still at the root):** ✅ Pass on (a) — 2026-08-13, preview build, production. `brevo app upload`
immediately after the UI-app create printed the summary with its `UI app:` block
(extension type, placement + all six context fields, label, more info, redirect link) and
then **`Already up to date at version 0.0.1.`**, pushing nothing. That is the exact
regression this case guards, and it clears it end to end: create persisted the block
server-side, the read-back echoed it with a `link_target` the file does not carry, and the
diff still reported no drift. It also confirms, from the terminal rather than from reading
the handler, that `POST /v3/app-store/apps` **stores** `ui_app` — the claim in `CLAUDE.md`
→ *A created app is immediately readable as a UI app*.

The summary carried **no "Redirect URLs" row and no `Link target:` row** (TC-12.4's
rendering half). (b) and (c) were not run — nothing was hand-edited, so the `(changed)`
diff and the key/placement-reorder no-ops are still unverified, as is the whole of
TC-12.4's *push* half: this app was never uploaded with a real change, so no `ui_app`
payload has been observed on the wire and no write-back has been inspected.

### TC-12.5b — Superseded block shapes are rejected with a migration hint
**Priority:** High
**Why this matters:** an unmigrated config could upload "successfully" and render an app with missing text or record context — the CLI's named refusals are the layer that reports *what moved where* rather than a generic "label cannot be empty" pointing at the wrong thing.
**Steps:** For each, hand-edit `app-config.json` and run `brevo app upload`:

Pre-BEX-290 spellings:
1. rename an entry's `label` to a root `heading`
2. add a root `subheading`
3. add a top-level `ui_app.context: ["recordId"]`
4. replace `surface_point_list` with a list of bare strings

Pre-BEX-426 spellings (the root CTA fields — added when the fields moved per entry):
5. move an entry's `label` to the `ui_app` root
6. add a root `more_info`
7. move an entry's `redirect_link` to the root
8. add a root `modal_iframe_url`
9. add a root `link_target: "_blank"`

**Expected:** Each fails before any network call, exit `1`, naming the field and the fix — (1) renamed to `ui_app.label`; (2) renamed to `ui_app.more_info`; (3) move it into each `surface_point_list` entry; (4) entries must be objects; (5)–(8) "moved into each surface_point_list entry", with an example entry showing the field in place; (9) is the odd one out — the hint is **remove it**, not move it: `link_target` is never authored, `app upload` injects it per entry. The server refuses the superseded root spellings by name too, so a CLI that missed one would still 400 — but the local message is the one with the fix in it.

### TC-12.6 — Extension-point validation (the silent-failure guard)
**Priority:** High
**Why this matters:** the platform *drops* an unregistered slot name and the UI kit matches names by exact string equality — both silently. These rejections are the only place a bad name is ever reported.
**A slot has two names, both dotted now, and the authored one is the slug.** Each registry row carries an `extension_point_name` in the `<location>.<place>.<kind>` grammar (`contactDetails.headerMenu.action`) *and* a `surface_point_name` slug (`contactDetails.header.menu`), 1:1. The authored key is **`surface_point_name`** and it takes the **slug**. The grammar name is what renders and what every spec quotes, which makes it the natural thing to try — and authoring it is rejected. Since the 2026-08-18 platform migration renamed the slugs from kebab-case, the two spellings differ only in segmentation, so watch for the mix-up specifically.

**The CLI no longer holds a list of valid slot names.** Local validation is deliberately *shape-only*; the registry is the sole authority, so an unregistered name passes locally and is rejected by the **server**. Do not expect "Unknown extension point" from the CLI — that local mirror was removed because a copy can only lag the registry, and it failed in both directions.

For the entries below, `label` and `redirect_link` are assumed present and valid on each entry — this case is about the slot name and `context` only.

**Steps:** For each, set `ui_app.surface_point_list` and run `brevo app upload`:
1. `[{"surface_point_name":"contactDetails.headerMenu.action", …}]` — the grammar name where the slug belongs
2. `[{"surface_point_name":"contact-details-header-menu", …}]` — the **retired kebab slug**, no longer a registry row
3. `[{"surface_point_name":"", …}]` — blank
4. `[{"surface_point":"contactDetails.header.menu", …}]` — the pre-rename *key* (the value doesn't matter)
5. `[]` — empty list
6. the same `surface_point_name` twice — duplicates
7. `[{"surface_point_name":"contactDetails.header.menu","context":"recordId", …}]` — context not an array
8. `[{"surface_point_name":"contactDetails.header.menu","context":["recordId","recordId"], …}]` — duplicated context field

**Expected:** Split by who rejects them.

- **Cases 1 and 2 reach the server** — they are well-formed strings, so the CLI sends them. The upload endpoint answers **400**, naming the offending slot(s) (`ui_app.surface_point_list contains unregistered extension point(s)`). Exit `1`. This is the intended division of labour, not a missing check.
- **Cases 3–8 fail locally**, before any network call, naming the field; exit `1`. (3) blank slot name; (4) entries must carry `surface_point_name` — the bare `surface_point` spelling is used nowhere and should be reported as an unrecognised entry shape; (5) at least one placement; (6) duplicate slots; (7)–(8) the offending entry's `context`.
- A **widget** slot is **accepted** for an action link — it renders as a card, so there is no kind rule to break.

### TC-12.7 — Install into an account, and the action link renders
**Priority:** High
**Preconditions:** TC-12.4 succeeded; a test account ID; the registry is seeded in the environment (prod verified 2026-08-24; staging not yet).
**Steps:** `brevo app install <account-id>`, confirm the prompt. Open a contact record in that account and open the header **More** (•••) menu.
**Expected:** The success line names the resolved target account. A menu entry appears **labelled with that entry's `label`**, with its `more_info` as the second line, and clicking it opens that entry's `redirect_link` in a new tab, carrying that entry's `context` fields as **query parameters**. On a `.widget` slot the same app renders as a card whose title is the app name, whose description is `more_info`, whose button is `label`, and whose box honours the entry's `size` when authored. Then `brevo app uninstall <account-id>` and confirm it disappears. Also: `install` on an **OAuth** app is refused with exit `1` — an OAuth app has nothing to render, and before this gate it "installed" successfully and rendered nothing.

### TC-12.8 — Multiple placements from one app (hand-authored)
**Priority:** Medium
**Why this changed:** `brevo app create` authors **exactly one** placement since BEX-426 — the CTA fields are per-entry, so N placements would mean re-asking three questions per placement. Multi-placement is now the hand-edit path the created-app box's hint points at, and this case pins that path.
**Steps:** After TC-12.3, hand-add two more `surface_point_list` entries to `app-config.json` — a second record page's menu slot and one `.widget` slot — each with its **own** `label`, `redirect_link` and (on the widget entry) an optional `size`; get the slugs from another created app or the registry owner, since the CLI deliberately ships no list of them. Run `brevo app upload`, then `brevo app install <account-id>`.
**Expected:** Upload's diff shows the block `(changed)` and the push is accepted — the platform rejects only a *duplicate* slot, so several entries (even two spots on one page) are fine. After install, each placement renders with **its own** label and destination: different menu text on the two record pages, and a card whose button and description come from the widget entry's fields.

### TC-12.9 — Install refuses before an upload
**Priority:** High
**Steps:** In a UI-app project whose `app-config.json` has no `version` (or a freshly created, never-uploaded app), run `brevo app install <account-id>`.
**Expected:** Refuses with "Please first validate your configuration with `brevo app upload`"; exit `1`; nothing installed. This local gate is the **only** gate — the server has none (a never-uploaded app would answer `201` and render nothing) — so also check it holds when the app is named via `--app-id` and via the picker, not just from the linked project.

### TC-12.10 — Uninstall from an account, and idempotency
**Priority:** High
**Steps:** `brevo app uninstall <account-id>` on an installed app; then run it again.
**Expected:** First run: the app is uninstalled from the account and the entry is gone from the record. Second run: reports the app is not installed in that account and exits **`0`** (not an error). Under `--json`: `{"uninstalled": false, "reason": "NOT_INSTALLED", …}`.

Note the second run relies on the uninstall route answering **404** for both "no such install" and "no such app" — it has no `installation_id` to delete by, so it cannot distinguish them. `uninstall` therefore maps *any* 404 to this informational path. Do not treat a 404 here as a failure.

### TC-12.11 — Field validation and account-ID validation
**Priority:** Medium
**Steps:** All field edits are on a `surface_point_list` **entry** (the root spellings are a different failure — TC-12.5b): (a) set an entry's `redirect_link` to `http://example.com/x` and upload; (b) set it to `http://localhost:3000/x` and upload; (c) blank an entry's `label` and upload; (d) set an entry's `label` to 49 characters and upload; (e) set an entry's `more_info` to 256 characters and upload; (f) add `modal_iframe_url` to an `actionLink` entry and upload; (g) set an entry's `size` to `{"width":"280"}` and upload; (h) set it to `{"height":"150%"}` and upload; (i) `brevo app install abc`; (j) `brevo app install` with no argument.
**Expected:** (a) rejected — must use https; (b) **accepted** (loopback exemption); (c) rejected — label cannot be empty; (d) rejected — at most 48 characters; (e) rejected — at most 255 characters; (f) rejected — only used by `iframeExtension`; (g) rejected — an axis needs an explicit `px` or `%` unit; (h) rejected — a `%` axis is 1–100 (shrink-only); (i) "not a numeric Brevo account ID". Every rejection names the offending entry (`ui_app.surface_point_list["<slug>"].label: …`) and exits `1` with no API call. Also check the prompts themselves reject (c)–(e) during `brevo app create`, before anything is written.

(j) is **not** an error: `[account-id]` is optional on both `install` and `uninstall`. Omitted, the target resolves from the authenticated account — a plain account installs into itself with no prompt (so `--json`/CI still work), a corporate account is offered a picker of its sub-accounts (and `uninstall`'s picker asks "uninstall from", not "install into"). Expect a successful install into your own account, not "Missing account ID". The explicit positional is still checked first and remains the only way to reach an account the listing won't show, notably a deactivated sub-account.

### TC-12.12 — A UI app cannot be created non-interactively
**Priority:** High
**Steps:** (a) `brevo app create --name "QA Link" --distribution private --json`; (b) the same command piped from `/dev/null` (non-TTY); (c) `brevo app create --type ui`; (d) `brevo app create --surface contact`.
**Expected:** (a) and (b) create an **OAuth** app without ever showing the app-type prompt — JSON reports `appType: "oauth"`, includes `redirectUri`, and has **no** `uiApp` key; no `ui_app` block is written to `app-config.json`. (c) and (d) fail with commander's `unknown option` and exit non-zero — neither flag exists. `brevo app create --help` lists neither, nor `--label`/`--more-info`/`--redirect-link`/`--link-target`.

### TC-12.13 — `app scaffold` in a UI-app project
**Priority:** High
**Steps:** From a UI-app project, hand-edit an entry's `more_info`, then force drift (rename the app locally or on the server) and run `brevo app scaffold`, consenting to the refresh.
**Expected:** No feature-type prompt, no `src/oauth/` files, and a message that there are no features to scaffold. **Critically: the hand-edited `ui_app` block survives the refresh** — still present and unchanged in `app-config.json` afterwards.

### TC-12.14 — OAuth regression sweep
**Priority:** High
**Steps:** Create a private OAuth app end to end (`brevo app create` → accept the feature prompt → `yarn --cwd src/oauth` → `brevo app start oauth`), then `brevo app upload`.
**Expected:** The same experience as before this branch — redirect-URL prompts, four default scopes, `src/oauth/` scaffold, working OAuth flow, and an upload payload with **no** `snapshot` (and no `ui_app`) key — **except** for the prompt-order change in TC-12.1 (the logo is now asked second) and the two gated questions now being asked with one choice each on a published build. A public OAuth app must still get the PKCE scaffold.

**Result:** ✅ Pass — 2026-08-13, published build, production. Full walk: create → accept
the feature confirm → `yarn --cwd src/oauth` (6 files, clean install) → `brevo app start
oauth` → browser authorization → **access token and refresh token both received**, refresh
endpoint advertised → `Ctrl+C` shut down cleanly → `brevo app upload`. Four default
scopes as expected. Payload keys were not observed on the wire (no proxy in the run) —
that half is covered by the unit assertions. Public/PKCE variant not run.

**Result (second run):** ✅ Pass — 2026-08-13, **preview** build, production, this time a
**public** app created through `brevo app init` rather than `brevo app create`. Same
outcome: `yarn --cwd src/oauth` clean, `brevo app start oauth` on `localhost:3009`,
browser authorization, **access token *and* refresh token received**, clean `Ctrl+C`. The
following `brevo app upload` summary showed the OAuth shape (Redirect URLs, four scopes,
logo, version) with **no `UI app:` block** — the negative half of this case, as far as a
terminal can show it.

This closes the *"Public/PKCE variant not run"* gap only **partially**: a public OAuth app
was built and its flow works, but nothing in the output distinguishes a PKCE scaffold from
the private one — the same `6` feature files were written. **Whether "a public OAuth app
must still get the PKCE scaffold" is still a real expectation needs settling by reading
the templates, not by watching the terminal.**

---

## Suite 13 (public-app subset) — `brevo app submit`

> TC-13.1–13.3 (`init`, `credentials`, `delete`) are build-agnostic and stay on the feature
> branch. `app submit` is a public-app command, eliminated from a published build.

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
**preview** build covering `app init` on a public app, `status`, `submit`, `delete`,
`scaffold` in both modes, and a **UI app** created and uploaded. (Sweep 1 was a published
build and exercised the OAuth happy path only, so it contributes nothing here except the
published half of TC-10.2.)

A Result line says which build it ran on when it matters. Nothing here is signed off.

| Suite | Owner | Result (Pass/Fail) | Notes |
|-------|-------|--------------------|-------|
| 2 — create: public | Piyush | ◐ Partial pass | TC-2.1 ✅ — created live on a preview build + flag-enabled account, then uploaded to `0.0.2`. TC-2.4's refusal path still untested (needs an account **without** `app-store-bo-be-public-apps`); TC-2.2 / TC-2.3 not run. |
| 5 (subset) — upload under review | | **Blocked** | TC-5.13–5.16 not runnable on this account — see Suite 7. |
| 6 — status | Piyush | ✗ **Fail** | TC-6.1 ✅ (`◇ Configured`, aligned card, resolved from the linked config — also TC-6.5 case 1). **TC-6.3 fails:** a never-uploaded app surfaces a raw, misleading server message instead of the friendly Unknown card. TC-6.2's other states, 6.4 (`--json`) and 6.6 (colour) not run. |
| 7 — withdraw | | **Blocked** | Not run, and **not runnable on this account**: `app submit` only opens a Google Form, so no app can be driven into `submitted`/`in_review` from the CLI. Reaching Suite 7 (and TC-5.13–5.16, and TC-6.2's review states) needs the form completed or the state set server-side. |
| 10 (subset) — help layout | Piyush | ✅ Pass | TC-10.2 / 10.3 confirmed on **both** builds, which is what makes the BEX-405 elimination visible. |
| 12 — UI apps / action links | Piyush | ◐ Partial pass | **TC-12.5(a) ✅ — the headline result**: a UI app created and then uploaded reported `Already up to date at version 0.0.1`, so create persists `ui_app` and the server's `link_target` echo is not read as drift. TC-12.2 / 12.2c / 12.3 partial (one page only; `app-config.json` never opened), TC-12.14 ✅ ×2. **Not run: 12.4's push half, 12.5(b)/(c), 12.5b, 12.6, 12.7–12.13** — nothing was hand-edited, and the install commands (then `deploy` / `rollback`, since renamed `install` / `uninstall`) were never invoked. The sweep also predates BEX-416/422/426 and the slug rename — the partial passes above were against the root-CTA-field, multi-select, kebab-slug flow. |
| 13 (subset) — submit | Piyush | ◐ Partial pass | TC-13.4 ◐ — ran twice, but the mismatch branch was not exercised and the form was never completed. |

**Overall verdict:** ☐ Ready for GA  ☑ Not yet signed off.

What sweep 2 establishes: a public app can be created, uploaded and previewed for
submission end to end, and the UI-app create→upload round trip is clean — including the
drift regression TC-12.5(a) exists to catch.

What still blocks sign-off, in priority order:

1. **TC-6.3 is a confirmed failure** — an unmapped, misleading server message on a
   never-uploaded app. It needs a decision (map the message, or fix the case's
   precondition and delete the dead empty-state path).
2. **`ui_app` on disk is still unverified** — every UI-app assertion so far is read off
   the terminal, not out of `app-config.json`. TC-12.4's push half, TC-12.5b and TC-12.6
   are the ones that would catch a wrong key.
3. **Suite 7 and TC-5.13–5.16 are blocked, not merely unrun** — they need a submitted
   app, which the CLI cannot produce on its own.
4. **`install` / `uninstall` (TC-12.7, 12.9, 12.10, 12.11) have never been invoked** —
   under either their current names or the old `deploy` / `rollback`.
5. **No `--json` / non-TTY path has been run** for any of these suites — TC-12.12 is the
   one that pins the scripted contract for UI apps, and it is unrun.
6. **TC-2.4's refusal path is untested** — it needs an account without the public-apps
   flag, which is mutually exclusive with TC-2.1's precondition on any one account.
