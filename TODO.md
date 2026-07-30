# TODO

Running work tracker. Per `CLAUDE.md`, delete this file before merging the branch
into `main` — anything that must outlive the branch belongs in
`RELEASE-CHECKLIST.md` → *Before UI-apps GA* instead.

## Open

### BEX-290 follow-ups

- [x] **`ui_app` field names — resolved.** Aligned with the platform's manifest read path and its
      extensibility UI kit (BEX-308 / BEX-350). The block is the stored app snapshot
      verbatim.
- [ ] **Blocking before this reaches users:** the snapshot **write path** doesn't exist
      yet — only the manifest read path that consumes it exists, and the existing
      build endpoint writes a separate config field. So the upload transport is still a guess (the CLI
      sends the block as `snapshot` on `POST /v3/app-store/apps/{id}/upload`), as are
      the deploy/remove endpoints. See `RELEASE-CHECKLIST.md` → *Before UI-apps GA*.
- [ ] **`app deploy` target-account resolution — design written, not implemented.** See
      `BEX-290-deploy-account-resolution.md`. Makes `<account-id>` optional: standalone
      accounts resolve their own, corporate accounts pick from
      `GET /v3/corporate/subAccount`. Two blockers, both recorded in that file:
      - [ ] **Non-corporate identifier is unresolved.** The corporate branch yields a numeric
            sub-account `id`; `organization_id` is a UUID and `parseAccountId` rejects it.
            Needs confirmation of whether `/v3/account/info` exposes a numeric account ID
            distinct from `organization_id` / `user_id`, and whether sub-accounts share their
            master's `organization_id`.
      - [ ] **Deploy/remove endpoints still don't exist**, so the contract is ours to define:
            path, body field name and type, owner of the "must be uploaded first" rule and its
            status code, double-deploy idempotency, whether a master's credential may deploy
            into its sub-account, and whether the response carries an installation ID.
- [ ] **Keep `EXTENSION_POINTS` in lockstep with the registry.** `src/lib/constants.ts`
      hard-codes the twelve-point registry so slot names can be validated offline. If
      the platform's registry gains or renames an entry (e.g. a `quoteDetails`
      location, or a second action place), the CLI will reject a legitimate name until
      it is updated. Worth revisiting if the registry becomes fetchable.
- [ ] **BEX-350 requires a coordinated release.** The kit, the reseeded registry and
      the backend have to land together; a CLI authoring `.widget`/`.action` names
      against a `.region`-era registry produces extensions that render nothing, with no
      error anywhere.
- [ ] `iframeExtension` support (the platform's name for a modal card). The type
      round-trips today but `validateUiApp` rejects it on upload, and `modalIframeUrl`
      is rejected on an `actionLink` because the UI kit only honours it for an
      `iframeExtension`. Needs: authoring for `modalIframeUrl`, `permittedUrls.iframe`
      handling (the postMessage origin allowlist is what makes the modal secure), and
      the corresponding create prompts.
- [ ] Widget slots (`<location>.overviewAttributes|overviewMain|overviewSidebar.widget`).
      The registry and `EXTENSION_POINTS` already carry them and `ExtensionSlot`
      renders them, but there is no CLI authoring path — `validateUiApp` rejects a
      widget slot for an action link, which is correct, but nothing can author a
      widget-type extension yet. The delivery prompt shows it as a disabled choice.
- [ ] `place` selection is currently implicit: an action link always targets
      `headerMenu`, the only action place in the registry. If a second action place
      lands (a sidebar toolbar, an inline header bar), the record-page prompt needs a
      companion prompt rather than deriving the slot name.
- [ ] No local dev story for a UI app. `brevo app start` has no UI-app equivalent, so
      a partner can't preview an action link without deploying to a real account.
      Worth considering a local harness that renders the action menu and forwards
      context params to the external URL.
- [ ] `permittedUrls` is scaffolded empty and never validated or populated from
      `ui_app.redirectLink`. Harmless for action links (they open a new tab), but it
      becomes load-bearing for `iframeExtension` modals.
- [ ] Consider whether `brevo app list` should show the app type. Right now an OAuth
      app and a UI app are indistinguishable in the list output.
- [ ] Record context is an allow-list on the extension-point registry row
      and surfaces on the manifest as `app_configs.context`,
      i.e. the platform decides it per slot. Nothing for the CLI to author — but worth
      surfacing read-only (e.g. in the create summary) so a partner knows which
      params their URL will actually receive.

### Pre-existing, unrelated

- [ ] `dist/` in this working copy is owned by `root` (dated 27 Jul), so `yarn build`
      fails with `EACCES`. `tsc --noEmit`, `yarn test`, and `yarn lint` are unaffected.
      Fix locally with `sudo rm -rf dist` — not a repo issue, and deliberately left
      alone here rather than running `sudo` unprompted.
- [ ] `README.md`'s command table still omits `brevo app status` / `submit` /
      `withdraw` / `available-scopes` (the stale `app update` row was fixed in this
      branch).
