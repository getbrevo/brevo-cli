# UI apps (action links) — release status

> Working notes derived from PR #53 (`docs/public-cli-ui-apps-feature-changes`:
> `RELEASE-CHECKLIST.md`, `QA-TESTCASES.md`, `docs.md`), the BEX-281 epic and the Action
> Link Dev PDR, cross-checked against the code on `main` / `feat/bex-416-entry-size` as of
> 2026-08-21. **Re-verified 2026-08-24** against CLI `origin/main`, app-store-bo-be
> `origin/main` and app-store-backend `origin/main` plus live Jira statuses — items below
> carry a *(2026-08-24)* stamp where that sweep changed them.
> **Branch-local working doc — never merge into `main`** (see CLAUDE.md).
> References are Jira keys and PR numbers only.
>
> ~~⚠️ The PR #53 docs are dated 2026-08-13 and predate the UI-apps GA flip~~ — **RESOLVED
> 2026-08-24**: all three were rewritten for the current surface and moved from the
> retired `docs/public-cli-ui-apps-feature-changes` branch onto this branch's root. The
> original note, kept for context: they still said
> "UI apps are not GA", call the commands `deploy`/`rollback`, and describe root-level
> `label`/`more_info`. All three are stale — see "Docs debt" below.

## Headline (corrected 2026-08-24): GA code is complete but NOT on `main`

