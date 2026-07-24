---
"@getbrevo/cli": minor
---

Add `brevo app withdraw` to withdraw an app from submission.

`brevo app withdraw --app-id <id>` calls the app-store withdraw endpoint. It mirrors `brevo app delete`'s UX: a confirmation prompt before withdrawing (`--force` skips it) and `--json` for machine-readable output. When `--app-id` is omitted, it resolves the target from the linked `app-config.json` if run inside a scaffolded project, otherwise falls back to an interactive app picker. If the app was never submitted, it prints a hint to submit it first (`brevo app submit --app-id <id>`) and exits `0` instead of erroring.
