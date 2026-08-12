# TODO

Running work tracker. Per `CLAUDE.md`, delete this file before merging the branch
into `main` — anything that must outlive the branch belongs in
`RELEASE-CHECKLIST.md` → *Before UI-apps GA* instead.

## Open

- [ ] **`app create` creates and `cd`s into the project directory before the app
      exists on Brevo.** `resolveCreateDirectory()` runs at `create.ts:427`, one line
      before `createAppWithRetry()` — so any hard create failure leaves a stray
      directory behind and the process `chdir`'d into it. Seen with
      `--distribution public` (`Creating test-public and moving into it...` then the
      server's refusal), but it is general: a quota `403`, a network drop, or any
      unmapped `400` does the same. The `409` name clash is the only failure that
      recovers, because it retries in place. Nothing is *deleted* — the scaffold
      writes files at `create.ts:490`, after the create — so this is a stray
      directory and a moved cwd, not data loss.

      **The ordering is deliberate and the fix has a real trade-off:** all local
      prompting finishes before the app is registered, so a Ctrl-C at the directory
      prompt can't orphan an app on the server (the same concern documented at
      `create.ts:481-486`). Don't simply move the create call earlier. The fix is to
      split `resolveCreateDirectory` into *decide* (prompts, no filesystem writes)
      and *apply* (`mkdirSync` + `chdir`), keeping the decision before the create and
      moving the mutation after it. That preserves the prompt order and the
      no-orphan property while leaving the filesystem untouched on failure.

### BEX-290 follow-ups

- [ ] **Ask the platform to echo `ui_app` on `GET /v3/app-store/apps`.** Confirmed live
      (2026-08-11) that the list response carries no `ui_app` key, so `brevo app list`
      can identify a UI app but cannot show what it does — every UI-app row stops at
      `Version:`. Two consequences: the detail rows in `printUiApp` (`src/commands/app/
      list.ts`) are unit-tested only, and app-type detection has to fall back to a
      heuristic (`isUiAppRecord` in `src/lib/config.ts` — no `client_id` and no
      callbacks). Both the fallback and its comment can go once the block is echoed.
      Alternative if the platform declines: an N+1 per-app read, which is worse.

      **Confirmed in code (2026-08-12), so this is a real ask and not a misread.**
      bo-be's list path builds each row through `applyIdentityFields`, which sets only
      `app_id`, `name`, `distribution_type`, `version` and `display_version` — there is
      no snapshot read on the list path at all. Contrast `GET /cli/apps/{id}`, which
      *does* echo the block via `applyLatestVersionFields`. The ask is therefore
      narrow: reuse the same `findLatestVersions` result the list already fetches (it
      is already loading the version rows the snapshot lives on) and set `UIApp`
      alongside `Version`. Worth saying that in the ticket — it makes the change small
      enough to argue for.
- [ ] **Decide what `brevo app credentials` should do for a UI app.** It no longer
      crashes, but it prints `Client ID: ` (blank), `Client secret: [hidden — …]`,
      `Scopes: (none)`, `Redirect URLs: (none)` — a form with nothing in it, because a
      UI app has no OAuth credentials to show. Options: refuse with a typed message
      naming the app type (consistent with how `app scaffold` handles a UI-app project),
      or render a UI-app view like `app list` now does. Same call needed for the `--json`
      shape, which currently returns empty strings/arrays for all four fields. Not fixed
      with the crash because it is a UX decision, not a bug.
- [x] **`owner_user_id: 0` on UI-app records — EXPLAINED, nothing to raise
      (2026-08-12).** Not a create-path failure to stamp the owner. The field is
      OAuth-service-owned: bo-be populates it from the OAuth response body, and an app
      with no linked OAuth credentials has no such body, so `buildAppStoreOnlyResponse`
      leaves it at Go's zero value. A UI app has no OAuth record by construction, so `0`
      is the correct read of "there is no OAuth owner here", not an unowned app record.
      The CLI does not read the field. This item's premise — that OAuth apps carry a real
      ID *and therefore* UI apps should too — was the wrong inference.

