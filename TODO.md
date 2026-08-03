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
- [x] **Drop `distribution_type` from the upload *request*.** Agreed with the server
      side — they are removing it from the upload request in the BEX-355 contract
      (the field is immutable via upload, and the endpoint had zero released
      consumers). CLI side landed on this branch: removed from `UploadAppPayload.auth`
      and the POST body, client-side drift guard added in `uploadCommand` (errors with
      `APP_UPLOAD_DISTRIBUTION_IMMUTABLE` when local `distribution_type` differs from
      the fetched remote value, preserving the old server-400 UX), wire-shape tests and
      docs updated. Verify against a server build with the BEX-355 contract before
      release (see RELEASE-CHECKLIST.md).
- [ ] **Port the `cli_version` removal to the `BEX-290_ui-components` worktree.** That
      branch still injects `cli_version` at three sites in `src/services/app.ts`
      (createApp, updateApp, uploadApp — lines ~160/171/178) plus the template/type
      (`app-config.json.tmpl`, `ProjectConfig.cliVersion`, scaffold var). Apply the same
      removal when it rebases onto this branch, or it reintroduces the 400 on strict
      server builds (the upload endpoint rejects unknown top-level body keys).
