---
'@getbrevo/cli': minor
---

The CLI now identifies itself to the Brevo API on every request via a `User-Agent` header (`brevo-cli/<version> (<os>)`) and `X-Brevo-CLI-Version`, `X-Brevo-CLI-OS`, and `X-Brevo-CLI-Auth-Method` headers. No personal data is sent — only the CLI version, operating system family, and authentication method already in use.
