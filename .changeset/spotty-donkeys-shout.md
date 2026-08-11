---
'@getbrevo/cli': patch
---

Take the update banner's message from the Brevo API so it can be improved for users already running an old version.

Whether a banner appears is unchanged: the CLI still checks the npm registry, compares against its own version, and applies the same soft-notice and force-update rules. What changed is the first line of that banner, which now comes from `GET /v3/app-store/cli/info` and is rendered in red above the box.

The call happens only when a banner is actually going to be shown, so an up-to-date CLI makes no extra request. The result is cached alongside the npm answer, so an outdated CLI asks at most once per TTL. It supplies wording only — if the endpoint is slow, down, returns HTML from a gateway, or sends an unrecognised code, the banner still appears with the CLI's own text.

The endpoint is fetched outside the authenticated API client, so a 401 from it can never reach the re-auth handler or clear stored credentials. The returned message is validated against a known code, control-character stripped, flattened to one line and clamped before display.
