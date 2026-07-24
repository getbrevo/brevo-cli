---
'@getbrevo/cli': minor
---

Add `brevo app status` command (BEX-252): shows an app's review lifecycle state (`configured`, `submitted`, `in_review`, `approved`, `rejected`, `changes_requested`) with a canned human message. Resolves the app from `--app-id`, the linked `app-config.json`, or an interactive picker. Read-only; supports `--json` (`{ state, message }`). Reviewer feedback is delivered by email and is never surfaced here.
