---
"@getbrevo/cli": minor
---

Add `brevo app submit` to start the public-app review submission flow (BEX-221).

The command targets an app via `--app-id`, the working directory's `app-config.json`, or an interactive picker. It requires the app's `distribution_type` to be `public`, verifies the local `app-config.json` (when it describes the target app) matches the server definition, then opens the review-submission form link returned by the app API (`google_form_link`) in the browser. `--json` prints `{"app_id","form_url"}` instead of opening a browser, for CI and agent use. Exit codes follow the CLI convention: `1` for not-public / config drift / missing form link, `5` when the app doesn't exist.

When the sync check fails, the error shows a field-by-field diff of the drifted values with `(local only)` / `(server only)` tags so you can tell which side is ahead before pushing; `--json` mode keeps the compact field-name message.
