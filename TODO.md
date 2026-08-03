# TODO

Running work tracker. Per `CLAUDE.md`, delete this file before merging the branch
into `main` — anything that must outlive the branch belongs in
`RELEASE-CHECKLIST.md` → *Before UI-apps GA* instead.

## Open

### BEX-290 follow-ups

- [x] **`ui_app` field names — resolved.** Aligned with the platform's manifest read path and its
      extensibility UI kit (BEX-308 / BEX-350). The block is the stored app snapshot
      verbatim.
- [x] **Upload wire contract — resolved (2026-08-03).** The platform's CLI upload
      endpoint binds the block as `ui_app` and the CLI now sends/reads that key.
      Remaining skew: the CLI still sends `cli_version` on the upload payload, which
      the server strict-rejects as an unknown key — drop it or have the server
      whitelist it (settle with the bo-be branch before either side releases).
- [ ] **Blocking before this reaches users:** the deploy/undeploy endpoints are
      designed and approved on the platform side but **not built yet**. See
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
      - [ ] **Deploy/undeploy endpoints are designed but not built.** The approved
            server design answers the open contract questions (`account_id` in the body,
            422 `app_not_configured` for "must upload first", idempotent upsert, master
            may deploy into its sub-accounts but never itself, response carries
            `integration_id`); the CLI's routes now match it (`/deploy`, `/undeploy`).
            Scope note (2026-08-03): interactive account selection is only needed for
            deploy/undeploy against **sub-accounts** — plain accounts keep the explicit
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
      `ui_app.redirectLink`. Harmless for action links (they open a new tab), but it
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