- [x] **Slot-name validation moved to the server — DONE.** Resolved by deleting the
      local check rather than by fetching the registry at upload time: the upload
      endpoint already validates every authored name against `extension_points` and
      400s naming the offenders (`checkExtensionPoints`, app-store-bo-be
      `http_cli_upload_app.go:423`), so a second opinion in the CLI could only be a
      lagging one. `EXTENSION_POINTS` and its feeders (`EXTENSION_LOCATIONS`,
      `EXTENSION_WIDGET_PLACES`, `EXTENSION_ACTION_PLACE`, `actionPointForLocation`,
      `extensionPointName`) are gone from `src/lib/constants.ts`; `validateSurfacePoint`
      is shape-only. **`EXTENSION_PLACE_LABELS` was NOT deleted** — the earlier wording
      of this item was wrong to list it. It is CLI-owned partner-facing display text
      and the registry has no display-name column (`surface_point_name` holds kebab
      slugs like `contact-details-header-menu`). `EXTENSION_PLACES_BY_KIND` did not
      exist; that name was stale.
- [x] **The create→read-back 404 was FIXED server-side by BEX-379 — no ticket to file
      (2026-08-12).** The diagnosis in the original item was right: the read path
      excluded an app with no `auth` block. bo-be `e05adbc` (*support CLI apps without
      linked OAuth credentials*, BEX-379, merged 2026-08-10, in prod image 1.7.0) makes
      an OAuth-less app first-class across the CLI endpoints — its changelog literally
      reads "`GET /cli/apps/{id}`: return App-Store data with empty OAuth fields instead
      of 404". The 404 observed on 2026-08-07 predates that release.
      **The fallback is not removed, deliberately.** `fetchAppContext`'s `fallbackApp`
      and `resolveAppCredentials`'s `tolerateMissing` now cost nothing on a current
      server and are the only thing standing between an older deployment and a failed
      create, so they stay until the CLI stops supporting pre-1.7.0 environments. Revisit
      then, not now — and if they are removed, remove both together.
- [ ] **Consider surfacing `url_pattern` from the BEX-361 rows** in the placement
      prompt (e.g. as a choice hint) so partners see where in the product a slot
      renders before picking it.
- [x] **The pre-BEX-361 row-name aliases are confirmed dead — kept anyway, on purpose
      (2026-08-12).** The shipped projection is
      `{extension_point_name, location_name, section_name, component_type,
      surface_point_name, default_context_field, allowed_context_field}`, and bo-be's
      own comment says `place` and `kind` "are not column names and must not appear on
      the wire". So the alias branch in `appService.fetchSurfacePoints`
      (`extension_point`, `location`, `place`, `kind`, `supported_extension_types`) can
      never match a current server.
      **Not deleted**, for the same reason as the create-404 fallback: it is a
      few lines that cost nothing against a current server and are the difference
      between "works" and "the registry has not been seeded" against an older one.
      Delete it in the same pass that drops pre-1.7.0 support, together with the
      bare-array tolerance and the unfiltered retry below — one decision, three sites.
- [x] **Reconsider the second registry call — DONE (2026-08-06).** Resolved by making
      the two reads ask *different* questions rather than by dropping one. The pages
      now come from `GET /v3/app-store/surface-points/locations` (location names, no
      rows) and the rows are read once, narrowed to the pages that were picked. The
      old pair fetched the whole registry and then a strict subset of it, so the
      second call bought freshness and nothing else; the page prompt also no longer
      waits on a full registry read to offer three choices.
- [x] **`?location=` is confirmed honoured — unfiltered retry kept (2026-08-12).**
      `parseLocationFilter` reads the comma-separated parameter, validates every token
      against the registry's own location values, and **400s listing the valid ones**
      on an unknown value rather than silently dropping it. There is also an explicit
      `all` sentinel meaning "no filter", for a caller building the query string
      programmatically. So the retry in `fetchSurfacePointsForPages` is unreachable
      against a current server; see the entry above for why it stays.
- [x] **Locations endpoint shape confirmed: `{ locations: []string, count: int }`
      (2026-08-12)** — the response struct is exactly those two fields, and it takes no
      filter of its own. The bare-array tolerance in
      `appService.fetchSurfacePointLocations` is unnecessary against a current server;
      kept for the same reason as the two entries above.
      **One thing this confirms rather than resolves:** the CLI cannot ask for an
      extension-type-aware page list, because a location list carries no type
      information — so the warning path for a page with no hostable placement stays
      load-bearing in principle. In practice it cannot fire today either, since the
      row projection publishes no `extension_type_list`/`status` for
      `rowSupportsExtensionType` to filter on (see RELEASE-CHECKLIST). Keep the path;
      don't rely on it.
