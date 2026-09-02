---
'@getbrevo/cli': minor
---

`brevo app create` can now create an `actionLink` UI app non-interactively, either via `--ui-config <file>` (a JSON file: `{ extension_type, record_page, surface_point_name, label, more_info?, redirect_link }`) or via `--ui-app --record-page <slug> --placement <surface_point_name> --label <text> --url <url> [--more-info <text>]`. Previously a non-interactive run (`--json`, piped stdin, or a script) always created an OAuth app instead, with no error, even when a UI app was intended. Both new paths reuse the interactive wizard's own registry validation and reject an unknown `--record-page`/`--placement` with the valid options listed in the error. Only `extension_type: "actionLink"` is supported non-interactively today; `iframeExtension`/`legacyComponent` are refused with a clear message. A plain non-interactive run with neither flag still creates an OAuth app, unchanged.
