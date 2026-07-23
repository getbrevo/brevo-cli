---
"@getbrevo/cli": minor
---

Track the app-store API's `version` field through the CLI.

`brevo app create` now shows the server-assigned `version` in the created-app box and `--json` output. `brevo app scaffold` writes it into the new `app-config.json`'s top-level `version` key. `brevo app list` shows a `Version:` line per app (and includes `version` in `--json` output). `brevo app update` shows the app's current version and backfills it into `app-config.json` for projects scaffolded before this field existed — no new flag, `version` is read-only from the CLI's perspective.

`brevo app create` also now scaffolds starter OAuth code by default — the "Generate starter code now?" confirmation is gone, in both interactive mode and `--json`. Interactive mode still prompts for the target directory (default `./<slugified-app-name>`) and how to handle an existing one. Under `--json`, the same default directory is used non-interactively; the response includes `directory` and `scaffolded` (file count) on success, or `directory` and `scaffoldSkipped` (a message) instead of overwriting an existing directory.

`brevo app create` now hard-errors when `app-config.json` already exists in the working directory (no confirm, no override) and resolves its target directory before creating the app. `brevo app scaffold` gained a project-type prompt and is directory-aware: diffs the local config against the server when the same app is already linked (prompting only if they differ, with full regeneration on consent), and requires picking a new directory when a different app is linked.

Scaffolding now tells you where files are landing before it writes them (e.g. "Scaffolding into the current directory." or "Creating ./my-app and moving into it...") instead of staying silent until after the fact. The post-scaffold "Next steps" box no longer shows a `cd` step — the CLI already changes into the target directory as part of resolving it, so that step was always a no-op `cd .`.

Fixed a critical bug where `brevo app scaffold --json` could still block on an interactive prompt (target directory conflict, a config diff against the server, or a directory linked to a different app), hanging non-interactive scripts and CI jobs. `--json` now never prompts: each of those cases is treated as declined and reported via `{ "cancelled": true, "reason": "...", "diffs": [...] }` (only the relevant fields present) instead.
