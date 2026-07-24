---
"@getbrevo/cli": major
---

Replace `brevo app update` with `brevo app upload` (BEX-250).

`brevo app update` is removed entirely — no stub, no forwarding shim. `brevo app upload` takes only `--yes`/`--json` and has no edit flags (`--app-id`, `--name`, `--redirect-uri`, `--scope`, `--logo-uri` are all gone); change an app's name, redirect URLs, scopes, logo, or version by editing `app-config.json` directly, then run `upload`.

`upload` always fetches the app's current remote state and renders a local-vs-server diff before pushing — even under `--yes` (skips the confirmation prompt but still shows the diff) or `--json` (the diff comes back as structured data instead of a prompt). If nothing differs, it exits 0 with "already up to date" and makes no network push. Otherwise it POSTs the full local `app-config.json` to `POST /v3/app-store/apps/{appId}/upload` and writes the server-confirmed state back into `app-config.json` on success.

On success, `upload` now reads the server-confirmed version from either `app_version` or `version` in the upload response, so the bumped version is always persisted to `app-config.json` and printed — instead of silently keeping the old value when the server returns it under `version`.

Breaking change: any script or CI job invoking `brevo app update` (or its `--scope`/`--redirect-uri`/`--name`/`--logo-uri` flags) needs to switch to editing `app-config.json` and running `brevo app upload` instead.
