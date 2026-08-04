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
- [ ] **Port the `cli_version` removal to the `BEX-290_ui-components` worktree.** That
      branch still injects `cli_version` at three sites in `src/services/app.ts`
      (createApp, updateApp, uploadApp — lines ~160/171/178) plus the template/type
      (`app-config.json.tmpl`, `ProjectConfig.cliVersion`, scaffold var). Apply the same
      removal when it rebases onto this branch, or it reintroduces the 400 on strict
      server builds (the upload endpoint rejects unknown top-level body keys).
