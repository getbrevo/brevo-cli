---
'@getbrevo/cli': patch
---

Keep browser (OAuth) logins alive for as long as the refresh token is valid.

The CLI stored an access-token expiry on login but never read it, so refresh was purely reactive — it only fired after the API returned `401`, which made a short access-token TTL feel like the session itself expiring and cost every post-expiry request an extra round-trip. Commands that need credentials now check the stored expiry first and refresh the access token before it lapses (60s skew buffer), so the request goes out with a valid token.

The refresh is best-effort: if the login service is unreachable the command runs anyway with the existing token, and the reactive `401` path stays in place as the safety net and remains the only thing that clears dead credentials. Local-only commands (`login`, `logout`, `skill:cli …`, `app available-scopes`) never trigger it, so they keep working offline. No new command, flag, or environment variable.
