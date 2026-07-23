---
"@getbrevo/cli": minor
---

Track the app-store API's `version` field through the CLI.

`brevo app create` now shows the server-assigned `version` in the created-app box and `--json` output. `brevo app scaffold` writes it into the new `app-config.json`'s top-level `version` key. `brevo app list` shows a `Version:` line per app (and includes `version` in `--json` output). `brevo app update` shows the app's current version and backfills it into `app-config.json` for projects scaffolded before this field existed — no new flag, `version` is read-only from the CLI's perspective.
