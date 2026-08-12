---
'@getbrevo/cli': minor
---

Fix `brevo <command> --help` and honour `--json` on failure paths.

`brevo <command> --help` now prints that command's own usage line, arguments, flags, and examples. Previously every subcommand rendered the root help screen — repeating the full command list and never naming the flags the user was looking for, despite the root screen telling them to run `brevo <command> --help` for exactly those details. The cause was a single `formatHelp` override on the root program, which Commander copies down to every subcommand; it now applies to the root only and subcommands fall through to the default formatter. The root screen itself is unchanged.

`brevo app create --distribution public` now explains why it failed. The platform refuses a public-app create from the CLI (`400 invalid_parameter` — *public apps cannot be created with source "cli"; use distribution_type "private"*), keyed on the CLI being the caller rather than on anything in the request body, so no flag or config change can satisfy it. The bare server sentence is replaced with a message that says public app distribution isn't available yet, names `--distribution private`, notes that `distribution_type` is fixed at creation time, and still quotes the server's own response. The CLI deliberately does not refuse locally — it forwards the attempt and translates the refusal, so the restriction lifts on the platform's schedule without a CLI release.

`--json` now also applies when a command fails. Commands other than `whoami` and `logout` previously wrote the error to stderr and exited non-zero without emitting anything on stdout, so a script parsing `brevo app list --json` got zero bytes and no reason. Failures now write a single `{"error": {...}}` document to stdout carrying `name`, `message`, and `exitCode`, plus `statusCode` and (when the API classified it) `code` for API failures. The human-readable message still goes to stderr, and commands that already describe their own failure — `whoami`'s `{"authenticated": false, ...}`, `rollback`'s `{"rolledBack": false, ...}` — keep their existing shape, so stdout stays exactly one parseable document.
