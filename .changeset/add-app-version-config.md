---
"@getbrevo/cli": minor
---

Track the app-store API's `version` field through the CLI.

`brevo app create` now shows the server-assigned `version` in the created-app box and `--json` output. `brevo app scaffold` writes it into the new `app-config.json`'s top-level `version` key. `brevo app list` shows a `Version:` line per app (and includes `version` in `--json` output). `brevo app update` shows the app's current version and backfills it into `app-config.json` for projects scaffolded before this field existed — no new flag, `version` is read-only from the CLI's perspective.

`brevo app create` also now scaffolds starter OAuth code by default — the "Generate starter code now?" confirmation is gone, in both interactive mode and `--json`. Interactive mode still prompts for the target directory (default `./<slugified-app-name>`) and how to handle an existing one. Under `--json`, the same default directory is used non-interactively; the response includes `directory` and `scaffolded` (file count) on success, or `directory` and `scaffoldSkipped` (a message) instead of overwriting an existing directory.

`brevo app create` now hard-errors when `app-config.json` already exists in the working directory (no confirm, no override) and resolves its target directory before creating the app. `brevo app scaffold` gained a project-type prompt and is directory-aware: diffs the local config against the server when the same app is already linked (prompting only if they differ, with full regeneration on consent), and requires picking a new directory when a different app is linked.
