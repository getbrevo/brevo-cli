---
'@getbrevo/cli': minor
---

`brevo app available-scopes` no longer requires authentication — it only reads the public IdP scope catalog, so it now works before `brevo login` (previously exited with "Not authenticated").
