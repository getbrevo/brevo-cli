---
"@getbrevo/cli": minor
---

Track the app-store API's `version` field through the CLI.

`brevo app create` now shows the server-assigned `version` in the created-app box and `--json` output. `brevo app scaffold` writes it into the new `app-config.json`'s top-level `version` key. `brevo app list` shows a `Version:` line per app (and includes `version` in `--json` output). `brevo app update` shows the app's current version and backfills it into `app-config.json` for projects scaffolded before this field existed — no new flag, `version` is read-only from the CLI's perspective.

`brevo app create` also now scaffolds starter OAuth code by default — the "Generate starter code now?" confirmation is gone, in both interactive mode and `--json`. Interactive mode still prompts for the target directory (default `./<slugified-app-name>`) and how to handle an existing one. Under `--json`, the same default directory is used non-interactively; the response includes `directory` and `scaffolded` (file count) on success, or `directory` and `scaffoldSkipped` (a message) instead of overwriting an existing directory.

`brevo app create` now hard-errors when `app-config.json` already exists in the working directory (no confirm, no override) and resolves its target directory before creating the app. `brevo app scaffold` gained a project-type prompt and is directory-aware: diffs the local config against the server when the same app is already linked (prompting only if they differ, with full regeneration on consent), and requires picking a new directory when a different app is linked.

Scaffolding now tells you where files are landing before it writes them (e.g. "Scaffolding into the current directory." or "Creating ./my-app and moving into it...") instead of staying silent until after the fact.

The post-scaffold "Next steps" box shows a `cd <dir>` step again when scaffolding landed somewhere other than the directory the command was run from. The CLI does `process.chdir()` internally while resolving the target directory, but that only moves the CLI's own process — it can't and never could move the shell the command was typed into, so the user still needs to `cd` there themselves once the command exits. The step is omitted when scaffolding writes into the directory the command was already run from.

Fixed a critical bug where `brevo app scaffold --json` could still block on an interactive prompt (target directory conflict, a config diff against the server, or a directory linked to a different app), hanging non-interactive scripts and CI jobs. `--json` now never prompts: each of those cases is treated as declined and reported via `{ "cancelled": true, "reason": "...", "diffs": [...] }` (only the relevant fields present) instead.

Split app creation from feature scaffolding. `brevo app create` now writes only the **basic project structure** — `app-config.json` plus the project meta files (`.gitignore`, `AGENTS.md`, `CLAUDE.md`, `README.md`) — and the OAuth test-server code is now a *feature*. `create` scaffolds a feature only when the interactive prompt ("Do you want to scaffold a feature?", default yes → "Test OAuth App") is answered yes; non-interactive runs (`--json` or piped) stay base-only and leave the OAuth code to a follow-up `brevo app scaffold`. `brevo app scaffold` is repurposed to "add a feature to an already-created project": it now **requires** an `app-config.json` in the current directory (erroring with guidance to run `brevo app create` or `cd` into a project otherwise), reads the linked app from that config (the `--app-id` flag and app picker are gone), diffs the config against the server and updates it on consent before writing the feature files (merged in — existing files are never clobbered).
