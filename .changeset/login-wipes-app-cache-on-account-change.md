---
'@getbrevo/cli': patch
---

Wipe the per-app credential cache on `brevo login` when the new account differs from the previously-stored one. Cached `clientId`/`clientSecret` values belong to the prior account's apps and would mislead the new session. Same-account re-logins keep the cache intact.
