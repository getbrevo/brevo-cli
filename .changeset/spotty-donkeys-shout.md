---
'@getbrevo/cli': minor
---

Take the update banner's message from the Brevo app-store service, and let it block a CLI version that can no longer be supported.

Whether an update banner appears is unchanged: the CLI still checks the npm registry, compares against its own version, and applies the same soft-notice and force-update rules. What changed is the first line of that banner, which now comes from `GET /cli/info` and is rendered in red above the box. The box's own contents are untouched.

That endpoint is called on the app-store service **directly**, not through the v3 API gateway, and needs no API key — so the notice still renders while logged out, mid-`login`, or with expired credentials, which is exactly when a stale CLI is most likely to be the real problem. `BREVO_APP_STORE_URL` overrides the base URL for non-production testing.

The response may also carry `"is_blocked": true`. When it does, every command except `--help` / `--version` prints the banner to stderr and exits `1` without running, letting a broken CLI version be stopped without shipping a new release. This is deliberately **not** silenced by `BREVO_NO_UPDATE_NOTIFIER=1`, `--no-update-notifier`, CI, or a non-TTY — those suppress a *notice*, and a suppressed banner must never mean a suppressed block.

Because a block has to prevent a command rather than report on it afterwards, the call now runs once before the command instead of after it, and its result is **not cached**: revised wording and a new block both take effect on the very next run rather than after a TTL.

It fails open throughout. A timeout, a non-2xx, HTML from a gateway, or an unparseable body all leave the CLI behaving exactly as before — the banner falls back to local wording and nothing is blocked. Only a literal `true` blocks, so an outage can never lock anyone out. The endpoint is fetched outside the authenticated API client, so a 401 from it cannot reach the re-auth handler or clear stored credentials, and the returned text is control-character stripped, flattened to one line, and clamped before display.

Also show the update notice when a command fails. Previously the banner only printed on the success path, so anyone whose command errored — including the auth errors most likely to be fixed by upgrading — never saw that a newer CLI existed. The banner now prints after the error message on stderr, keeping the command's own exit code, and `notifyUpdate` is idempotent so runs that already showed it up front (`--help`, `app init`, `app create`) don't print it twice. A Ctrl-C abort still exits immediately without waiting on the check.
