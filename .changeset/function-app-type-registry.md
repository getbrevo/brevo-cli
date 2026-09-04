---
'@getbrevo/cli': minor
---

Add `function` as a first-class app type in the CLI's app-type registry. A Brevo Function app is now detected by the presence of `brevo_function` in both the local config and the server record, and participates in the same resolution, capability, and recoverability checks as `oauth` and `ui` apps. The capability matrix grants a private Function app no OAuth or UI capabilities (it ships its own `brevo function deploy` flow); public distribution adds `review-lifecycle`. A new `app_type` field is written to `app-config.json` on `brevo app create` and `brevo app scaffold` as informational metadata (`"oauth"`, `"ui"`, or `"function"`); it is never sent to the server and legacy configs without it continue to work unchanged. Additional fixes: `fetchFunctionList` now paginates past 50 functions, `sseStream` refreshes the OAuth token before connecting, `brevo function deploy` appears in help output, and `resolveFunctionId` replaces a duplicated IIFE in the shared action runner.

Refuse a `brevo app upload` whose `app_type` contradicts the blocks it sits next to. `app_type` stays informational — the presence of `ui_app` / `brevo_function` / `auth` is still the only discriminator, and `isUiAppConfig()` is still the only place it is read — but a file labelled `"oauth"` that carries a `ui_app` block is a hand-edit that half-landed, and `upload` now says so before any round trip, naming both the declared and the detected type and how to reconcile them. A config that omits `app_type` (every file written by an earlier release) is unaffected: the check is skipped entirely rather than defaulted. The label is never sent to Brevo.

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

Every `--json` document now carries each camelCase key together with its snake_case twin: `appId` and `app_id`, `clientId` and `client_id`, `upToDate` and `up_to_date`, and in the error envelope `exitCode` / `exit_code` and `statusCode` / `status_code`. `brevo app create --json`'s `redirectUri` and `brevo app credentials --json`'s `redirectUris` are twinned as `redirect_uris`, the wire name. Array documents (`brevo app list --json`) alias each element. Nested objects are left as they are — `ui_app`, the upload diff's `current` / `next`, Function records — since they were already snake_case or are the user's own data. Nothing is removed: every existing `jq .appId` keeps working. This is the deprecation step toward one spelling for machine-readable output, matching `app-config.json` and the API; the camelCase keys will be removed in the next major release, and new scripts should read the snake_case ones.
