# TODO

## Open

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
- [ ] **Propose dropping `distribution_type` from the upload *request* while the contract
      is still pre-release.** The upload endpoint has zero released consumers — the
      published CLI's `app update` used `PATCH /v3/app-store/apps/{id}`, and the server
      contract only just froze — so this is the last cheap moment to fix the
      request/response asymmetry (request nests it under `auth`, response returns it
      top-level). Recommended shape: remove the field from the request entirely rather
      than moving it top-level, since it is immutable via upload anyway (server 400s
      "distribution_type cannot be changed via upload"). If the server drops it:
      (1) remove `distribution_type` from `UploadAppPayload.auth` and the POST body in
      `uploadProjectConfig`; (2) keep the user-facing drift guard by erroring client-side
      when `config.distribution_type` differs from the fetched remote value (the command
      already fetches the remote app for the diff), preserving today's "cannot be changed
      via upload" UX; (3) update the wire-shape test and the `UploadAppPayload` comment in
      `src/types.ts`. Do nothing until the server side lands their change — sending the
      field is required today and dropping it unilaterally changes nothing.
- [ ] **Port the `cli_version` removal to the `BEX-290_ui-components` worktree.** That
      branch still injects `cli_version` at three sites in `src/services/app.ts`
      (createApp, updateApp, uploadApp — lines ~160/171/178) plus the template/type
      (`app-config.json.tmpl`, `ProjectConfig.cliVersion`, scaffold var). Apply the same
      removal when it rebases onto this branch, or it reintroduces the 400 on strict
      server builds (the upload endpoint rejects unknown top-level body keys).
