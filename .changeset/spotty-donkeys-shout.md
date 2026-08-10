---
'@getbrevo/cli': minor
---

Take update notices from the Brevo API instead of the npm registry.

The CLI no longer calls `registry.npmjs.org` on any code path. Every API response now carries the API's verdict on the calling version (`X-Brevo-Cli-Status`: `ok`, `outdated` or `unsupported`) plus the latest published version, read off requests the CLI already makes — so an up-to-date CLI does no extra work at all.

`outdated` shows an update notice and the command still runs. `unsupported` shows the notice and exits 1 without running. The verdict is cached at `~/.brevo/cli-notice.json` for 24h so it applies offline, and a cache written by a different CLI version is discarded so an upgrade is never blocked by the previous version's verdict.

Because the API owns the decision, support policy can change without a CLI release — replacing the old rule, which blocked whenever npm had a newer *major* even if the installed version still worked.

The display text comes from a new unauthenticated `GET /v3/app-store/cli/info`, fetched only when a notice is shown and the cached copy is stale. It supplies wording only: if it is slow, down, or returns something unexpected, the CLI falls back to its own text and the verdict is unchanged.

Notice opt-outs (`BREVO_NO_UPDATE_NOTIFIER`, `--no-update-notifier`, CI, non-TTY) suppress the notice but no longer suppress a block — an unsupported version in CI would otherwise fail later on real API errors with a worse message. `BREVO_CLI_SKIP_VERSION_GATE=1` is an emergency bypass.