- [ ] **Per-placement `label` / `more_info` / `redirect_link`.** One set is shared
      across every chosen placement today, so an app cannot say *menu entry → link
      X* alongside *sidebar card → link Y*. The nested `surface_point_list` makes
      this cheap to add later — per-entry text would be new fields on an existing
      object rather than a reshape.
- [ ] **Per-entry context narrowing is structural only for now.** Every registry row
      currently carries the same default, so every authored entry gets an identical
      list, and the upload endpoint does not yet validate context per entry. The
      shape is forward-compatible; nothing enforces narrowing anywhere yet.
- [x] **UNBLOCKED — the server-side unified-payload change is deployed (verified
      2026-08-12).** This was the item gating the whole branch. bo-be `origin/main`
      (prod image 1.7.0) accepts both halves:
      - **Create takes the nested `auth` block.** `cliCreatePublicRequest` binds
        `auth: {scopes, redirect_uris}` and `ui_app`, and `isPublicAppsRequestBody`
        uses the presence of either as the contract selector — a body with neither
        routes to the legacy flat-OAuth flow, so older CLI builds keep working. The
        two are mutually exclusive in practice via `validatePublicAppsBlocks`, which
        requires at least one.
      - **Upload takes `version`.** Both spellings are bound; `version` is canonical
        and `app_version` is the kept-for-older-builds fallback. Sending *both* with
        different values is a 400 (`version and app_version disagree: send version
        only`) — the CLI sends `version` alone, so this is satisfied.
      - **Top-level `distribution_type` on upload** is bound and 422s when it differs
        from the stored app, exactly as the reversed 2026-08-04 decision assumed.
      The one thing this change cost is BEX-405: the create response echoes the
      nesting back, and every read site was reading the flat shape. Fixed in
      `flattenCreateAuth`.

- [x] **`ui_app` field names — resolved.** Aligned with the platform's manifest read path and its
      extensibility UI kit (BEX-308 / BEX-350). The block is the stored app snapshot
      verbatim.
- [x] **Upload wire contract — resolved (2026-08-03).** The platform's CLI upload
      endpoint binds the block as `ui_app` and the CLI now sends/reads that key.
      Remaining skew: the CLI still sends `cli_version` on the upload payload, which
      the server strict-rejects as an unknown key — drop it or have the server
      whitelist it (settle with the bo-be branch before either side releases).
- [x] **Deploy/rollback transport — resolved (2026-08-06).** Confirmed against staging:
      one resource, `POST`/`DELETE /v3/app-store/apps/{id}/installs`, same body on both
      (`deploy_client_id` as a number, `name`, `is_developer`). The CLI now matches. Only
      the rejection codes and the POST response shape remain assumed — see
      `RELEASE-CHECKLIST.md` → *Before UI-apps GA*.
- [x] **`app deploy` target-account resolution — implemented (2026-08-07).** `<account-id>`
      is now `[account-id]`: plain accounts resolve their own ID, corporate accounts pick
      from `GET /v3/corporate/subAccount`. Lives in `resolveDeploymentTarget()`, so
      rollback inherits it. Two assumptions remain, both in `RELEASE-CHECKLIST.md` →
      *Before UI-apps GA*:
      - [x] **`organization_id` shape — no longer a blocker.** Both body identifiers are
            `int64` and the body is decoded before `X-Sib-Client-Id` is read, so the CLI
            omits a non-numeric one instead of sending it (`toNumericIdentifier()`):
            `client_id` falls back to the header, `deploy_client_id` to the caller.
            Confirmed against staging, where a working DELETE carries no `client_id`.
            Worth confirming the real shape for the record only.
      - [ ] **The corporate discriminator `type === 'corporate'` is assumed.** Typed optional;
            an absent/unknown value degrades to the plain branch (deterministic, no prompt),
            so a wrong guess shows up as a master account deploying into itself.
      - [x] **Deploy/rollback transport settled (2026-08-06)** — see above. The route is
            `/installs`, not the `/deploy`+`/undeploy` pair the approved design described,
            and the account travels as a numeric `deploy_client_id`. The design's other
            claims (422 `app_not_configured`, idempotent upsert, master may deploy into
            its sub-accounts but never itself, response carries `integration_id`) are
            **not** confirmed by the staging curl and remain open.
            Scope note (2026-08-03): interactive account selection is only needed for
            deploy/rollback against **sub-accounts** — plain accounts keep the explicit
            `<account-id>` argument.