On **this branch** (`feat/bex-416-entry-size`, now **PR #68**, open since 2026-08-21)
`FEATURE_STAGE['ui-app-type']` and `FEATURE_STAGE['account-install']` are `'ga'`
(`src/lib/preview.ts`), `app install` / `app uninstall` live in
`src/commands/definitions.ts`, their bindings are asserted **present** in every build via
`GA_MARKERS` in `scripts/build.mjs`, and the *UI app* choice ships in the app-type prompt.

**But the release event has NOT happened.** PR #56 carried this to `main` on 2026-08-19
and was **reverted the same day** (#66 — "merged prematurely; the work returns to review
in a follow-up PR from the same branch"). CLI `origin/main` today has both
`FEATURE_STAGE` rows back at `'preview'`, and npm `latest` is still **2.1.0**. GA happens
when **PR #68 merges** and the changesets "Version Packages" PR publishes. The ✅ items
below remain code-verified — on this branch.

---

## ✅ Done (verified in code or by a recorded QA result)

### Runbook (`RELEASE-CHECKLIST.md` → Before UI-apps GA)
- **Gate opened** — both `FEATURE_STAGE` rows flipped to `'ga'`; command definitions moved
  out of `preview-definitions.ts` into `definitions.ts`; names dropped from `LEAK_MARKERS`
  and added to `GA_MARKERS` (build asserts they ship). BEX-290 touched 17 files doing this.
- **Commands renamed** `deploy`/`rollback` → `install`/`uninstall` (2026-08; the wire field
  `deploy_client_id` deliberately keeps the old vocabulary).
- **Agent docs restored** — per CLAUDE.md, `agent-context/SKILL.md` / `AGENTS.md` carry the
  UI-app surface; strings moved from `preview-messages.ts` to `src/lang/en.ts`.

### Wire contracts — confirmed (checklist's ✅ items, all still true)
- `ui_app` field names confirmed against both platform consumers (manifest read path +
  extensibility UI kit, BEX-308/BEX-350). Authored key is `surface_point_name`.
  ⚠️ **Slug format changed (2026-08-18 migration, verified applied on PROD
  2026-08-24; post-rename Redis flush done):** the authoring slugs were renamed from kebab-case to dot notation
  (`contact-details-header-menu` → `contactDetails.header.menu`) with the stored
  snapshots rewritten in the same transaction; `extension_point_name` (the
  `<location>.<place>.<kind>` grammar) is untouched, and the new slugs are dotted but
  deliberately NOT the grammar names. The CLI needs no code change (it prompts from the
  registry) — but every doc that says "kebab slug" (CLAUDE.md included) is now stale.
  ✅ **Fixed 2026-08-24** (commit 8e02317): CLAUDE.md, SKILL.md, AGENTS.md, the
  `rejectRootCtaFields` hint and an `authoring.ts` comment all use the dotted slugs now.
- **Create persists the block** — `POST /v3/app-store/apps` stores `ui_app` inside the create
  transaction; `GET .../apps/{id}` echoes it. Proven live: first upload after create says
  "Already up to date" (TC-12.5(a) ✅).
- **No-auth contract** — create and upload both accepted with no `auth` key (live, prod).
- **BEX-361 shipped** — both surface-point reads confirmed against deployed handlers
  (locations shape, row columns, `?location=` filter, deterministic ordering).
- **Registry seeded** — all twelve BEX-350 rows with both identities; production confirmed
  seeded incidentally during TC-12.2c.
- **Install transport** — one resource (`POST`/`DELETE /apps/{id}/installs`), body contract,
  404-for-both mapping, numeric-identifier omission — all confirmed live or by code.
- **`type === 'corporate'` discriminator on `/v3/account/info` — VERIFIED** (confirmed
  2026-08-21). `resolveInstallTarget()`'s corporate branch and the sub-account picker
  (`GET /v3/corporate/subAccount`) are no longer assumed. ✅ Follow-up closed 2026-08-24:
  the code comment (`src/types.ts`), CLAUDE.md and `docs.md` all record it as verified.
- **No server-side upload gate on install** — `assertUploadedBeforeInstall()` is the only
  gate and covers every resolution path; the 422 branch is kept as dead-but-deliberate.

### Landed after the PR #53 docs were written (they don't know about it)
- **BEX-426: per-entry CTA fields** — `label`, `more_info`, `redirect_link`,
  `modal_iframe_url`, `link_target` moved into each `surface_point_list` entry; hard move
  with migration hints on both CLI and server. This **closes** docs.md's parked item
  *"Per-placement label / more_info / redirect_link"*.
- **BEX-416: per-entry `size`**, **BEX-422: extension-type-filtered registry reads**,
  single-select page prompt (create authors exactly one placement).
- **Smoke fix** — `scripts/smoke/core.ts` now builds with `PREVIEW=1` when the suite needs
  it (docs.md's "smoke builds the wrong artifact" QA gap appears fixed; re-verify with a run).

### QA cases with recorded passes (sweep 2, 2026-08-13, preview build, production)
- TC-12.5(a) ✅ — the headline drift regression (create → upload → "Already up to date").
- TC-12.2c ◐ — one-prompt-per-page, friendly labels, no slug in prompt (N=1 only).
- TC-12.3 ◐ — created-app box, example URL, no OAuth scaffold (file never opened on disk).
- TC-12.14 ✅ ×2 — OAuth regression sweep, both builds.
- TC-10.2 ✅ — help layout on both builds.

---

## 🔲 Still to take care of

### 1. Blocked / unverified contracts — BOTH RESOLVED (2026-08-24)
- ✅ **Install idempotency — CONFIRMED in code** (app-store-backend `origin/main`,
  `cmd/app-store-webhooks/http_create_integration_details.go`): `findExistingInstallation`
  keys developer installs on `client_id + app_id + metadata.is_developer=true` and a repeat
  install answers `200` with the existing row's ID — no duplicate insert. The CLI's
  never-check-first behaviour is safe.
- ✅ **Environment sequencing (BEX-426) — production is updated.** The per-entry move
  shipped in bo-be **v1.12.0** (#362, then `link_target` in #368) and production runs
  image **1.14.0**; staging tracks `main` via argocd. A current CLI build no longer risks
  the `unknown key` 400 against Brevo-run environments. (The separate *staging registry
  seed* check in §6 housekeeping still stands — needs DB access.)

### 2. QA never run (from the sign-off table — these are the real gaps)
- **`install` / `uninstall` have never been manually invoked** — TC-12.7 (install + the link
  actually renders in the CRM), TC-12.9 (refuse before upload), TC-12.10 (uninstall +
  idempotent second run), TC-12.11 (g)/(h) (account-ID validation, optional positional).
  **Tracked separately as BEX-438** (child of BEX-218) — needs a real account + browser,
  so it is planned end-to-end outside the CLI-side QA.
- **`ui_app` on disk is unverified** — every assertion so far was read off the terminal.
  Open `app-config.json` and check the key set: TC-12.3's file half, TC-12.4's push half
  (payload on the wire + write-back with no `link_target`), TC-12.5(b)/(c) (edit → diff
  `(changed)`; reorder → no-op).
- **TC-12.5b** — pre-BEX-290 shape rejected with migration hints (now also covers the
  BEX-426 root-spelling rejections — update the case, it predates the per-entry move).
- **TC-12.6** — extension-point validation split (dotted name / unknown slug → server 400;
  shape errors → local).
- **TC-12.12** — no `--json` / non-TTY path has been run; this pins the scripted contract
  (non-interactive create = OAuth app, no `--type` flag).
- **TC-12.13** — scaffold in a UI-app project preserves a hand-edited block.
- **TC-12.8 / multi-page** — the placement fan-out was only evidenced for N=1; with BEX-426
  the case needs rewriting (create is single-placement now; multi-placement is hand-authored
  + upload).
- **PKCE question from TC-12.14** — whether "a public OAuth app must still get the PKCE
  scaffold" is real needs settling by reading the templates, not the terminal.

### 3. Open UX decisions (docs.md Part 2 — choices, not bugs)
- ✅ **`app credentials` on a UI app — DECIDED & DONE (2026-08-24): refuse, typed.** It
  used to print an empty credential form (blank client ID, "(none)" scopes/URLs) and cache
  the emptiness. Now `credentials.ts` routes through the capability matrix (`'oauth-flow'`,
  which has named this command since the matrix was written) and throws
  `APP_CREDENTIALS_UI_APP` before any side effect (name cache / credential cache /
  config backfill). Not a UI-app view: that would be a second, blurrier `app list`.
- ✅ **Install/uninstall picker — DONE (2026-08-24): offers only UI apps.** Same session:
  `promptAppSelection` gained an optional `filter`, and `resolveInstallTarget` passes a
  UI-type test (OAuth-material bias, same as `assertInstallable`) plus
  `APP_INSTALL_NO_UI_APPS` for the emptied-list case. Delete/withdraw/scaffold pickers
  stay unfiltered. Retire the bias when the `?type=` listing filter lands (item ◐ below).
- **Friendly placement labels** in the created-app box and upload diff (they print the raw
  slug; needs a registry lookup at print time).
- **`url_pattern` as a prompt hint**; **unpaginated `promptAppSelection`**;
  **`app upload --json` stale `next.version`**.

### 4. Platform asks (raised, not CLI work)
- ◐ **List endpoint type awareness — server side LANDED (2026-08-24).** bo-be `main`'s
  `GET /cli/apps` (`http_cli_get_apps.go`) now supports `?type=oauth|ui_app|brevo_function`
  (unknown value → 400 listing valid types), classifying server-side from version
  snapshots. **CLI follow-up:** consume the filter / server classification and retire the
  `isUiAppRecordShape` heuristic where the listing is the source.
- ✅ **`surface_point_name` unique — APPLIED ON PROD (2026-08-24).**
  `uq_extension_points_surface_point_name UNIQUE (surface_point_name)` now exists
  (verified via `pg_constraint`: pkey + name unique + composite + this + context CHECK).
  The earlier composite `uq_extension_points_name_surface_point` didn't cover the
  slug-alone lookup (`WHERE surface_point_name = ANY(...)`); this does. Remaining:
  🔲 run the same `ALTER TABLE` on **staging**; ◐ bo-be **PR #384** (open,
  2026-08-24) records it in `specs/database.sql` and flags the composite-constraint
  spec drift — plausibly the un-stamped BEX-424 migration — for reconciliation.

### 5. Deliberately parked — don't "fix" without revisiting
- `iframeExtension` prompt authoring (waits on the iframe-embed RFC);
  `permittedUrls` scaffolded empty; no local dev story (`app start` for UI apps);
  per-entry context narrowing is structural only.

### 6. BEX-281 epic + Action Link Dev PDR — cross-repo remainder (added 2026-08-21)

Consolidated from the BEX-281 child-ticket statuses and the Action Link Dev PDR,
**corrected 2026-08-24** against both platform repos' `origin/main` and live Jira. The
earlier version of this section said "#56 merged 2026-08-19, so the GA code is on
`main`" — **that lasted hours**: #66 reverted #56 the same day ("merged prematurely"),
and the work re-entered review as **CLI PR #68** (open, from this branch). npm `latest`
is still **2.1.0**.

**Critical path to the release (2026-08-24):**
1. **Merge CLI PR #68** — the GA code (this branch) has to land on `main` again first.
2. **BEX-437 (bo-be) — still the hard blocker, but now moving: Dev In Progress, PR #380
   open** (branch `feat/BEX-437-ungate-ui-app-authoring`, 2 commits, pushed 2026-08-21).
   Verified 2026-08-24: `gateUIApp` still gates create/upload on bo-be `origin/main`.
   Must land before or with the CLI release.
3. **Ship the CLI release** — cut the version (changesets "Version Packages" PR) so npm
   moves past 2.1.0. Then flip **BEX-427** to Done (still Dev In Progress; its
   `app delete` warning now travels in #68 after the #56 revert).
4. **Investigate the post-deploy UI Automation Suite failure** on all three host repos'
   tag runs (likely the pre-existing app-crm `main` pipeline breakage).

**Open BEX-281 children (Jira statuses re-pulled 2026-08-24; everything else is Done or
Rejected):**
- **BEX-410** (Ready for dev, bo-be) — gap #16: `POST /apps/{appId}/build` writes a
  version row with **no snapshot**, so the UI config silently vanishes (HTTP 200) for
  developer-installed accounts. Verified still open: the ⚠️ gap comment sits in
  `http_push_app.go` (tagged BEX-355 in the code — same gap, older key).
- **BEX-413** (Ready for dev, backend + UI kit) — gap #18: app-227 special-casing.
  **Partially collapsed on backend `main`**: `TestHardLimitAppSlotResolutionIsNotSpecialCased`
  pins the removal of the old slot special-case; what remains is one deliberate
  `AppIDHardLimit` pin in `getExtensionTypeFromApp` (pinned to `legacyComponent`) plus
  whatever survives in the UI kit. Ticket stays open for the remainder.
- **BEX-435** (Code In Review, QA) — POM coverage that host-kit slots render nothing
  without a manifest app; the POM PR is open and ready for review.
- **BEX-436** (Backlog, backend) — `/extensibility/integrations` `totalCount` diverges
  from the items actually served. Note: the BEX-426 rework (#727/#733/#735) reshaped this
  handler's counting (`totalCount` now counts installations, with the divergence
  documented in comments) — re-scope the ticket against current `main` before starting.
- **BEX-237 / BEX-297** (Ready for dev, frontend) — legacy retirement
  (`DeepIntegrationAppCollection` / `placement` / `supportedEntities`). Its gate — all
  three hosts migrated and deployed — is now satisfied, so this is actionable.
- **BEX-281 itself** (Dev In Progress) — close the epic once the above drain.

**Landed on app-store-backend `main` since the PDR (2026-08-24):** the extensibility read
path serves the per-entry contract — per-entry card `size` on appConfigs (BEX-416, #727)
and per-entry CTA copy with the entry as the **only** CTA source (BEX-426, #733 + #735).
Server-side serving of BEX-416/426 is no longer an open item.

**Housekeeping from the PDR (re-checked 2026-08-24 — several closed themselves):**
- Close the folded QA PR; **stamp the BEX-424 applied marker** in bo-be's
  `specs/database.sql` (verified still absent).
- ✅ **Registry seed verified on PROD (2026-08-24):** 12 rows (ids 4–15,
  contact/company/dealDetails × 4 slots), both identities on every row, post-rename
  dotted slugs, no duplicate slugs, and the composite unique + context CHECK constraints
  in place. The 2026-08-18 slug-rename migration is applied on prod, and the
  post-rename **extensibility Redis flush was done** (`extensibility:integrations:*`).
  🔲 **Staging: still unverified** — run the same two queries (registry rows +
  `extension_points` constraints) against staging.
- bo-be hardening trio (2026-08-03) — **2 of 3 now resolved on `main`**:
  ✅ advisory-lock coverage (`pg_advisory_xact_lock` serialises both
  `http_cli_update_app.go` and `http_cli_upload_app.go` writes);
  ✅ missing `oauth_id` no longer 404s (`http_cli_get_app.go` skips the OAuth call and
  serves the app without credentials when `oauth_id` is absent);
  🔲 the upload **input guard** — no clearly attributable guard found; keep open.
- ✅ bo-be: obsolete snapshot round-trip test and stale DEPLOY-ORDER comment are **gone**
  (no `#710` references remain on `main`).
- Backend swagger cleanup (gap #9) and the "flush the extensibility Redis keys on every
  shape-change deploy" ops rule.
- DB — **VERIFIED on PROD (2026-08-24), with one real finding**.
  `appstore.as_integrations` carries exactly two constraints: the PK and
  `FOREIGN KEY (app_id) REFERENCES appstore.apps(id) ON DELETE CASCADE`.
  - ✅ **FK ON DELETE CASCADE confirmed** — deleting an app really does take its installs
    with it, which is precisely what `brevo app delete`'s warning (BEX-427) says.
  - ⚠️ **The `(client_id, app_id)` unique constraint DOES NOT EXIST.** Install
    idempotency is therefore application-level only (`findExistingInstallation`); two
    concurrent installs can race past the check and insert duplicate rows. Raise as a
    platform ask alongside the `surface_point_name` unique.
  - ⚠️ **No status CHECK/enum at the DB level** — status labels are enforced (if at all)
    in application code only.
- Contacts host: six pre-merge items (gaps #10/#14, debug `console.*` removal,
  manifest promise-cache eviction on route re-entry, one-render-stale `recordId`) were
  never individually ticked after the host PR merged — verify against the merged diff.
- ✅ **PII / `email` context — CLOSED by decision (2026-08-24): no email for now.** Two
  facts settle it: the live vocabulary contains no `email` — every row's
  `allowed_context_field` is exactly `["recordId","recordName","userId","locale","accountId"]`
  (bo-be `specs/database.sql`, verified against prod & staging 2026-08-10, no drift) — and
  that file already gates *adding* it on PII sign-off ("widening it (e.g. adding email)
  needs PII sign-off first"). So nothing is exposed today and nothing needs retroactive
  sign-off; the sign-off requirement stays as the gate on any future widening. The two CLI
  test fixtures that used `'email'` as a context value (wire.test.ts, list.test.ts) were
  scrubbed to the real vocabulary — they were the only `email` context anywhere in this repo.

**Open decisions parked in the PDR (unscheduled):**
- **BEX-218** — contract-version gate vs lockstep, three sub-decisions open (semver vs
  counter, one number vs several, echo-back). The kit deliberately hasn't bumped `'1'`.
  ⚠️ Key mismatch (2026-08-24): Jira's BEX-218 is *"CLI: Flow and Tech Improvements and
  smoke testing"* (Dev In Progress) — the contract-version decision lives elsewhere;
  re-locate the right ticket before acting on this line.
- ~~**BEX-372** — CORS expose-headers for `X-Extensibility-*`~~ — **Rejected / Won't Do**
  in Jira (2026-08-24); drop it.
- Enable/disable of an extension point at runtime; registry-driven default styles —
  both folded into future RFCs.
- Deal-page rollout gate vs the live PandaDoc legacy mount — the epic's last open
  "key question".

### 7. Docs debt — ✅ RESOLVED 2026-08-24
All three files were rewritten for the current surface (docs-branch commit 0437680) and
then moved onto **this branch's root**; the `docs/public-cli-ui-apps-feature-changes`
branch is retired (safe to delete — its history is preserved in the closed PR #53 and in
git). What was done:
- ✅ `RELEASE-CHECKLIST.md` — the **Before UI-apps GA** checklist collapsed into a record
  of the flip; the resolved survivors (corporate discriminator, install idempotency) are
  recorded there and in `docs.md`'s Resolved section.
- ✅ `QA-TESTCASES.md` Suite 12 — rewritten for `install`/`uninstall`, per-entry fields
  and `size`, dotted slugs, and the single-placement create flow; the 2026-08-13 results
  kept and annotated with what they predate.
- ✅ `docs.md` Part 1 — UI-apps copy marked superseded by this branch's pending changeset
  and rewritten to match it; Part 2 re-baselined (ship-steps blocking list, `?type=`
  filter and missing DB uniques as platform asks, resolved items moved).
