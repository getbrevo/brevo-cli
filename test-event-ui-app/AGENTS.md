# test-event-ui-app — Agent Context

This project is a Brevo **UI app** scaffolded with the Brevo CLI — an action link that renders inside Brevo CRM records.

> **Nothing runs locally.** A UI app has no OAuth callback and no scaffolded server code. Brevo opens a URL you already host; this project is the app's configuration.

## What this does
Declares where the app appears inside Brevo's CRM (which record page, which slot) and where Brevo sends the user when they click it. The whole app is the `ui_app` block in `app-config.json`.

## Project structure
```
.
├── app-config.json          App metadata + the `ui_app` block (the whole app)
├── .gitignore               Ignores .env.local and build artifacts
├── AGENTS.md                AI agent guidance (this file)
├── CLAUDE.md                Claude Code guidance
└── README.md                Human-facing setup guide
```

## The `ui_app` contract
- The presence of `ui_app` is the app-type discriminator. `app_type` is a label the CLI writes alongside it (`"oauth"`, `"ui"` or `"function"`) so the file says in one word what it is; nothing branches on it. `brevo app upload` does check it still agrees with the blocks and refuses a contradiction — if you add or remove a `ui_app` block by hand, update `app_type` to match (or delete it; it is optional, and older configs have no such key).
- `auth` must be exactly `{}` — a UI app uses no OAuth, and `brevo app upload` refuses one carrying `scopes` or `redirect_uris`.
- `extension_type` is the only field at the `ui_app` root: `actionLink` (opens `redirect_link` in a new tab) or `iframeExtension` (embeds `modal_iframe_url` in a modal). camelCase only — `action_link` is rejected, not aliased.
- Everything else lives **per entry** in `surface_point_list`, so each placement carries its own text and destination:
  - `surface_point_name` (required) — the registry slug in dot notation, e.g. `contactDetails.header.menu`. Not the dotted extension-point name a spec quotes (`contactDetails.headerMenu.action`).
  - `label` (required, max 48) — the menu entry's text on an `.action` slot; a card's CTA button on a `.widget` slot.
  - `more_info` (optional, max 255) — the menu entry's second line; a card's description.
  - `redirect_link` (`actionLink`) / `modal_iframe_url` (`iframeExtension`) — `https://`, or `http://localhost`. Each is rejected on the other extension type.
  - `context` (optional) — narrows the record context Brevo sends; omitted, the slot's full allow-list applies.
  - `size` (optional) — `{ "width": "280px", "height": "160px" }`; a positive integer with an explicit `px` or `%` unit, `%` capped at 100.
- A card's title is the app name. There is no field for it.
- Never author `link_target`, `version` or `extension_point_name` — the platform owns them, `brevo app upload` injects or strips them, and a copy in the file reads as permanent drift in the upload diff.
- Root-level `label` / `more_info` / `redirect_link` / `modal_iframe_url` / `context` / `link_target`, and the older `heading` / `subheading`, are all refused by name with a migration hint.

## Record context
Brevo appends the record context to the destination URL as **query parameters** — the path is never templated. Typical fields: `recordId`, `recordType`, `accountId`, `userId`, `clientId`, `extId`, `locale`. They arrive via the browser, so treat them as untrusted input.

## Placements
`brevo app create` authors exactly one placement. Add more by hand as extra `surface_point_list` entries — each with its own `label` and destination — then `brevo app upload`.

Slot names are **not** validated locally: the platform's extension-point registry is the only authority and the CLI keeps no copy that could lag it. `app upload` sends the block and the platform rejects the upload naming any unregistered slot.

## Development
```bash
brevo app upload             # validate + save the configuration (diff shown first)
brevo app install            # make it available in an account
brevo app uninstall          # remove it from that account
```
`brevo app upload` has no edit flags — it pushes the whole of `app-config.json`. `install` / `uninstall` take an optional `[account-id]`; omitted, the target resolves from the authenticated account.

## Docs
- [Brevo API Documentation](https://developers.brevo.com)
- [Brevo CLI reference](https://developers.brevo.com/docs/cli-reference) — full command and option list
- [Brevo CLI repo](https://github.com/getbrevo/brevo-cli)
