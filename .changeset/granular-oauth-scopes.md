---
'@getbrevo/cli': minor
---

Granular OAuth scopes (BEX-197):

- `brevo app create` now creates apps with `contacts:read`, `contacts:write`, `crm:read`, `crm:write` instead of the legacy `all`. The CLI prints a one-line notice listing the defaults and how to change them.
- `brevo app update --scope <scope>` (new, repeatable) appends scopes to an app's existing set, de-duped, order-preserving. Writes back to `app-config.json` when applicable. A single flag value may contain multiple comma- or whitespace-separated tokens (`--scope "crm:read, crm:write"` is equivalent to two `--scope` flags); the same normalization heals comma-embedded entries when reading `auth.scopes` from `app-config.json`. Each resulting token is validated locally against `[A-Za-z0-9][A-Za-z0-9:_.-]*` to catch typos before the API call.
- `brevo app available-scopes [--json] [--web]` (new) prints the IdP's supported-scopes catalog. Text output groups scopes by category (`account`, `data_crm`, `messaging`); `--json` returns a flat array of names. OIDC-reserved scopes and magic wildcards are excluded. Sourced from `/realms/partner/scopes`.
- Passing `--web` to `brevo app available-scopes` additionally starts a short-lived loopback HTTP server on `127.0.0.1` and opens the user's browser to a self-contained HTML page listing every supported scope grouped by category, with a search filter. Each scope is expandable to reveal its API endpoints (chip list). A "Refresh" button on the page re-fetches scopes from the IdP without restarting the command. The server runs in the foreground until Ctrl+C (SIGINT or SIGTERM closes it cleanly). Without `--web` the command exits after printing the list — TTY detection no longer triggers the browser. `--json` always suppresses the browser.

Other changes:

- `brevo app create` and `brevo app update` now send the CLI's own version as `cli_version` in the request body, so the backend can track which CLI release performed each write.
- Removed the dormant `minCliVersion` mechanism. `brevo app scaffold` no longer writes `minCliVersion` into `app-config.json` (the constant had been `0.0.0` since introduction, so the runtime check never fired). The npm-registry update-notifier already covers the "you should upgrade" nudge. Existing `app-config.json` files keep their `minCliVersion` field harmlessly — it is now ignored. `cliVersion` (informational provenance) is unchanged.
