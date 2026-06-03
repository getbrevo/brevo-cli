---
'@getbrevo/cli': minor
---

`brevo app available-scopes --web` page improvements: per-category "Copy" CTA, per-scope checkboxes that build a copyable selection list, a `deprecated` badge on the legacy `'all'` scope (excluded from copy/selection), and a footer link to the CLI reference docs. Copied scope lists are double-quoted and comma-separated (`"contacts:read","contacts:write"`) — ready to paste into `app-config.json`'s `auth.scopes` array or `brevo app update --scope`.
