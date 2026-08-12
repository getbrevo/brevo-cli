---
'@getbrevo/cli': minor
---

Fix `brevo <command> --help` and honour `--json` on failure paths.

`brevo <command> --help` now prints that command's own usage line, arguments, flags, and examples. Previously every subcommand rendered the root help screen — repeating the full command list and never naming the flags the user was looking for, despite the root screen telling them to run `brevo <command> --help` for exactly those details. The cause was a single `formatHelp` override on the root program, which Commander copies down to every subcommand; it now applies to the root only and subcommands fall through to the default formatter. The root screen itself is unchanged.

Two platform refusals now read as actionable messages instead of raw API copy.

`brevo app create --distribution public` previously surfaced the bare `400 invalid_parameter` sentence *public apps cannot be created with source "cli"; use distribution_type "private"*. The platform stamps the request's source as `cli` itself, so no flag or config change can satisfy it. The message now leads with *"Public apps can't be created from the CLI yet"*, points at `--distribution private`, notes that `distribution_type` is fixed at creation time, and still quotes the server's own response.

Authoring a `ui_app` block previously surfaced `ui_app is not enabled for this account` — a wire key the reader can't act on. `403` / `ui_app_not_enabled` now reads *"UI apps aren't enabled for this Brevo account yet"* with the reason and the alternative. It is mapped by API code, so it covers both `brevo app create` and `brevo app upload`, and `--json` consumers still receive `code: "ui_app_not_enabled"` for matching.

Neither refusal is enforced locally: the CLI forwards the attempt and translates the platform's answer. Both allowances are granted per account, so an enabled account is unaffected and the restrictions lift on the platform's schedule without a CLI release.

`--json` now also applies when a command fails. Commands other than `whoami` and `logout` previously wrote the error to stderr and exited non-zero without emitting anything on stdout, so a script parsing `brevo app list --json` got zero bytes and no reason. Failures now write a single `{"error": {...}}` document to stdout carrying `name`, `message`, and `exitCode`, plus `statusCode` and (when the API classified it) `code` for API failures. The human-readable message still goes to stderr, and commands that already describe their own failure — `whoami`'s `{"authenticated": false, ...}`, `rollback`'s `{"rolledBack": false, ...}` — keep their existing shape, so stdout stays exactly one parseable document.
