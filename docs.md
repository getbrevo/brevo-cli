# Deferred release notes — public apps and UI apps

**Status: not released. Do not publish any of this as-is.**

Everything below describes surface that exists in this repo but is **eliminated from the
published build** by `scripts/build.mjs` (see `CLAUDE.md` → *Public app distribution is not
GA* and *UI apps are not GA either*). It was written as changeset copy for `2.1.0`, then
pulled out when BEX-405 moved the guard from a runtime check to build-time elimination — a
public CHANGELOG that names `brevo app submit` would send readers to a command their install
answers `unknown command` to.

This file is the holding pen so the copy isn't rewritten from scratch at GA. It is not in
`package.json` `files:`, so it never ships in the npm tarball.

**At GA:** work through `RELEASE-CHECKLIST.md` → *Before public-apps GA* / *Before UI-apps
GA*, then move the relevant sections below into a fresh changeset in the release that turns
the feature on. Re-verify every claim first — the copy dates from this branch and the
platform has moved under it before.

---

## New commands

- **`brevo app status`** — an app's review lifecycle state (`configured`, `submitted`,
  `in_review`, `approved`, `rejected`, `changes_requested`, or `unknown`) with a human
  message. Read-only, `--json` gives `{ state, message }`.
- **`brevo app submit`** — opens the public-app review submission form. Runs a status
  preflight, requires `distribution_type: public`, and verifies the local `app-config.json`
  matches the server (showing a field-by-field diff with `(local only)` / `(server only)`
  tags on drift) before opening the form. `--json` prints `{"app_id","form_url"}`.
- **`brevo app withdraw`** — withdraws an app from submission. Mirrors `app delete`'s UX
  (`--force`, `--json`); an app that was never submitted prints a hint and exits `0`.
- **`brevo app deploy [account-id]`** / **`brevo app rollback [account-id]`** — manage a UI
  app's availability in one Brevo account.

All five resolve the target app from `--app-id`, the linked `app-config.json`, or an
interactive picker.

`deploy` refuses an app that was never uploaded, whichever way it is named — a linked project
is answered from `app-config.json` with no extra request, and `--app-id` / the picker read the
app's server-side version. There is no server-side gate: the install endpoint resolves the app,
checks the plan and installs, so an unuploaded app would otherwise answer `201` and render
nothing.

`rollback` has no such gate and treats HTTP `404` as "not deployed to this account", exiting
`0` (`{"rolledBack": false, "reason": "NOT_DEPLOYED"}` under `--json`), so teardown scripts stay
idempotent — at the cost of a mistyped `--app-id` reading as "not deployed" rather than "app not
found".

`[account-id]` is optional on both. Omitted, the target resolves from the account you are logged
in as: a plain account resolves to itself with no prompt (so `--json` and CI keep working), a
corporate account lists its active sub-accounts and asks. Passing the ID explicitly skips
resolution and remains the only way to target an account the listing won't show.

## UI apps (BEX-290)

A UI app is a new *type* of app rather than a separate entity — it shares the app record,
credentials and version lifecycle with OAuth apps, and adds a `ui_app` block to
`app-config.json` describing where and how it renders inside Brevo. The first shippable variant
is the **action link**: an entry in a CRM record's action menu that opens an external URL in a
new tab with record context.

```json
{
  "ui_app": {
    "extension_type": "actionLink",
    "surface_point_list": [
      { "surface_point_name": "contact-details-header-menu", "context": ["recordId"] },
      { "surface_point_name": "deal-details-header-menu", "context": ["recordId", "recordName"] }
    ],
    "label": "View in CRM",
    "more_info": "Open this contact in your connected CRM to see full activity history.",
    "redirect_link": "https://example.com/view"
  }
}
```