- [x] **Keep `EXTENSION_POINTS` in lockstep with the registry — MOOT, the mirror is
      gone.** This item described the maintenance burden that justified deleting it: a
      hardcoded copy silently rejects a legitimate name the moment the platform adds a
      location or a second action place. There is nothing left to keep in lockstep.
- [x] **BEX-350's registry side has landed (verified 2026-08-12).** bo-be
      `origin/main`'s `specs/database.sql` seeds all twelve rows in the `.widget` /
      `.action` grammar, each carrying both identities (dotted `extension_point_name`
      + kebab `surface_point_name`), with the three pre-BEX-350 `<page>.left.card`
      rows still alongside. The coordination risk this item describes is therefore
      retired for the registry and the backend.
      **What remains is the kit, and it is tracked separately** — see
      `RELEASE-CHECKLIST.md` → *Ship the UI-kit rendering change before or with this
      CLI*. Also note the seed is verified in the **schema spec**, not in any
      particular environment's data: confirm the target environment before releasing,
      because an unregistered name is still dropped silently.
- [ ] `iframeExtension` prompt authoring — **deliberately parked (decision
      2026-08-03):** the CLI stays actionLink-only until the iframe-embed RFC (trust
      handshake, JWT, postMessage) lands; the delivery-path prompt was removed. A
      hand-edited `iframeExtension` block still validates and uploads, and the
      platform keeps accepting it. When the RFC lands, restore the prompt plus
      `permittedUrls.iframe` handling (the postMessage origin allowlist is what makes
      the modal secure).
- [x] Widget slots and explicit `place` selection — **done in the placement prompts**
      (record pages → menu entry vs card → regions); all twelve slots are authorable
      and `validateUiApp` accepts both kinds for an action link.
- [ ] No local dev story for a UI app. `brevo app start` has no UI-app equivalent, so
      a partner can't preview an action link without deploying to a real account.
      Worth considering a local harness that renders the action menu and forwards
      context params to the external URL.
- [ ] `permittedUrls` is scaffolded empty and never validated or populated from
      `ui_app.redirect_link`. Harmless for action links (they open a new tab), but it
      becomes load-bearing for `iframeExtension` modals.
- [ ] Consider whether `brevo app list` should show the app type. Right now an OAuth
      app and a UI app are indistinguishable in the list output.
- [ ] Record context is an allow-list on the extension-point registry row and surfaces
      on the manifest as `app_configs.context`. The CLI can now author a *narrowing*
      `context` list (free text — the allow-list lives server-side, so an unknown name
      is refused at upload). Still worth surfacing the per-slot allow-list read-only
      (e.g. in the create summary) once `GET /cli/surface-points` lands, so a partner
      knows which params their URL will actually receive without a failed upload.

- [ ] **`surface_point_name` has no unique constraint — the stamp inherits that.**
      app-store-backend's own comment (`http_get_apps_extensibility.go`,
      `slotName`) states the case plainly: a slug is `<page>-<section>` with the
      component KIND dropped, and the column has no unique constraint, so two kinds
      on one section resolve to whichever row the lookup reaches first. bo-be's
      `FindByNames` returns `map[string]ExtensionPoint` keyed by slug, so a
      duplicate slug collapses and `stampExtensionPointNames` would stamp an
      arbitrary one of the two. **Latent, not live** — the twelve seeded rows have
      twelve distinct slugs today. Fix by adding a unique constraint on
      `surface_point_name`, or by making the authored identity carry the kind. Do
      one of those before any thirteenth row is seeded.

- [x] **app-store-backend already reads both — DONE, and it was ahead of us.**
      The working branch `fix/bex-346-pin-cache-schema-v4` (staged, uncommitted)
      already decodes `surface_point_name` with **no compatibility shim** for the old
      `surface_point` key, and already decodes `extension_point_name` and PREFERS it
      over the slug (`snapshotSurfacePoint.slotName`). So this branch is not
      proposing a new contract: bo-be and the CLI were writing a key the backend had
      stopped reading. Two consequences worth carrying into review:
      **(a)** the backend's comment says `extension_point_name` is "resolved by the
      CLI at authoring time" — it is not, and must not be; bo-be stamps it and the
      CLI never authors it. Correct that comment when the backend branch lands, or
      someone will add a CLI field to satisfy it.
      **(b)** a snapshot written before the stamp carries no `extension_point_name`,
      so the backend's slug fallback in `slotName` stays load-bearing. Do not delete
      it as dead code once the stamp is deployed.

