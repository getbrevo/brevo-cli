---
'@getbrevo/cli': minor
---

**UI apps are GA** (BEX-290). `brevo app create` offers the _UI app_ type in every build (interactive-only — no `--type` flag), and `brevo app install [account-id]` / `brevo app uninstall [account-id]` now ship in the published CLI. Public app distribution (`--distribution public`, `app submit` / `app status` / `app withdraw`) remains pre-GA and excluded from published builds.

**Per-entry card `size`** (BEX-416). Each `ui_app.surface_point_list` entry accepts an optional `size` with `width` / `height` as CSS lengths — `"<positive integer>px"` or `"<1-100>%"` — overriding the host page's default card size for that placement. Both axes are optional; an omitted axis keeps the host default.

**CTA fields moved into each entry** (BEX-426). `label`, `more_info`, `redirect_link` and `modal_iframe_url` now live on each `surface_point_list` entry instead of the `ui_app` root, so every placement can carry its own label and destination. The root spellings are refused with a migration hint, and the per-type rules run per entry (`actionLink` requires `redirect_link` and refuses `modal_iframe_url`; `iframeExtension` the reverse). `brevo app create` authors exactly one placement — add more by editing `app-config.json` and running `brevo app upload`.

**Install/uninstall improvements.** Both commands refuse an app that is not a UI app (previously an OAuth app "installed" with nothing to render), name the resolved target account — `installed into Acme Retail (account 4043630)` — with an additive `accountName` in `--json`, and `uninstall`'s corporate sub-account picker asks "uninstall from" instead of "install into". Their interactive app picker now offers **only UI apps** — an OAuth app in the list was a choice whose only outcome was that refusal one step later — and errors with a pointer at `brevo app create` when there is no UI app to offer.

**`brevo app credentials` refuses a UI app.** A UI app has no OAuth credentials, so the command now exits `1` with a typed message pointing at `brevo app list`, instead of printing an empty credential form (blank client ID, "(none)" scopes and URLs) and caching the emptiness locally.

**`brevo app delete` warns before the confirm** that deletion also removes the app from every account where it is installed or published, and that installs and credentials cannot be recovered. `--force` still deletes without prompting, but now prints the same consequence line so a scripted delete leaves a record; it is kept out of `--json` output, which stays parseable JSON only.

Smaller changes: `app create`'s placement prompt is labelled from the registry's own names; the UI integration-type prompt offers Link only until iframe authoring is ready (a hand-authored `iframeExtension` block still uploads); `--help` examples for `--app-id` show a UUID instead of `42`; a `surface_point_list` entry missing its `surface_point_name` key is reported as a missing key — with a rename hint when the pre-rename `surface_point` spelling is present — instead of as a blank slot name.
