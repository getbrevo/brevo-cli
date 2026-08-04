---
"@getbrevo/cli": major
---

Replace `brevo app update` with `brevo app upload` (BEX-250).

`brevo app update` is removed entirely — no stub, no forwarding shim. `brevo app upload` takes only `--yes`/`--json` and has no edit flags (`--app-id`, `--name`, `--redirect-uri`, `--scope`, `--logo-uri` are all gone); change an app's name, redirect URLs, scopes, logo, or version by editing `app-config.json` directly, then run `upload`. `distribution_type` is the exception: it is immutable after `app create` — the server rejects any attempt to change it via upload, and the CLI errors first with a message telling you to restore it (or create a new app), before anything is pushed.

`upload` always fetches the app's current remote state and renders a local-vs-server diff before pushing — even under `--yes` (skips the confirmation prompt but still shows the diff) or `--json` (the diff comes back as structured data instead of a prompt). If nothing differs, it exits 0 with "already up to date" and makes no network push. Otherwise it POSTs the full local `app-config.json` to `POST /v3/app-store/apps/{appId}/upload` and writes the server-confirmed state back into `app-config.json` on success.

On success, `upload` now reads the server-confirmed version from either `app_version` or `version` in the upload response, so the bumped version is always persisted to `app-config.json` and printed — instead of silently keeping the old value when the server returns it under `version`.

Likewise, `upload` now reads the server-confirmed `distribution_type` from the top level of the upload response, where the server has always returned it — the response's `auth` block only carries `scopes` and `redirect_uris`. Previously the CLI looked for it nested under `auth` (a shape no server build ever emitted), so the write-back silently kept whatever `app-config.json` already said instead of the server's echo. If the field is ever missing from a response, the write-back still falls back to the local value. The response's `auth.scopes`/`auth.redirect_uris` may also come back `null` (e.g. UI-only apps whose snapshot has no OAuth block) — the write-back treats `null` as absent and keeps the locally-sent values.

Breaking change: any script or CI job invoking `brevo app update` (or its `--scope`/`--redirect-uri`/`--name`/`--logo-uri` flags) needs to switch to editing `app-config.json` and running `brevo app upload` instead.

The CLI no longer injects `cli_version` into the `app create` and `app upload` request bodies. The upload endpoint binds its body strictly and rejects unknown top-level keys with a 400, and the CLI version already reaches the backend on every request via the `User-Agent` header (`brevo-cli/<version> (<os>; auth=<method>)`), so the body field was both redundant and a hard failure against strict server builds. Relatedly, `brevo app create`/`brevo app scaffold` no longer stamp an informational `cliVersion` field into `app-config.json` — nothing ever read it, and it recorded only the version that scaffolded the project. Existing `app-config.json` files that carry the field keep working; the CLI ignores it and drops it on the next config write-back.

`app-config.json`'s redirect-URL list is renamed `auth.redirectUrls` → `auth.redirectUris`, matching the wire key (`redirect_uris`). Backward compatible: the CLI still reads the old key (the new one wins if both are present), and any command that writes the file back (`upload`, `app start`'s URL registration) migrates it to `redirectUris` automatically. New scaffolds write `redirectUris` from the start. Note for mixed-version teams: once a file is migrated, older CLI releases (which read only `redirectUrls`) will report "no redirect URLs" on upload — re-add the old key or upgrade the CLI.
