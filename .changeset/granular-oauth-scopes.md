---
'@getbrevo/cli': minor
---

Granular OAuth scopes (BEX-197):

- `brevo app create` now creates apps with `contacts:read`, `contacts:write`, `crm:read`, `crm:write` instead of the legacy `all`. The CLI prints a one-line notice listing the defaults and how to change them.
- `brevo app update --scope <scope>` (new, repeatable) appends scopes to an app's existing set, de-duped, order-preserving. Writes back to `app-config.json` when applicable.
- `brevo app scopes [--json]` (new) prints the IdP's supported-scopes catalog. Text output groups scopes by category (`account`, `data_crm`, `messaging`); `--json` returns a flat array of names. OIDC-reserved scopes and magic wildcards are excluded. Sourced from `/realms/partner/scopes`.
