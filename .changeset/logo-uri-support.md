---
'@getbrevo/cli': minor
---

Add `logo_uri` support to `brevo app create` (`--logo-uri`), `brevo app update` (`--logo-uri`), and the `logoUri` top-level field in `app-config.json`. Flagless `brevo app update` pushes `logoUri` from the config file when present.
