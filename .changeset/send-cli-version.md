---
'@getbrevo/cli': patch
---

`brevo app create` and `brevo app update` now send the CLI's own version as `cli_version` in the request body, so the backend can track which CLI release performed each write.
