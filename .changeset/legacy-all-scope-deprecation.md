---
'@getbrevo/cli': minor
---

Deprecate the legacy `'all'` OAuth scope: `brevo app update` and `brevo app start oauth` now block when scopes contain `'all'`. Pass `--scope` on `brevo app update` to migrate (drops `'all'`, applies the new granular scopes). `brevo app list` flags legacy apps (text tag + `legacy_all_scope: true` in `--json`); `brevo app scaffold` drops `'all'` when scaffolding from a legacy app, keeping its granular scopes (or the default scopes when `'all'` was the only one).
