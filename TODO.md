# TODO

Running work tracker. Per `CLAUDE.md`, delete this file before merging the branch
into `main` — anything that must outlive the branch belongs in
`RELEASE-CHECKLIST.md` → *Before UI-apps GA* instead.

## Open

### BEX-290 follow-ups

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
- [ ] **Consider surfacing `url_pattern` from the BEX-361 rows** in the placement
      prompt (e.g. as a choice hint) so partners see where in the product a slot
      renders before picking it.
- [ ] **Drop the pre-BEX-361 row-name aliases** in `appService.fetchSurfacePoints`
      (`extension_point`, `location`, `place`, `kind`,
      `supported_extension_types`) once the real endpoint's response shape is
      confirmed. They exist only because keying strictly on either candidate naming
      would fail closed against the other — every row dropped, and the partner told
      the registry "has not been seeded".
- [x] **Reconsider the second registry call — DONE (2026-08-06).** Resolved by making
      the two reads ask *different* questions rather than by dropping one. The pages
      now come from `GET /v3/app-store/surface-points/locations` (location names, no
      rows) and the rows are read once, narrowed to the pages that were picked. The
      old pair fetched the whole registry and then a strict subset of it, so the
      second call bought freshness and nothing else; the page prompt also no longer
      waits on a full registry read to offer three choices.
- [ ] **Drop the unfiltered retry in `fetchSurfacePointsForPages`** once
      `?location=` is confirmed honoured on the real endpoint (and confirmed to 400
      rather than silently ignore an unknown value). It exists because the narrowed
      read is the only row read in the flow: without it, an early build that 400s on
      the filter — or honours only the first CSV value — would abort or silently drop
      pages after the partner has already answered the page prompt.
- [ ] **Confirm the locations endpoint's response shape** (`{ locations, count }`)
      and whether it takes any filter of its own. The CLI tolerates a bare array
      alongside the wrapped shape in `appService.fetchSurfacePointLocations`; that
      tolerance can go once the shape is confirmed. Note the CLI does not ask it for
      an extension-type-aware page list — see the warning path for a page with no
      hostable placement.
- [ ] **Per-placement `label` / `more_info` / `redirect_link`.** One set is shared
      across every chosen placement today, so an app cannot say *menu entry → link
      X* alongside *sidebar card → link Y*. The nested `surface_point_list` makes
      this cheap to add later — per-entry text would be new fields on an existing
      object rather than a reshape.
- [ ] **Per-entry context narrowing is structural only for now.** Every registry row
      currently carries the same default, so every authored entry gets an identical
      list, and the upload endpoint does not yet validate context per entry. The
      shape is forward-compatible; nothing enforces narrowing anywhere yet.
- [ ] **Blocking before release: server-side unified-payload change.** The CLI now
      sends the create payload with OAuth fields nested under `auth` (same block as
      upload) and the upload payload with `version` instead of `app_version`.
      `POST /apps` is live in production, so the create endpoint must accept the
      nested `auth` block (and upload the `version` key) before this CLI ships — see
      the per-branch entry in RELEASE-CHECKLIST.md.

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
- [ ] **BEX-350 requires a coordinated release.** The kit, the reseeded registry and
      the backend have to land together; a CLI authoring `.widget`/`.action` names
      against a `.region`-era registry produces extensions that render nothing, with no
      error anywhere.
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
