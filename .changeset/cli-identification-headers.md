---
'@getbrevo/cli': minor
---

The CLI now identifies itself to the Brevo API on every request via a single `User-Agent` header: `brevo-cli/<version> (<os>)`, extended with `; auth=api_key` or `; auth=oauth` when the request carries credentials. No personal data is sent — only the CLI version, operating system family, and authentication method already in use.
