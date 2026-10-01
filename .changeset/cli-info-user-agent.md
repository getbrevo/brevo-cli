---
'@getbrevo/cli': patch
---

The update check (`/cli/info`) now identifies itself with the CLI's `User-Agent` (`brevo-cli/<version> (<os>)`), like every other CLI request, instead of Node's default `node`. No credentials are sent, and the notice behaves exactly as before.
