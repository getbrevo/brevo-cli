# TODO

Running work tracker. Per `CLAUDE.md`, delete this file before merging the branch
into `main` — anything that must outlive the branch belongs in
`RELEASE-CHECKLIST.md` → *Before UI-apps GA* instead.

## Open

### BEX-290 follow-ups

- [ ] **Make `app upload` validate `surface_point_list` against the fetched BEX-361
      registry** instead of the local `EXTENSION_POINTS` mirror, then delete the
      mirror (`EXTENSION_POINTS`, `EXTENSION_PLACE_LABELS`, `EXTENSION_PLACES_BY_KIND`
      in `src/lib/constants.ts`). Until then there is a documented split: create
      validates against the live registry, upload pre-flights against the mirror —
      a live-only slot authors fine at create but trips upload's pre-flight.
- [ ] **Consider surfacing `url_pattern` from the BEX-361 rows** in the placement
      prompt (e.g. as a choice hint) so partners see where in the product a slot
      renders before picking it.
- [ ] **Drop the pre-BEX-361 row-name aliases** in `appService.fetchSurfacePoints`
      (`extension_point`, `location`, `place`, `kind`,
      `supported_extension_types`) once the real endpoint's response shape is
      confirmed. They exist only because keying strictly on either candidate naming
      would fail closed against the other — every row dropped, and the partner told
      the registry "has not been seeded".
- [ ] **Reconsider the second registry call.** `app create` fetches the registry
      unfiltered, then again with `?location=<csv>`. The narrowed response is a
      strict subset of the first, so the second call buys freshness and nothing else
      while doubling latency; `ApiClient.get` has no ETag/cache support, so the
      endpoint's caching headers don't mitigate it. If freshness turns out not to
      matter, filter the first call's rows in memory instead.
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
- [ ] **`app deploy` target-account resolution — design written, not implemented.** See
      `BEX-290-deploy-account-resolution.md`. Makes `<account-id>` optional: standalone
      accounts resolve their own, corporate accounts pick from
      `GET /v3/corporate/subAccount`. Two blockers, both recorded in that file:
      - [ ] **Non-corporate identifier is unresolved.** The corporate branch yields a numeric
            sub-account `id`; `organization_id` is a UUID and `parseAccountId` rejects it.
            Needs confirmation of whether `/v3/account/info` exposes a numeric account ID
            distinct from `organization_id` / `user_id`, and whether sub-accounts share their
            master's `organization_id`.
      - [x] **Deploy/rollback transport settled (2026-08-06)** — see above. The route is
            `/installs`, not the `/deploy`+`/undeploy` pair the approved design described,
            and the account travels as a numeric `deploy_client_id`. The design's other
            claims (422 `app_not_configured`, idempotent upsert, master may deploy into
            its sub-accounts but never itself, response carries `integration_id`) are
            **not** confirmed by the staging curl and remain open.
            Scope note (2026-08-03): interactive account selection is only needed for
            deploy/rollback against **sub-accounts** — plain accounts keep the explicit
            `<account-id>` argument.
- [ ] **Keep `EXTENSION_POINTS` in lockstep with the registry.** `src/lib/constants.ts`
      hard-codes the twelve-point registry so slot names can be validated offline. If
      the platform's registry gains or renames an entry (e.g. a `quoteDetails`
      location, or a second action place), the CLI will reject a legitimate name until
      it is updated. **Next up:** adopt the planned `GET /cli/surface-points` endpoint
      once it lands server-side and retire this hardcoded mirror (prompt with live slot
      names; keep the offline list only as a fallback).
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

- [ ] **Decide the fate of `source: 'cli'` in the `app create` body** (`src/services/app.ts`).
      It has the same shape of problem as the removed `cli_version`: a top-level body key
      outside the declared payload. If the server's create endpoint ever binds strictly, it
      400s the same way. Either the server declares it in the create contract or the CLI
      drops it and the backend derives the source from the `User-Agent` header
      (`brevo-cli/...`). Coordinate with the server side (BEX-355).
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
