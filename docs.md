# Public apps and UI apps — deferred release notes & outstanding work

**Status: public apps are not released. UI apps left the pre-GA gate at BEX-290, but the
release has not published** — the GA code merged in CLI PR #56 (2026-08-19), was reverted
the same day (#66), and re-entered review as CLI PR #68. Do not publish any of this as-is.
**Branch-local — never merge into `main`** (see `CLAUDE.md` → *Branch-local working
docs*; this file lived on the retired `docs/public-cli-ui-apps-feature-changes` branch
until 2026-08-24).

Two halves. **Part 1** is the release copy, held until GA. **Part 2** is everything still
open on the two features — consolidated from `TODO.md`, `QA-TESTCASES.md`,
`RELEASE-CHECKLIST.md` and the three `BEX-290-*.md` working notes, which were deleted once
their durable content landed here.

**The UI-apps release copy no longer lives here.** It travels as the pending changeset on
CLI PR #68, which is what the Version Packages PR will publish. Part 1's UI-app section
below is kept as the fuller background narrative for whoever writes the announcement —
aligned with that changeset as of 2026-08-24, but the changeset wins on conflict.

The public-apps surface still exists in this repo and is **eliminated from the published
build** by `scripts/build.mjs` (see `CLAUDE.md` → *Public app distribution is not GA*). Its
copy was written as changeset text for `2.1.0`, then pulled out when BEX-405 moved the
guard from a runtime check to build-time elimination — a public CHANGELOG that names
`brevo app submit` would send readers to a command their install answers `unknown command`
to.

This file is the holding pen so the copy isn't rewritten from scratch at GA. It is not in
`package.json` `files:`, so it never ships in the npm tarball.

**At GA:** work through `RELEASE-CHECKLIST.md` → *Before public-apps GA*, then move the
relevant sections below into a fresh changeset in the release that turns the feature on.
Re-verify every claim first — the copy dates from this branch and the platform has moved
under it before (the `surface_point_name` slugs, for one, changed spelling entirely).

---

# Part 1 — release copy (hold until GA)

## New commands

Public apps (held until public-apps GA):

- **`brevo app status`** — an app's review lifecycle state (`configured`, `submitted`,
  `in_review`, `approved`, `rejected`, `changes_requested`, or `unknown`) with a human
  message. Read-only, `--json` gives `{ state, message }`.
- **`brevo app submit`** — opens the public-app review submission form. Runs a status
  preflight, requires `distribution_type: public`, and verifies the local `app-config.json`
  matches the server (showing a field-by-field diff with `(local only)` / `(server only)`
  tags on drift) before opening the form. `--json` prints `{"app_id","form_url"}`.
- **`brevo app withdraw`** — withdraws an app from submission. Mirrors `app delete`'s UX
  (`--force`, `--json`); an app that was never submitted prints a hint and exits `0`.

UI apps (shipping with CLI PR #68 — its changeset is the operative copy):

- **`brevo app install [account-id]`** / **`brevo app uninstall [account-id]`** — manage a
  UI app's availability in one Brevo account. (They were `deploy` / `rollback` until
  2026-08; the commands are named for the install resource they manage.)

All five resolve the target app from `--app-id`, the linked `app-config.json`, or an
interactive picker.

`install` refuses an app that was never uploaded, whichever way it is named — a linked
project is answered from `app-config.json` with no extra request, and `--app-id` / the
picker read the app's server-side version. There is no server-side gate: the install
endpoint resolves the app, checks the plan and installs, so an unuploaded app would
otherwise answer `201` and render nothing. Both commands also refuse an app that is not a
UI app — an OAuth app has nothing to install.

`uninstall` has no such gate and treats HTTP `404` as "not installed in this account",
exiting `0` (`{"uninstalled": false, "reason": "NOT_INSTALLED"}` under `--json`), so
teardown scripts stay idempotent — at the cost of a mistyped `--app-id` reading as "not
installed" rather than "app not found".

