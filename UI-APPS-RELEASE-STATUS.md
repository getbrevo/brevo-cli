# UI apps (action links) — release status

> Working notes derived from PR #53 (`docs/public-cli-ui-apps-feature-changes`:
> `RELEASE-CHECKLIST.md`, `QA-TESTCASES.md`, `docs.md`), the BEX-281 epic and the Action
> Link Dev PDR, cross-checked against the code on `main` / `feat/bex-416-entry-size` as of
> 2026-08-21. **Branch-local working doc — never merge into `main`** (see CLAUDE.md).
> References are Jira keys and PR numbers only.
>
> ⚠️ The PR #53 docs are dated 2026-08-13 and predate the UI-apps GA flip. They still say
> "UI apps are not GA", call the commands `deploy`/`rollback`, and describe root-level
> `label`/`more_info`. All three are stale — see "Docs debt" below.

## Headline: UI apps are ALREADY GA

`FEATURE_STAGE['ui-app-type']` and `FEATURE_STAGE['account-install']` are `'ga'`
(`src/lib/preview.ts`). `app install` / `app uninstall` live in
`src/commands/definitions.ts`, their bindings are asserted **present** in every build via
`GA_MARKERS` in `scripts/build.mjs`, and the *UI app* choice ships in the published
app-type prompt. The release event has happened; what remains is verification debt,
open decisions, and doc cleanup.

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
  extensibility UI kit, BEX-308/BEX-350). Authored key is `surface_point_name` (kebab slug).
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
  (`GET /v3/corporate/subAccount`) are no longer assumed. Follow-up: the code comments and
  `docs.md` (docs branch) still call this unverified — update them to close it out.
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

### 1. Blocked / unverified contracts (highest value)
- **Install idempotency** — whether a repeated install to the same account upserts. The CLI
  relies on it and never checks for an existing install; `findExistingInstallation` reads as
  an upsert but it was inferred, not confirmed.
- **Environment sequencing (BEX-426)** — the per-entry keys 400 (`unknown key`) on any bo-be
  that predates its side of the move. Confirm every target environment is updated before
  pointing a current build at it.

### 2. QA never run (from the sign-off table — these are the real gaps)
- **`install` / `uninstall` have never been manually invoked** — TC-12.7 (install + the link
  actually renders in the CRM), TC-12.9 (refuse before upload), TC-12.10 (uninstall +
  idempotent second run), TC-12.11 (g)/(h) (account-ID validation, optional positional).
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
- **`app credentials` on a UI app** prints an empty credential form (blank client ID,
  "(none)" scopes/URLs). No UI-app branch exists in `credentials.ts` today. Decide: refuse
  with a typed message, or render a UI-app view like `app list`.
- **Friendly placement labels** in the created-app box and upload diff (they print the raw
  slug; needs a registry lookup at print time).
- **`url_pattern` as a prompt hint**; **unpaginated `promptAppSelection`**;
  **`app upload --json` stale `next.version`**.

### 4. Platform asks (raised, not CLI work)
- **`GET /v3/app-store/apps` (list) does not echo `ui_app`** — UI-app rows stop at
  `Version:`; type detection stays heuristic (`isUiAppRecordShape`) until echoed.
- **`surface_point_name` has no unique constraint** — latent collision if a thirteenth
  registry row shares a slug; fix before one is seeded.

### 5. Deliberately parked — don't "fix" without revisiting
- `iframeExtension` prompt authoring (waits on the iframe-embed RFC);
  `permittedUrls` scaffolded empty; no local dev story (`app start` for UI apps);
  per-entry context narrowing is structural only.

### 6. BEX-281 epic + Action Link Dev PDR — cross-repo remainder (added 2026-08-21)

Consolidated from the BEX-281 child-ticket statuses (Jira) and the Action Link Dev PDR's
2026-08-21 re-verification callout, corrected against this repo where the PDR is stale
(it says CLI PR #67 is open — #67 was closed in favour of **#56, merged 2026-08-19**, so
the GA code is on `main`; what has NOT happened is the npm release: `latest` is still
**2.1.0** with no UI-app surface).

**Critical path to the release:**
1. **BEX-437 (bo-be, Backlog) — the one hard blocker.** `gateUIApp` still 403s UI-app
   create/upload for accounts without the `app-store-bo-be-public-apps` toggle,
   contradicting the BEX-290 GA. Must land before or with the CLI release.
