# RELEASE CHECKLIST

This file has **two sections with different lifetimes** — read this header before
editing or deleting anything in it.

| Section | Lifetime |
| --- | --- |
| `## Before public-apps GA` | **Durable.** Merges into `main` and stays there until public app distribution ships. Do **not** delete it during branch cleanup. |
| `## Before UI-apps GA` | **Durable.** Same deal for UI apps (action links) — stays until they ship. Do **not** delete it during branch cleanup. |
| `## Per-branch verification` | **Scratch.** Per-branch working state — clear it before merging the branch into `main`, but keep the file and the section headings. |

---

## Before public-apps GA

Public app distribution is not live on the Brevo platform, so the published CLI is
**built without it** (BEX-405): `--distribution public` is refused, the review-lifecycle
commands (`app submit` / `app status` / `app withdraw`) are eliminated from the bundle,
and the agent-facing docs describe only what a public build ships. See `CLAUDE.md` →
*Public app distribution is not GA* for why.

**When public apps go GA, restore them everywhere in one pass** — start with the gate,
because the doc steps below describe surface that does not exist until it is open:

- [ ] **Open the build-time gate (BEX-405).** In `src/lib/preview.ts`, flip
      `FEATURE_STAGE['public-distribution']` and `FEATURE_STAGE['review-lifecycle']`
      to `'ga'`. That one edit is the whole release: the root help, `brevo app --help`,
      the `--distribution` value list, `app create --help`'s examples, the app-type
      prompt and the refusal all read the same table. Do **not** hand-edit
      `src/lib/help.ts` or `src/commands/definitions.ts` to restore the text — they
      derive it.
  - [ ] **Move the released entries out of `src/commands/preview-definitions.ts`** back
        into `definitions.ts`. Flipping the table is *not* enough for these five: they
        are referenced from behind `__BREVO_PREVIEW__`, which is a **build** flag, not a
        stage lookup — a GA feature whose command still lives in that module would be
        eliminated from the published bundle regardless of `FEATURE_STAGE`. Delete the
        module (and its import + the `...(__BREVO_PREVIEW__ ? … : [])` spread) once it
        empties.
  - [ ] **Un-hide `app withdraw`, in both renderers.** It carries `hidden: true` in
        `src/commands/preview-definitions.ts` — a second, independent suppression that
        `FEATURE_STAGE` does not reach, so flipping the table would ship a GA command
        that is still advertised nowhere. Delete that line, **and** restore its two lines
        to the `review-lifecycle` section of `formatRootHelp` in `src/lib/help.ts`, where
        a comment marks the spot; Commander's `hidden` governs only its own generated
        output, so the hand-aligned root screen has to be edited by hand. Then drop
        `GATED_LISTED` and the two `app withdraw` cases from `preview-gate.test.ts`, and
        restore `withdraw` to TC-10.2 in `QA-TESTCASES.md`. The signature to restore:
        ```
        `  brevo app withdraw          [--app-id <id>] [--force] [--json]`,
        `                                                        Withdraw an app from submission`,
        ```
  - [ ] **Drop the freed names from `LEAK_MARKERS` in `scripts/build.mjs`.** The public
        build asserts each one is *absent* and the preview build asserts each is
        *present*, so a released command left in that list fails the build both ways.
  - [ ] Update `src/__tests__/lib/preview.test.ts` → *lists every gated feature as
        preview*, which asserts the table verbatim and is designed to fail here.
  - [ ] Re-point the public-build cases in `preview-gate.test.ts` (`GATED`,
        `GATED_HEADINGS`) and `create.test.ts` (*in a published (public) build*) at
        whatever is still gated.
  - [ ] **If nothing is gated any more**, remove the machinery in one pass:
        `src/lib/preview.ts`, `src/globals.d.ts`, `src/commands/preview-definitions.ts`,
        `jest.setup.js` + its `setupFiles` entry in `jest.config.js`, the `define` block
        and both `LEAK_MARKERS` checks in `scripts/build.mjs`, the `build:preview`
        script and `link:dev`'s use of it, the `previewFeatureOf` /
        `assertFeatureAvailable` wiring in `src/lib/command-registry.ts`, the two
        `isFeatureAvailable` calls in `src/commands/app/create.ts`, the `gatedSection` /
        `distributionValues` / `createDescription` helpers in `src/lib/help.ts`, and
        `messages.PREVIEW_FEATURE_UNAVAILABLE`.
  - [ ] **Keep esbuild.** The bundler was adopted for the gate but is now the build
        (`scripts/build.mjs`); reverting to `tsc` would change the published layout
        again — `dist/bin/files`, the single-file entry, `sideEffects: false`. Only
        `define` / `LEAK_MARKERS` are gate-specific.
  - [ ] Restore the released commands to `agent-context/SKILL.md` and
        `agent-context/AGENTS.md`, and to `README.md`'s command table. Their reference
        text was **deleted, not hidden**, so recover it from git rather than rewriting
        it — see the per-file steps below for the exact recipe. `CLAUDE.md` →
        *Keep agent docs in sync* makes this part of the same PR, not a follow-up.