`[account-id]` is optional on both. Omitted, the target resolves from the account you are
logged in as: a plain account resolves to itself with no prompt (so `--json` and CI keep
working), a corporate account lists its active sub-accounts and asks. Passing the ID
explicitly skips resolution and remains the only way to target an account the listing won't
show.

## UI apps (BEX-290, reshaped by BEX-416 / BEX-422 / BEX-426)

A UI app is a new *type* of app rather than a separate entity — it shares the app record
and version lifecycle with OAuth apps, and adds a `ui_app` block to `app-config.json`
describing where and how it renders inside Brevo. The first shippable variant is the
**action link**: an entry in a CRM record's action menu that opens an external URL in a
new tab with record context.

```json
{
  "ui_app": {
    "extension_type": "actionLink",
    "surface_point_list": [
      {
        "surface_point_name": "contactDetails.header.menu",
        "context": ["recordId"],
        "label": "View in CRM",
        "more_info": "Open this contact in your connected CRM.",
        "redirect_link": "https://example.com/contacts"
      },
      {
        "surface_point_name": "dealDetails.header.menu",
        "context": ["recordId", "recordName"],
        "label": "View deal in CRM",
        "redirect_link": "https://example.com/deals"
      }
    ]
  }
}
```

`surface_point_name` is the registry's **dot-notation slug**, which is what the platform
resolves an entry by. It is *not* the `<location>.<place>.<kind>` extension-point name
(`contactDetails.headerMenu.action`) — both are dotted since the platform renamed the
slugs from kebab-case (2026-08-18 migration), which makes them easier than ever to
confuse, and only the slug is authorable.

**Every CTA field lives per entry (BEX-426).** `label` (max 48 chars) labels that
placement's menu entry and doubles as a widget card's CTA button; `more_info` (max 255,
optional) is the menu entry's second line and the card's description; `redirect_link` is
that placement's destination (record context arrives as **query parameters** — the path is
never templated). An optional per-entry `size` (BEX-416) narrows a widget card's box —
`width` / `height` as CSS lengths, `"<positive integer>px"` or `"<1-100>%"` of the host
slot, shrink-only, either axis omittable. `extension_type` is the only field left at the
`ui_app` root. A card's *title* is the app name and has no field. `link_target` is not
authored — `brevo app upload` injects `_blank` per entry for an `actionLink`. Neither is
`extension_point_name`, which the platform derives from the slug and stamps on its own
copy; both are excluded from every configuration comparison on both sides.

