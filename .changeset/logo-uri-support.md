---
'@getbrevo/cli': minor
---

Add `logo_uri` support to `brevo app create` (`--logo-uri`), `brevo app update` (`--logo-uri`), and the `logoUri` top-level field in `app-config.json`. Flagless `brevo app update` pushes `logoUri` from the config file when present. The interactive `brevo app create` flow (also reached via `brevo app init`) now prompts for an optional logo URL; the prompt is skipped under `--json` or when `--logo-uri` is passed. The interactive prompt and its invalid-format hint now advertise the expected `https://` form.
