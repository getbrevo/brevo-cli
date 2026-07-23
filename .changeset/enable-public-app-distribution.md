---
"@getbrevo/cli": minor
---

Enable public app distribution in `brevo app create`.

`brevo app create --distribution public` now creates a public app instead of erroring — the "coming soon" rejection is removed and Public is a selectable option in the interactive distribution prompt. Scaffolded `app-config.json` records the app's distribution type under `auth.type` (via a new `{{DISTRIBUTION}}` template variable) and drops the redundant top-level `distribution` key; previously scaffolded projects keep working because `readProjectConfig()` backfills `auth.type` from the legacy key (`auth.type` wins when both are present).

The OAuth callback URL hint in `brevo app create` now explicitly labels the localhost default as a local test-server callback and reminds you to add a production callback URL before going live.

Existing projects with a legacy `app-config.json` (top-level `distribution` key) are now migrated automatically: the next time any command writes the file back (e.g. `brevo app update`), the legacy key is dropped and `auth.type` is written in its place.
