---
'@getbrevo/cli': minor
---

Fix `brevo <command> --help` and honour `--json` on failure paths.

`brevo <command> --help` now prints that command's own usage line, arguments, flags, and examples. Previously every subcommand rendered the root help screen — repeating the full command list and never naming the flags the user was looking for, despite the root screen telling them to run `brevo <command> --help` for exactly those details. The cause was a single `formatHelp` override on the root program, which Commander copies down to every subcommand; it now applies to the root only and subcommands fall through to the default formatter. The root screen itself is unchanged.

`--json` now also applies when a command fails. Commands other than `whoami` and `logout` previously wrote the error to stderr and exited non-zero without emitting anything on stdout, so a script parsing `brevo app list --json` got zero bytes and no reason. Failures now write a single `{"error": {...}}` document to stdout carrying `name`, `message`, and `exitCode`, plus `statusCode` and (when the API classified it) `code` for API failures. The human-readable message still goes to stderr, and commands that already describe their own failure — `whoami`'s `{"authenticated": false, ...}`, `rollback`'s `{"rolledBack": false, ...}` — keep their existing shape, so stdout stays exactly one parseable document.