**A UI app is authored entirely through the prompts.** There is no `--type` flag and no
flag for any UI-app field, so every non-interactive run creates an OAuth app exactly as
before. The flow authors **exactly one placement**: integration type (**Link** only — the
disabled "coming soon" Iframe choice was removed 2026-08-19 until iframe authoring is
ready) → which record page (single-select) → where on that page (single-select, labelled
with the registry's own `section_name — component_type` values) → label → more info
(optional) → redirect link. One placement because the CTA fields are per-entry now —
authoring N placements interactively would re-ask three questions per placement. More
placements are added by hand as further `surface_point_list` entries (each with its own
label and URL) and pushed with `brevo app upload`; the created-app box's hint says exactly
that. The box also prints an **example URL** — the redirect link with the seeded context
fields as query parameters — because query parameters are the only way context reaches
your endpoint.

Placements are read live from the platform's extension-point registry, fetch-only with no
offline fallback, and both reads narrow by the chosen extension type (BEX-422):
`GET /v3/app-store/surface-points/locations` for the record pages, then
`GET /v3/app-store/surface-points?location=<csv>` for the placements on the page that was
picked. A page the registry offers nothing on for the chosen type aborts with a precise
error — since the page prompt is single-select there is no other picked page to continue
with, so the old skip-with-warning went with the multi-select. A row carrying no slug is
never offered, since it could only author a placement its own upload rejects.

**The CLI carries no list of valid slot names.** It used to mirror the platform's twelve
`extension_points` rows so upload could pre-flight offline; that copy could only lag the
registry and was wrong in both directions — it rejected a slot the platform had added
(including one `brevo app create` had just authored from the live registry) and accepted
one the platform had removed. `brevo app upload` now sends the block and the endpoint
answers `400` naming every slot it doesn't recognise. Local validation keeps the checks
that are statements about the *file*: `extension_type` must be `actionLink` (the
pre-BEX-350 `action_link` spelling is rejected), entries must be objects with a non-blank
`surface_point_name`, slots must not repeat, and per entry: `context` names unique and
non-blank, `label` non-empty and within its ceiling, `redirect_link` https (`http://` only
for `localhost`/`127.0.0.1`), `size` axes well-formed CSS lengths, and `modal_iframe_url`
rejected on an `actionLink` entry. For anyone hand-editing `app-config.json`, a mistyped
slot name is no longer caught locally.

A UI app's `app-config.json` carries exactly `auth: {}` — an empty object, no `scopes`, no
`redirectUris` — and on the wire both create and upload omit the `auth` key entirely.
`ui_app` is what marks the omission deliberate: a create body carrying neither block is
read as an OAuth app missing its callbacks and rejected with `redirect_uris is required
and must not be empty`. `upload` enforces the shape both ways, rejecting a UI-app config
with no `auth` at all and one still carrying `scopes`/`redirectUris`.

**A config written by an earlier build of this branch is rejected with a migration hint.**
Pre-BEX-290 spellings: `heading` → `label`, `subheading` → `more_info`, a top-level
`context` → move it into each entry, `surface_point` → `surface_point_name`, bare strings
in `surface_point_list` → wrap each as an object. Pre-BEX-426 spellings: `label`,
`more_info`, `redirect_link` and `modal_iframe_url` at the `ui_app` root → move each into
the entries; a root `link_target` → remove it (the CLI never wanted it in the file). The
server refuses the superseded root spellings by name too. There is deliberately no
read-path alias: the renames shipped before the feature was live, so these files only
exist on developer machines — reasoning frozen at GA; a future rename needs a real
migration path.

`brevo app scaffold` inside a UI-app project refreshes the base config and reports that
there are no features to scaffold, preserving a hand-edited `ui_app` block through a
confirmed refresh and no longer reporting phantom redirect-URL drift for an app type that
has none.

**Bootstrap refuses a UI app the platform returns no `ui_app` block for.** A config
written without the block reads as a valid *OAuth* app (the block's presence is the
app-type discriminator), so the command refuses rather than writing one. A half-configured
OAuth app — client ID issued, no callbacks yet — is unaffected and still bootstraps.

This is an **edge case, not the ordinary post-create state** — an earlier version of this
note said the platform stores the block only from an upload snapshot, which is false.
bo-be's CLI create handler writes an `app_versions` row carrying the block inside the
create transaction, and `GET /cli/apps/{id}` serves it from that snapshot, so a UI app
created through this CLI is recoverable immediately with no upload. Proven live on
2026-08-13: the first `app upload` after a create answers "Already up to date"
(QA-TESTCASES TC-12.5(a)).

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

The interactive prompt order is name → logo → distribution → app type → type-specific
prompts (the logo moved to second on 2026-08-13 — it used to be asked inside each branch).
Flag-driven and non-interactive runs are unaffected. A published build without public apps
asks both gated questions with one choice each (`Private` only; until UI apps publish,
`OAuth app` only) rather than skipping them.

## `app list` rendering

Each row leads with its type (`OAuth app` / `UI app`), a UI app's OAuth-only rows are omitted
rather than printed empty, and the `ui_app` block is rendered field for field — extension type,
one row per placement with its context, label, more info, link — mirroring the upload summary.
The listing header is `Your apps:` rather than `Your OAuth apps:`, since it can contain both.

The list endpoint does not echo `ui_app` today, so a UI app's row currently stops at the type;
app-type detection falls back to the absence of every piece of OAuth material, and a record with
a client_id but no callbacks stays an OAuth app (a half-configured one), not a UI app. (The
server side moved on 2026-08-24 — see *Platform-side asks*.)

The null-safety half of this — `redirect_uris: null` / `scopes: null` no longer crashing the
listing — shipped in `2.1.0` and is already in its notes.

## Error mapping

Authoring a `ui_app` block against an account without it enabled previously surfaced the raw
`ui_app is not enabled for this account`. `403` / `ui_app_not_enabled` now reads *"UI apps
aren't enabled for this Brevo account yet"* with the reason and the alternative, mapped by API
code so it covers both `create` and `upload`; `--json` consumers still receive
`code: "ui_app_not_enabled"`.

## Request payloads — install and uninstall

`app install` / `app uninstall` send `client_id` — the authenticated account's organization
ID — alongside `deploy_client_id` (the wire field keeps the server's pre-rename vocabulary),
when each is a number. The two are not interchangeable: `client_id` is the account that
*owns* the app, `deploy_client_id` is the account the install lands in, and they differ
whenever a corporate account installs into a sub-account. Both are optional on the wire and
a non-numeric identifier is omitted rather than sent, because the platform types both as
64-bit integers and parses the body before it looks at the authenticated caller — a UUID in
either field would reject a request that otherwise works. Omitting loses nothing: the
platform resolves the caller from the credential and defaults the target to that same
account. If the CLI can't determine your account at all it says so and points at
`brevo login`.

---

## Not release copy — how the guard itself works (BEX-405)

Kept here for the GA author's benefit, **not** to be published. There is no user-visible
"pre-GA gate" to announce: from a user's point of view the surface simply is not in the
binary, which is the whole point of moving the guard into the build.

The published build eliminates the gated surface — now the public-apps surface only — at
compile time. `scripts/build.mjs` sets `__BREVO_PREVIEW__`, gated command definitions live
in `src/commands/preview-definitions.ts` and are referenced from behind that flag, and
`src/lib/preview.ts` → `FEATURE_STAGE` states which features are gated. Build with
`PREVIEW=1 yarn link:dev` (or `yarn build:preview`) to get the full surface locally.

Flipping a `FEATURE_STAGE` row to `'ga'` is **necessary but not sufficient** — a GA feature
left in `preview-definitions.ts` is still eliminated. `RELEASE-CHECKLIST.md` has the full
sequence, and the UI-apps flip (BEX-290) is the worked example: definitions moved, strings
moved, names moved from `LEAK_MARKERS` to `GA_MARKERS` so every build asserts they ship.

There is deliberately **no runtime escape hatch**. An earlier iteration unlocked on an
`@brevo.com` / `@sendinblue.com` account or `BREVO_ENABLE_PREVIEW=1`; both are gone, and
`CLAUDE.md` says not to add one back — a compile-time guard a user can switch on is a runtime
guard wearing a costume, and it has to ship the surface in order to reveal it.

---

# Part 2 — outstanding work

Nothing below blocks *this* release — the build-time gate is what makes that true for
public apps. The first list blocks the UI-apps release; the rest blocks nothing.

**This half is the open-questions log; `RELEASE-CHECKLIST.md` is the GA runbook.** Keep
them apart: this answers *what is still unknown*, that answers *what to do on the day*.
When an item here resolves, delete it; when it becomes a release step, move it there.

## Blocking — the UI-apps release (the code is done; these are the ship steps)

- [ ] **Merge CLI PR #68.** The GA code merged in #56 (2026-08-19) and was reverted the
      same day (#66); it must land on `main` again before anything publishes.
- [ ] **bo-be must un-gate UI-app authoring (BEX-437)** before or with the CLI release —
      create/upload of a `ui_app` block are still gated server-side on bo-be `main`
      (verified 2026-08-24; the fix is in review).
- [ ] **Cut the release** — merge the changesets "Version Packages" PR so npm moves past
      `2.1.0`.
- [ ] **Staging registry seed is unverified.** Production is confirmed (2026-08-24): all
      twelve rows, both identities per row, post-rename dotted slugs, no duplicates.
      Staging needs the same check before QA runs against it.

## Platform-side asks — raised, not CLI fixes

- [ ] **Echo `ui_app` on `GET /v3/app-store/apps`.** The list response carries no
      `ui_app` — `applyIdentityFields` sets only `app_id`, `name`, `distribution_type`,
      `version`, `display_version` — so `app list` can identify a UI app but not show what
      it does; every UI-app row stops at `Version:`. **Half-answered on bo-be `main`
      (2026-08-24):** the endpoint now takes `?type=oauth|ui_app|brevo_function` (unknown
      value → 400 listing the valid types), classifying server-side from version
      snapshots — but the block itself is still not echoed. **CLI follow-up once
      deployed:** consume the filter / server classification and retire the
      `isUiAppRecordShape` heuristic where the listing is the source; the detail rows in
      `printUiApp` stay unit-tested-only until the block is echoed.
- [ ] **`surface_point_name` alone still has no unique constraint — checked on prod
      (2026-08-24).** `appstore.extension_points` carries a unique on
      `extension_point_name` and a **composite** unique on
      (`extension_point_name`, `surface_point_name`). The composite does NOT close the
      gap: the lookup is `WHERE surface_point_name = ANY(...)`, so two rows with different
      dotted names can still share a slug, and `FindByNames` returns a map keyed by slug —
      a duplicate collapses and the stamp picks an arbitrary row. **Latent, not live** —
      the twelve seeded rows have twelve distinct slugs. The single-column unique is still
      the ask; do it before a thirteenth row is seeded. (Spec drift noted: the composite
      constraint is absent from bo-be's `specs/database.sql` — the live schema is ahead of
      the spec file.)
- [ ] **`appstore.as_integrations` has no `(client_id, app_id)` unique constraint —
      checked on prod (2026-08-24).** Install idempotency is application-level only
      (`findExistingInstallation`); two concurrent installs can race past the check and
      insert duplicate rows. Raise alongside the `surface_point_name` unique. (The
      code-level idempotency itself is confirmed — see *Resolved*.)
- [x] **RESOLVED (2026-08-12) — `POST /v3/app-store/apps` DOES write an `app_versions` row,
      and it does read the `ui_app` block.** Confirmed by reading app-store-bo-be, then
      proven live on 2026-08-13 (create → upload → "Already up to date", TC-12.5(a)):

      - `persistCreateResultTx` (`http_cli_create_app.go`) inserts an `app_versions` row
        **inside the create transaction**, at `initialAppVersion = "0.0.1"`, with
        `Snapshot.UIApp = params.uiSnapshot` — so the authored block is stored at create
        time. The OAuth half of the snapshot is added only when `auth` was provided,
        which is why a UI app stores cleanly with no OAuth block.
      - `GET /cli/apps/{id}` serves it straight back off the latest snapshot.

      **Consequence, already applied to the CLI.** The bootstrap refusal
      (`recoverableFromRecord`, surfaced as `APP_SCAFFOLD_BOOTSTRAP_UNRECOVERABLE`) was
      written on the belief that the platform stores `ui_app` *only* from an upload
      snapshot. That belief was wrong: a created-but-never-uploaded UI app **is**
      recoverable immediately. The guard itself is still right — a record with no block
      genuinely has nothing to bootstrap from — but it is an edge case (an app predating
      the handler, or created outside this CLI), not the ordinary post-create state.

## Wire contracts still assumed

Each is marked in a comment at its call site.

- [ ] **HTTP 422 for install's "not uploaded" does not exist.** Verified against
      app-store-backend `origin/main` (prod image 1.5.0): the installs handler
      (`http_create_integration_details.go`) resolves the app by UUID, checks the plan and
      inserts — no configured/uploaded check on the path, so installing a never-uploaded
      app answers `201` and renders nothing. `assertUploadedBeforeInstall()` is therefore
      the **only** gate and must hold for every resolution path. The `422` branch in
      `install.ts` is dead-but-deliberate defence and is commented as such — don't delete
      it as dead code, and don't weaken the local check on the belief the server will
      catch it.
- [ ] **Whether the install `POST` response carries an ID worth surfacing.** It returns
      `{brevo_integration_id, installation_id}` (same value twice); the CLI discards both,
      fine while uninstall addresses the install by account rather than by ID.
- [ ] **BEX-355 sign-off that an absent `source` is contract-valid.** The CLI stopped sending
      `source: 'cli'` after the platform started reading it as policy (`400
      invalid_parameter`, *public apps cannot be created with source "cli"*). The backend
      derives the caller from the `User-Agent` header instead. **Staging accepts the omission**
      — a private create with no `source` and no `cli_version` returned `201` (2026-08-12) —
      but that only proves it is not *rejected*. Still needs the owners to confirm it does
      not change attribution, rate-limiting or gating.
- [ ] **The app-read responses disagree on shape, and the CLI absorbs it.** Confirmed on
      staging 2026-08-12: `POST /apps` and `POST /apps/{id}/upload` return OAuth fields
      **nested** under `auth`, while `GET /apps/{id}` returns them **flat** (`client_id`,
      `redirect_uris` at the top level). The CLI copes — `flattenCreateAuth` tolerates both
      on create, and the read path expects flat — so nothing is broken. But it is one
      resource described two ways, which is how the original nesting regression hid as long
      as it did. Worth raising on BEX-355 rather than leaving each new consumer to
      rediscover it.

## CLI cleanups now unblocked

- [ ] **Drop the pre-BEX-361 row-name aliases** in `appService.fetchSurfacePoints`
      (`extension_point`, `location`, `place`, `kind`, `supported_extension_types`). The
      real row shape is confirmed from the deployed handlers and bo-be documents the old
      spellings as dead, so the aliases no longer buy anything. (The locations endpoint's
      bare-array tolerance and the placements read's unfiltered retry are **kept
      deliberately**, not pending — see `RELEASE-CHECKLIST.md`'s history for the
      reasoning.)
- [ ] **Consume the list endpoint's `?type=` filter** once it deploys — see the `app list`
      platform ask above.

## UX decisions — open, and each a choice rather than a bug

- [x] **What `brevo app credentials` should do for a UI app — DECIDED AND SHIPPED
      (2026-08-24).** It refuses with a typed message before any side effect, routed
      through the capability matrix (`'oauth-flow'`), which had named the command as
      OAuth-only since it was written — the "render a UI-app view" alternative was not
      taken. In the same change, the `install`/`uninstall` picker offers only UI apps (an
      OAuth row was a choice whose only outcome was the type-gate refusal one step
      later); the delete/withdraw/scaffold pickers stay unfiltered.
- [ ] **Whether the created-app box and the `app upload` diff should render a friendly
      placement label** instead of the raw `surface_point_name` slug they print today.
      The *prompt* moved to the registry's own values at BEX-426 (`section_name —
      component_type`, replacing the local label map, which is not reintroducible); the
      box and the diff still print the authored slug. Neither call site holds the registry
      row at print time, so this needs a lookup, not a formatting change.
- [ ] **Whether `url_pattern` from the BEX-361 rows should surface in the placement prompt**
      (e.g. as a choice hint) so partners see where in the product a slot renders before
      picking it.
- [ ] **`promptAppSelection` is an unpaginated `rawlist` over every app on the account.** Fine
      at today's counts; it degrades past a screenful.
- [ ] **`app upload --json` reports a stale `next.version`.** Observed 2026-08-12: the
      top-level `version` correctly showed the new `0.0.2` while `next.version` still read
      `0.0.1` — `next` is built from the local config before the server assigns the bump.
      Cosmetic, but `next` reads as "what it will become", so it should carry the new version
      or drop the field.

## Deliberately parked — don't "fix" without revisiting the decision

- [ ] **`iframeExtension` prompt authoring** — parked 2026-08-03; the disabled "coming
      soon" choice was removed from the integration-type prompt entirely on 2026-08-19,
      so the prompt now offers **Link** only. The CLI stays actionLink-only until the
      iframe-embed RFC (trust handshake, JWT, postMessage) lands. A hand-edited
      `iframeExtension` block still validates and uploads (per entry: `label` +
      `modal_iframe_url` required, `redirect_link` refused). When the RFC lands, restore
      the choice plus `permittedUrls.iframe` handling — the postMessage origin allowlist
      is what makes the modal secure.
- [ ] **`permittedUrls` is scaffolded empty** and never validated or populated from an
      entry's `redirect_link`. Harmless for action links (they open a new tab);
      load-bearing for `iframeExtension` modals.
- [ ] **No local dev story for a UI app.** `brevo app start` has no UI-app equivalent, so a
      partner cannot preview an action link without installing into a real account. Worth a
      local harness that renders the action menu and forwards context params to the external
      URL.
- [ ] **Per-entry context narrowing is structural only.** Every registry row carries the same
      default today, so every authored entry gets an identical list, and the upload endpoint
      does not yet validate context per entry. The shape is forward-compatible; nothing
      enforces narrowing anywhere yet.
- [ ] **Surface the per-slot context allow-list read-only** (e.g. in the create summary) so a
      partner knows which params their URL will receive without a failed upload.

## QA gaps

`QA-TESTCASES.md` on this branch carries the public-app and UI-app suites; Suite 12 was
rewritten 2026-08-24 for the current surface (`install`/`uninstall`, per-entry CTA
fields and `size`, dot-notation slugs, the single-placement create flow). The recorded
2026-08-13 results predate those changes and say so inline.

- [x] **`yarn smoke --against=local` built the wrong artifact — FIXED, pending a
      verifying run.** `stepReinstall` (`scripts/smoke/core.ts`) now runs the build with
      `PREVIEW=1` when the suite under test needs the preview surface, so the gated
      suites no longer silently skip every step against a public artifact.
      `--against=published` still installs from npm, where the gated commands genuinely
      are absent, so skipping stays the correct outcome there. Re-run the local suite
      once to confirm before relying on it.
- [ ] **The real QA gaps are the never-run cases**, consolidated in Suite 12's sign-off
      table: `install`/`uninstall` have never been manually invoked (TC-12.7, 12.9,
      12.10, 12.11(g)/(h)), `ui_app` has never been verified **on disk** (TC-12.3's file
      half, TC-12.4's push half, TC-12.5(b)/(c)), the migration-hint and
      extension-point-validation cases (TC-12.5b, TC-12.6) are unrun, and no `--json` /
      non-TTY path has been exercised (TC-12.12).
- [ ] **No suite covers the gate itself** — that a published build hides the commands and
      refuses `--distribution public`. Automated coverage exists
      (`src/__tests__/lib/preview.test.ts`, `preview-gate.test.ts`, plus the build's own
      output assertions), so this is a nice-to-have.

## Known limit of the build gate

- [ ] **Object-literal properties survive elimination.** esbuild cannot prune a property from
      an object literal, so anything reached as `OBJECT.KEY` stays at zero references. In a
      public build that leaves `CLI.APP_SUBMIT` / `APP_WITHDRAW`, the `/withdraw` entry in
      `ENDPOINTS` (both `src/lib/constants.ts`), and `appService.withdrawApp`
      (`src/services/app.ts`). All inert — no command reaches them, no help lists them.
      (The install-side names left this list at UI-apps GA — they ship for real now.)
      `src/lang/preview-messages.ts` is the pattern that fixes this class if the residue ever
      matters.

## Resolved — kept for the reasoning

Decisions that look re-openable but aren't.

- **Per-entry CTA fields (BEX-426) closed the parked "per-placement label / more_info /
  redirect_link" item.** `label`, `more_info`, `redirect_link` and `modal_iframe_url`
  live on each `surface_point_list` entry — the same move `context` and `size` already
  made — with the root spellings refused by name on both the CLI and the server.
  `link_target` followed per entry (injected, never authored). `extension_type` is the
  only field left at the root, deliberately: a per-entry type would let one app be two
  kinds at once.
- **The slug rename needed no CLI change.** The registry's `surface_point_name` slugs went
  from kebab-case to dot notation (`contactDetails.header.menu`) in a 2026-08-18 platform
  migration, snapshots rewritten in the same transaction, verified applied on prod
  2026-08-24. The CLI prompts from the registry and validates shape only, so only its
  examples and comments needed updating (CLI PR #64). The dotted slug is still not the
  `extension_point_name` grammar; only the slug is authorable.
- **`type === 'corporate'` on `/v3/account/info` — verified 2026-08-21** against a live
  corporate account: the sub-account picker (`GET /v3/corporate/subAccount`) and the
  corporate branch of `resolveInstallTarget()` are no longer assumed. This was the last
  assumed wire contract; the `src/types.ts` comment was updated to match.
- **A repeated install is an idempotent upsert — confirmed in code (2026-08-24,
  app-store-backend `origin/main`).** `findExistingInstallation` keys a developer install
  on caller + app + `is_developer=true` and a repeat answers `200` with the existing
  row's ID. The CLI's never-check-first behaviour is safe. DB-level uniqueness is still
  absent — that's the open platform ask above, about racing concurrent installs, not
  about the sequential case.
- **BEX-426 environment sequencing is closed.** The per-entry keys 400 (`unknown key`) on
  a bo-be that predates its side of the move; bo-be shipped it in v1.12.0 and production
  runs 1.14.0, so a current CLI build no longer risks that against Brevo-run
  environments.
- **`?location=` and the locations shape — confirmed from the deployed BEX-361 handlers.**
  The filter is honoured (unknown value 400s listing valid locations), the locations
  endpoint answers `{ locations, count }`, and row order is deterministic. The CLI's
  unfiltered retry and bare-array tolerance are kept deliberately, not pending.
- **Install/uninstall transport — settled 2026-08-06, commands renamed 2026-08.** One
  resource, not two routes: `POST /v3/app-store/apps/{id}/installs` to install, `DELETE`
  on the same path to remove (app-store-backend PR #717, BEX-362 / BEX-364). Same body on
  both. The commands were `deploy` / `rollback` until 2026-08; they are named for the
  install resource now, and the wire field `deploy_client_id` keeps the server's old
  vocabulary and must not be renamed.
- **The account identifier — settled.** Both body identifiers are Go `int64` and the handler
  decodes the body *before* reading `X-Sib-Client-Id`, so a UUID in either field is a decode
  failure (400) that kills a request the header would have resolved. `toNumericIdentifier()`
  yields `undefined` for anything non-numeric and `pick()` drops the key; the server resolves
  `client_id` from the header and defaults `deploy_client_id` to the caller. Do not "tidy"
  this into `Number()` (NaN → null → also a decode failure), and do not send a UUID as a
  string "to let the server decide" — it cannot, it 400s first.
- **`owner_user_id: 0` on UI-app records — not a bug.** The field is OAuth-service-owned;
  bo-be populates it from the OAuth response body, and an app with no linked OAuth credentials
  has no such body. A UI app has no OAuth record by construction, so `0` correctly reads as
  "there is no OAuth owner here".
- **Slot-name validation belongs to the server.** The local `EXTENSION_POINTS` mirror was
  deleted rather than kept in sync: a copy can only lag the registry, and it failed in both
  directions. `validateSurfacePoint` is shape-only, and `validators.test.ts` asserts an
  unregistered name passes it — that test exists to fail if someone adds an allow-list back.
- **Labelling the header-menu entry from `label` is a Brevo-side rendering change.** Until it
  ships a partner can author a `label` the menu does not yet show. The CLI is the producer and
  is ready; nothing is blocked on it.
- **The pre-GA blocking items all landed.** BEX-361 (the surface-points reads) shipped and
  its contract is confirmed from the deployed handlers; the BEX-350 registry is seeded on
  prod with both identities per row; and the unified create payload is accepted live —
  create carrying `ui_app` and no `auth` answers `201` and the block round-trips. What
  blocks the UI-apps release now is the ship list at the top of this Part, not these.
