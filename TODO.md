# TODO

## Open

- [ ] **Decide the fate of `source: 'cli'` in the `app create` body** (`src/services/app.ts`).
      It has the same shape of problem as the removed `cli_version`: a top-level body key
      outside the declared payload. If the server's create endpoint ever binds strictly, it
      400s the same way. Either the server declares it in the create contract or the CLI
      drops it and the backend derives the source from the `User-Agent` header
      (`brevo-cli/...`). Coordinate with the server side (BEX-355).
- [ ] **Confirm the server does not *require* `cli_version` in the upload/create body.** The
      CLI stopped sending it (this branch); if the BEX-355 server contract planned to
      whitelist or require it, point them at the `User-Agent` header instead.
- [ ] **Port the `cli_version` removal to the `BEX-290_ui-components` worktree.** That
      branch still injects `cli_version` at three sites in `src/services/app.ts`
      (createApp, updateApp, uploadApp — lines ~160/171/178) plus the template/type
      (`app-config.json.tmpl`, `ProjectConfig.cliVersion`, scaffold var). Apply the same
      removal when it rebases onto this branch, or it reintroduces the 400 on strict
      server builds (the upload endpoint rejects unknown top-level body keys).