### Pre-existing, unrelated

- [ ] `dist/` in this working copy is owned by `root` (dated 27 Jul), so `yarn build`
      fails with `EACCES`. `tsc --noEmit`, `yarn test`, and `yarn lint` are unaffected.
      Fix locally with `sudo rm -rf dist` — not a repo issue, and deliberately left
      alone here rather than running `sudo` unprompted.
- [ ] `README.md`'s command table still omits `brevo app status` / `submit` /
      `withdraw` / `available-scopes` (the stale `app update` row was fixed in this
      branch).

### Wire-contract follow-ups (merged from `features_set_public_cli`)

- [x] **Decide the fate of `source: 'cli'` in the `app create` body** (`src/services/app.ts`).
      Resolved 2026-08-07: **dropped**. The predicted failure arrived from the other
      direction — the server didn't bind strictly, it started reading the key as policy
      (`400 invalid_parameter`, *public apps cannot be created with source "cli"*), which
      is the API-side pre-GA guard `CLAUDE.md` calls for. Either way it was an undeclared
      top-level key, so the CLI no longer sends it; the backend derives the caller from the
      `User-Agent` header (`brevo-cli/...`), same resolution as `cli_version`. **Still needs
      BEX-355 sign-off that an absent `source` is contract-valid** — see the per-branch
      entry in `RELEASE-CHECKLIST.md` for what to confirm against staging.
- [ ] **Give `--distribution public` a real local failure** (`src/commands/app/create.ts`).
      Today the flag is accepted, the scaffold directory is created and entered, and the
      run dies on the server's raw `400` string. Whether that guard survives with `source`
      gone is unconfirmed (see above) — but if the platform refuses CLI-created public apps
      pre-GA, the CLI should say so before doing any filesystem work, and the `--distribution`
      examples in `src/commands/definitions.ts` and the `README.md` table should stop
      advertising a path that can't complete. Note the existing runtime-guard item under
      `RELEASE-CHECKLIST.md` → *Before public-apps GA*: any guard needs the same
      internal-Brevo-account escape hatch.
- [x] **Confirm the server does not *require* `cli_version` in the upload/create body.**
      Confirmed by the upload-service owners 2026-08-03: zero server-side references —
      upload (strict) 400s on it, PATCH/create silently ignore it, telemetry reads the
      structured `User-Agent` from the request log. Header approach is final.
- [x] **~~Drop~~ Keep `distribution_type` in the upload *request*, moved top-level** —
      decision reversed 2026-08-04: the field stays in the request and moves from
      `auth` to the top level of the body, matching the response and `OAuthApp`
      (fixes the request/response asymmetry); the server remains the immutability
      authority. CLI side re-landed on this branch: top-level
      `UploadAppPayload.distribution_type` and the POST body updated; the client-side
      drift guard in `uploadCommand` (`APP_UPLOAD_DISTRIBUTION_IMMUTABLE`) is kept as
      a fast-fail before the server's 422. Server side (BEX-355) must declare
      top-level `distribution_type` in the upload schema and 422 on mismatch with the
      stored app (landed on its `feat/bex-355-cli-snapshot-contract` branch 2026-08-04) — see the per-branch entry in RELEASE-CHECKLIST.md for the exact
      server checklist.
- [x] **Port the `cli_version` removal to the `BEX-290_ui-components` worktree.** Done
      by the 2026-08-04 merge of `features_set_public_cli` into this branch: no
      `cli_version` remains in any request body, and `cliVersion` is gone from the
      template, `ProjectConfig`, and the scaffold vars (the version travels only in
      the `User-Agent` header via `src/lib/telemetry.ts`).

- [ ] Decide whether the created-app box and the `app upload` diff should render a
      friendly placement label (`Header "More" (•••) menu — menu entry`) instead of the
      raw `surface_point_name` slug they now print. Both print the authored value, and
      the authored value became the slug when `surface_point_list` moved off the dotted
      slot name. Neither call site holds the registry row at print time, so this needs a
      lookup, not a formatting change.

