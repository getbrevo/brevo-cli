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
        script (`link:dev` runs the plain `yarn build`, so it needs no edit), the
        `previewFeatureOf` / `assertFeatureAvailable` wiring in
        `src/lib/command-registry.ts`, the two
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
      choice* rather than rejecting an answer. The prompt being interactive-only was a
      soft limit on reaching it accidentally; it was never a limit on reaching it
      deliberately, which is what the gate adds.

      **Revised 2026-08-13:** a locked run originally didn't ask at all, restoring the
      pre-BEX-290 flow rather than rendering a one-item list. It now asks, listing only
      the choices that build supports. The gate is unchanged — the withheld choice is
      still absent, and `resolveUiApp` is still eliminated — but the question itself is
      no longer conditional, so the flow reads the same in both builds and the user is
      told which app type they are getting instead of having it applied silently. Same
      change to the distribution question. GA still just flips `FEATURE_STAGE`.

      `app deploy` / `app rollback` are gated as commands (capability
      `account-install`), hidden from help and refused when invoked.

      **Removal is a GA step — see the item added to the list at the top of this
      section.**

---

## Per-branch verification

Append an entry per change that needs verifying. Clear this section (keep the
heading) before merging into `main`.