- [ ] `agent-context/SKILL.md`
  - [ ] Restore the decision-tree entries for `app status`, `app submit` and
        `app withdraw`. They were deleted rather than rewritten — recover the text rather than
        writing it again: `git log --diff-filter=M -S'Commands you may not see' --
        agent-context/SKILL.md` finds the commit that removed it, and
        `git show <sha>^:agent-context/SKILL.md` prints the version that still had it.
  - [ ] "Create an app": restore `--distribution <private|public>` and the
        private-vs-public guidance ("`private` for apps used exclusively by the user's
        own organisation, `public` for apps distributed to end users or marketplace
        listings; default to `private` when the user hasn't said which"), replacing the
        current "check `--help` for the values your account accepts" wording.
  - [ ] Revisit the *`brevo --help` is the source of truth* section — delete it once
        nothing is gated, or narrow it to whatever still is.
  - [ ] Restore the `app withdraw` mentions in *Locating the linked app* and the
        `app rollback` example under *JSON errors*.
- [ ] `agent-context/AGENTS.md`
  - [ ] Restore the `brevo app status`, `brevo app submit` and `brevo app withdraw`
        rows to the *Common commands* table. Recover them the same way:
        `git log --diff-filter=M -S'Not available yet' -- agent-context/AGENTS.md`, then
        `git show <sha>^:agent-context/AGENTS.md`.
  - [ ] Restore `--distribution <private|public>` plus the private-vs-public guidance
        on the `brevo app create` row.
  - [ ] Restore the `app withdraw` / `app rollback` mentions in the `app-config.json`
        convention bullet, the *JSON errors* section and *Command help*.
  - [ ] Restore `withdraw` (and, at UI-apps GA, `deploy`) to the *Skip prompts* bullet.
        It reads `--force` for `app delete` and `logout` — the two commands a published
        build actually has. It was missed by the original strip and corrected later; it
        is not a sign that those commands never took `--force`.
- [ ] `CLAUDE.md` — delete the `## Public app distribution is not GA` section.
- [ ] `AGENTS.md` (repo root) — delete the `## Public app distribution is not GA`
      section.
- [ ] `README.md`
  - [ ] Restore `--distribution private\|public` on the `brevo app create` row.
  - [ ] Revisit the paragraph under the commands table stating that the table is the
        complete surface of a published release.
- [ ] `QA-TESTCASES.md` — delete the **⚠️ Public apps are not available to end users
      yet** blockquote (if the file still exists; it's per-branch scratch).
- [ ] Verify nothing was missed:
      `grep -rn "not been released\|source of truth" --include="*.md" .`
      (excluding `node_modules/`, `dist/`, `coverage/`) returns only this file.
- [ ] Delete this whole `## Before public-apps GA` section — and if
      `## Per-branch verification` is empty, delete the file and drop the
      *Working docs* reference to it from `CLAUDE.md`.

**Related follow-ups (not blockers for GA removal).** Open questions live in `docs.md`
→ *Part 2 — outstanding work*, not here: this file is the GA runbook, that one is the
open-questions log. Only settled decisions are recorded below, for the reasoning.

- [x] **Decided and shipped (BEX-405): the guard is the build, not a runtime check.**
      The question was whether to guard `--distribution public` at runtime or keep relying
      on documentation. It landed further than either: `scripts/build.mjs` eliminates the
      review-lifecycle commands from the published bundle, and `--distribution public` —
      which must still be parsed before it can be rejected — is refused with a typed
      `CliError` (exit 1) before any filesystem work. *Warn* was rejected because a warning
      still creates the app, which is the outcome the notice existed to prevent.

      **There is no escape hatch.** An interim version unlocked on an `@brevo.com` /
      `@sendinblue.com` account or `BREVO_ENABLE_PREVIEW=1`; both were removed when the flag
      moved to build time, because a compile-time guard a user can switch back on is a
      runtime guard wearing a costume — and it has to ship the surface in order to reveal
      it. Internal testing is `PREVIEW=1 yarn link:dev`, a different artifact.

      That also retires the old "guardrail, not a security boundary" caveat: there is no
      client-side check left to bypass. The two layers are the build and the API.

      **Removal is a GA step — see the list above.**
- [x] `README.md`'s command table drift — **closed.** The stale `brevo app update` row was
      fixed in the BEX-290 branch and `brevo app available-scopes` was added on this one.
      `status` / `submit` / `withdraw` stay out by design until GA, when the list above
      restores them.

---

## Before UI-apps GA

UI apps (action links) are not live on the Brevo platform, so the published CLI is
**built without them** (BEX-405): the *UI app* choice at `app create`'s app-type prompt
and the `app deploy` / `app rollback` commands are eliminated from the bundle, and the
agent-facing docs describe only what a public build ships.

**When UI apps go GA, restore them everywhere in one pass:**

- [ ] **Open the gate.** In `src/lib/preview.ts` flip `FEATURE_STAGE['ui-app-type']`
      and `FEATURE_STAGE['account-install']` to `'ga'` — then work the *same sub-steps
      listed under `## Before public-apps GA`*, which are shared machinery: move
      `deploy` / `rollback` out of `src/commands/preview-definitions.ts`, drop their
      names (and `resolveDeploymentTarget`) from `LEAK_MARKERS` in `scripts/build.mjs`,
      and re-point the public-build test cases. Do not do half of it — a feature flipped
      to `'ga'` whose command still lives in `preview-definitions.ts` is still
      eliminated from the published bundle.
- [ ] `agent-context/SKILL.md`
  - [ ] Restore the decision-tree entries for creating a UI app, `app deploy` and
        `app rollback`. They were deleted rather than rewritten — recover the text rather than
        writing it again: `git log --diff-filter=M -S'Commands you may not see' --
        agent-context/SKILL.md` finds the commit that removed it, and
        `git show <sha>^:agent-context/SKILL.md` prints the version that still had it.
  - [ ] Re-add UI apps to the *`brevo --help` is the source of truth* section's framing
        if the surface is no longer partial, or delete that section entirely once
        nothing is gated.
  - [ ] Restore the *Two app types* detail to the hard rules. The surviving rule
        (*Never mix the two app types in one `app-config.json`*) is a correctness rule
        and stays either way.
- [ ] `agent-context/AGENTS.md`
  - [ ] Restore the `brevo app deploy` / `brevo app rollback` rows to the *Common
        commands* table, and the UI-app half of the `brevo app create` row. Recover the
        text: `git log --diff-filter=M -S'Not available yet' -- agent-context/AGENTS.md`
        finds the commit that removed it, then `git show <sha>^:agent-context/AGENTS.md`.
  - [ ] Restore the *Two app types, one command surface* convention bullet, which was
        replaced by a narrower *`app-config.json` describes an OAuth app* bullet.
  - [ ] Re-add the UI-app detail to the `brevo app list` row.
- [ ] `README.md` — restore the `brevo app deploy` / `brevo app rollback` rows and the
      app-type sentence on the `brevo app create` row; revisit the paragraph under the
      table that says the table is the complete surface.
- [ ] Verify nothing was missed:
      `grep -rn "preview\|not been released" --include="*.md" .`
      (excluding `node_modules/`, `dist/`, `coverage/`) returns only this file.
- [ ] Delete this whole `## Before UI-apps GA` section.

**Related follow-ups (not blockers for GA removal).** Open questions live in `docs.md`
→ *Part 2 — outstanding work*, not here: this file is the GA runbook, that one is the
open-questions log. Only settled decisions are recorded below, for the reasoning.

- [x] **`ui_app` field names — RESOLVED.** Confirmed against both of the platform's
      consumers — the manifest read path and the extensibility UI kit
      (BEX-308 / BEX-350). The block is the stored app snapshot verbatim:
      `extension_type`, `surface_point_list` (a list of
      `{ surface_point_name, context? }` objects), `label`, `more_info`,
      `redirect_link`. The entry key is `surface_point_name` — it names the registry
      column it is matched against, and it is the slug, not the dotted slot name.
      This line said `surface_point` until 2026-08-12; that spelling is used nowhere
      and authoring it is exactly the bug bo-be's own `surfacePoint` doc comment
      records ("a CLI duly authored this value and every upload failed as an
      unregistered extension point").
      `heading`/`subheading` were the pre-BEX-290 names for `label`/`more_info`, and
      `link_target` is no longer authored into the file at all — `app upload` injects
      `_blank`. The UIApp Support Spec's `properties`/`trigger` vocabulary is not read
      anywhere and has been dropped.
- [x] **Coordinate the BEX-350 registry reseed — SEEDED (verified 2026-08-12).**
      bo-be `origin/main`'s `specs/database.sql` carries all twelve rows in the
      BEX-350 grammar, each with both identities: the dotted `extension_point_name`
      (`contactDetails.headerMenu.action`) and the kebab `surface_point_name`
      (`contact-details-header-menu`), across the three record pages x three widget
      places + one action place. The three pre-BEX-350 `<page>.left.card` rows are
      still present alongside them. **What is verified is the schema spec, not any
      particular environment's data** — confirm the target environment is on it
      before releasing, since an unregistered name is still dropped silently.
      **There is no longer a local registry copy to keep in lockstep.** An earlier
      version of this line pointed at `EXTENSION_POINTS` in `src/lib/constants.ts`;
      that mirror was deleted on this branch precisely so a copy could not lag the
      registry. `EXTENSION_PLACE_LABELS` in the same file is **CLI-owned display
      text and stays** — the registry exposes no display-name column, so either the
      CLI keeps this map or the platform adds one.
- [x] **Snapshot write path confirmed.** The platform's upload endpoint
      (app-store-bo-be `POST /cli/apps/{app_id}/upload`, branch
      feat/bex-355-cli-snapshot-contract) binds the block under `ui_app` and
      rejects unknown keys with a 400. The CLI now sends `ui_app` to match
      (`src/types.ts` `UploadAppPayload` and `upload.ts`). "snapshot" on the
      platform means the whole stored app config; this block is only its UI
      subset, hence the key.
- [x] **Ship BEX-361 and confirm its /v3 mapping — SHIPPED, and every sub-item below
      is now answered from the deployed handlers** (bo-be `origin/main`, prod image
      1.7.0; `http_cli_get_surface_points.go` and
      `http_cli_get_surface_point_locations.go`). UI-app creation is no longer
      blocked on an unshipped endpoint. The CLI still makes TWO reads per run, asking
      different questions: `GET /v3/app-store/surface-points/locations` for the
      record-page prompt (distinct location names, no rows), then
      `GET /v3/app-store/surface-points?location=<comma-separated>` for the
      placements on the pages that were picked.
      - [x] `/surface-points/locations` answers `{ locations: []string, count: int }`.
            Confirmed — the response struct is exactly those two fields. The CLI's
            bare-array tolerance is now provably unnecessary (see `docs.md`); it is
            being kept deliberately, not pending.
      - [x] The response rows carry `extension_point_name`, `location_name`,
            `section_name`, `component_type`, `surface_point_name`,
            `default_context_field`, `allowed_context_field`. Confirmed — and note
            what is **absent**: the projection publishes no `extension_type_list` and
            no `status`, and neither is even a column in `extensionPointColumns`. The
            pre-BEX-361 spellings (`extension_point`, `location`, `place`, `kind`,
            `supported_extension_types`) are confirmed dead; bo-be's own comment says
            `place` and `kind` "are not column names and must not appear on the wire".
      - [x] **Consequence of that absence: `rowSupportsExtensionType` can never
            filter anything.** It is written to treat a missing `extension_type_list`
            /`status` as permissive, so the behaviour is correct rather than broken —
            but the "page whose every placement is un-hostable" warning path it feeds
            is unreachable against today's registry. Do not delete the path (the
            columns may yet arrive); do not rely on it either.
      - [x] `?location=` is honoured and an unknown value 400s listing the valid
            locations (`parseLocationFilter`), rather than being silently dropped.
            There is also an explicit `all` sentinel for "no filter". Confirmed, so
            the unfiltered retry can go (see `docs.md`) — again, kept deliberately.
      - [x] Row order is deterministic: `buildSurfacePoints` sorts by
            (`location_name`, `section_name`, `component_type`) with
            `extension_point_name` as the tiebreaker, and bo-be documents the
            ordering as part of the contract for exactly the reason this line gives.
      - [ ] Remaining, and it is a data question rather than a contract one: confirm
            the target environment's registry is actually seeded, and that
            `location_name` is populated on every row — a row missing it is served
            (and logged) rather than hidden, and cannot match a location filter.
- [x] **Confirm the no-auth wire contract for UI apps — ANSWERED live (2026-08-12,
      production).** Both requests are tolerated with the whole `auth` block omitted:
      `POST /v3/app-store/apps` created the UI app and `POST .../upload` accepted it
      (`200`, version bump), neither carrying an `auth` key. On the credentials
      question: the server does **not** issue usable OAuth credentials for a UI app —
      `GET /v3/app-store/apps/{id}` answers `client_id: ""` with `grant_types: null`,
      `redirect_uris: null`, `scopes: null`. So `auth: {}` in the file is accurate.
      (Related bug found in the same run: the create response nests credentials under
      `auth` and the CLI reads them flat — see `docs.md`.)
- [x] **Create actually branches on `ui_app` — ANSWERED live (2026-08-12, production).**
      The open question in `CLAUDE.md` ("whether the create endpoint actually branches on
      it is not yet confirmed") is settled: it does more than branch, it **persists the
      block**. A create carrying `ui_app` and no `auth` returned `version: 0.0.1`, and
      the immediately-following `GET /v3/app-store/apps/{id}` echoed the full block back
      — `extension_type`, all `surface_point_list` entries with their `context`, `label`,
      `more_info`, `redirect_link` — including the 3-placement multi-page case. Hence the
      first `app upload` after a create correctly reports **"Already up to date"** rather
      than showing the whole block as new.
- [x] **The installs POST response carries an install ID — ANSWERED (2026-08-12).** It
      returns `{"brevo_integration_id": <n>, "installation_id": <n>}` (both the same
      value). The CLI currently discards it. Nothing depends on it — the developer
      uninstall route resolves the install from the body, which is why `DELETE` needs no
      ID — so surfacing it is optional, but it is available if a future `app status`-style
      view for deployments wants it.
- [x] **`/v3/account/info` `type` discriminator — partially answered (2026-08-12).** A
      plain internal account answers `type: "standard"` (with `enterprise: false`), and
      `resolveDeploymentTarget()` took the deploy-into-itself path with no prompt, so
      `--json`/CI is safe there. The `type === "corporate"` branch and its
      `GET /v3/corporate/subAccount` listing are **still unverified** — they need a
      corporate account.
- [x] **A non-numeric `organization_id` really is omitted, and the server copes —
      CONFIRMED live (2026-08-12).** The test account's `organization_id` is the hex
      string `60af7557…`, so `toNumericIdentifier()` returned `undefined` and `pick()`
      dropped both identifiers: the install body went out as exactly
      `{"name": "...", "is_developer": true}` with **no `client_id` and no
      `deploy_client_id`**. `POST` answered `201` and `DELETE` `204`, so the gateway
      header resolution and the caller-defaulting both work as designed. This is the
      case `CLAUDE.md` predicts ("a plain account deploying into itself").
- [x] **Deploy/rollback route and body — resolved (2026-08-06).** Confirmed against the
      staging endpoint: it is one resource, `/v3/app-store/apps/{id}/installs`, with
      `POST` to install and `DELETE` to remove, both carrying the same body —
      `deploy_client_id` (the account ID, as a **number**), `name`, `is_developer`.
      `ENDPOINTS.APP_STORE_APP_INSTALLS` and `appService.deployApp` / `rollbackApp`
      now match. The CLI sends the app's own name as `name` and `is_developer: true`
      unconditionally.
- [x] **Rollback's rejection code — RESOLVED (app-store-backend PR #717, BEX-364).**
      `DELETE /apps/{app_id}/installs` resolves the install from the request body
      (`client_id` + `is_developer`, optional `deploy_client_id`) because a developer
      never sees an `installation_id`. It answers **404** — not 422 — for *both* an
      unknown app and an absent install, distinguishable only by the error copy.
      `app rollback` maps any 404 to its informational not-deployed path (exit 0) and
      `rollbackApp()` deliberately skips `rethrowNotFound`. The body also carries
      `client_id` (the caller's `organization_id`), without which the endpoint 400s.
- [x] **Deploy's rejection code — ANSWERED, and the answer is that there isn't one
      (verified 2026-08-12 against app-store-backend `origin/main`, prod image
      1.5.0).** The assumed `422` for "not yet uploaded" does not exist:
      `http_create_integration_details.go` resolves the app by UUID (404 when the
      lookup fails), checks the plan, and inserts. Nothing on the path asks whether
      the app was ever configured — `IsAppConfigured` has no caller in the repo — so
      **deploying a never-uploaded app answers `201` and renders nothing.**
      Two consequences, both actioned:
      - `assertUploadedBeforeDeploy()` is the *only* gate and now covers every
        resolution path, not just the linked-project one it was written for: a linked
        project is answered from `app-config.json` (no round trip), `--app-id` and the
        picker read the app's server-side `version`. A read failure is non-fatal by
        design.
      - The `422` branch in `deploy.ts` is dead but kept, and its comment now says so
        rather than claiming the server is the authority.
      - [x] `name` — **required**, not advisory: `validateRequestBody` rejects an empty
            or blank name (and one over 200 chars) with a missing/invalid-parameter
            error. The CLI always sends the app name, so this is satisfied.
      - [x] The POST response carries `{brevo_integration_id, installation_id}` (both
            the same value). The CLI discards it, which stays fine while rollback
            addresses the install by account rather than by ID.
      - [x] **The body's `client_id` is ignored when the gateway sets the header.**
            `extractClientID` reads `X-Sib-Client-Id` **first** and only falls back to
            the body. This is what makes the CLI's omit-a-non-numeric-identifier
            strategy correct rather than merely lucky.
      - [ ] Still open: whether a repeated deploy to the same account is an idempotent
            upsert. `findExistingInstallation` does key a developer install on
            client_id + app_id + is_developer, which reads as an upsert — the CLI
            relies on it, since it never checks for an existing install — but confirm
            it rather than inferring it from the lookup.
- [x] **`organization_id` shape — DEFUSED, no longer blocking.** Both body identifiers
      are Go `int64` and the handler decodes the body *before* reading
      `X-Sib-Client-Id`, so a UUID in either field would 400 a request the header
      resolves fine. The CLI therefore **omits** a non-numeric identifier rather than
      sending it (`toNumericIdentifier()` + `pick()`), which is safe in both directions:
      `client_id` falls back to the gateway-populated header, `deploy_client_id`
      defaults to the caller. Confirmed against staging — a working `DELETE
      .../installs` carries no `client_id` at all. `organization_id` was observed as a
      UUID during BEX-290; if that holds, deploy/rollback still work, they just lean on
      the header. Worth confirming the shape for the record, but it no
      longer gates GA.
- [x] **`GET /v3/app-store/apps/{id}` returns the `ui_app` block — CONFIRMED
      (2026-08-12, bo-be `origin/main`).** The echo is already shipped, not planned:
      `applyLatestVersionFields` reads the latest `app_versions` row and sets
      `resp.UIApp = uiAppResponseFromSnapshot(snap.UIApp)`, and `cliOAuthAppResponse`
      declares `UIApp *uiAppResponse` with `omitempty` so OAuth-only apps and
      pre-snapshot versions see the response they always did. It is the same wire
      shape upload binds, which is what makes the diff reconcilable. The response type
      is `uiAppResponse`, so **`link_target` is never echoed** — the CLI's write-back
      strip is therefore belt-and-braces on this path rather than load-bearing, but
      keep it: upload's own echo is where the field showed up. The two normalizations
      must keep working — the diff ignores `link_target`/`version` and sorts
      `surface_point_list` so a server echo is never reported as local drift.
- [x] **`GET /v3/app-store/apps` (list) does NOT echo `ui_app` — CONFIRMED by code,
      matching the live 2026-08-11 observation.** `applyIdentityFields` sets only
      `app_id`, `name`, `distribution_type`, `version`, `display_version`; there is no
      snapshot read on the list path. So `brevo app list`'s UI-app detection must keep
      its heuristic (`isUiAppRecord` — no `client_id`, no callbacks) and the detail
      rows in `printUiApp` stay unit-tested only. This is a platform ask, not a CLI
      fix — see `docs.md`.
- [x] **`owner_user_id: 0` on UI-app records — EXPLAINED, and it is not a bug to
      raise.** The field is OAuth-service-owned. An app with no linked OAuth
      credentials has no OAuth body to source it from, so `buildAppStoreOnlyResponse`
      leaves it at the zero value. Nothing in the CLI reads it. The item that
      called this a create-path failure to stamp the owner was wrong.
- [x] **Decided and shipped (BEX-405): the CLI gates the UI-app path too.** Same
      decision as `--distribution public` — refuse, don't warn — and the same escape
      hatch. The shape differs because there is no flag to refuse: a UI app is only
      reachable from the interactive app-type prompt, so the gate *withholds the
      choice* rather than rejecting an answer. A locked run doesn't ask at all, which
      restores the exact pre-BEX-290 flow instead of showing a one-item list. The
      prompt being interactive-only was a soft limit on reaching it accidentally; it
      was never a limit on reaching it deliberately, which is what the gate adds.

      `app deploy` / `app rollback` are gated as commands (capability
      `account-install`), hidden from help and refused when invoked.

      **Removal is a GA step — see the item added to the list at the top of this
      section.**

---

## Per-branch verification

Append an entry per change that needs verifying. Clear this section (keep the
heading) before merging into `main`.

### BEX-405 — the pre-GA surface is removed at build time (2026-08-12)

**Change:** the gate moved from a runtime check to build-time elimination. `yarn build`
(esbuild, `scripts/build.mjs`) folds `__BREVO_PREVIEW__` to `false` and drops the gated
modules; `PREVIEW=1 yarn build` (or `yarn link:dev`) keeps them. The earlier escape
hatches — an `@brevo.com` account check and `BREVO_ENABLE_PREVIEW=1` — are **gone**;
internal testing is a different artifact, not a different flag.

**What is eliminated from a public build:** the five gated command modules and their
definitions, `commands/app/account-deployment.ts`, the whole UI-authoring layer
(`app-types/ui/authoring.ts` — registry reads, placement prompts, summary box), the
gated root-help sections, and 63 gated strings (`lang/preview-messages.ts`).
183.8 kB → 167.2 kB.

**What is NOT eliminated, by construction:** properties of object literals, which
esbuild cannot prune — `CLI.APP_DEPLOY`/`APP_ROLLBACK`/`APP_SUBMIT`/`APP_WITHDRAW`, the
`/withdraw` and `/installs` entries in `ENDPOINTS`, and `appService`'s `deployApp` /
`rollbackApp` / `withdrawApp` methods. All inert — nothing reaches them and no help
lists them. Fixable with the same split used for `lang/preview-messages.ts` if it ever
matters; deliberately not done here.

**Must hold true:**

- [x] `yarn build` fails if a gated module survives; `yarn build:preview` fails if one
      goes missing. Both directions asserted on the output in `scripts/build.mjs`.
- [x] A public artifact answers `unknown command` for all five gated commands, refuses
      `--distribution public` with the typed message, and ignores
      `BREVO_ENABLE_PREVIEW=1`. Verified by running `dist/bin/index.js`.
- [x] A preview artifact lists all five in `brevo app --help`. *(Superseded: `withdraw`
      is now `hidden` and lists nowhere — see the entry below. The other four are
      unchanged, and all five are still registered.)*
- [x] Bundling did not break runtime path resolution — `--version` (package.json),
      `skill:cli install` (agent-context), scaffolding (templates at `dist/bin/files`).
      All three verified against the built artifact, not mocks.
- [x] `npx tsc --noEmit`, `yarn lint`, `yarn format:check`, `yarn test`
      (56 suites / 1189 tests) green.
- [ ] **Manual, blocking:** `npm pack` and install the tarball in a clean directory —
      confirm `brevo app scaffold` writes template files and `brevo skill:cli install`
      works from the *packed* layout, not just from `dist/` in the repo. The `files:`
      allowlist still says `dist`, which now contains a different tree.
- [ ] **Manual:** confirm CI's `yarn install --frozen-lockfile` accepts the added
      `esbuild` devDependency — it reuses tsx's existing `esbuild@~0.28.0` lockfile
      entry, so no lockfile change was needed, but that is worth seeing go green once.
- [ ] Reviewer: `sideEffects: false` was added to `package.json`. It is what lets the
      bundler drop unused modules. Confirm no module in `src/` is imported purely for a
      side effect (there are none today — `grep -rn "^import '" src`).

### The deploy upload-gate covers every resolution path (2026-08-12)

**Change:** `assertUploadedBeforeDeploy()` takes the resolved app ID and became
async. A linked project is still answered locally from `app-config.json`'s
`version`; outside one (`--app-id`, or the interactive picker) it reads the app and
checks the server-side `version`. `CreateAppResponse.created_at`/`updated_at` and
`OAuthApp.created_at`/`updated_at` became optional in the same pass.

**Why this stopped being optional.** The gate was written as a pre-flight, with the
server's `422` as the real authority — the comment said so. Reading the deployed
handler shows there is no such authority: app-store-backend's
`http_create_integration_details.go` (`origin/main`, prod image 1.5.0) resolves the
app by UUID, checks the plan, and inserts. No configured/uploaded check exists
anywhere on the path. So for `--app-id` and the picker there was **no gate on either
side**, and deploying a never-uploaded app answered `201` and rendered nothing —
exactly the silent no-op the gate exists to prevent.

The timestamp fields are the same class of defect as BEX-405 and were found looking
for more of it: no deployed handler sends them (`cliOAuthAppResponse` and
`cliCreatePublicResponse` both declare no timestamp), nothing in `src/` reads them,
and declaring them required is what lets a call site read `undefined` with the
compiler silent.

**Must hold true:**

- [x] `yarn tsc --noEmit` clean; `deploy.test.ts` / `rollback.test.ts` green.
- [x] `--app-id` on an app with no server-side `version` refuses with the
      `brevo app upload` message and never calls `deployApp`. Covered by
      `refuses an --app-id app the server has no version for`.
- [x] `--app-id` on an uploaded app still deploys. Covered by `deploys an --app-id
      app that has been uploaded`.
- [x] A failed version read does **not** block the deploy — guarding a silent no-op
      must not become a new way to fail. Covered by `still deploys when the version
      read fails`.
- [x] A linked project costs no extra round trip. Covered by `does not read the app
      when a linked project answers the question`.
- [ ] **Manual:** `brevo app deploy --app-id <uuid>` against an app created but never
      uploaded — confirm the CLI refuses rather than answering `201`. This is the
      case that was silently broken.
- [ ] Reviewer: the `422` branch in `deploy.ts` is now documented as dead-but-kept.
      Confirm that is preferable to deleting it — the argument for keeping it is that
      it costs nothing and still reads correctly if the check is ever added.
- [ ] Reviewer: no user-visible flag, command or output changed (a refusal that
      should always have happened is not new surface), so no `SKILL.md` / `AGENTS.md`
      edit. Confirm that reading.

### BEX-405 — `app create` reads the nested `auth` block off the create response (2026-08-12)

**Change:** `createApp()` now lifts `auth.{client_id, client_secret, redirect_uris,
scopes}` to the top level before returning (`flattenCreateAuth`,
`src/services/app.ts`), and `CreateAppResponse` declares those four optional.

This is a **branch regression, not a live bug** — it never reached npm. The
unified-payload work moved the create *request*'s OAuth fields inside `auth`; the
platform's nested-contract handler echoes that nesting back, so the response
changed shape while all seven read sites kept reading the flat one. Nothing
type-errored, because the type declared the fields required and flat, so the reads
compiled clean against `undefined`. Confirmed against production with `--debug` and
against `main`'s build (`0ad977c`) side by side.

Both shapes are tolerated — the flat handler is still live on some deployments —
so this is a compatibility shim, not a migration. Two follow-on fixes came with it,
both consequences of the same wrong assumption that a create response always
carries credentials: the UI-app box no longer renders `Client ID` / `Client secret`
rows (a UI app has neither), and `saveAppCredentials` is skipped when there is no
pair to cache.

**Must hold true:**

- [x] Nested, flat, mixed, and UI-app (no `auth`) responses all resolve correctly.
      Covered by four cases in `src/__tests__/services/app.test.ts` → `createApp`.
- [x] A present flat field wins over its nested twin — asserted, so a future
      "simplification" to nested-first is a test failure rather than a silent
      behaviour change.
- [x] `--json` emits `clientId` and `redirectUri` with real values. Asserted on the
      values, not just key presence: `JSON.stringify` drops `undefined`, which is
      exactly how the regression stayed invisible.
- [x] The UI-app fixture in `create.test.ts` carries no credential fields, matching
      what the platform actually returns for a UI app.
- [x] `yarn lint && yarn format:check && npx tsc --noEmit && yarn test` green
      (51 suites / 1073 tests).
- [ ] **Manual, blocking — this is a wire-shape fix, so mocks cannot confirm it.**
      Run `brevo app create --name "..." --distribution private --json` against
      staging and confirm `clientId` and `redirectUri` are both present and correct.
- [ ] **Manual, blocking:** run the same create interactively and confirm the box
      prints a real `Client ID:` and one `Redirect URL n:` line per callback.
- [ ] **Manual:** create a UI app interactively and confirm the box shows no
      credential rows, and that `~/.brevo/credentials.json` gains no `apps` entry
      for it.
- [ ] **Manual:** confirm the scaffold read-back fallback path still works — it
      reads `client_id` / `redirect_uris` off the same response
      (`scaffold.ts:137,144,145`) and was silently degrading to placeholders.

### BEX-355 — `app create` stops sending `source: 'cli'` (2026-08-07)

**Change:** `createApp()` posts the declared payload and nothing else. This closes
the open `docs.md` item on the key's fate, and it is the last top-level key the CLI
was adding to a request body outside the declared contract (`cli_version` went
earlier on this branch).

The trigger was a live `400`: `POST /v3/app-store/apps` now answers
`invalid_parameter` — *public apps cannot be created with source "cli"; use
distribution_type "private"* — for any create pairing `source: 'cli'` with
`distribution_type: "public"`. The platform has started reading the key as policy
input rather than telemetry, which is the API-side pre-GA guard `CLAUDE.md` says
belongs there. Removing the key from the body is not a way around that guard; it
just stops the CLI asserting a field the create contract never declared. The
backend still identifies the caller from the structured `User-Agent`
(`brevo-cli/<version>`, `src/lib/telemetry.ts`), which is the same resolution the
`cli_version` removal landed on.

**Must hold true:**

- [x] The create body carries the payload verbatim — no `source`, no `cli_version`.
      Covered by `should POST to app-store/apps with the payload unchanged and
      normalize app_id`.
- [x] `yarn test` green on `src/__tests__/services/app.test.ts` (54 tests).
- [x] `yarn lint && yarn format:check && yarn tsc --noEmit && yarn test` green
      across the suite (47 suites / 1002 tests).
- [ ] **Manual, blocking — the behaviour change is entirely server-side.** With the
      key gone, run `brevo app create --distribution private` against staging and
      confirm it still succeeds and the app is attributed to the CLI (the platform
      reads `User-Agent`; confirm it actually does for *create*, not just upload).
- [x] **Manual, blocking:** run `brevo app create --distribution public` against
      staging and record what the platform now does with an absent `source`. Three
      outcomes, and they need different follow-ups: still `400` (guard keys on
      something else — fine, nothing more to do), succeeds (the CLI can now create
      a public app that no notice or guard prevents — that is a pre-GA regression,
      raise it on BEX-355 before release), or a different error (map it in
      `src/lang/en.ts`).

      **Answered (2026-08-12): still `400`, same copy** — *public apps cannot be
      created with source "cli"; use distribution_type "private"* — with `source`
      absent from the body. No pre-GA regression: the restriction holds without the
      CLI asserting the field. The message is now mapped, see the entry below.

      **Why, confirmed by reading app-store-bo-be — and it is not the `User-Agent`.**
      `POST /cli/apps` assigns `payload.Source = SourceCLI` before validating
      (`http_cli_create_app.go`, and identically `http_cli_create_app_public.go` for
      the nested `auth`/`ui_app` contract the CLI sends). Its comment says the
      overwrite is deliberate — "so the public-app gate cannot be bypassed by sending
      a different source". So the body key was never what the gate read, and the
      BEX-355 removal could not have affected it either way. An earlier revision of
      this entry credited the `User-Agent`; that was wrong. `User-Agent` carries
      *attribution*, and the sign-off item below is still the one that covers it.
- [ ] **BEX-355 sign-off, blocking:** confirm with the create endpoint's owners that
      an absent `source` is contract-valid and that dropping it does not change how
      an app is attributed, rate-limited, or gated. The key was undeclared, so its
      absence is not obviously safe either.
- [ ] Reviewer: nothing else in `src/` references `source` on a request body —
      `src/services/skill.ts`'s `source: 'brevo-cli'` is the local skill-install
      marker written to disk, unrelated.
- [x] Reviewer: decide whether `--distribution public` should now fail locally with
      a real message instead of surfacing the raw server `400` after the scaffold
      directory has already been created and entered. Tracked in `docs.md`; see also
      the runtime-guard item under *Before public-apps GA*.

      **Decided (2026-08-12): translate the server's refusal, do not guard locally.**
      See the entry below. The stray-directory half of this item is not fixed and is
      now tracked separately in `docs.md` — it affects every hard create failure, not
      just this one, and fixing it trades against orphan-app risk.

### `app create` explains the platform's public-app refusal (2026-08-12)

**Change:** a `400` on a public-app create whose message names `distribution_type` is
translated into `APP_CREATE_PUBLIC_REJECTED` — a `CliError` that says public
distribution isn't available yet, names `--distribution private`, notes that
`distribution_type` is fixed at creation, and quotes the server's own sentence.
`isPublicDistributionRefusal()` in `src/commands/app/create.ts` does the matching.

**Deliberately not a local guard.** The CLI still sends `distribution_type: "public"`
and lets the platform refuse it, per `CLAUDE.md`'s standing rule that the CLI must not
mirror platform policy locally (the same reasoning that removed the local
extension-point list). Confirmed against app-store-bo-be, that is not merely tidier —
**a local guard would be incorrect**, because the restriction is per-account:

- `allowPublic` is the Unleash flag `app-store-bo-be-public-apps` resolved for the
  calling client (`http_cli_create_app.go`), failing closed on a lookup error.
- It lifts the rule for the `cli` source only — `oauth` never gets it — and was added
  by app-store-bo-be `cf3d19a`, *"allow public app creation for internal accounts on
  POST /cli/apps [BEX-333]"*.
- So the **server already implements the internal-account escape hatch** `CLAUDE.md`
  requires of any guard. An account with the flag enabled creates public apps from the
  CLI successfully and never reaches this translation. A hard-coded local refusal would
  break exactly that account — the dogfooding case the clause exists to protect.

An earlier revision of this entry, and of the notice in both agent docs, claimed the
server refused *every* caller including `@brevo.com`. That was wrong and is corrected;
the docs now say the allowance is per-account and tell an agent not to infer from a
failure that the account isn't internal.

One detail the CLI cannot currently trip: the same check rejects an **empty**
`distribution_type` too (it defaults to public downstream), even when `allowPublic` is
set. `resolveDistribution()` always sends an explicit value, so this only matters if a
future change makes the field optional on the wire.

**Must hold true:**

- [x] Four tests in `src/__tests__/commands/app/create.test.ts` under *the platform's
      refusal to create a public app from the CLI*: the explanation fires, the server's
      sentence is quoted, a public create is still **attempted** (the anti-local-guard
      assertion), and an unrelated `400` on a public create keeps its own text.
- [x] `yarn lint && yarn format:check && yarn tsc --noEmit && yarn test` green.
- [ ] **Manual:** `brevo app create --distribution public` against staging now prints
      the mapped message and the quoted server text, and still exits non-zero.
- [ ] **Manual:** `brevo app create --distribution public --json` writes the mapped
      message inside the single `{"error": {...}}` document on stdout (the global
      `emitJsonError` path — this branch deliberately doesn't call `jsonOutput` itself,
      unlike the older `APP_LIMIT_REACHED` branch beside it).
- [ ] Reviewer: confirm the `/distribution_type/i` match is the right narrowing. It is
      what stops an unrelated `400` being relabelled; if the platform rewords its
      sentence the match stops firing and the raw message surfaces again, which is the
      pre-change behaviour rather than a new failure mode.

### `ui_app_not_enabled` reads as a sentence, not a wire key (2026-08-12)

**Change:** `ERR_UI_APP_NOT_ENABLED` replaces the platform's `ui_app is not enabled for
this account`. Registered in `apiCodeMessages` (`src/api/client.ts`) under the API code
`ui_app_not_enabled`, not in a command.

**Why centrally, and why this one doesn't quote the server.** app-store-bo-be's
`gateUIApp` answers `403` / `ui_app_not_enabled` when the calling account lacks the
public-apps flag and the request authors a `ui_app` block. It guards **two** commands —
`app create` (`http_cli_create_app.go:214`) and `app upload`
(`http_cli_upload_app.go:547`, `:591`) — so a per-command branch would need writing
twice. Unlike the public-app refusal, this one is identified by a *stable code* rather
than by copy, so there is no rewording risk to leave an escape valve for and the raw
sentence is not appended.

**It is the same allowance as public apps** (`app-store-bo-be-public-apps`), so an
account that can create public apps can author `ui_app` blocks too, and an enabled
account never sees either message. Both agent docs now say so under the UI-apps notice.

**Must hold true:**

- [x] `replaces the raw ui_app_not_enabled copy with actionable text` in
      `src/__tests__/api/client.test.ts` — asserts the mapped text, that the wire key
      `ui_app is not enabled` does *not* reach the user, and that `apiCode` /
      `statusCode` survive for scripts.
- [x] `yarn lint && yarn format:check && yarn tsc --noEmit && yarn test` green.
- [ ] **Manual:** on an account without the flag, `brevo app create` → *UI app* and
      `brevo app upload` of a `ui_app` config both print the new message and exit
      non-zero. Note the server sends the text under `error`, not `message`.
- [ ] **Manual, blocking before UI-apps GA:** confirm on an account *with* the flag
      that neither command sees this message — i.e. the mapping is inert rather than
      swallowing a real failure.
- [ ] Reviewer: `mapErrorCode` still classifies this as `ACCESS_DENIED` (403). Confirm
      that is the right exit-code bucket for a per-account feature gate, or whether it
      deserves its own `ErrorCode`.

### The public-app refusal message was reworded for readability (2026-08-12)

**Change:** `APP_CREATE_PUBLIC_REJECTED` went from one long paragraph to a lead line
plus three aligned labelled lines (`Do this:` / `Note:` / `Brevo said:`). No logic
change — `isPublicDistributionRefusal` is untouched.

**Must hold true:**

- [x] The create test asserts the new lead line and `--distribution private` on a
      single invocation (a second call would exhaust the `mockResolvedValueOnce`
      prompt chain and fail before the API call).
- [ ] Reviewer: both agent docs quote this message; they were updated with it. If it is
      reworded again, re-grep `agent-context/` for the old text.

### `app create` sends the `ui_app` block for UI apps (2026-08-07)

**Change:** `buildCreatePayload()` now includes `ui_app` for a UI app, under the same
key `app upload` uses. It was deliberately upload-only before, on the reasoning that
create registers the record and upload validates the configuration.

**The trigger was a live 400 on staging.** A UI-app create sent
`{"name":"test","distribution_type":"private"}` — no `auth` block, correctly, since an
action link has no OAuth callback — and got
`{"code":"invalid_request","error":"redirect_uris is required and must not be empty"}`.
With neither `auth` nor `ui_app` in the body there is nothing in the request that says
which app type it is, so the endpoint reads it as an OAuth app missing its callbacks.
Sending `ui_app` gives create the same discriminator the CLI uses locally
(`isUiAppConfig`) and the same one upload already receives.

**✅ CONFIRMED (2026-08-12) — the hypothesis held, and readings 1 and 2 are both dead.**
This paragraph used to warn that the fix was a guess about server behaviour. It is not
any more, on two independent confirmations:

- **Live, against production.** A create carrying `ui_app` and no `auth` returned
  `version: 0.0.1`, and the immediately-following `GET /v3/app-store/apps/{id}` echoed the
  whole block back — including the 3-placement multi-page case. So the endpoint does more
  than branch on `ui_app`, it **persists** it, which is why the first `app upload` after a
  create correctly reports *"Already up to date"*.
- **By reading the deployed handler** (`http_cli_create_app_public.go`, bo-be
  `origin/main` at prod image 1.7.0). `isPublicAppsRequestBody` sniffs for exactly the
  `auth` and `ui_app` keys; a body carrying neither routes to the legacy flat-OAuth flow,
  and `validatePublicAppsBlocks` then enforces "at least one of auth or ui_app". The
  discriminator is the same on the wire as it is in `app-config.json`.

That kills **reading 1** (`redirect_uris` is not required unconditionally — it is required
only on the branch a body without `ui_app` falls into) and **reading 2** (the nested-`auth`
contract is live; the bare field name in the old error was just the legacy branch's
wording). Full detail under *Before UI-apps GA* → *Create actually branches on `ui_app`*.

**Must hold true:**

- [x] A UI-app create body carries `ui_app` and no `auth`; an OAuth create carries
      `auth` and no `ui_app`. Covered by `sends the ui_app block to POST /apps, under
      the ui_app key` and the non-TTY OAuth test's `not.toHaveProperty('ui_app')`.
- [x] The block sent to create is the same object written to `app-config.json` —
      covered by `sends the same block it collected and writes to app-config.json`, so
      the registered app type can never disagree with the partner's file.
- [x] Never the earlier `snapshot` spelling (rejected server-side).
- [x] `yarn test` (47 suites / 1009 tests), `yarn lint`, `yarn tsc --noEmit` green.
- [x] **Manual — ran, and it decided the three readings (2026-08-12, production).**
      `brevo app create` → **UI app** succeeded: `version: 0.0.1`, block echoed back on the
      following read. The hypothesis holds; the wire contract is marked confirmed in
      `CLAUDE.md` → *The block travels on `POST /v3/app-store/apps` (create) too*.
- [x] **Manual — OAuth create against the same environment also succeeded**, so the
      nested-`auth` server change *has* landed and reading 2 was never live. Covered in
      more depth by the *nested `auth` block* entry above, which is the follow-on bug the
      same run surfaced: the response nests credentials and the CLI was reading them flat.
- [ ] Reviewer: `createApp()`'s payload type in `src/services/app.ts` gained
      `ui_app?: UiApp`, so the block can no longer reach the wire untyped.
- [ ] Reviewer: `fetchAppContext()` is still passed the collected block explicitly
      (`create.ts`), which stays correct whether or not the create response starts
      echoing `ui_app` back.

### `--debug` logs the request body alongside the response (2026-08-07)

**Change:** `ApiClient.request()` now emits `[debug] request <METHOD> <path>: <body>`
before the fetch, and the existing response line gained the method so the two halves
of one call pair up: `[debug] response <METHOD> <path>: <body>`. Both go through
`logDebug()`, so both are redacted by the same `SENSITIVE_KEYS` set in
`src/lib/logger.ts` — no new redaction rules. Logging before the fetch is deliberate:
a payload the server never answers (timeout, socket hang up) is still visible.

**Must hold true:**

- [x] Request line carries method, path, and the JSON body; bodyless `GET` logs no
      request line at all (rather than a bare `undefined`).
- [x] `client_secret` and friends are `[REDACTED]` in **both** directions — covered by
      `redacts sensitive keys in the request body` / `…in the response body`.
- [x] The body is logged even when `performFetch` throws.
- [x] `yarn test` (47 suites / 1008 tests) and `yarn lint` green.
- [ ] **Manual:** run `brevo app upload --debug` and `brevo app deploy --debug`
      against staging and read the output — confirm the request/response pairs are
      legible, and that no token, secret, or API key appears anywhere in the transcript.
      This is the check that matters: the redaction set is a key allow-list, so a
      *new* secret-bearing field name would print in the clear.
- [ ] Reviewer: nothing outside `--debug` / `BREVO_DEBUG=1` changed — the log lines
      are not part of any documented contract, so no `SKILL.md` / `AGENTS.md` edit
      (per `CLAUDE.md`, log-line formatting isn't user-visible behaviour).
- [ ] Reviewer: note `request()` gates on `opts.body !== undefined` while
      `performFetch` sends `opts.body ? … : undefined`. Every caller passes an object
      or nothing, so they agree today; a falsy-but-defined body (`null`, `''`, `0`)
      would be logged and not sent. Worth aligning if such a caller ever appears.

### BEX-290/BEX-364 — install payload carries `client_id`; `[account-id]` resolves itself (2026-08-07)

**Change:** Aligns deploy/rollback with app-store-backend PR #717, and makes the
target account resolvable instead of mandatory.

1. **`client_id` is now sent.** The installs endpoint requires it (`400` without it,
   since the CLI sends no `X-Sib-Client-Id` header) and resolves the app against it —
   `FindIDByUUID(uuid, client_id)`. `resolveCallerClientId()` reads the authenticated
   account's `organization_id` from cached credentials and rejects a non-numeric value
   with an actionable "run `brevo login`" rather than sending `NaN`. `deploy_client_id`
   keeps its old meaning: the account the install lands in.
2. **Rollback maps 404, not 422.** The developer uninstall route resolves the install
   from the body (no `installation_id` exists at uninstall time) and answers 404 for
   both an unknown app and an absent install. `rollbackApp()` no longer calls
   `rethrowNotFound` — the `ApiError` reaches the command, which treats any 404 as the
   informational not-deployed path.
3. **`<account-id>` → `[account-id]`.** Omitted, the target resolves from the logged-in
   account: plain accounts deploy into themselves (no prompt, no listing call), a
   corporate account (`type === 'corporate'`, **assumed**) picks from
   `GET /v3/corporate/subAccount`, paged to exhaustion on `count`. Both commands share
   `resolveDeploymentTarget()`, so rollback inherits it.

**Must hold true:**

- [x] `yarn lint && yarn format && yarn tsc --noEmit && yarn test` green
      (47 suites / 998 tests).
- [x] Both verbs send `client_id` (caller) and `deploy_client_id` (target) as distinct
      numbers. Covered by `should send the caller organization ID and the deploy target
      separately`.
- [x] A non-numeric identifier is **omitted** from the body, never sent as a string and
      never coerced to `NaN`/`null` — both fields are `int64` and the body is decoded
      before the header is read. Covered by the `should omit client_id when the
      organization ID is %s` table, `should omit deploy_client_id when the target is not
      numeric`, and `should never emit null or NaN for either identifier`.
- [x] The emitted body matches the confirmed staging curl. Covered by `should match the
      staging DELETE payload shape`.
- [x] A UUID `organization_id` still resolves as the display/target value. Covered by
      `defaults to a UUID organization ID unchanged`.
- [x] Only an absent or blank `organization_id` fails, and it fails before any request.
      Covered by `surfaces a missing organization ID rather than labelling the target
      "undefined"`.
- [x] Deploy still maps 404 → "App not found"; rollback propagates it instead. Covered
      by `should rethrow a 404 on deploy as a friendly not-found error` and
      `should propagate a 404 on rollback unchanged`.
- [x] Rollback exits 0 on *either* flavour of 404. Covered by `treats "not deployed"
      (404) as informational` and `treats an unknown-app 404 as not deployed too`.
- [x] A plain account resolves its own ID with no prompt and no sub-account call, and
      still works with `--json` / no TTY. Covered by `defaults to the caller own account
      when no account ID is given` and `still resolves its own account non-interactively`.
- [x] A corporate account prompts, hides deactivated sub-accounts, errors rather than
      showing an empty picker, and demands an explicit ID under `--json`. Covered by the
      `corporate account` describe block in `deploy.test.ts`.
- [x] An explicit `[account-id]` short-circuits resolution entirely — no
      `/v3/account/info` read, no sub-account listing. Covered by `uses an explicit
      account ID without touching the sub-account listing`.
- [x] Sub-account paging terminates on `count` *and* on an empty page. Covered by
      `should page until count is reached` and `should stop on an empty page even when
      count disagrees`.
- [x] Confirm which shape `organization_id` takes on a real account — **answered live
      (2026-08-12).** The test account's is the hex string `60af7557…`, so
      `toNumericIdentifier()` returned `undefined` and `pick()` dropped both identifiers:
      the install body went out as exactly `{"name": …, "is_developer": true}`. `POST`
      answered `201`, `DELETE` `204` — the gateway header resolution and the
      caller-defaulting both work as designed. See *Before UI-apps GA*.
- [ ] **Manual, blocking:** confirm the corporate discriminator is `type === 'corporate'`
      on `/v3/account/info`. An absent/unknown value silently takes the plain branch, so
      a wrong guess here shows up as a master account deploying into itself.
- [ ] Manual: on a corporate account, `brevo app deploy` with no positional → picker →
      confirm the install lands in the *sub-account*, not the master.
- [ ] Manual: `GET /v3/corporate/subAccount` with an OAuth bearer token (browser login is
      the default path) as well as an api-key.
- [ ] Reviewer: `APP_DEPLOY_MISSING_ACCOUNT_ID` / `APP_ROLLBACK_MISSING_ACCOUNT_ID` are
      deleted — the positional is optional, so "Missing account ID" is unreachable.
      Confirm nothing else referenced them.
- [ ] Reviewer: `SKILL.md`, `AGENTS.md`, `README.md`, `CLAUDE.md` and the changeset all
      updated and in sync.

### BEX-290 — slot-name validation moves to the server (2026-08-06)

**Change:** The CLI no longer holds a list of valid extension-point names.
`EXTENSION_POINTS` and the constants that fed only it (`EXTENSION_LOCATIONS`,
`EXTENSION_WIDGET_PLACES`, `EXTENSION_ACTION_PLACE`, `actionPointForLocation`,
`extensionPointName`) are deleted from `src/lib/constants.ts`, and
`validateSurfacePoint` is now shape-only — a slot name must be a non-blank string,
and nothing else is asserted about it locally.

The mirror existed so `app upload` could pre-flight a hand-edited
`surface_point_list` without a round trip. It was the wrong place for the check: a
hardcoded copy can only lag the platform's `extension_points` table, and it failed
in **both** directions — rejecting a slot the registry had gained (a partner who
authored it through `app create`, which reads the live registry, then could not
upload the file `create` had just written), and passing one the registry had
dropped (straight back to the silent empty slot the check was meant to prevent).

Both paths now read the real registry. `app create` already prompted from
`GET /v3/app-store/surface-points`, so its entries are built from rows the platform
just returned and its `validateUiApp` call no longer passes an allow-list. `app
upload` sends the block and lets the upload endpoint answer: `checkExtensionPoints`
(app-store-bo-be `cmd/app-store-bo-be/http_cli_upload_app.go:423-448`, branch
`BEX-361_surface-points-endpoint-and-default-context`) reads the registry
in one indexed query and returns **400** naming every unregistered slot, before the
app is even loaded. Verified present on that branch — no server-side work was
needed for this.

**`EXTENSION_PLACE_LABELS` is deliberately kept.** It is CLI-owned partner-facing
display text, not a mirror of anything: the registry has no display-name column,
and `surface_point_name` holds kebab slugs (`contact-details-header-menu`) that
would be worse to show a partner. `docs.md` previously listed it for deletion
alongside the mirror; that was wrong and is corrected.

**Must hold true:**

- [x] `yarn lint && yarn test && yarn build` green (47 suites / 971 tests).
- [x] An unregistered slot name passes `validateUiApp` and reaches the upload
      payload instead of failing locally. Covered by `passes an unregistered slot
      name through for the server to reject` (`validators.test.ts`) and `uploads an
      unregistered extension point for the server to reject` (`upload.test.ts`).
      Both exist to fail if a local allow-list is ever added back.
- [x] Shape checks that don't need the registry still fail locally without a round
      trip — blank/missing `surface_point`, duplicate slots, bare-string entries,
      pre-BEX-290 field names. Covered by `rejects a blank extension point without a
      round trip` and the `validateUiApp` rejection table.
- [x] No reference to `EXTENSION_POINTS` remains in `src/`. Verified by repo-wide
      grep.
- [ ] Manual: hand-edit `app-config.json` to a bogus slot
      (`contact.headerMenu.action`), run `brevo app upload`, and confirm the server
      returns a 400 that **names the offending slot** and that the CLI surfaces that
      message legibly. This is the whole point of the change — if the server's error
      doesn't reach the partner readably, the local check was carrying more weight
      than this entry assumes.
- [ ] Manual: confirm the 400 arrives before any partial write, i.e. a rejected
      upload leaves the stored version untouched.
- [ ] Reviewer: this changes an error message scripts could match on — the local
      `Unknown extension point "…". Must be one of: …` is gone. UI apps are pre-GA
      and `upload` never shipped for them, so no alias or deprecation is proposed;
      confirm that reasoning holds.
- [ ] Reviewer: `agent-context/SKILL.md` and `agent-context/AGENTS.md` are both
      updated and still in sync (CLAUDE.md requires it), along with `CLAUDE.md`,
      `docs.md` and the changeset.

### BEX-290 — `undeploy` → `rollback` rename (2026-08-06)

**Change:** `brevo app undeploy` is now `brevo app rollback`. Third name for this
command on this branch: `remove` → `undeploy` → `rollback`. Nothing behavioural
changed — same target resolution, same absent upload gate, same
`DELETE .../installs` call, same 422 → informational exit `0`.

Renamed with it: `src/commands/app/undeploy.ts` → `rollback.ts` (and its test),
`undeployCommand` → `rollbackCommand`, `appService.undeployApp` → `rollbackApp`,
`messages.APP_UNDEPLOY_*` → `APP_ROLLBACK_*`, `CLI.APP_UNDEPLOY` → `CLI.APP_ROLLBACK`,
and the **`--json` key `undeployed` → `rolledBack`** (following the precedent set when
`removed` → `undeployed`). `reason: "NOT_DEPLOYED"` is unchanged — `deploy` keeps its
name, so "not deployed" is still what the state is called.

**Naming note for the reviewer:** `rollback` conventionally means "revert to the
previous version", not "remove from this account", and `deploy` / `rollback` is an
asymmetric pair where `deploy` / `undeploy` was not. The CLI also already has
`app withdraw` for the review lifecycle, so there are now two different
"take it back" verbs. Flagged, not blocking — renaming is cheap while UI apps are
pre-GA, and it gets much more expensive after.

**Must hold true:**

- [x] `yarn lint && yarn test && yarn build` green (46 suites / 936 tests).
- [x] No `undeploy` remains anywhere in `src/` — command name, handler, service
      method, message keys, CLI constant, filenames. Verified by repo-wide grep.
- [x] Behaviour is byte-identical to `undeploy`: no upload gate, 422 →
      informational NOT_DEPLOYED at exit `0`, `--force` / `--json` unchanged,
      same `DELETE .../installs` body. Covered by `rollback.test.ts` (ported
      wholesale, only names and the JSON key changed).
- [ ] Manual: `brevo app --help` and `brevo app rollback --help` both list
      `rollback` and no longer mention `undeploy`.
- [ ] Manual: `brevo app rollback <account-id> --json` against a non-deployed app
      returns `{"rolledBack": false, "reason": "NOT_DEPLOYED"}` at exit `0`.
- [ ] Reviewer: this is a **breaking rename of an unreleased command**. Confirm
      `undeploy` never shipped in a published version — if it did, the old name
      needs an alias and a deprecation notice rather than a clean rename.
- [ ] Reviewer: `agent-context/SKILL.md` and `agent-context/AGENTS.md` are both
      updated and still in sync (CLAUDE.md requires it), along with `README.md`,
      `CLAUDE.md`, `QA-TESTCASES.md` and the changeset.

### BEX-290 — deploy/rollback hit the real installs endpoint (2026-08-06)

**Change:** The deploy transport is no longer assumed. Confirmed against the staging
endpoint, deploy and rollback are two verbs on one resource,
`/v3/app-store/apps/{id}/installs` — `POST` to install, `DELETE` to remove — both
carrying the same body: `deploy_client_id` (the account ID, **as a number**), `name`,
`is_developer`. The two separate `/deploy` and `/undeploy` routes are gone, replaced by
`ENDPOINTS.APP_STORE_APP_INSTALLS`. `ApiClient.delete` gained an optional body, since
this resource identifies the install by a body field rather than a path segment.

`name` is the app's own name — no new prompt and no new flag, so `app deploy` stays
scriptable. `is_developer` is hard-coded `true`: every install the CLI creates is a
developer install by construction. No user-visible command, flag, or output changed, so
`SKILL.md` / `AGENTS.md` need no edit.

**Must hold true:**

- [x] `yarn lint && yarn test && yarn build` green (46 suites / 936 tests).
- [x] `deployApp` POSTs to `/installs` with `deploy_client_id` as a **number**, not the
      string `parseAccountId` returns. Covered by
      `should POST an install with the account ID coerced to a number`.
- [x] `rollbackApp` DELETEs the same path with an identical body. Covered by
      `should DELETE the same install resource with the same body`.
- [x] `ApiClient.delete` serialises a body when given one and still sends none when not.
      Covered by `should send a body when one is passed` in `client.test.ts`.
- [x] The install `name` is the app name from `app-config.json`, falling back to the app
      ID under `--app-id` (no linked config to read a name from). Covered by the updated
      `deploy.test.ts` / `rollback.test.ts` assertions.
- [x] 404 still becomes the friendly not-found error and 422 still propagates for the
      commands to map. Covered by `should rethrow a 404 as a friendly not-found error on
      both verbs` and `should propagate a 422 ApiError unchanged`.
- [ ] Manual: `brevo app deploy <account-id>` against a real account, then confirm the
      action link appears on the record page. Then `brevo app rollback <account-id>` and
      confirm the DELETE removes it. **This is the first real exercise of the endpoint —
      capture the POST response body.**
- [x] Confirm the rejection codes — **both answered, and neither matched the
      assumption.** Deploy's 422 does not exist at all (see *Before UI-apps GA* →
      *Deploy's rejection code*): the installs handler resolves, checks the plan and
      inserts, so a never-uploaded app answers `201`. Rollback answers **404**, not 422,
      for both an unknown app and an absent install. Both are mapped accordingly.
- [x] Confirm whether the POST response carries an install/integration ID — it returns
      `{brevo_integration_id, installation_id}` (both the same value). The CLI discards
      it, which stays fine while rollback addresses the install by account rather than by
      ID. Surfacing it is optional; see *Before UI-apps GA*.
- [x] Confirm whether `name` is required or advisory — **required.**
      `validateRequestBody` rejects an empty or blank name, and one over 200 chars. The
      CLI always sends the app name.
      - [ ] Still open, tracked once in *Before UI-apps GA*: whether a repeated deploy to
            the same account is an idempotent upsert. `findExistingInstallation` keys a
            developer install on client_id + app_id + is_developer, which reads as one,
            and the CLI relies on it — but confirm rather than infer.

### BEX-290 — review fixes on the reshape + prompt reorder

**Change:** Two behavioural fixes and a round of accuracy corrections on the two commits
below. (1) The grouped placement prompt's per-page rule is measured against the pages that
actually produced a group, not the pages that were picked — the old rule was unsatisfiable
whenever the narrowed registry read covered only some picked pages, and a picked page the
registry offers nothing on is now a warning printed before the prompt. (2) `link_target` is
injected into the upload payload for an `actionLink` only, and the upload diff prints no
link-target row for an `iframeExtension`. Plus: the write-back strips the block's
server-managed `version` alongside `link_target`, placement rows align with every other row
in the created-app box and the upload diff, and several comments/checklist items that
asserted stale or unverifiable behaviour are corrected.

**Must hold true:**

- [x] `yarn lint && yarn test && yarn build` green.
- [x] Pick two record pages where the registry only returns rows for one, and the
      placement prompt is still answerable: the missing page is warned about and dropped,
      and ticking the offered spot passes `validate`. Covered by
      `warns about a picked page the registry offers no placements on` and
      `does not require a placement on a page that offered none`.
- [x] The pages-that-did-offer rule still fires: two pages both offering rows, spots
      ticked on one only, refuses with *nothing selected for: deal*. Covered by
      `requires at least one placement on every page that was picked` (unchanged).
- [x] An `iframeExtension` block uploads with **no** `link_target` in the payload, and an
      `actionLink` still uploads with `_blank`. Covered by
      `does not inject link_target for an iframeExtension` and the existing
      `injects link_target into the payload without it being in the config`.
- [x] The write-back never writes `link_target` **or** `version` into the `ui_app` block
      of app-config.json, even when the server echoes both. Covered by
      `strips the server-managed version from the write-back`.
- [ ] Manual: run `brevo app create` → *UI app* and confirm the `Placement:` rows in the
      created-app box, and the `Placement:` rows in `brevo app upload`'s diff, start in the
      same column as `App name:` / `Extension type:`.
- [ ] Reviewer: the changeset is published to a public changelog. Confirm the migration-hint
      paragraph and the pre-BEX-290 rejection comment in `validators.ts` describe only the
      LOCAL diagnostic and assert nothing about how the upload endpoint reacts to an
      unmigrated block.

### BEX-290 — `ui_app` schema reshape + reordered `app create` prompts

**Change:** Two commits. (1) `surface_point_list` becomes a list of
`{ surface_point, context? }`, `heading`/`subheading` become `label`/`more_info`,
the top-level `context` is gone, `link_target` is no longer authored into
`app-config.json` (upload injects `_blank`), and `label`/`more_info` gain the
server's length ceilings (48 / 255). (2) `brevo app create`'s UI-app flow is
reordered — integration type first, then record pages, then ONE grouped placement
prompt built from real registry rows — and each entry's `context` is seeded from
that row's `default_context_field` instead of being prompted for. The registry
endpoint is now called twice (unfiltered, then `?location=<csv>`) and rows the
chosen extension type can't be hosted on are filtered client-side.

**Must hold true:**

- [x] `yarn lint && yarn test && yarn build` green (46 suites / 927 tests).
- [x] Upload of an unchanged UI app still prints *Already up to date* when the
      server echo differs from the file only by `link_target` / `version` or by
      `surface_point_list` order. Regression-tested; without the normalization the
      block reads as changed on every upload.
- [x] A successful upload does not write `link_target` back into `app-config.json`.
      Regression-tested — the server defaults and echoes it, so passing the echo
      through verbatim would undo the decision on the first upload.
- [x] The pre-BEX-290 shape (`heading`, `subheading`, top-level `context`, a
      bare-string `surface_point_list`) fails `brevo app upload` with a migration
      hint rather than a generic "label cannot be empty".
- [ ] Manual, once BEX-361 ships: run `brevo app create` → *UI app* end to end and
      confirm the prompt order is integration type → record pages → placements →
      label → more info → redirect link, with no kind, place or record-context
      question anywhere.
- [ ] Manual: pick two record pages, tick spots on only one, and confirm the
      placement prompt refuses with *nothing selected for: <page>* rather than
      silently authoring fewer placements than were asked for.
- [ ] Manual: pick a page whose registry offers exactly one placement and confirm it
      is pre-ticked.
- [ ] Manual: confirm the placement labels read as page regions
      (*Header "More" (•••) menu — menu entry*, *Sidebar — card*) and that no
      kebab-case slug from `surface_point_name` ever appears in the prompt.
- [ ] Manual: confirm the created-app box prints an example URL whose query
      parameters are exactly the seeded context fields, and that it merges correctly
      into a `redirect_link` that already has a `?` and a `#`.
- [ ] Manual: point `BREVO_API_URL` at an environment whose registry endpoint 400s
      on `?location=` and confirm creation still completes on the rows from the first
      call, rather than dying after the page prompt.
- [ ] Manual: with the endpoint absent entirely, confirm creation aborts with the
      actionable *Could not load the available placements* message and that OAuth
      creation is unaffected.
- [x] Reviewer: the registry read path tolerates BOTH row namings — and the tolerance is
      now known to be **unnecessary**. BEX-361 shipped; the pre-BEX-361 spellings
      (`extension_point`, `location`, `place`, `kind`) are confirmed dead, and bo-be's own
      comment says `place`/`kind` "are not column names and must not appear on the wire".
      The aliases are kept deliberately, not pending; removal is tracked in `docs.md`.
- [x] ~~Reviewer: `EXTENSION_POINTS` must stay — upload still pre-flights against the
      mirror.~~ **Obsolete — the opposite happened.** The mirror was deleted from
      `src/lib/constants.ts` (see *BEX-290 — slot-name validation moves to the server*):
      a local copy can only lag the registry, and it failed in both directions. Upload now
      pre-flights nothing and lets the endpoint's `checkExtensionPoints` 400. Only
      `EXTENSION_PLACE_LABELS` remains, as CLI-owned display text.
- [ ] Reviewer: no fixture, example or seed anywhere uses a context field name
      outside `recordId`, `recordName`, `userId`, `locale`, `accountId`.

### Public-apps-not-available notice

**Change:** Documentation only. Added a **⚠️ Public apps are not available yet**
notice to `agent-context/SKILL.md`, `agent-context/AGENTS.md`, and `README.md`, and
a maintainer-facing counterpart to `CLAUDE.md` and root `AGENTS.md`. Renamed
`TESTING.md` → `RELEASE-CHECKLIST.md`. No source changes, no behaviour change.

**Must hold true:**

- [x] No file under `src/` changed, so `yarn test` / `yarn build` outcomes are
      unaffected by this change.
- [x] `agent-context/SKILL.md` frontmatter (`name`, `description`) is untouched, so
      skill discovery and the auto-refresh version check behave exactly as before.
**⚠️ This entire entry is SUPERSEDED by BEX-405 — do not work its checks.** The notice
it verified is gone, and so is the mechanism the checks were written against. BEX-405
replaced documentation-prohibition with build-time elimination: the gated commands are
not in a published bundle, so an agent cannot be led into them and there is no prose to
test. The `@brevo.com` / `@sendinblue.com` domain carve-out was **removed outright** —
`BREVO_ENABLE_PREVIEW` survives only in `preview.test.ts`, asserting it is *ignored*.
Internal testing is `PREVIEW=1 yarn link:dev`, a different artifact. The five remaining
checks below all tested that carve-out or the notice wording, so each is retired rather
than answered; the live successors are in the BEX-405 entry at the top of this section.

- [x] ~~Manual: `brevo skill:cli install` installs a SKILL.md containing the notice.~~
      Retired — the notice is deleted. That `skill:cli install` still works from the
      bundled `agent-context` **is** verified, under BEX-405 → *Bundling did not break
      runtime path resolution*.
- [x] ~~Manual, non-internal account: agent declines a public-app request.~~ Retired —
      there is no request to decline. `--distribution public` is refused by the binary
      and the review-lifecycle commands answer `unknown command`.
- [x] ~~Manual, internal account (the carve-out — must not regress).~~ Retired — **the
      carve-out was deliberately regressed away.** A compile-time guard a user can switch
      back on is a runtime guard wearing a costume, and it has to ship the surface in
      order to reveal it. See `CLAUDE.md` → *There is deliberately no runtime escape
      hatch*; do not add one back.
- [x] ~~Manual, social-engineering check.~~ Retired — nothing to social-engineer. The
      agent has no privileged path to unlock, because the commands are absent from the
      bundle rather than gated behind a claim about who is asking.
- [x] ~~Manual, logged out: an unavailable `whoami` must be treated as non-internal.~~
      Retired — `whoami` is no longer consulted for feature availability at all.
- [x] Reviewer: nothing blocks CLI development or QA of the public-app code paths.
      Confirmed and now stronger than a doc statement — `PREVIEW=1 yarn link:dev` builds
      the full surface, and `CLAUDE.md` → *This does not restrict work in this repo* plus
      root `AGENTS.md` both say so.
- [x] ~~Reviewer: sanity-check the domain list against how Brevo staff accounts are
      provisioned.~~ Retired with the domain list itself — there is no list to get wrong,
      which is the point: it could never have covered every staff-provisioning path.
- [x] Reviewer: the two agent docs stay in sync — still required by `CLAUDE.md`, but they
      now carry **one rule** (`brevo --help` is the complete surface) instead of a
      prohibition section. Verified in the BEX-405 changeset.

### `brevo app submit` status preflight

**Change:** `brevo app submit` now runs a status preflight — it reads the app's
review state (the same `appService.fetchAppState` path as `brevo app status`)
before any submit work. Only a failed fetch blocks; the state value is not a gate.

**Must hold true:**

- [x] On a successful status read, submit proceeds exactly as before (public
      check → drift check → confirm → open form). Covered by all existing
      `submit.test.ts` cases + `runs the status check before opening the
      submission form`.
- [x] When the status read throws (network/auth/not-found), submit aborts
      before calling `fetchApp` or opening the browser. Covered by `aborts
      before submitting when the status check fails`.
- [x] Preflight runs in both interactive and `--json` mode (spinner silenced
      in `--json`), and a thrown error is formatted by `withCommandHandler`.
- [ ] Manual: point the CLI at an unreachable API and confirm `brevo app
      submit` exits non-zero with the status-fetch error, not a submit error.

### BEX-290 — UI app support (action links)

**Change:** New app type. `brevo app create --type <oauth|ui>` with a UI-app prompt
path, a `ui_app` block in `app-config.json`, `ui_app` on the upload payload with
local validation and diffing, and two new commands `brevo app deploy <account-id>` /
`brevo app rollback <account-id>` (named `remove`, then `undeploy`, during development). `applyConditionals` generalised from a single
distribution value to a flag set.

**Must hold true:**

- [x] The OAuth path is unchanged end to end. `create` still collects redirect URLs,
      still sends `redirect_uris` + the four `DEFAULT_SCOPES`, and the upload payload
      for an OAuth app is byte-identical (no `ui_app` key at all). Covered by the
      pre-existing `create.test.ts` / `upload.test.ts` cases plus
      `never sends a ui_app field for an OAuth app`.
- [x] A private OAuth scaffold renders byte-for-byte as before, despite
      `applyConditionals` now taking a flag set — the existing
      `templates/conditionals.test.ts` invariants still pass, and
      `applyConditionals(tmpl, 'private')` still accepts a bare `Distribution`.
- [x] A UI app never acquires a phantom OAuth callback: `resolveRedirectUrls` (which
      falls back to `http://localhost:3009/auth/callback` in non-TTY) is not on the UI
      path. Covered by `never prompts for or defaults a redirect URL`.
- [x] Editing only the `ui_app` block is detected as a change, not "already up to
      date". Covered by `uploads when only the ui_app block changed`; key-order
      insensitivity by `treats a reordered ui_app block as unchanged`.
- [x] A hand-edited `ui_app` block survives a `brevo app scaffold` config refresh
      (which rewrites `app-config.json` wholesale from server values). Covered by
      `preserves the local ui_app block through a confirmed config refresh`.
- [x] `app deploy` refuses before an upload, and maps the server's 422 to the same
      message. `app rollback` has no gate and exits `0` when not deployed. Covered by
      `deploy.test.ts` / `rollback.test.ts`.
- [x] ~~The `ui_app` block matches the platform's stored app-snapshot shape field for
      field (`extension_type`, `surface_point_list`, `heading`, `subheading`,
      `redirect_link`, `link_target`), verified against both of the platform's
      consumers (BEX-308 / BEX-350).~~ **Superseded** by the schema reshape — see
      *BEX-290 — `ui_app` schema reshape* above. The field list is now
      `extension_type`, `surface_point_list` (objects with a per-entry `context`),
      `label`, `more_info`, `redirect_link`; `link_target` is not authored at all.
- [x] An unregistered, mis-cased, stale-grammar, or widget-slot extension point is
      rejected locally — the platform would drop it silently. Covered by
      `validateSurfacePoint` cases and the upload-level rejections.
- [ ] Manual, **against a real test account**: run `brevo app create`, choose **UI app**
      at the prompt, inspect the generated `app-config.json`, then `brevo app upload`
      and confirm the backend **accepts** the `ui_app` block. The write path exists
      (see the confirmed follow-up above); a 400 naming an unknown key means the CLI
      and server disagree on the wire key again.
- [ ] Manual: `brevo app deploy <account-id>` against a real account, then confirm the
      action link actually renders in that account's contact record action menu, opens
      the external URL in a new tab, and carries the declared context properties.
      Then `brevo app rollback <account-id>` and confirm it disappears.
- [ ] Manual: `brevo app deploy <account-id>` on a never-uploaded app must refuse with
      the `brevo app upload` hint — verify the **server** path too (not just the local
      `version` pre-flight) by deleting `version` from a config whose app *was*
      uploaded.
- [ ] Manual: `brevo app create` interactively on an existing OAuth project directory
      and confirm the new app-type prompt appears first and that choosing *OAuth app*
      reproduces the previous flow exactly.
- [x] ~~Manual: confirm the UI-app create flow has **no delivery-path prompt** — it goes
      straight to placement.~~ **Superseded** by the prompt reorder: the flow now opens
      with an integration-type prompt (*Link* selectable, *Iframe* shown disabled), and
      the written block is still always `actionLink`.
- [x] ~~Manual: confirm the created-app box states that the menu entry is labelled with
      the app name.~~ **Superseded** by the reshape: `label` labels the menu entry now.
      The box states that the app name is a *card's title* — that is the text with no
      field a partner would otherwise hunt for.
- [ ] Reviewer: `agent-context/SKILL.md` and `agent-context/AGENTS.md` both document
      the new commands, the prompt-only UI-app create path (and that no `--type` or
      UI-field flags exist), the `ui_app` block, and both carry the
      UI-apps-not-available notice with equivalent wording (CLAUDE.md requires those
      two stay in sync).
- [ ] Reviewer: the **field names, the upload wire key (`ui_app`), and the
      deploy/rollback route and body are all now verified** against the platform. What
      remains unconfirmed on the installs endpoint is only its rejection codes (the
      422 mappings) and whether the POST response carries an install ID. See *Before
      UI-apps GA* → related follow-ups.
- [ ] Reviewer: BEX-350 needs a coordinated release (kit + reseeded extension-point
      registry + backend). A CLI release ahead of the reseed authors names that resolve
      to nothing, silently. Confirm the sequencing.

### UI-app create is prompt-only; `extension_type` values are camelCase

- [x] `brevo app create` exposes **no** `--type`, `--surface`, `--heading`,
      `--subheading`, `--redirect-link` or `--link-target`. Covered by lint (the dead
      imports in `definitions.ts` would fail it) and by TC-12.12 manually; commander
      rejects each with `unknown option`.
- [x] Every non-interactive run creates an OAuth app: piped stdin **and** `--json` on a
      TTY, neither showing the app-type prompt. Covered by
      `creates an OAuth app in a non-TTY run, without prompting for the app type` and
      `creates an OAuth app under --json even on a TTY`.
- [x] The prompt `validate` callbacks are still wired now that the flag parsers are
      gone — they are the only remaining input check. Covered by
      `validates the heading and redirect-link answers at the prompt` and
      `requires at least one record page`.
- [x] ~~There is no delivery-path prompt; the block is always `actionLink`.~~
      **Superseded** by the prompt reorder: the integration-type prompt is back as the
      FIRST question, with *Iframe* disabled, so only `actionLink` is still authorable.
      Covered by `offers the integration-type prompt with Iframe disabled`.
- [x] The authored `extension_type` is `actionLink`, and `action_link` is rejected on
      upload. Covered by `builds the snapshot shape the platform consumes` and the
      `validateUiApp` type cases.
- [ ] Manual: with a UI project created via the prompts, confirm `brevo app upload`
      renders `Extension type: actionLink` in the diff and sends that value under
      the `ui_app` wire key. Then hand-edit the file to `action_link` and confirm the
      upload is rejected locally with exit `1` and no API call.
- [ ] Reviewer: the platform's server-side `link_target` default is gated on the literal
      `"action_link"`, so it no longer fires for CLI-authored apps. Confirm this stays
      harmless — the CLI does not author the field, but `brevo app upload` still sends it
      explicitly for an `actionLink`, and the UI kit defaults an absent/unrecognised
      value to `_blank` client-side. (Amended: the CLI stopped *writing* it into
      `app-config.json` in the reshape; it injects it into the payload instead.)

### `remove` → `undeploy` rename + actionLink-only prompts (2026-08-03)

> **Superseded on 2026-08-06** — the command is now `brevo app rollback`, and the
> route is `DELETE /v3/app-store/apps/{id}/installs`, not `/undeploy`. Kept as a
> record of what this branch did on 2026-08-03; the rename criteria below were met
> at the time and are re-verified under the newer entries at the top of this section.
> Read `undeploy` as `rollback` throughout.

**Change:** `brevo app remove` is now `brevo app undeploy`, hitting
`POST /v3/app-store/apps/{id}/undeploy` (aligning with the platform's approved
deploy/undeploy design — the CLI route previously skewed as `/remove`). Its JSON
output keys renamed `removed` → `undeployed`. The `iframeExtension` delivery-path
prompt is removed from `brevo app create` per the 2026-08-03 decision: the CLI
authors `actionLink` only until the iframe-embed RFC; a hand-edited
`iframeExtension` block still validates and uploads (the platform keeps accepting
it).

**Must hold true:**

- [x] No `remove` command remains: `brevo app remove` is unregistered, the service
      method and endpoint constant are renamed, and no source or doc references the
      old name. Covered by `undeploy.test.ts` (ported from `remove.test.ts`, JSON
      keys updated) and a repo-wide grep.
- [x] `undeploy` behaves exactly as `remove` did: no upload gate, 422 → informational
      NOT_DEPLOYED exit `0`, `--force`/`--json` unchanged. Covered by
      `undeploy.test.ts`.
- [x] The UI-app create flow asks no `extension_type` question and always writes
      `actionLink` + `redirect_link` + `link_target: "_blank"`. Covered by
      `never prompts for a delivery path and always authors an actionLink`.
- [x] `validateUiApp` still accepts a hand-authored `iframeExtension` block
      (`modal_iframe_url` required, `redirect_link`/`link_target` rejected) — the
      prompts are gated, not the wire. Covered by the existing `validateUiApp`
      iframe cases.
- [x] Reviewer: confirm the shipped route with the app-store backend team. Done
      2026-08-06 — it is neither `/remove` nor `/undeploy` but `DELETE .../installs`.
      Superseded; see the top-of-section entries.

### Smoke test: public-app lifecycle (BEX-339)

**Change:** `scripts/smoke-test.ts` rewritten around two lifecycles. Removed
`stepPublicAppRejected` (public create is valid since BEX-327). Replaced the
`brevo app update` step with `brevo app upload` steps, fixed the scaffold step
(no more `--app-id`), and added the public flow: create → upload → status →
submit → submit again → status → withdraw → status → delete, plus negative
probes. Every create now runs from a tracked tmp work root because `create`
writes `./<slug>` into the cwd. New `--skip-public` / `--with-public` flags;
gated commands are feature-detected from `brevo --help` and reported as
**skipped**, not failed. Test-only — no `src/` change, so no SKILL.md/AGENTS.md
update is required.

**Must hold true:**

- [x] `yarn smoke --help` lists `--with-public` / `--skip-public`; unknown flags
      still exit 2 with the help text.
- [x] Script typechecks under the repo's strict settings
      (`tsc --noEmit --strict --noUncheckedIndexedAccess`) and is prettier-clean.
- [x] Full step list passes end to end against a mock `brevo` on `PATH`
      (25/25), and the mock account holds zero apps afterwards.
- [x] Capability gating: with `submit`/`status`/`withdraw`/`upload` absent from
      `brevo --help`, the run stays green — 13 passed, 12 **skipped**, no
      failures, both apps still deleted. This is the `--against=published`
      path while sibling tickets land.
- [x] Pre-BEX-255 build (create returns no `directory`): upload / no-op upload /
      verify-rename / scaffold / start skip themselves; 19 passed, 6 skipped.
- [x] Backend serves no `google_form_link`: the submit step skips with the app
      id in the reason rather than failing; the repeat-submit step skips too.
- [x] Mid-run `SIGINT` (during "Start briefly"): exit 130, the created app is
      deleted by the trap, and no `brevo-smoke-work-*` tmp dir is left behind.
- [x] `yarn lint` and `yarn test` (733 tests) pass — unchanged, since nothing
      under `src/` is touched.
- [x] **Manual, real backend** — ran `yarn smoke --skip-auth` on 2026-07-29
      against a live account (prod API, OAuth login, local build via `yarn link`).
      **24/25 passed;** the one failure was the private-app submit probe, which
      surfaced a real CLI issue, now recorded in the PR description's *Reviewer
      notes* (see the last bullet below). Every assertion that encoded a guess about server behaviour
      is now confirmed:
  - [x] `app-config.json`'s `distribution_type` comes back `public` for a public
        app — round-trip via `buildTemplateVars` works, no silent `private`.
  - [x] The second `upload` reported `up to date at version 0.0.2` — the server
        does **not** bump `version` on an unchanged upload, so the strict
        `upToDate: true` branch is the one that fires.
  - [x] `submit` straight after `upload` was **not** rejected for config drift
        (run from the project dir, so the drift check did execute).
  - [x] `status` for a freshly created + uploaded public app returned
        `configured` — a state the CLI has copy for, not `unknown`.
  - [x] `withdraw` on a never-submitted app returned the mapped `NOT_SUBMITTED`
        payload at exit 0 (HTTP 422, not a 404).
  - [x] `status` **and** `withdraw` on a random UUID both mapped to not-found at
        exit 5.
  - [x] No `brevo-cli-smoke*` app left on the account — both delete steps assert
        absence from `app list` after deleting, and both passed.
  - [x] Bonus, unplanned: `submit` **did** return a review-form link on prod, so
        the public path was exercised for real rather than skipped. The repeat
        submit was idempotent (same URL, exit 0), confirming that branch too.
- [ ] Reviewer: confirm the two intentionally permissive assertions are the right
      call — the repeat-submit probe accepts idempotent success or the mapped
      "currently unavailable" refusal, because the CLI's submit hands over a form
      URL rather than transitioning state, so a server-side "already submitted"
      rejection can't be produced from the CLI alone; and the private-app submit
      probe now accepts the server's `This activity is not supported for private
      apps.` alongside the CLI's own `APP_SUBMIT_NOT_PUBLIC` copy, because the
      status preflight in `submit.ts` fires first and makes the CLI's message
      unreachable. The refusal is correct either way — but if the reviewer would
      rather the CLI own that message, the fix is described in the PR's
      *Reviewer notes*.

### Smoke test: cleanup + rate-limit hardening (BEX-339 follow-up)

**Change:** Three defects the second live run exposed, all in `scripts/smoke-test.ts`:

1. `trapDeleteApps` logged `trap: deleted app <id>` without checking the exit
   status — `spawnSync` doesn't throw on a non-zero exit, so a delete that 401'd
   was recorded as a success and the orphan went unreported. It now checks
   `r.status`, logs the real reason, and prints an `⚠ ORPHANED APPS` block with
   the delete commands.
2. `Logout` and `Final cleanup` ran as ordinary steps *before* the post-run
   safety net, destroying the credentials and the linked binary it needed — so a
   leftover app could never be recovered. Added a `Cleanup: leftover apps` step
   ahead of them.
3. A rate-limited API failed every later step, including making the negative
   probes assert mapped messages against `Rate limited. Retrying in 5 seconds…`.
   `exec()` now retries centrally (5s/15s/30s) when a *failed* call looks
   rate-limited, and counts the waits.

Leaks and throttling are now visible in the summary and the `--report=` JSON
(`orphanedAppIds`, `rateLimitWaits`).

**Must hold true:**

- [x] Transient rate limit on one call → absorbed: one 5s wait, step passes, run
      green, `rateLimitWaits: 1` in the report.
- [x] Every `app delete` failing → run fails, `LEAKED 2 app(s)` in the summary,
      both ids in `orphanedAppIds`, orphan block printed with delete commands,
      and the ids really are still on the (mock) account — report matches reality.
- [x] Trap log never claims an unverified delete: `trap: FAILED to delete app
      <id> (exit 3): <reason>`.
- [x] No regression: clean run 26/26; gated run 14 passed / 12 skipped; both
      self-cleaning. Typecheck + prettier clean.
- [x] Sonar: 7 code smells in `scripts/smoke-test.ts` fixed (S8786 regex
      backtracking → line-based stack-frame detector, S3358 ×2, S4624, S6551,
      S7776, S1135). Zero security hotspots. The other 7 findings on the PR are
      pre-existing in `src/` files this branch doesn't touch.
- [ ] **Live re-run still pending.** The fixes above are verified against a mock
      `brevo` only. Re-run `yarn smoke --skip-auth` on a real account to confirm
      end to end — ideally against staging rather than a shared prod account,
      which is what throttled the last run and made the orphan real.
- [ ] Clean up after the pre-fix run: `brevo app list` and delete anything named
      `brevo-cli-smoke*` (`brevo app delete --app-id <id> --force`). That run's
      public-app delete was rate-limited and the trap's "deleted" line was the
      unverified log fixed in point 1, so one may still exist. App ids aren't
      recorded here — this repo is public.

### Smoke test: split into per-flow suite modules (BEX-339 follow-up)

**Change:** `scripts/smoke-test.ts` was one 2141-line file. Split so either
lifecycle can run on its own:

| File | Role |
| --- | --- |
| `scripts/smoke-test.ts` | Runner — flags, suite registry, step composition, summary, report |
| `scripts/smoke/core.ts` | Shared plumbing: state, logging, exec + rate-limit retry, assertions, capability detection, create/upload/delete helpers, teardown, traps |
| `scripts/smoke/private-app.ts` | `privateAppSuite` |
| `scripts/smoke/public-app.ts` | `publicAppSuite` |
| `scripts/smoke/init-wizard.ts` | `initWizardSuite` (opt-in) |

Selection is `--suite=private|public|init|all` (comma-separated, default
`private,public`). `--with-public` / `--skip-public` / `--with-init` are kept as
aliases. Setup (pre-flight, install, auth) and teardown (leftover-app cleanup,
logout, uninstall) always run, so each suite stands alone — the public suite
creates its own app and never depends on the private one.

The extraction was mechanical: all 127 top-level blocks were indexed and
verified to be covered exactly once (no gaps, no overlaps) before reassembly, so
no step logic changed in the move.

**Must hold true:**

- [x] Typecheck (`--strict --noUncheckedIndexedAccess`) and prettier clean across
      all five files.
- [x] `--suite=private` → 16 steps, `--suite=public` → 16, default → 26,
      `--skip-public` → 16. All pass, all self-cleaning.
- [x] `--suite=frobnicate` is rejected, listing the valid names.
- [x] Public suite alone against a build without the review commands:
      8 passed / 8 skipped, still green.
- [x] Failure modes survive the split: gated build 14 passed / 12 skipped;
      every-delete-failing still reports `ORPHANED APPS` + `LEAKED 2 app(s)`;
      transient rate limit still absorbed with one 5s wait.
- [x] **Live run, real account, correct binary** — 26/26. Step 2 reported
      `brevo 2.0.1 at ~/.yarn/bin/brevo`, matching `package.json`, so this
      exercised the branch build. Observed: upload bumped to version `0.0.2`;
      no-op upload reported up-to-date; public status `configured` throughout;
      submit returned a review form URL and the repeat submit was idempotent;
      withdraw mapped to `NOT_SUBMITTED` at exit 0; unknown app id → exit 5 for
      both `status` and `withdraw`; account left at its baseline app count.
- [ ] **Do not run this suite via `yarn smoke` until the version guard lands**
      (see the PR's *Reviewer notes*). yarn prepends `node_modules/.bin` ahead of any exported
      PATH, and this repo currently has a stray undeclared `@dtsl/brevo-cli`
      symlinked there. An earlier live run passed 26/26 against *that* package
      instead of the branch build. Invoke it directly meanwhile:
      `PATH="$HOME/.yarn/bin:$PATH" ./node_modules/.bin/tsx scripts/smoke-test.ts --skip-auth`

### Upload write-back reads top-level `distribution_type` from the response

**Change:** `uploadProjectConfig` (`src/commands/app/upload.ts`) read the
server-confirmed distribution only from `response.auth.distribution_type` — a
shape the upload-service owners confirmed **no server build has ever emitted**
(the upload response returns `distribution_type` top-level; its `auth` block
carries only `scopes` + `redirect_uris`, per the service's locked OpenAPI
contract). The `?? config.distribution_type` fallback masked the break —
nothing errored, but the write-back never persisted the server-confirmed value.
The read is now `response.distribution_type ?? config.distribution_type`; the
nested read was dropped entirely as confirmed-dead code, so there is no
backward-compat concern. `UploadAppResponse` gained the top-level field, and
its `auth.scopes`/`auth.redirect_uris` are typed `string[] | null` — the
service owners confirmed they come back `null` (not absent, not `[]`) when the
stored snapshot has no OAuth block (UI-only apps). Request payload is
untouched — `UploadAppPayload` still nests `distribution_type` under `auth`,
which the service owners confirmed remains the locked request contract
(top-level would 400 under strict binding; no move planned).

**Must hold true:**

- [x] A response with top-level `distribution_type` persists the server value
      into `app-config.json`. Covered by the new `upload.test.ts` case
      (`persists the server-confirmed distribution_type…`), watched failing
      before the fix.
- [x] A response with `"auth":{"scopes":null,"redirect_uris":null}` keeps the
      locally-sent scopes/redirect URLs — no nulls persisted, no crash. Covered
      by `keeps the local scopes/redirect URLs when the response auth carries
      nulls`.
- [x] A response missing `distribution_type` entirely still falls back to the
      local config value (`??` chain unchanged on that side).
- [x] Full suite green (732/732), `tsc --noEmit` clean, lint clean.
- [ ] Manual: `brevo app upload` against a current server build, then inspect
      `app-config.json` — `distribution_type` must match the server's echo, not
      merely the pre-upload local value.

### Upload request sends top-level `distribution_type`; server enforces immutability, CLI fast-fails drift

**Change:** Decision reversed from the earlier "drop the field" plan on this
branch: the upload *request* keeps `distribution_type`, moved from `auth` to
the **top level** of the body — fixing the request/response asymmetry (the
response and `OAuthApp` were always top-level; distribution is an app-level
attribute, not an OAuth setting). The server side (BEX-355) declares the
top-level field and rejects drift with its 422 ("distribution_type cannot be
changed via upload"). The client-side guard added on this branch **stays** as
a fast-fail UX layer: after the (pre-existing) remote fetch, if the remote
distribution differs from `app-config.json`'s, `uploadCommand` throws
`APP_UPLOAD_DISTRIBUTION_IMMUTABLE` before rendering the diff, prompting, or
pushing — in interactive, `--yes`, and `--json` modes alike. The guard is
skipped when the server reports no distribution (server check is then the only
enforcement). The response side is unchanged (top-level `distribution_type`,
write-back as before). Docs already describe the field as immutable-with-error;
the changeset no longer claims the field is absent from the request.

**Must hold true:**

- [x] The upload POST body carries `distribution_type` at the **top level**
      (not under `auth`; `auth` carries only `scopes` + `redirect_uris`).
      Covered by the wire-shape test in `upload.test.ts` and the byte-for-byte
      pass-through test in `app.test.ts`.
- [x] Local `distribution_type` differing from the remote app blocks the upload
      with the immutability error — `uploadApp` and `writeProjectConfig` are
      never called. Covered by `blocks the upload when local distribution_type
      differs…`.
- [x] Full suite green (733/733), `tsc --noEmit` clean, lint clean.
- [ ] Server side (BEX-355): the upload request schema **declares top-level
      `distribution_type`** (strict binding must accept it; it must no longer
      require the old `auth.distribution_type` nesting) and validates it
      against the stored app — 422 with a "distribution_type cannot be changed
      via upload"-style message on mismatch, no partial write. Confirm whether
      the field is required or optional-when-present; the CLI always sends it,
      so either works, but the contract doc should say which.
- [ ] Sequencing: pre-BEX-355 server builds bind strictly and expect the old
      `auth.distribution_type` nesting — this CLI must not release before the
      server change deploys (note it in the PR).
- [ ] Manual: `brevo app upload` with matching `distribution_type` succeeds
      against the BEX-355 server build (top-level field in the request body).
- [ ] Manual: edit `distribution_type` in a real project's `app-config.json` to
      the other value and run `brevo app upload` — expect the CLI immutability
      error naming both values, exit non-zero, and no server call after the
      initial fetch. (Server 422 is the backstop if the guard is ever bypassed,
      e.g. remote fetch reports no distribution.)

### Upload `auth` block renames `redirect_urls` → `redirect_uris`

**Change:** The upload request/response `auth` block now uses `redirect_uris`,
the key every other surface already uses (create/PATCH endpoints, OAuth
service, stored snapshot, `OAuthApp`/`fetchApp`, RFC 7591). Upload was the lone
holdout with `redirect_urls`; renamed pre-release on both sides in the same
coordinated pass as the top-level `distribution_type` move (server:
`app-store-bo-be` `feat/bex-355-cli-snapshot-contract`). `UploadAppPayload`'s quirk
comment now lists only `app_version` as intentional divergence.
`app-config.json` follows in a second step (see the next entry): the local key
is now `auth.redirectUris` too, with the legacy `redirectUrls` still read and
migrated on write-back.

**Must hold true:**

- [x] The upload POST body's `auth` carries `redirect_uris` (not
      `redirect_urls`). Covered by the wire-shape test in `upload.test.ts` and
      the pass-through test in `app.test.ts`.
- [x] Write-back reads `response.auth.redirect_uris` (null tolerated, keeps
      locally-sent values). Covered by the null write-back test.
- [x] Full suite green (733/733), `tsc --noEmit` clean, lint clean.
- [ ] Server side: upload request binds `auth.redirect_uris`, response echoes
      the same key, and a body still sending `redirect_urls` gets the strict
      400 naming the key (proves the rename can't fail silently).
- [ ] Manual (against the paired server build): `brevo app upload` changing a
      redirect URL round-trips — new URL pushed, server echo written back into
      `app-config.json`.

### `app-config.json` renames `auth.redirectUrls` → `auth.redirectUris` (tolerant read, migrate-on-write)

**Change:** The local config key now matches the wire key: `ProjectConfig.auth`
carries `redirectUris`, `readProjectConfig` reads the legacy `redirectUrls`
when the new key is absent (new key wins when both are present) and drops it
from the returned object — so every write-back (`upload`, `app start`,
credentials backfill) migrates old projects automatically, same pattern as the
legacy `distribution`/`auth.type` handling. Scaffold template, user-facing
messages (`en.ts`), `SKILL.md`, README template, and QA cases all say
`redirectUris` now. **Known downgrade caveat (accepted):** older CLI releases
read only `redirectUrls`, so a migrated file fails loudly there
("No redirect URLs") — never silently.

**Must hold true:**

- [x] Legacy `redirectUrls` config is read correctly and the returned object
      carries only `redirectUris`. Covered by the three new
      `config.test.ts` cases (legacy read, both-keys precedence, write-back
      migration round-trip).
- [x] Full suite green (736/736), `tsc --noEmit` clean, lint clean.
- [ ] Manual: in a project whose `app-config.json` still says `redirectUrls`,
      run `brevo app upload` — upload succeeds and the file afterwards says
      `redirectUris` with the same values.
- [ ] Manual: fresh `brevo app create` scaffold writes `redirectUris`.

### Drop `cli_version` from request bodies and `cliVersion` from app-config.json

**Change:** `createApp` and `uploadApp` (`src/services/app.ts`) no longer spread
`cli_version` into the request body — the upload endpoint binds
strictly and 400s on unknown top-level keys, and the version already travels on
every request in the `User-Agent` header (`src/lib/telemetry.ts`). The scaffold
no longer stamps `cliVersion` into `app-config.json` (template line, `{{CLI_VERSION}}`
var, `ProjectConfig.cliVersion` type all removed — nothing ever read the field).
`source: 'cli'` on create is deliberately untouched (see `docs.md`).

**Must hold true:**

- [x] `uploadApp` POSTs the `UploadAppPayload` byte-for-byte — no extra top-level
      keys. Covered by the updated `app.test.ts` assertion including an explicit
      `not.toHaveProperty('cli_version')`.
- [x] `createApp` body carries only the payload plus `source: 'cli'`. Covered by
      `app.test.ts`.
- [x] Template vars no longer include `{{CLI_VERSION}}` and the scaffolded
      `app-config.json` has no `cliVersion` line. Covered by `scaffold.test.ts`.
- [x] Full suite green: 730/730, lint clean, `tsc --noEmit` clean.
- [ ] Manual: `brevo app upload` against a strict server build (one that rejects
      unknown keys) succeeds where it previously 400'd. Blocked on access to a
      server build with the BEX-355 contract merged.
- [ ] Manual: `brevo app create` still succeeds against the current backend (which
      tolerated `cli_version`) — i.e. removing the key is backward-compatible with
      lenient builds too.
- [x] Reviewer: confirm with the upload-service owners that nothing *requires*
      `cli_version` in the body (telemetry should read the `User-Agent` header,
      which is unchanged and covered by `telemetry.test.ts` / `client.test.ts`).
      **Confirmed by the service owners 2026-08-03:** zero references to
      `cli_version` server-side — upload (strict) 400s on it, PATCH/create
      silently ignore it, and telemetry reads the structured `User-Agent` from
      the request log. The header approach is final.
- [ ] Manual: run `brevo app upload` in a project whose `app-config.json` still
      carries a legacy `cliVersion` field — upload must succeed and the write-back
      may silently drop the field (fill-only semantics unaffected).

### Upload response version key: `version` is canonical, `app_version` is the fallback

**Change:** Verified against the BO source (`app-store-bo-be`
`http_cli_upload_app.go`): the upload *response* returns the bumped version
under `version` (plus optional `display_version`), not `app_version` — that
name is request-side only. `UploadAppResponse` (`src/types.ts`) and the
write-back in `src/commands/app/upload.ts` now read `version` first with
`app_version` kept as a tolerated fallback (precedence flipped; both keys were
already read, so no behavior change against any real server build). Test
fixtures updated to mirror the BO response shape. Redirect naming was
re-confirmed in the same pass and has since been aligned: upload used to be
the lone endpoint saying `redirect_urls`; the key is now `redirect_uris`
everywhere (see the rename entry below).

**Must hold true:**

- [x] A response carrying only `version` persists and prints the bumped value.
      Covered by `upload.test.ts` (canonical fixtures now use `version`).
- [x] A response carrying only `app_version` still works (tolerance path).
      Covered by `captures the new version when the upload response names it
      'app_version'`.
- [x] Full suite green: 733/733, lint clean.
- [ ] Manual: `brevo app upload` against a real backend — confirm the printed
      and persisted version match the server's bumped `version` value.

### UI apps: `auth: { "type": "none" }` and slimmer app-config.json

**Change:** A UI app's config no longer carries an OAuth block: `auth` is
exactly `{ "type": "none" }` — no scopes (the `DEFAULT_UI_APP_SCOPES` constant
is gone), no redirect URIs, no jwtSecret. On the wire, `POST /apps` for a UI
app omits the `scopes` key and the upload payload omits the whole `auth` key
(ASSUMED server-tolerated — see *Before UI-apps GA*). `app upload` enforces
the shape both ways: a UI-app config with `scopes`/`redirectUris` is rejected,
as is `"type": "none"` on a config without `ui_app`. Additionally the unused
`permittedUrls` and `support` sections were dropped from the scaffolded
config for **both** app types (nothing ever read them); the read path strips
them from legacy files so the next write migrates. The read path also carves
`"none"` out of the interim `auth.type` → `distribution_type` migration.

**Must hold true:**

- [x] UI-app create sends no `scopes`/`redirect_uris` keys; upload sends no
      `auth` key; write-back restores `auth: { type: 'none' }` verbatim.
      Covered in `create.test.ts` / `upload.test.ts`.
- [x] Auth-shape mismatches fail with actionable errors (3 paths covered in
      `upload.test.ts`).
- [x] `readProjectConfig` preserves `auth.type: "none"` (not folded into
      `distribution_type`, not deleted as the interim key) and drops
      `permittedUrls`/`support`. Covered in `config.test.ts`.
- [x] OAuth flows unchanged: same create/upload payloads, scopes and redirect
      validation intact. Full suite green: 885/885.
- [ ] Manual: create a UI app end-to-end from a local build, inspect the
      written `app-config.json` (auth block, no permittedUrls/support), and run
      `brevo app upload` against a real backend to confirm the server accepts
      the auth-less payload.
- [ ] Manual: `brevo app upload` in an OAuth project scaffolded by an older
      build (file still has `permittedUrls`/`support`) — upload succeeds and
      the write-back drops both sections.

### UI-app create: registry-driven prompts (BEX-361) + integration-type prompt

**Change:** `brevo app create`'s UI-app path now fetches
`GET /v3/app-store/surface-points?extensionType=actionLink` before any placement
prompt (fetch-only, NO local-mirror fallback — failure aborts with an actionable
message) and builds pages/kind/positions/context choices from the fetched rows;
`surface_point_list` is the selected rows' `extension_point` names, validated
against the fetched list (`validateUiApp` gained an optional `allowedPoints`
param; upload still defaults to the local mirror). New integration-type prompt:
External link selectable, Modal iframe disabled ("coming soon"). Context prompt
becomes a checkbox of the selected rows' `allowed_context_field` union, with
free text only when no row declares one. Field prompts now describe what they
render as (heading = link label, subheading = tooltip, redirect = URL).

**Must hold true:**

- [x] Fetch failure / empty registry aborts before any placement prompt, no app
      created, OAuth path unaffected. Covered in `create.test.ts`.
- [x] Choices (pages, positions, labels, context union) come from the fetched
      rows; a registry-only point validates at create (allowed-points threading).
      Covered in `create.test.ts`.
- [x] Modal iframe choice is disabled and unselectable; the answer threads into
      `extension_type`. Covered in `create.test.ts`.
- [x] `app upload` pre-flight is unchanged (local mirror; no fetch). Full suite
      green: 901/901, lint clean.
- [ ] Manual (needs BEX-361 deployed): run the UI-app flow end-to-end against a
      seeded registry — verify labels, the context checkbox, and that the
      created `app-config.json` carries the selected `extension_point` names.
- [ ] Manual: run `brevo app create` → UI app against an environment WITHOUT
      BEX-361 — verify the actionable abort (QA TC-12.2b).

### Smoke suite: assert on `auth.redirectUris` (post-rename drift fix)

**Change:** `scripts/smoke/core.ts` only. The BEX-366 rename of app-config.json's
`auth.redirectUrls` → `auth.redirectUris` landed without updating the smoke
harness, so the create/upload steps in both lifecycles failed on the old key
(`auth.redirectUrls is not an array: undefined`) before the upload CLI call even
ran, cascading into the rename-verify and public status/submit steps. The six
assertion/write sites now use `redirectUris`. No test case removed, no `src/`
change, no user-visible CLI behavior change (so no changeset).

**Must hold true:**

- [x] `npx tsc --noEmit -p scripts/tsconfig.json` passes.
- [x] The key the smoke script reads/writes matches what the CLI scaffolds
      (`src/templates/files/app-config.json.tmpl` writes `auth.redirectUris`).
- [ ] Manual: `yarn smoke` against staging — steps 4/6/8 (private create,
      upload, verify rename) and 14–21 (public lifecycle) pass. If public
      status/submit still fail *after* a successful upload, that is a
      backend-side question (review snapshot), not this fix.
- [ ] Manual: rerun requires a `dist/` owned by the current user (a prior
      `sudo` run left it root-owned; `sudo chown -R "$(whoami)" dist` first).

### Unified create/upload payload structure + `auth: {}` for UI apps

**Change:** `POST /v3/app-store/apps` (create) now sends the same structure as
the upload payload: OAuth fields travel inside `auth: { scopes, redirect_uris }`
instead of top-level `scopes`/`redirect_uris` keys (UI apps omit the block
entirely, as before). The upload request's version field is renamed
`app_version` → `version`, matching the response and every app object. A UI
app's `app-config.json` auth marker changed from `auth: { "type": "none" }` to
the empty object `auth: {}` — the scaffold template, upload write-back,
`validateAuthShape`, and the config read path (which now drops any legacy
`auth.type`, migrating dev-era files on next write) all follow. Docs updated in
`SKILL.md`/`AGENTS.md`.

**⚠️ Server dependency — do not release ahead of the backend.** Unlike the
UI-app assumptions above, `POST /apps` is live in production for OAuth apps: a
CLI sending nested `auth` against a server that still binds top-level
`scopes`/`redirect_uris` would create apps with no OAuth config (or 400). The
create endpoint must accept the nested block — and the upload endpoint the
`version` key — before this ships.

**Must hold true:**

- [x] `buildCreatePayload` (OAuth) emits `auth: { scopes, redirect_uris }` and
      no top-level `scopes`/`redirect_uris`; UI apps emit no `auth` key at all.
      Covered in `create.test.ts`.
- [x] Upload payload carries `version` (no `app_version` key); the response
      read path still tolerates both. Covered in `upload.test.ts` /
      `app.test.ts`.
- [x] Scaffolded UI-app `app-config.json` carries `auth: {}` and parses as
      valid JSON; `readProjectConfig` drops a legacy `auth.type: "none"`
      without misreading it as a distribution. Covered in
      `conditionals.test.ts` / `config.test.ts`.
- [x] Full suite green: 899/899, lint clean.
- [ ] Manual (blocked on backend): create an OAuth app against a server build
      that accepts nested `auth` — verify scopes and redirect URIs land on the
      app. Then `brevo app upload` — verify the server accepts `version` and
      the confirmed version is written back.

### `ui_app` field names renamed to snake_case (keys only; values stay camelCase)

**Change:** Every field NAME in the `ui_app` block is now snake_case, in
`app-config.json` and on the wire (the upload payload carries the block
verbatim, so both change together): `extensionType` → `extension_type`,
`surfacePointList` → `surface_point_list`, `redirectLink` → `redirect_link`,
`linkTarget` → `link_target`, `modalIframeUrl` → `modal_iframe_url`
(`heading`, `subheading`, `context`, `version` were already single words).
Field VALUES are unchanged — `extension_type: "actionLink"`, slot names like
`contactDetails.headerMenu.action`, `_blank`. The
`GET /v3/app-store/surface-points?extensionType=` query parameter is a
separate endpoint contract (BEX-361) and is deliberately NOT renamed. There is
no read-path alias for the old camelCase keys — no config exists in the wild
while the feature is pre-GA, same stance as the BEX-350 value-casing decision.
Validation error messages now name the snake_case fields. Docs
(`SKILL.md`/`AGENTS.md`/`QA-TESTCASES.md`/changeset) updated in the same
change.

**⚠️ Server dependency — same caveat as the unified payload above.** The
snake_case block must be what the upload endpoint binds and what the manifest
read path / UI kit consume. Confirm against the platform before GA.

**Must hold true:**

- [x] `brevo app create` (UI path) writes a `ui_app` block with only
      snake_case keys; the created-app box renders from the renamed fields.
      Covered in `create.test.ts` (`builds the ui_app shape the platform
      consumes`).
- [x] `brevo app upload` sends the snake_case block under the `ui_app` wire
      key and validates the renamed fields (`ui_app.extension_type`,
      `ui_app.surface_point_list`, …) with messages naming the new keys.
      Covered in `upload.test.ts` / `validators.test.ts`.
- [x] `fetchSurfacePoints` still queries `?extensionType=` (unrenamed).
      Covered in `services/app.test.ts`.
- [x] Full suite green: 899/899; `tsc --noEmit` clean.
- [ ] Manual (blocked on backend): upload a UI app against a server build and
      confirm the snake_case block is accepted and echoed back; deploy and
      confirm the action link renders (proves the manifest/UI-kit path reads
      the snake_case names).

### BEX-290 — record pages come from `/surface-points/locations` (2026-08-06)

**Change:** `brevo app create`'s UI-app path no longer pulls the whole
extension-point registry to work out which record pages exist. The two registry
reads now ask different questions:

1. `GET /v3/app-store/surface-points/locations` → `{ locations, count }`, the
   registry's distinct `location_name` values, for the record-page prompt
   (`appService.fetchSurfacePointLocations`, `ENDPOINTS.APP_STORE_SURFACE_POINT_LOCATIONS`).
2. `GET /v3/app-store/surface-points?location=<csv>` → the rows, once, for the
   placements on the pages that were picked. This is now the ONLY row read in the
   flow.

Partner-visible prompts are unchanged. Two behavioural consequences:

- **The extension type can no longer be checked before the page prompt** — a list
  of location names carries no `extension_type_list`. So a page whose every
  placement is un-hostable is offered, then reported as a warning and skipped once
  the rows arrive, and `APP_CREATE_UI_POINTS_NONE_FOR_TYPE` is raised *after* the
  page prompt instead of before it. This makes the existing dropped-page warning
  path more reachable, not less — it is load-bearing now.
- **The narrowed read has no already-held superset to fall back on**, so a read
  that fails, or that covers fewer of the picked pages than were asked for, is
  retried UNFILTERED and narrowed client-side. Only a failure of both aborts.
  Tracked for removal once `?location=` is confirmed honoured (`docs.md`).

**Must hold true:**

- [x] `yarn lint && yarn test` green (47 suites / 979 tests); `tsc --noEmit` clean.
- [x] The page prompt offers exactly what the locations endpoint lists, not a
      reduction of the rows. Covered by `offers exactly the pages the locations
      endpoint lists` (`create.test.ts`), where the row fixture covers three pages
      and only the two listed ones are offered.
- [x] One locations read + one row read on a clean run, with the row read narrowed
      to the picked pages. Covered by `reads the pages from the locations endpoint,
      then the picked pages by location`.
- [x] The unfiltered retry fires on a failed narrowed read, an empty one, and one
      covering only some picked pages — and both reads failing aborts with the
      actionable message. Four cases in `create.test.ts`.
- [x] A locations read that fails or returns `[]` aborts before anything is asked
      and before any row read is attempted.
- [x] A page with rows but none that can host the chosen type is warned about and
      skipped, and the placement prompt stays satisfiable (the prompt-lock
      regression). Covered by the `a picked page with no placement that can host the
      chosen type` describe.
- [ ] Manual (blocked on BEX-361 shipping): run `brevo app create` → UI app against
      a real environment and confirm the locations endpoint's shape, that the page
      prompt matches the registry, and that `?location=` is honoured (which lets the
      retry go).
- [ ] Reviewer: no agent-doc change is proposed. `SKILL.md`/`AGENTS.md` describe this
      as "reads the available placements from the platform's extension-point
      registry" without naming endpoints, and no command, flag, prompt, exit code or
      message changed — so this is not user-visible CLI behaviour under CLAUDE.md's
      definition. Confirm that reading.

### `surface_point_list` authors the registry slug, not the dotted slot name (2026-08-07)

**Change:** `buildSurfacePointList()` writes each entry's `surface_point` from the
registry row's `surface_point_name` (`contact-details-header-menu`) instead of its
dotted `surface_point` / `extension_point_name`
(`contactDetails.headerMenu.action`). The placement prompt's choice values and
dedupe key move to the slug with it, and `toUsableRows()` now drops a row the
registry gives no slug for.

**The trigger was a live 400 on staging.** A UI-app upload answered
`ui_app.surface_point_list contains unregistered extension point(s):
companyDetails.overviewAttributes.widget, contactDetails.headerMenu.action` — the
values the CLI had just authored from the registry's own rows.

**Why the dotted name is wrong even though it is what renders.** Every
`extension_points` row carries both identities, 1:1. The platform resolves an
authored entry by the slug only — `ExtensionPointsRepository.FindByNames`, a
`WHERE surface_point_name = ANY($1)` read, used by both
`checkUIAppExtensionPoints` (app-store-bo-be, upload) and the manifest path
(app-store-backend, render). What it serves the frontend as `extensionPoint` is
that row's *dotted* name. So the dotted form is what specs quote and what the UI
kit exact-matches, and it is still not authorable.

Note the same JSON field carries the other vocabulary in one place server-side:
`defaultSurfacePointList` in app-store-backend holds dotted names, because a
defaulted slot bypasses the registry lookup entirely (un-migrated legacy apps).
That is a backend quirk, not a second contract for authored blocks.

**Must hold true:**

- [x] `yarn lint && yarn format:check && yarn tsc --noEmit && yarn test` green
      (47 suites / 1011 tests).
- [x] The authored value is the slug and never the dotted name. Covered by
      `authors the surface_point_name slug, never the dotted extension-point name`,
      and by `REGISTRY_ROW` keeping the two as deliberately different strings so no
      fixture can make either one pass by accident.
- [x] A row with no `surface_point_name` is dropped rather than offered. Covered by
      `drops a row the registry gave no surface_point_name`.
- [ ] **Manual, blocking:** re-run `brevo app create` → UI app → `brevo app upload`
      against staging and confirm the upload 200s where it previously 400'd.
- [ ] **Manual:** confirm the rendered slot actually appears on the CRM record page
      (upload accepting the slug proves the lookup matched; only the render proves
      the resolved dotted name reached the kit).
- [ ] Reviewer: the created-app box and the `app upload` diff now print the slug,
      since they print the authored value. Decide whether that is acceptable
      partner-facing text or whether both should render `EXTENSION_PLACE_LABELS`
      against the row instead — the CLI no longer holds the row at print time, so
      that is a real change, not a tidy-up.
- [ ] Reviewer: agent docs updated (`SKILL.md`, `AGENTS.md`) because the authored
      `app-config.json` value changed — that is user-visible under CLAUDE.md's
      definition, unlike the registry-read change above it.

### One placement per record page (2026-08-07)

**Change:** the placement step is now one single-select `list` per picked page
(`placement:<location>`), replacing the single grouped checkbox. An app takes
exactly one spot on a page.

This deletes the two prompt rules that guarded the grouped version
(`APP_CREATE_UI_PLACEMENT_REQUIRED`, `APP_CREATE_UI_PLACEMENT_PAGE_MISSING`) and,
with them, the prompt-lock class of bug they caused — a page the registry offered
nothing on could not satisfy its own validate. A page with no hostable placement is
now simply never asked about, and is still reported by the existing warning.

**The platform does not enforce one-per-page.** `validateSnapshot` (app-store-bo-be
`cli_ui_app.go`) rejects only a *duplicate* slot, so a hand-edited config listing two
spots on one page uploads and renders. This is the CLI's authoring model.

**Must hold true:**

- [x] `yarn lint && yarn format:check && yarn tsc --noEmit && yarn test` green
      (47 suites / 1008 tests).
- [x] One prompt per picked page, each offering only that page's rows, and each a
      `list`. Covered by `asks one placement prompt per picked page, each listing only
      that page` and `offers the page placements as a single-select list`.
- [x] Three picked pages author three placements, in registry order rather than
      answer order. Covered by `authors exactly one placement for each picked page`
      and `writes the placements in registry order regardless of answer order`.
- [x] A page the registry offers nothing on is warned about and not prompted for, and
      the run still creates. Covered by the `a picked page with no placement that can
      host the chosen type` describe.
- [ ] **Manual:** run `brevo app create` → UI app across two pages and confirm the
      prompts read well one after another — the per-page phrasing is new
      (`Where should it appear on the contact page?`).
- [ ] Reviewer: confirm one-per-page is the intended product rule and not just the
      shape of the current UI kit. If an app may legitimately take two spots on one
      page later, this is the commit to revert — the wire has always allowed it.

### `app create` survives a read-back that 404s (2026-08-07)

**Change:** `app create` passes its create response to `fetchAppContext` as a
read-back fallback, and `resolveAppCredentials` gained `{ tolerateMissing }` so that
one caller can take a 404 as `null` instead of the friendly not-found error.

**Observed on staging (2026-08-07, UI-app create).** `POST /v3/app-store/apps`
answered with an app ID; `GET /v3/app-store/apps/{that id}` answered
`{"error":"id not found","code":"not_found"}` under a second later. The throw
propagated out of `fetchAppContext` before `runBaseScaffold`, so the command exited
non-zero with `App <id> not found.` — for an app that had just been created and was
still on the server. Two identically-named apps 51s apart in the local
`appNames` cache are the signature of retrying into the same failure.

**Root cause is not established, and this change does not assume one.** Two
candidates: (a) the read path excludes UI apps — plausible if it scopes on
`FindIDByUUID(uuid, client_id)` or joins a row a UI app has none of, since a UI app
sends no `auth` block; (b) read-after-write lag, weighted lower because
`id not found` is a definite answer rather than a timeout. The fallback is correct
under either, and disappears on its own if the read starts resolving.

**Must hold true:**

- [x] `yarn lint && yarn format:check && yarn tsc --noEmit && yarn test` green
      (47 suites / 1018 tests).
- [x] A 404 stays fatal for every caller that reads a user-supplied ID
      (`app scaffold`, `fetchApp`, `fetchAppState`, `deleteApp`). Covered by
      `throws the friendly not-found error on a 404 by default` and by the
      `tolerateMissing: false` assertion in the scaffold suite.
- [x] `tolerateMissing` is scoped to 404 — a 500 or an expired session still throws
      rather than being silently scaffolded around. Covered by `still throws non-404
      errors when tolerateMissing is set`.
- [x] The fallback context is built from the create response, not from placeholders.
      Covered by `builds the context from the fallback when the server returns no
      app` (asserts `client_id`, `client_secret`, `redirect_uris`).
- [x] The warning is suppressed under `--json` — `logWarn` writes to stdout, which is
      the JSON blob. Covered by `stays silent on the fallback path under --json`.
- [x] The spinner stops when the read throws (it was left spinning over the error
      output; visible in the reported paste as `⠧ Fetching app details...  ← 404`).
      `spinner.stop()` moved into a `finally`.
- [ ] **Manual:** `brevo app create` → UI app against staging. Confirm the app
      directory is written, `app-config.json` carries the real name /
      `distribution_type` / `version` from the create response, and the run exits 0
      with the read-back warning.
- [ ] **Then confirm the platform side** — `GET /v3/app-store/apps/{id}` for a
      known UI app, and the same for an OAuth app in the same account. If the UI app
      404s and the OAuth app resolves, that is candidate (a) and belongs on the
      platform; file it and link it here. Until then this fallback is the only thing
      keeping a UI-app create from failing.
- [ ] Reviewer: on the fallback path `scopes` is absent from the create response, so
      `buildTemplateVars` falls back to `DEFAULT_SCOPES` for an OAuth app. Harmless
      for a UI app (scopes resolve to `[]` regardless) and self-correcting on the
      next `app scaffold`, but confirm that's the right degradation rather than
      writing an empty `scopes` array.

### BEX-290 — `surface_point` → `surface_point_name`, and the platform stamps `extension_point_name` (2026-08-10)

**Change (cross-repo, two branches that must land together):**

- **brevo-cli** (`BEX-290_ui-components`): each `ui_app.surface_point_list` entry
  names its slot with `surface_point_name` instead of `surface_point`. Value
  unchanged — it was always the registry's kebab-case slug. The old key is
  rejected with a rename hint (`validateSurfacePointList`), not aliased.
- **app-store-bo-be** (`BEX-361_surface-points-endpoint-and-default-context`):
  same key rename on `uiAppSurfacePointRequest` and `appstoredb.UIAppSurfacePoint`,
  plus `checkUIAppExtensionPoints` now **stamps** each stored entry's
  `extension_point_name` from the registry row it just matched. Runs on both write
  paths (`POST /cli/apps` and `POST /cli/apps/{id}/upload`).

The stamp is server-derived: it is not bound by the request struct (so authoring it
is a 400), not present on `uiAppResponse` (so it never reaches `app-config.json`),
and unconditionally rewritten on every upload so a renamed registry row wins over
the copy stored last time.

**Must hold true:**

- [x] **The string `surface_point` appears nowhere in either repo.** Not as an
      authored key, not as a rejection hint, not on the registry response. Verify with
      a grep that excludes `surface_point_name` / `surface_point_list` /
      `surface-points`; a match means the removal was partial.
- [x] CLI: `yarn tsc --noEmit && yarn test` green (47 suites), including
      `ignores a server-echoed extension_point_name inside an entry`.
- [x] bo-be: `go vet ./... && go test ./appstoredb/... ./cmd/...` green, including
      `…RejectsAuthoredExtensionPointName`, `…DoesNotEchoExtensionPointName` and
      `TestHTTPCliUploadAppStampAloneIsNotAChange`.
- [x] The upload fixture's registry rows carry a **dotted** `Name` distinct from
      their slug key, so the stamp assertion cannot pass by reading the authored
      value back. (`defaultRegisteredPoints`, `testActionPointName` et al.)
- [ ] **Manual, blocking — end to end against staging, in this order.** Deploy bo-be
      first. There is no compatibility shim in either direction and no migration hint:
      an old CLI authoring `surface_point` against the new service gets the generic
      `ui_app.surface_point_list[0] has unsupported field(s): surface_point`, and a new
      CLI against the old service gets the same message naming `surface_point_name`.
      Confirm both, so the failure is at least legible during the rollout window.
- [ ] **Manual, blocking:** the registry response renamed its row field too
      (`surface_point` → `extension_point_name`). An old CLI reading the new
      `GET /cli/surface-points` finds no name on any row and reports the registry as
      unseeded — it does NOT fall back, because `extension_point_name` is not one of
      the alias spellings it tolerates. Confirm that message, and that it points the
      partner at upgrading rather than at a data problem.
- [ ] **Manual, blocking:** `brevo app create` → UI app → `brevo app upload`, then
      read `app_versions.snapshot` for that app and confirm each
      `surface_point_list` entry carries **both** `surface_point_name` and the
      matching dotted `extension_point_name`.
- [ ] **Manual, blocking:** confirm the upload response, and the `app-config.json`
      written back from it, contain **no** `extension_point_name` — and that a
      second `brevo app upload` immediately after reports "already up to date"
      rather than phantom drift.
- [ ] **Manual:** upload twice with the registry row's `extension_point_name`
      changed in between, and confirm the stored stamp follows the registry rather
      than staying at the first value. **Note the interaction with change detection:**
      the stamp is excluded from `isVersionUnchanged` (`AppSnapshot.ForComparison`),
      so if NOTHING else changed the upload is a no-op and the stamp is not rewritten.
      Change one authored field in the same upload to observe the refresh.
- [ ] **Manual, blocking:** re-upload an app stored BEFORE the stamp existed, with no
      other edit, and confirm it reports **not changed** and records no new version.
      Without the comparison exclusion every UI app in the estate bumps a version once
      for a config nobody edited.
- [ ] Reviewer: `openapi.json` renamed the key in the four `ui_app` entry schemas
      **and** on the `/cli/surface-points` row, where it is now `extension_point_name`
      — the column it was always reading. That row property was the last thing in
      either repo still called `surface_point`, and its old description told readers
      to author that value, which is the bug this whole change removes.
- [x] Reviewer: **app-store-backend was already ahead of both repos.** Its working
      branch `fix/bex-346-pin-cache-schema-v4` decodes `surface_point_name` with no
      shim for the old key, and decodes `extension_point_name` and *prefers* it over
      the slug (`snapshotSurfacePoint.slotName`). This branch closes a mismatch
      rather than opening one — but that makes the deploy order matter in three
      places, not two. See `docs.md` for the two review notes it leaves behind (a
      stale comment crediting the CLI with the stamp, and the slug fallback that
      must survive).
- [ ] **Manual, blocking:** confirm the twelve seeded rows still have twelve
      DISTINCT `surface_point_name` values before relying on the stamp. The column
      has no unique constraint and the slug drops the component kind, so a
      thirteenth row sharing a section would make `FindByNames` — and therefore the
      stamp — pick arbitrarily. Tracked in `docs.md`.

### BEX-290 — `app list` survives a UI app and names each app's type (2026-08-11)

**Change:** `brevo app list` crashed with `TypeError: Cannot read properties of null
(reading 'length')` part-way through the listing as soon as the account contained a UI
app. `GET /v3/app-store/apps` returns `redirect_uris: null` — not `[]`, not absent — for
any app with no OAuth block, and the render loop dereferenced it. `scopes` was already
guarded on that line; `redirect_uris` never was, and `OAuthApp` typed it non-nullable so
the compiler could not see it.

Both fields are now `string[] | null` on `OAuthApp`, which surfaced the same unguarded
dereference in `app credentials` (`printCredentialsHuman`) — fixed here — and required
widening `containsLegacyAllScope` (already null-safe at runtime).

The render half: a UI app was being drawn as an OAuth app, so it read as a broken one
(empty Client ID, three `(none)` rows). Rows now lead with `Type: OAuth app` / `UI app`,
a UI app's OAuth-only rows are skipped rather than printed empty, and the `ui_app` block
renders field for field, mirroring the upload summary. Header is `Your apps:`. Detection
is `isUiAppRecord()` in `src/lib/config.ts`, beside `isUiAppConfig()`: the echoed
`ui_app` block when present, otherwise the absence of *every* piece of OAuth material.

**Must hold true:**

- [x] `yarn test` green on `src/__tests__/commands/app/list.test.ts` (19 tests, 7 new
      covering the null guard, both type labels, the `ui_app` rows, per-placement
      context, the echo-less fallback, and the half-configured-OAuth false positive).
- [x] `yarn lint && yarn format:check && npx tsc --noEmit && yarn test` green across the
      suite (47 suites / 1027 tests).
- [x] **Manual:** `brevo app list` against an account holding four UI apps and three
      OAuth apps — full listing renders, no crash, each row correctly typed.
- [x] **Manual:** `brevo app credentials --app-id <ui-app>` in both text and `--json`
      mode — no crash on the null callbacks.
- [ ] **Manual, once the single-app read echoes `ui_app`:** confirm the detail rows
      (extension type, placements + context, label, more info, link) render from a real
      server echo, not just the unit fixture. The list endpoint does **not** echo the
      block today — confirmed live on 2026-08-11 — so every UI-app row currently stops
      at `Version:`, and the `printUiApp` path is unit-tested only.
- [ ] Reviewer: the detection fallback is a heuristic and it is load-bearing while the
      list omits `ui_app`. It requires an empty `client_id` **and** no callbacks, so a
      half-configured OAuth app stays an OAuth app. Confirm no path can produce an OAuth
      record with a blank `client_id` — if one can, it will now be mislabelled.
- [ ] Reviewer: `Type:` is printed on OAuth rows too, which is new output on a path
      scripts may read. The contract for scripting is `--json` (unchanged here), so this
      is judged safe — say so if you disagree.
- [ ] **Platform question, non-blocking:** the four UI apps come back with
      `owner_user_id: 0` while every OAuth app carries a real user ID. If the UI-app
      create path is not stamping the owner, that is a server-side bug — raise on
      BEX-290. The CLI does not read the field, so nothing here depends on it.

### Refactor — split `create.ts`, single-source the upload key strip (2026-08-11)

**Change:** structural only, no behaviour change intended and none expected. Two parts.

1. **`src/commands/app/create.ts` split.** The UI-app half — the registry reads, the
   placement prompts, `buildSurfacePointList`, the example-URL builder and the UI-app
   summary box — moved verbatim into a new `src/commands/app/ui-app-authoring.ts`,
   which exports exactly `resolveUiApp` and `renderCreatedUiApp`. `create.ts` drops
   1112 → 541 lines and keeps the shared flow (name, distribution, app type,
   directory, the POST and its 409 retry). Follows the seam
   `account-deployment.ts` already established for `deploy` / `rollback`.

   The moved region is **byte-identical** to what was removed apart from four edits:
   two added `export` keywords, the leading comment retitled (its "4b." step number
   no longer leads a file), and one blank line. Verified with a `diff` of the
   extracted range against the deleted range.

2. **`src/commands/app/upload.ts` — one owner for `UPLOAD_INJECTED_UI_APP_KEYS`.**
   `canonicalizeUiApp` had its own deep traversal that re-implemented the same key
   filter as `stripInjectedKeys`, so the diff and the write-back each had a private
   copy of the rule. It now composes `sortKeysDeep(stripInjectedKeys(x))`, leaving
   `stripInjectedKeys` as the only reader of the list. Same output: both traversals
   already filtered the same keys at every depth, and the `surface_point_list` sort
   still runs last on the stripped, key-sorted object.

   This is the structural cause of two fixes already on this branch — `link_target`
   leaking into the diff (`29c9ef4`) and `extension_point_name` needing the strip
   taught to recurse (`5b41e31`). Both had to be fixed twice, once per traversal.

**Must hold true:**

- [x] `yarn test` green across the suite (47 suites / 1028 tests) — 1027 before the
      refactor, plus one new test.
- [x] `yarn lint && npx tsc --noEmit && yarn build` green.
- [x] New test: `strips a server-stamped extension_point_name from the write-back`
      (`src/__tests__/commands/app/upload.test.ts`). Closes the last gap in the
      matrix — `link_target` and `version` were each covered on both the diff and
      write-back sides, but the nested `extension_point_name` was covered on the
      diff side only, which is exactly the case a top-level-only strip gets wrong.
- [x] No test file needed changing for the split. `create.test.ts` imports only
      `createCommand` and mocks `inquirer` / `../../../container` / `../../../lib/config`
      / `./scaffold` / `node:fs`, all of which the new module resolves through the
      same paths.
- [x] `node dist/bin/index.js app create --help` and `app upload --help` render.
- [ ] **Manual:** walk the full interactive UI-app create against staging
      (integration type → pages → per-page placement → label → more info → redirect
      link) and confirm the prompts, the warning path for a page with no placements,
      and the created-app box with its example URL are unchanged. The split is
      mechanical, but this flow is prompt-driven and only partly covered by unit
      tests.
- [x] **Verified against a local API stub, not staging:** `brevo app upload` twice in a
      row on a UI app still prints "already up to date" — the end-to-end assertion that
      the diff and write-back agree on the injected keys. See the differential-equivalence
      note in the entry below for the method and its limits.
- [ ] Reviewer: no changeset added, deliberately — pure refactor with no user-visible
      behaviour change, per `.changeset/README.md` ("refactors with no user-visible
      effect"). Agent docs untouched for the same reason.

### Architecture — app-type registry, capability matrix, command metadata (2026-08-11)

**Change:** the three-part refactor that follows the `create.ts` split above. Structural; no
user-visible behaviour change intended and none observed.

1. **`src/app-types/` — one module per app type.** A type now describes itself (`label`,
   `availability`, `detectConfig`, `detectRecord`, `validateConfig`, `wireOnlyKeys`) and the
   commands ask it questions, instead of six `isUiAppConfig(config)` branches across
   `upload.ts`, `scaffold.ts`, `list.ts`, `create.ts` and `credentials.ts`. Layout:

   ```
   src/app-types/
     contract.ts        AppTypeModule + ValidatableConfig
     capabilities.ts    the matrix (part 2)
     index.ts           static registry: resolveFromConfig / resolveFromRecord
     oauth/index.ts
     ui/index.ts        descriptor + wireOnlyKeys
     ui/detect.ts       the discriminators — a LEAF module, see below
     ui/fields.ts       placement value formatting, shared by all three renderers
     ui/authoring.ts    moved from src/commands/app/ui-app-authoring.ts
   ```

   Migrated call sites: `upload.ts` (wire-only keys + `validateConfig` dispatch),
   `list.ts` (type label + placement lines), `create.ts` (authoring import path).
   `lib/config.ts`'s `isUiAppConfig` / `isUiAppRecord` are now thin re-exports of
   `ui/detect.ts`, so every caller and the registry agree by construction.

   **`ui/detect.ts` has no runtime imports, and must keep it that way.** The first attempt put
   the predicates behind `lib/config`, which the command test suites mock partially — every
   mock silently made detection `undefined` and the whole `app submit` suite failed on
   `isUiAppRecord is not a function`. Detection must not sit behind a commonly mocked module.

   Deliberately NOT moved: request-payload building (the wire shape is confirmed against the
   platform and asserted by many tests — a separate, riskier increment) and rendering labels
   (they genuinely differ per command; only value formatting is shared).

2. **`src/app-types/capabilities.ts` — the feature matrix.** `(app type × distribution) →
   capabilities`. Two orthogonal axes on purpose: `review-lifecycle` follows distribution,
   `account-install` follows app type. Before this the rule existed only as prose in
   `bin/index.ts`'s help block and the agent docs, enforced by one hand-rolled check.

3. **`requires` on `CommandDefinition`, and `submit`'s gate routed through the matrix.**
   `deploy`/`rollback` declare `account-install`; `submit`/`status`/`withdraw` declare
   `review-lifecycle`.

   **The registry does NOT enforce `requires`, deliberately.** A generic interceptor would
   replace each command's tested message and exit code with one string, which `CLAUDE.md`
   counts as a user-visible break. Enforcement stays in the commands via `assertCapability`,
   which takes the caller's own message — so `submit.ts` still throws
   `APP_SUBMIT_NOT_PUBLIC` with its existing exit code. The field is the executable copy of
   the rule, for generating the help groupings and doc notices that are hand-maintained today.

**Must hold true:**

- [x] `yarn test` green (49 suites / 1044 tests). Baseline before this work: 47 / 1028.
- [x] `yarn lint && yarn format:check && npx tsc --noEmit && yarn build` green.
- [x] `submit`'s gate answers identically for all four combinations. Covered by the existing
      `rejects a private app as ineligible for review` and `treats a missing
      distribution_type as not public` tests (both still pass unchanged), plus a new matrix
      invariant asserting `review-lifecycle` is granted for exactly the public combinations —
      the equivalence that makes the routing behaviour-preserving.
- [x] No import cycle. Verified at runtime against `dist/`: labels resolve, both
      discriminators answer, and `lib/config`'s delegation returns the same values.
- [x] New suites: `src/__tests__/app-types/capabilities.test.ts` (matrix invariants, registry
      resolution, wire-only keys, availability) and
      `src/__tests__/commands/command-capabilities.test.ts` (metadata names real capabilities,
      declares no unsatisfiable gate, and does not creep into enforcement).
- [x] **Differential equivalence, pre- vs post-refactor: byte-identical.** Both `062dabe`
      (the commit before this work) and `HEAD` were built and driven against a local
      stub of the app-store API (`BREVO_API_URL` allows HTTP for loopback, `BREVO_API_KEY`
      satisfies the auth guard), then every captured stdout, stderr and exit code was
      diffed. `diff -r` reports no differences at all across eight invocations:
      `app list`, `app list --json`, `app submit` on a private OAuth app (text and
      `--json`), on a private UI app, on a public app, and `app upload --yes` run twice
      on a UI app.

      Substance, not just sameness — the stub was built so a regression would show:

      - `app list` renders all four records with no crash: the UI app is typed `UI app`
        with its OAuth-only rows omitted, and the half-configured record (client_id but
        `redirect_uris: null`) correctly stays `OAuth app`.
      - `app submit` on a private app answers the unchanged
        `App <id> is private. Private apps cannot be submitted…` and exit `1`, for a UI
        app as well as an OAuth one; a public app proceeds and exits `0`.
      - `app upload` prints "Already up to date at version 1.0.0" even though the stub
        echoes every wire-only key (`link_target` and `version` at the top,
        `extension_point_name` nested inside each entry) AND lists the placements in the
        opposite order to the local file. That only passes if the diff still sorts
        `surface_point_list` and normalizes those keys away. `app-config.json` was
        unchanged afterwards, so the write-back is still stripping them too.

      **What this does NOT prove:** that the real server responds like the fixtures. The
      shapes used here are the ones confirmed live on 2026-08-11 (list returns
      `redirect_uris: null`, the list does not echo `ui_app`), so the fixtures are
      faithful as of that date — but a server-side change would not be caught by this.
      The method is the reproducible artifact: rebuild both commits, point
      `BREVO_API_URL` at a stub, diff.
- [ ] **Manual, still needs a human:** the interactive UI-app create flow. It is
      prompt-driven, so it is the one path the differential harness above cannot drive —
      see the duplicate item in the entry above.
- [ ] Reviewer: `requires` is metadata with no runtime effect. That is intentional (see above)
      but it does mean the field can be set wrongly without any command failing —
      `command-capabilities.test.ts` is what guards it. Say so if you'd rather it enforce.
- [ ] Reviewer: `availability: 'preview'` on the ui type is also metadata only, matching
      `CLAUDE.md`'s "no runtime guard, by design". Nothing reads it yet; it exists so the
      five hand-maintained "not available yet" notices can be generated at GA.
- [ ] No changeset — pure refactor, no user-visible change. Agent docs untouched for the
      same reason.

### `brevo app update` answers with a signpost instead of `unknown command` (2026-08-12)

**Change:** removed commands are now registered rather than absent. New
`src/lib/removed-commands.ts` holds the table (one entry: `app update` → BEX-250),
`command-registry.ts` registers each as a hidden command whose action throws its
message, and `auth-guard.ts` exempts them from the credential check. The message is
`messages.APP_UPDATE_REMOVED`.

**Why.** Commander's answer to a name it doesn't know is `unknown command 'update'`
plus a `did you mean` guess drawn from string distance — which for `update` was
`create`. So the CLI's reply to the single most likely stale invocation on the branch
was wrong in the expensive direction: `create` makes a second app, `upload` was the
answer. Registering the dead name costs one hidden command and lets the CLI name its
own replacement.

**Must hold true:**

- [x] `yarn test` (1158), `yarn lint`, `yarn format:check`, `yarn build` all clean.
- [x] Every old flag reaches the message rather than `unknown option '--name'` —
      `allowUnknownOption` + `allowExcessArguments` + a variadic `[args...]`. Covered
      by the `OLD_INVOCATIONS` table in `removed-commands.test.ts` (bare, `--name`,
      `--redirect-uri`, `--scope`, `--logo-uri`, `--app-id`, `--yes`, `--json`,
      combinations, and a stray operand).
- [x] `brevo app update --help` gets the message, **not** a usage screen and **not**
      exit `0` — `helpOption(false)` is what does it, and exit `0` is the one answer a
      script must not get from a removed command. Covered by the `--help` / `-h` rows.
- [x] `brevo app help update` too. It is the one route that reaches neither the action
      nor the help option: `_dispatchHelpCommand` calls the target's `help()` directly
      and does not skip hidden commands, so it printed `Usage: brevo app update
      [args...]` and exited `0` — a removed command claiming to exist and to take
      arguments. Fixed by replacing the instance's `help()`; `brevo app help create`
      still works, so the group's help command itself is untouched. Both covered.
- [x] Exits `1` with a `CliError`, so `--json` gets the standard
      `{"error":{…,"exitCode":1}}` envelope via `emitJsonError`. Covered.
- [x] Reachable logged out: the exemption in `commandRequiresAuth` is scoped to the
      removed name, and `app upload` still demands credentials. Both covered.
- [x] `update` appears in no help screen (`hidden`), including the hand-aligned root
      one. Covered.
- [x] Verified against the built CLI, not just the test tree: bare, with old flags,
      `--help`, and `--json` all print the message and exit `1`; `brevo app --help`
      has no `update` row.
- [ ] Reviewer: the message names all five removed flags. That is deliberate (the
      reason someone lands here is usually one of them) but it makes the message long
      — say so if you'd rather it just pointed at the docs.
- [ ] Reviewer: a table plus two consumers for one dead command is more structure than
      a special case in the registry would need. The argument for it is that the
      registry and the auth guard both need the same fact, and a special case would
      duplicate it. Confirm that reading.
- [x] `SKILL.md` and `AGENTS.md` both carry the migration note: `AGENTS.md` as a
      *There is no `brevo app update`* bullet under **Conventions**, `SKILL.md` as the
      tail of the *"Update app metadata"* decision-tree row (which already said the edit
      flags don't exist). Both name `upload`, say nothing is uploaded, and say the `1`
      means the command is gone rather than that an upload failed — that last part is
      the bit an agent needs, since it will meet this as an exit code in someone's CI
      log, not as a command it chose to run.
- [ ] Reviewer: this reverses a first pass that left the agent docs alone on the
      grounds that they didn't mention `app update` and `TC-11.6` asserted they
      mustn't. That reading was too literal — the point of `TC-11.6` is that the
      command must not be *advertised*, not that the string must be absent — so the
      case was rewritten to require the note and forbid any row, example or
      decision-tree entry that reads as an instruction to run it. `TC-11.4` was
      loosened the same way. Check both readings.
- [ ] Reviewer: the two docs say the same thing in different shapes (a Conventions
      bullet vs. a sentence on an existing decision-tree row) because that is where
      each file puts this kind of fact. `TC-11.7` asks for consistency of substance,
      not of layout — confirm that is the right call here.
- [x] Changeset: appended to `.changeset/app-upload-replaces-update.md` (already
      `major`) rather than adding a file, so the CHANGELOG keeps one entry for the
      whole `update` → `upload` migration.
- [x] `QA-TESTCASES.md` TC-5.1 rewritten — it previously expected the
      unknown-command error, which is exactly what this change replaces.

### `app scaffold` bootstraps without an app ID, and refuses the two silent failures (2026-08-12)

**Change:** the config-less branch of `brevo app scaffold` no longer requires
`--app-id`. On a TTY it offers ("Set this directory up for an app you already
have?", default yes) and then shows `promptAppSelection`; declining exits `0` with
the remaining routes printed. `--json`/non-TTY is unchanged — the offer is skipped
and `APP_SCAFFOLD_NO_CONFIG` is raised — so no script behaviour moved.

Three supporting pieces landed with it: `findEnclosingProjectDir()` in
`src/lib/config.ts` (parent walk, cwd excluded), `recoverableFromRecord` on the
app-type registry, and `stripUiAppWireOnlyKeys` extracted to
`src/app-types/wire.ts`.

**Why the two refusals are not polish.** Both failures they prevent are silent, and
each produces a *plausible* result rather than an error:

- Bootstrapping one directory inside a project wrote a second `app-config.json`
  nested in the first. Nothing complained; the next `brevo app upload` from that
  directory pushed the wrong app. `readProjectConfig` reads cwd and never walks up
  (correctly — every other command depends on that), so nothing else could catch it.
- Bootstrapping a UI app that was never uploaded wrote a config with no `ui_app`
  block, because the read endpoint sources that block from the latest
  `app_versions` snapshot. Since the block's presence *is* the app-type
  discriminator, the result did not read as an incomplete UI app but as a valid
  OAuth one — and its next upload would push `auth` where `ui_app` belonged.

**Must hold true:**

- [x] `yarn test` green (1201 tests, 56 suites); `yarn lint` and `yarn build` clean.
- [x] Interactive bootstrap: offer → picker → picked app's config written. Covered
      by `offers to set the directory up for an existing app, then bootstraps the
      picked one`.
- [x] Declining exits `0`, fetches nothing, writes nothing, and prints
      `brevo app create`. Covered by `cancels without fetching or writing when the
      offer is declined`.
- [x] `--json` and non-TTY never prompt and still raise the no-config error. Covered
      by `errors instead of prompting under --json` and `errors instead of prompting
      when stdin is not a TTY`.
- [x] Accepting the offer on an account with no apps reaches the shared empty-list
      error rather than an empty prompt. Covered by `surfaces the empty-list message
      when the account has no apps`.
- [x] The nesting guard fires for the picker path, the `--app-id` path and `--json`,
      always before any fetch or write, and does **not** fire for an ordinary
      in-project run. Covered by the four `nested-project guard` tests, and verified
      against the built CLI in a scratch project (the in-project run reaches the API
      call, proving it passes every local check).
- [x] A never-uploaded UI app is refused; a half-configured OAuth app (client ID, no
      callbacks) still bootstraps. Covered by the two `unrecoverable UI app` tests
      plus `recoverable.test.ts`, whose `composed with resolveFromRecord` cases pin
      the type resolution and the recoverability answer together.
- [x] The bootstrapped `ui_app` block carries no `link_target`, no snapshot
      `version` and no `extension_point_name`. Covered by `strips server-owned keys
      from the ui_app block it bootstraps into the config` and `wire.test.ts`.
- [x] The `stripUiAppWireOnlyKeys` extraction is behaviour-preserving for `upload` —
      its 93-test suite passed unchanged.
- [x] Docs updated in the same pass: `agent-context/SKILL.md` (decision tree entry +
      hard rule 4), `agent-context/AGENTS.md` (command table + the
      `app scaffold` behaviour bullet), `README.md` command table, `CLAUDE.md`
      conventions, and the pending changeset.

**Open question, tracked in `docs.md`:** whether `POST /v3/app-store/apps` writes an
`app_versions` row. If it does, the never-uploaded-UI-app refusal is close to
unreachable; if it does not, users will meet it. The refusal is correct either way —
this only changes how prominent it is.

### `brevo app withdraw` is hidden from help (2026-08-12)

**Change:** `app withdraw` is no longer advertised. It carries a new `hidden: true` on
its `CommandDefinition` (`commands/preview-definitions.ts`), and its two lines were
removed from the hand-aligned root screen in `lib/help.ts`. `hidden` is a **new,
separate axis from the pre-GA gate** — it suppresses the help entry and nothing else, so
the command is still registered, still parses `--app-id` / `--force` / `--json`, and
still reaches `withdrawCommand`. Nothing about the published build changes: the whole
review lifecycle is already eliminated there.

**Why it needs two edits, not one:** there are two help renderers and Commander's
`hidden` only governs the one it generates. The root screen is a hand-written string it
cannot reach, so that omission is maintained by hand and marked with a comment. Both are
asserted in `preview-gate.test.ts`, which is what catches a change to one and not the
other.

**Third consumer, easy to miss:** `scripts/smoke/core.ts` detected which gated commands a
build has by grepping the root help, so hiding `withdraw` would have made the smoke run
*skip* its withdraw step on a build that has it — passing green with less coverage.
`withdraw` is now probed with `brevo app withdraw --help` instead: a registered command
answers `Usage: brevo app withdraw`, an eliminated one falls back to the group's usage
line. The exit code cannot tell them apart (both `0`), which is why the earlier comment
said a subcommand probe was impossible — true of the exit code, not of the output.

**Must hold true:**

- [x] In a preview build, neither `brevo --help` nor `brevo app --help` contains the
      substring `withdraw`, while the *App-review commands* heading still renders with
      `submit` and `status` under it.
- [x] In a preview build, `brevo app withdraw --help` still prints its own usage and all
      three flags, and the command still runs.
- [x] A public build is byte-for-byte unaffected in behaviour — `withdraw` remains
      eliminated, `LEAK_MARKERS` unchanged, `yarn build` and `yarn build:preview` both
      green.
- [x] The smoke runner's capability probe still reports `withdraw` present on a preview
      artifact and absent on a public one. Verified by running `app withdraw --help`
      against both built artifacts, not by reasoning about the regex.
- [x] `npx tsc --noEmit`, `yarn lint`, `yarn format:check`, `yarn test` green.
- [ ] **Manual:** QA Suite 7 runs unchanged against a preview artifact — a tester who
      types the command gets the command, not `unknown command`. New TC-10.3 covers the
      hidden-but-callable pair.
