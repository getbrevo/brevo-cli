---
'@getbrevo/cli': minor
---

Migrate app management onto the public App Store APIs (BEX-249).

- App create/list/get/update/delete now target `/v3/app-store/apps` instead of the legacy `/v3/oauth/apps` endpoints.
- App update uses `PATCH` instead of `PUT`.
- The distribution field is sent and read as `distribution_type: "public" | "private"` instead of the boolean `public`. `--distribution public` is still rejected ("coming soon").
- Add a blocking force-update banner: when the installed CLI is a full major version behind the latest npm release, commands (except `--help`/`--version`) print an update banner and exit non-zero until the user upgrades. Honors the existing update-notifier opt-outs (`BREVO_NO_UPDATE_NOTIFIER`, `--no-update-notifier`, CI, non-TTY).
