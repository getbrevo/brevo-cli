---
'@getbrevo/cli': minor
---

**`brevo app install` offers to upload unsaved local config first.** When the linked project's `ui_app` block differs from the one the server stores, an interactive run (no `--force`, no `--json`) now asks whether to upload it before installing (default yes). Yes runs the normal `brevo app upload` flow — diff, installed-accounts notice and its own confirmation — then re-reads the server and installs what it now holds. Declining, `--force`, `--json` and non-interactive runs keep the previous behaviour: the drift notice, then the install of the stored configuration. Nothing is ever uploaded without being asked.

**`brevo app create --ui-config` now refuses every key it cannot honour instead of dropping it.** The file was read as a fixed key set, so anything else vanished with no error. Keys that belong to a different extension type are refused by name on this action-link-only route, and the platform-stamped keys (`link_target`, `extension_point_name`, `version`) get their own message: those are not authored anywhere, so it says to remove the key rather than to move it. Both refusals fire before any registry read, and the platform-owned list is derived from the app type's `wireOnlyKeys` so it cannot drift from the keys the CLI strips.

**`brevo app upload` refuses a hand-added `sandbox` key by name** — at the `ui_app` root, on an action-link entry and on a public app — before any network call, instead of sending it to the platform and surfacing an opaque `400`.

**`brevo app credentials` shows credentials for a UI app whose record carries a client ID.** The command refused every UI app on the assumption that none has OAuth material. The refusal now applies only to a record with no client ID, and the secret stays behind `--reveal-secret` (interactive terminal only), exactly as for an OAuth app.

**A malformed registry default card size is no longer seeded into a new app's config.** `brevo app create` seeds each entry's `size` from the picked slot's `default_size`, and the sanitizer dropped only blank axes — so a unit-less value served by a registry predating the grammar (`"100"` rather than `"100px"`) was written into `app-config.json` and then refused by the CLI's own `validateUiApp`, in the very flow that had just authored it. The seed is now judged by the authored-size grammar itself, shared by every reader of it, so they cannot drift apart.