`surface_point_name` is the registry's **kebab-case slug**, which is what the platform resolves
an entry by. `label` (max 48 chars) labels the menu entry and doubles as a widget card's CTA
button; `more_info` (max 255) is the menu entry's second line and the card's description. A
card's *title* is the app name and has no field. `link_target` is not authored — `brevo app
upload` injects `_blank` for an `actionLink`. Neither is `extension_point_name`, the dotted
`<location>.<place>.<kind>` name the platform derives from the slug and stamps on its own copy;
it is excluded from every configuration comparison on both sides.

**A UI app is authored entirely through the prompts.** There is no `--type` flag and no flag for
any UI-app field, so every non-interactive run creates an OAuth app exactly as before. The flow
is five questions, one optional: link vs iframe (**Iframe** is listed but disabled, "coming
soon") → which record pages → where on each page (one single-select per page, so an app takes
exactly one spot per page and can still mix a menu entry on contacts with a card on deals) →
label → more info (optional) → redirect link. The created-app box prints an **example URL** —
the redirect link with the seeded context fields as query parameters — because query parameters
are the only way context reaches your endpoint.

Placements are read live from the platform's extension-point registry, fetch-only with no
offline fallback: `GET /v3/app-store/surface-points/locations` for the record pages, then
`GET /v3/app-store/surface-points?location=<csv>` for the placements on the pages that were
picked. A page the registry offers nothing on is warned about and skipped. A row carrying no
slug is never offered, since it could only author a placement its own upload rejects.

**The CLI carries no list of valid slot names.** It used to mirror the platform's twelve
`extension_points` rows so upload could pre-flight offline; that copy could only lag the
registry and was wrong in both directions — it rejected a slot the platform had added
(including one `brevo app create` had just authored from the live registry) and accepted one
the platform had removed. `brevo app upload` now sends the block and the endpoint answers `400`
naming every slot it doesn't recognise. Local validation keeps the checks that are statements
about the *file*: `extension_type` must be `actionLink` (the pre-BEX-350 `action_link` spelling
is rejected), entries must be objects with a non-blank `surface_point_name`, slots must not
repeat, `context` names must be unique and non-blank, `label` must be non-empty and within its
ceiling, `redirect_link` must be https (`http://` only for `localhost`/`127.0.0.1`), and
`modal_iframe_url` is rejected on an `actionLink`. For anyone hand-editing `app-config.json`, a
mistyped slot name is no longer caught locally.

A UI app's `app-config.json` carries exactly `auth: {}` — an empty object, no `scopes`, no
`redirectUris` — and on the wire both create and upload omit the `auth` key entirely. `ui_app`
is what marks the omission deliberate: a create body carrying neither block is read as an OAuth
app missing its callbacks and rejected with `redirect_uris is required and must not be empty`.
`upload` enforces the shape both ways, rejecting a UI-app config with no `auth` at all and one
still carrying `scopes`/`redirectUris`.

**A config written by an earlier build of this branch is rejected with a migration hint** —
`heading` → `label`, `subheading` → `more_info`, a top-level `context` → move it into each
entry, `surface_point` → `surface_point_name`, and bare strings in `surface_point_list` → wrap
each as an object. There is deliberately no read-path alias: the feature is not live, so these
files only exist on developer machines.

`brevo app scaffold` inside a UI-app project refreshes the base config and reports that there
are no features to scaffold, preserving a hand-edited `ui_app` block through a confirmed
refresh and no longer reporting phantom redirect-URL drift for an app type that has none.

**Bootstrap refuses a UI app that was never uploaded.** The platform sources a UI app's
`ui_app` block from its latest upload snapshot, so a never-uploaded UI app has no block to
return, and a config written without one reads as a valid *OAuth* app (the block's presence is
the app-type discriminator). A half-configured OAuth app — client ID issued, no callbacks yet —
is unaffected and still bootstraps. (This is the third refusal in `app scaffold`'s bootstrap
mode; the other two ship today and are already in the `2.1.0` notes.)

## Public app distribution

