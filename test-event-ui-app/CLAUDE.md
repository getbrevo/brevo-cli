# CLAUDE.md — test-event-ui-app

## Project
Brevo **UI app** `7ad173cf-75f9-4f58-9a80-b859f94376fe` — an action link that renders inside Brevo CRM records.
Scaffolded with the [Brevo CLI](https://github.com/getbrevo/brevo-cli) — see the [Brevo CLI reference](https://developers.brevo.com/docs/cli-reference) for the full command list.

> **There is no local server to run.** A UI app has no OAuth callback and no scaffolded code — Brevo opens a URL you already host. This project *is* the app's configuration.

## Structure
```
.
├── app-config.json          App metadata + the `ui_app` block (the whole app)
├── .gitignore               Ignores .env.local and build artifacts
├── AGENTS.md                AI agent guidance
├── CLAUDE.md                Claude Code guidance (this file)
└── README.md                Human-facing setup guide
```

## Workflow
Everything about this app lives in the `ui_app` block of `app-config.json`. Edit the file, then:

```bash
brevo app upload             # validate + save the configuration (shows a diff first)
brevo app install            # make it available in an account
brevo app uninstall          # remove it from that account again
```

`brevo app upload` has no edit flags — it always pushes the whole of `app-config.json`. `install` and `uninstall` both take an optional `[account-id]`; omitted, the target resolves from the authenticated account (a corporate account is asked which sub-account).

## The `ui_app` block
The presence of `ui_app` is the app-type discriminator — it is what makes this a UI app rather than an OAuth one. That is why `auth` is `{}`, and it must stay empty: `brevo app upload` refuses a UI app carrying `scopes` or `redirect_uris`.

`extension_type` is the only field at the root, because an app is one kind of extension rather than several:

| Value | What it does | Destination field |
|-------|--------------|-------------------|
| `actionLink` | Opens your URL in a new tab | `redirect_link` |
| `iframeExtension` | Embeds your URL in a modal | `modal_iframe_url` |

Values are camelCase. The older snake_case spellings (`action_link`) are rejected outright, not aliased.

### `surface_point_list` entries
One entry is one placement, and each carries its own text and destination — so an app on three slots can label and deep-link each differently.

| Key | Required | Notes |
|-----|----------|-------|
| `surface_point_name` | yes | The registry **slug**, in dot notation — e.g. `contactDetails.header.menu`. This is *not* the dotted extension-point name a spec quotes (`contactDetails.headerMenu.action`); authoring that one fails validation at upload. |
| `label` | yes | Max 48 chars. The menu entry's text on an `.action` slot; the CTA button on a `.widget` slot's card. |
| `more_info` | no | Max 255 chars. The menu entry's second line; a card's description. |
| `redirect_link` | for `actionLink` | `https://` (or `http://localhost`). Record context arrives as **query parameters** — the path is never templated. |
| `modal_iframe_url` | for `iframeExtension` | Rejected on an `actionLink`, which navigates rather than embedding. |
| `context` | no | Narrows the record context Brevo sends. Omitted, the slot's full allow-list applies. |
| `size` | no | `{ "width": "280px", "height": "160px" }` — a positive integer with an explicit `px` or `%` unit (`%` capped at 100). An omitted axis keeps the slot's default. |

A card's **title** is the app name (`test-event-ui-app`) — there is no field for it.

`label`, `more_info`, `redirect_link`, `modal_iframe_url`, `context` and `size` all live **per entry**, never at the `ui_app` root. The root spellings are refused by name with a migration hint, as are the older `heading` / `subheading`.

Do not add `link_target`, `version` or `extension_point_name`. The platform owns all three — `brevo app upload` injects or strips them — so a copy in this file only shows up as permanent, unfixable drift in the upload diff.

## Adding a placement
`brevo app create` authors exactly one. Add further placements by hand as extra `surface_point_list` entries, each with its own `label` and destination, then run `brevo app upload`.

Slot names are **not** checked locally, by design: the platform's extension-point registry is the only authority on them and the CLI keeps no copy that could lag it. `brevo app upload` sends the block and the platform rejects the upload naming any unregistered slot — so let `upload` be the check rather than guessing.

## Next steps
- Host the `redirect_link` endpoint and read the record context off the query string (`recordId`, `recordType`, `accountId`, …) — treat every parameter as untrusted input; it arrives via the browser
- Run `brevo app upload`, then `brevo app install`, then open a CRM record to see the placement
- Keep `auth` as `{}` — a UI app uses no OAuth, and upload refuses one that carries OAuth fields