- [x] **BLOCKER — FIXED (2026-08-12). `app create` read the create response at the wrong
      nesting level, so every caller lost `client_id` / `redirect_uris` (found by E2E).**
      Fixed as described below, in the one place the fix belongs: `createApp()` now calls
      `flattenCreateAuth()` after `normalizeAppId()` (`src/services/app.ts`), lifting
      `auth.{client_id, client_secret, redirect_uris, scopes}` to the top level and
      tolerating both wire shapes. All seven read sites are untouched.
      `CreateAppResponse` now declares those four **optional**, which is what made the
      compiler surface the three call sites that had been reading `undefined` in silence —
      the type lying about the shape is why this shipped at all. Two consequences came
      with it: the UI-app box no longer renders `Client ID` / `Client secret` rows (a UI
      app has neither), and `saveAppCredentials` is skipped when there is no pair to
      cache. The read-site count was **seven, not six** — `scaffold.ts:137,144,145` reads
      the same response through `fetchAppContext`'s `fallbackApp`, and was degrading to
      placeholders. Verification entry added to `RELEASE-CHECKLIST.md`; the manual
      staging checks there are still open.

      Original report follows.
      The unified payload work made create send OAuth fields inside `auth`, and the
      platform's nested-contract handler (`http_cli_create_app_public.go`) **echoes that
      nesting back**: the live response is
      `{app_id, name, version, distribution_type, auth:{client_id, client_secret, scopes,
      redirect_uris}}`. All six read sites still read the flat shape —
      `create.ts:426,428,476,477,492,495` and `app-types/ui/authoring.ts:569` — and
      `CreateAppResponse` (`src/types.ts:347-358`) still declares them top-level, so
      nothing type-errors. Confirmed against production with `--debug`, and confirmed as
      a **branch regression** by running the `main` build (`0ad977c`) side by side: main
      sends the flat request, gets a flat response, and prints/emits both fields.
      User-visible today:
      - `brevo app create` (OAuth, human) prints `Client ID: undefined` and **drops the
        `Redirect URL n:` lines entirely** — QA-TESTCASES TC-1.1 expects both.
      - `brevo app create --json` silently omits `clientId` and `redirectUri`
        (`JSON.stringify` drops `undefined`), breaking the documented TC-4.2 contract
        and any pipeline reading `.clientId`.
      - The UI-app box prints `Client ID: undefined` too, plus a `Client secret` row and
        a `brevo app credentials` hint that never apply to a UI app.
      - `saveAppCredentials()` caches `{clientId: undefined, clientSecret: undefined}`.
        Not permanent loss — `brevo app credentials` re-fetches and heals the cache — but
        the create-time write is dead.
      **Fix in one place:** `createApp()` already post-processes via
      `normalizeAppId(raw)` (`src/services/app.ts:361`) — lift `auth.client_id`,
      `auth.client_secret` and `auth.redirect_uris` to the top level there (tolerating
      both shapes so the flat handler keeps working) and correct `CreateAppResponse`.
      That leaves all six call sites untouched. Separately, omit the Client ID/secret
      rows from the UI-app box rather than rendering empties.

- [ ] **`QA-TESTCASES.md` section 12 has drifted from the implemented flow.** Four
      expectations now contradict the code and `CLAUDE.md`, so QA would file passes as
      failures: TC-12.2c still describes the **single grouped placement prompt** (the
      flow is N single-selects, one per page — `CLAUDE.md` says never restore the
      grouped one); TC-12.4 still expects a `Link target: _blank (added on upload…)` row
      in the diff (deliberately removed in 29c9ef4); TC-12.10 still says `brevo app
      remove` and `{"removed": false}` (now `rollback` / `rolledBack`); and TC-12.2's
      prompt list omits the **`App logo URL`** prompt the UI flow actually asks between
      `Redirect link` and `Output directory`. The agent docs are already correct — only
      this file lags.

- [x] **FIXED (2026-08-12) — the two stale citations in `RELEASE-CHECKLIST.md` →
      *Before UI-apps GA*.** The *Coordinate the BEX-350 registry reseed* item no
      longer points at `EXTENSION_POINTS` in `src/lib/constants.ts` (that mirror was
      removed on this branch — the whole point of 0ae75c0; only
      `EXTENSION_PLACE_LABELS` remains), and the *`ui_app` field names* item now spells
      entries `{ surface_point_name, context? }`. Both sat in the **durable** GA
      section, so they would have misled whoever works the GA pass.
