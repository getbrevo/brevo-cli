---
'@getbrevo/cli': minor
---

Add UI app support: author action links and manage their per-account availability (BEX-290).

A UI app is a new *type* of app rather than a separate entity — it shares the app record, credentials, and version lifecycle with OAuth apps, and adds a `ui_app` block to `app-config.json` describing where and how it renders inside Brevo. The first shippable variant is the **action link**: a partner-authored entry point that appears in a CRM record's action menu and opens an external URL in a new tab with record context.

The `ui_app` block is the app-store backend's `app_versions.snapshot` payload field for field — `extensionType`, `surfacePointList`, `heading`, `subheading`, `redirectLink`, `linkTarget` — so what a partner authors is exactly what the platform stores, serves and renders, with no mapping layer in between.

`brevo app create` gained a `--type <oauth|ui>` flag and, interactively, a leading "What type of app are you building?" prompt. `oauth` is the default, and non-interactive runs without the flag keep creating OAuth apps, so existing scripted invocations are unaffected. The UI path collects placement and destination instead of OAuth callbacks — repeatable `--surface` (`contact`/`company`/`deal`, so one action link can appear on several record pages), `--heading`, `--subheading`, `--redirect-link` and `--link-target`, each with a prompt equivalent — and never asks for or defaults a redirect URL, since an action link has no OAuth callback. `redirect_uris` is omitted from the create call entirely for UI apps, which also start from narrower default scopes (`contacts:read`, `contacts:write`). No feature is scaffolded for a UI app; there is no local server to run.

`brevo app upload` now sends the block under the `snapshot` key for UI apps and validates it locally before the request. The validation is deliberately stricter than the wire, because the platform degrades a bad snapshot silently rather than rejecting it: `extensionType` must be `action_link` (`iframe_extension` and `legacy_component` are not CLI-authorable); `surfacePointList` must be non-empty, drawn from the twelve-point extension-point registry, action slots only, and free of duplicates; `heading` must be non-empty; `redirectLink` must be https — `http://` is accepted only for `localhost`/`127.0.0.1` so a partner can point at a local dev server; `linkTarget` must be `_blank` or `_self`; and `modalIframeUrl` is rejected outright, since the UI kit keeps it only for an `iframe_extension` item and would otherwise discard it without a word.

Extension-point validation is the most load-bearing part of that list. Slot names follow the grammar `<location>.<place>.<kind>`, the UI kit matches them by exact string equality, and the backend drops any name without a registry row — so a typo, a stale `.region`-era name, or a casing slip produces an empty slot, an HTTP 200, and no error anywhere in the stack. The CLI is the only layer that can tell a partner, so it checks locally against the registry.

The redirect-URL requirement is now OAuth-only. The upload diff covers the snapshot (ignoring key order), so editing only that block is correctly detected as a change instead of reporting "already up to date". For OAuth apps nothing is sent and the payload is unchanged.

New `brevo app deploy <account-id>` and `brevo app remove <account-id>` manage a UI app's availability in a single Brevo account. Both resolve the target app from `--app-id`, the linked `app-config.json`, or an interactive picker, and support `--force` and `--json`. `deploy` refuses until the configuration has been validated by an upload, pointing at `brevo app upload` — detected locally from a missing `version` and mapped from the server's own rejection. `remove` has no such gate and treats "not deployed to this account" as informational, exiting `0`, so teardown scripts stay idempotent.

`brevo app scaffold` inside a UI-app project now refreshes the base config and reports that there are no features to scaffold. It preserves a hand-edited `ui_app` block through a confirmed config refresh, which would otherwise have overwritten `app-config.json` wholesale from server values that don't include it, and no longer reports phantom redirect-URL drift for an app type that has none.

Note two fields the CLI deliberately does **not** author, because the platform has no counterpart: a per-action label (the record action menu labels the entry with the *app name*) and partner-declared context properties (the record context an action receives is an allow-list on the platform's extension-point registry row).

The write path for the snapshot does not exist on the platform yet, so the upload transport (a `snapshot` key on the existing upload endpoint) and the deploy/remove endpoints remain assumptions — marked in code comments and tracked in `RELEASE-CHECKLIST.md`. The field names themselves are confirmed against both consumers.

UI apps are **not live on the Brevo platform yet**. As with public apps, `agent-context/SKILL.md` and `agent-context/AGENTS.md` carry a notice telling AI agents not to create one or drive the deploy lifecycle, with the same internal-Brevo-account exception so dogfooding still works.
