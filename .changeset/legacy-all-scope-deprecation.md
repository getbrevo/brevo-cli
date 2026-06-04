---
'@getbrevo/cli': minor
---

Deprecate the legacy `'all'` OAuth scope and improve scope tooling:

- `brevo app update` and `brevo app start oauth` now block when scopes contain `'all'`. Pass `--scope` on `brevo app update` to migrate (drops `'all'`, applies the new granular scopes). `brevo app list` flags legacy apps (text tag + `legacy_all_scope: true` in `--json`); `brevo app scaffold` drops `'all'` when scaffolding from a legacy app, keeping its granular scopes (or the default scopes when `'all'` was the only one).
- `brevo app available-scopes` no longer requires authentication — it only reads the public IdP scope catalog, so it now works before `brevo login` (previously exited with "Not authenticated").
- `brevo app available-scopes --web` page improvements: per-category "Copy" CTA, per-scope checkboxes that build a copyable selection list, a `deprecated` badge on the legacy `'all'` scope (excluded from copy/selection), a hero CTA linking the scope catalog docs (https://developers.brevo.com/docs/oauth-scopes#scope-catalog), and a footer link to the CLI reference docs. The terminal output also prints the scope catalog docs URL. Copied scope lists are double-quoted and comma-separated (`"contacts:read","contacts:write"`) — ready to paste into `app-config.json`'s `auth.scopes` array or `brevo app update --scope`.