2. **Ship the CLI release** — the GA code is merged (#56); cut the version (changesets
   "Version Packages" PR) so npm moves past 2.1.0. Then flip **BEX-427** to Done (its
   `app delete` warning shipped in #56 but the ticket is still Dev In Progress).
3. **Investigate the post-deploy UI Automation Suite failure** on all three host repos'
   tag runs (likely the pre-existing app-crm `main` pipeline breakage).

**Open BEX-281 children (everything else is Done or Rejected):**
- **BEX-410** (Ready for dev, bo-be) — gap #16: `POST /apps/{appId}/build` writes a
  version row with **no snapshot**, so the UI config silently vanishes (HTTP 200) for
  developer-installed accounts. Same class as the PATCH carry-forward bug already fixed.
- **BEX-413** (Ready for dev, backend + UI kit) — gap #18: app-227 special-casing spread
  across 12+ sites in 4 layers; collapse into snapshot-driven behaviour.
- **BEX-435** (Code In Review, QA) — POM coverage that host-kit slots render nothing
  without a manifest app; the POM PR is open and ready for review.
- **BEX-436** (Backlog, backend) — `/extensibility/integrations` `totalCount` diverges
  from the items actually served (SQL count can't see `extensionType`).
- **BEX-237 / BEX-297** (Ready for dev, frontend) — legacy retirement
  (`DeepIntegrationAppCollection` / `placement` / `supportedEntities`). Its gate — all
  three hosts migrated and deployed — is now satisfied, so this is actionable.
- **BEX-281 itself** (Dev In Progress) — close the epic once the above drain.

**Housekeeping from the PDR (small, never closed):**
- Close the folded QA PR; stamp the BEX-424 applied marker in bo-be's
  `specs/database.sql`; verify the BEX-422/423 registry seed also ran on **staging**.
- bo-be hardening trio found 2026-08-03, never resolved: upload input guard, advisory-lock
  coverage of the name/logo writes, undocumented 404 on a missing `oauth_id`.
- bo-be: delete the obsolete snapshot round-trip test + fix the DEPLOY-ORDER comment
  (both were "once #710 ships" items; #710 shipped long ago).
- Backend swagger cleanup (gap #9) and the "flush the extensibility Redis keys on every
  shape-change deploy" ops rule.
- DB: verify the `as_integrations (client_id, app_id)` unique constraint + status enum
  labels, and the `app_id` FK's ON DELETE behaviour (relevant to the decided
  delete-with-warning semantics).
- Contacts host: six pre-merge items (gaps #10/#14, debug `console.*` removal,
  manifest promise-cache eviction on route re-entry, one-render-stale `recordId`) were
  never individually ticked after the host PR merged — verify against the merged diff.
- **PII sign-off on context values (esp. `email`) is not evidenced anywhere** — the
  `allowed_context_field` backfill went out uniform across all twelve slots; if sign-off
  was a precondition, confirm it happened.

**Open decisions parked in the PDR (unscheduled):**
- **BEX-218** — contract-version gate vs lockstep, three sub-decisions open (semver vs
  counter, one number vs several, echo-back). The kit deliberately hasn't bumped `'1'`.
- **BEX-372** — CORS expose-headers for `X-Extensibility-*`; only needed if the server
  ever echoes extensibility metadata to browsers.
- Enable/disable of an extension point at runtime; registry-driven default styles —
  both folded into future RFCs.
- Deal-page rollout gate vs the live PandaDoc legacy mount — the epic's last open
  "key question".

### 7. Docs debt — PR #53's own files are stale
- `RELEASE-CHECKLIST.md` still carries the full **Before UI-apps GA** section as if pending
  — it was worked through at BEX-290. Prune it; move survivors (corporate discriminator,
  install idempotency) into `docs.md` Part 2.
- `QA-TESTCASES.md` Suite 12 uses `deploy`/`rollback` and root-level `label`/`more_info` —
  rewrite for `install`/`uninstall` and per-entry fields (BEX-426), and for the
  single-select single-placement create flow.
- `docs.md` Part 1 release copy describes the pre-BEX-426 shape (shared root CTA fields,
  multi-select pages) — re-verify every claim before publishing, as its own header says.