`brevo app create --distribution public` no longer errors locally, and Public is a selectable
option in the interactive distribution prompt. The scaffolded OAuth flow branches on
`distribution_type`: **public** apps get Authorization Code + PKCE (RFC 7636) — `/auth/login`
generates a `code_verifier` and sends `code_challenge` + `code_challenge_method=S256`, and the
token exchange and refresh send the `code_verifier` with **no `client_secret`**, so the
generated `.env.local`/`.env.example` carry none. **Private** apps keep the confidential-client
flow unchanged.

The platform refuses public creates per account, independently of anything the CLI does. That
refusal reads *"Public apps can't be created from the CLI yet"*, points at
`--distribution private`, notes that `distribution_type` is fixed at creation, and quotes the
server's own response.

## `app create` prompt order

With both features on, the interactive prompt order is name → distribution → app type →
type-specific prompts → logo. Flag-driven and non-interactive runs are unaffected. The public
build has no app-type prompt, so its order is name → distribution → logo.

## `app list` rendering

Each row leads with its type (`OAuth app` / `UI app`), a UI app's OAuth-only rows are omitted
rather than printed empty, and the `ui_app` block is rendered field for field — extension type,
one row per placement with its context, label, more info, link — mirroring the upload summary.
The listing header is `Your apps:` rather than `Your OAuth apps:`, since it can contain both.

The list endpoint does not echo `ui_app` today, so a UI app's row currently stops at the type;
app-type detection falls back to the absence of every piece of OAuth material, and a record with
a client_id but no callbacks stays an OAuth app (a half-configured one), not a UI app.

The null-safety half of this — `redirect_uris: null` / `scopes: null` no longer crashing the
listing — shipped in `2.1.0` and is already in its notes.

## Error mapping

Authoring a `ui_app` block against an account without it enabled previously surfaced the raw
`ui_app is not enabled for this account`. `403` / `ui_app_not_enabled` now reads *"UI apps
aren't enabled for this Brevo account yet"* with the reason and the alternative, mapped by API
code so it covers both `create` and `upload`; `--json` consumers still receive
`code: "ui_app_not_enabled"`.

## Request payloads — deploy and rollback

`app deploy` / `app rollback` send `client_id` — the authenticated account's organization ID —
alongside `deploy_client_id`, when each is a number. The two are not interchangeable:
`client_id` is the account that *owns* the app, `deploy_client_id` is the account the install
lands in, and they differ whenever a corporate account deploys into a sub-account. Both are
optional on the wire and a non-numeric identifier is omitted rather than sent, because the
platform types both as 64-bit integers and parses the body before it looks at the authenticated
caller — a UUID in either field would reject a request that otherwise works. Omitting loses
nothing: the platform resolves the caller from the credential and defaults the target to that
same account. If the CLI can't determine your account at all it says so and points at
`brevo login`.

---

## Not release copy — how the guard itself works (BEX-405)

Kept here for the GA author's benefit, **not** to be published. There is no user-visible
"pre-GA gate" to announce: from a user's point of view the surface simply is not in the
binary, which is the whole point of moving the guard into the build.

The published build eliminates the gated surface at compile time. `scripts/build.mjs` sets
`__BREVO_PREVIEW__`, gated command definitions live in `src/commands/preview-definitions.ts`
and are referenced from behind that flag, and `src/lib/preview.ts` → `FEATURE_STAGE` states
which features are gated. Build with `PREVIEW=1 yarn link:dev` (or `yarn build:preview`) to
get the full surface locally.

Flipping a `FEATURE_STAGE` row to `'ga'` is **necessary but not sufficient** — a GA feature
left in `preview-definitions.ts` is still eliminated. `RELEASE-CHECKLIST.md` has the full
sequence.

There is deliberately **no runtime escape hatch**. An earlier iteration unlocked on an
`@brevo.com` / `@sendinblue.com` account or `BREVO_ENABLE_PREVIEW=1`; both are gone, and
`CLAUDE.md` says not to add one back — a compile-time guard a user can switch on is a runtime
guard wearing a costume, and it has to ship the surface in order to reveal it.
