---
'@getbrevo/cli': minor
---

Normalize every key in `app-config.json` to snake_case, matching the wire contract. The file was meant to be snake_case throughout but several keys were camelCase; they are renamed as follows:

- `appId` → `app_id`
- `appName` → `app_name`
- `logoUri` → `logo_uri`
- `appType` → `app_type`
- `auth.redirectUris` → `auth.redirect_uris`

`version`, `distribution_type`, `auth.scopes`, `ui_app` and `brevo_function` are unchanged, and nothing sent to or received from the Brevo API changes.

**Backward compatibility is preserved.** Every command still reads the camelCase spellings written by earlier releases (and the older `auth.redirectUrls`), through one shared normalizer in the config reader. When a file carries both spellings of a key with different values the snake_case one wins and a one-line notice is printed to stderr.

**Legacy files are migrated on write.** `brevo app create`, `brevo app upload`, `brevo app scaffold` and `brevo app start` now write snake_case keys only, and the camelCase copies are dropped. `brevo app upload` and `brevo app scaffold` also rewrite an in-sync legacy file on their "nothing to change" paths, so running either once is enough to migrate a project. Values are never changed by the migration.

The only `--json` output that echoes config key names is `brevo app scaffold`'s `diffs[].field`, which now reports `app_name`, `redirect_uris` and `logo_uri` instead of `appName`, `redirectUris` and `logoUri`. The `appId` / `appName` / `logoUri` keys in other commands' `--json` output are unchanged.
