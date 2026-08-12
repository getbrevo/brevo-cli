# Public apps and UI apps — deferred release notes & outstanding work

**Status: not released. Do not publish any of this as-is.**

Two halves. **Part 1** is the release copy, held until GA. **Part 2** is everything still
open on the two features — consolidated from `TODO.md`, `QA-TESTCASES.md`,
`RELEASE-CHECKLIST.md` and the three `BEX-290-*.md` working notes, which were deleted once
their durable content landed here.

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

# Part 1 — release copy (hold until GA)

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

**Bootstrap refuses a UI app the platform returns no `ui_app` block for.** A config written
without the block reads as a valid *OAuth* app (the block's presence is the app-type
discriminator), so the command refuses rather than writing one. A half-configured OAuth app —
client ID issued, no callbacks yet — is unaffected and still bootstraps. (This is the third
refusal in `app scaffold`'s bootstrap mode; the other two ship today and are already in the
`2.1.0` notes.)

This is an **edge case, not the ordinary post-create state** — an earlier version of this note
said the platform stores the block only from an upload snapshot, which is false. bo-be's CLI
create handler writes an `app_versions` row carrying the block inside the create transaction,
and `GET /cli/apps/{id}` serves it from that snapshot, so a UI app created through this CLI is
recoverable immediately with no upload. See *Platform-side asks* for the code references.

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

---

# Part 2 — outstanding work

Nothing below blocks *this* release — the build-time gate is what makes that true. It
blocks GA.

**This half is the open-questions log; `RELEASE-CHECKLIST.md` is the GA runbook.** Keep
them apart: this answers *what is still unknown*, that answers *what to do on the day*.
When an item here resolves, delete it; when it becomes a release step, move it there.

## Blocking — settle before either feature ships

- [ ] **The unified create/upload payload needs the matching server-side change.** The CLI
      sends create with OAuth fields nested under `auth`, and upload with `version` rather
      than `app_version`. `POST /v3/app-store/apps` is live in production, so the endpoint
      must accept the nested block before the gate is opened. Tracked on BEX-355.
- [ ] **BEX-350 requires a coordinated release.** The UI kit, the reseeded extension-point
      registry and the backend must land together. A CLI authoring `.widget` / `.action`
      names against a `.region`-era registry produces extensions that render nothing, with
      no error anywhere.
- [ ] **UI-app creation is unusable until BEX-361 ships.** The placement prompts read the
      live registry and abort with an actionable error if that read fails. The gate hides
      this from end users rather than fixing it.

## Platform-side asks — raised, not CLI fixes

- [ ] **Echo `ui_app` on `GET /v3/app-store/apps`.** Confirmed by code and observed live
      (2026-08-11): the list response carries no `ui_app` — `applyIdentityFields` sets only
      `app_id`, `name`, `distribution_type`, `version`, `display_version`. So `app list` can
      identify a UI app but not show what it does; every UI-app row stops at `Version:`. Two
      consequences: the detail rows in `printUiApp` (`src/commands/app/list.ts`) are
      unit-tested only, and type detection falls back to a heuristic (`isUiAppRecord` in
      `src/lib/config.ts` — no `client_id`, no callbacks). Both the fallback and its comment
      go once the block is echoed. The alternative if the platform declines is an N+1
      per-app read, which is worse.
- [x] **The create→read-back 404 does not reproduce — but RETEST WITH A UI APP before
      removing the fallback.** Checked against staging 2026-08-12: `POST /v3/app-store/apps`
      returned `201` and `GET /v3/app-store/apps/{id}` immediately after returned `200` with
      the full app. The 404 reported on 2026-08-07 was for a **UI app**; this check used an
      OAuth app, so it narrows the report rather than disproving it. Retest with a UI app
      before deleting `fetchAppContext`'s `fallbackApp` or `resolveAppCredentials`'s
      `tolerateMissing` — if a UI app still 404s, the read path excludes an app with no
      `auth` block and it belongs on app-store-backend.
- [ ] **`surface_point_name` has no unique constraint, and the stamp inherits that.**
      app-store-backend's own comment (`http_get_apps_extensibility.go`, `slotName`) states
      it: a slug is `<page>-<section>` with the component KIND dropped, and the column has no
      unique constraint, so two kinds on one section resolve to whichever row the lookup
      reaches first. bo-be's `FindByNames` returns a map keyed by slug, so a duplicate
      collapses and `stampExtensionPointNames` stamps an arbitrary one. **Latent, not live** —
      the twelve seeded rows have twelve distinct slugs today. Fix with a unique constraint,
      or by making the authored identity carry the kind. Do one before a thirteenth row is
      seeded.
- [x] **RESOLVED (2026-08-12) — `POST /v3/app-store/apps` DOES write an `app_versions` row,
      and it does read the `ui_app` block.** Confirmed by reading app-store-bo-be, not by
      observation:

      - `persistCreateResultTx` (`cmd/app-store-bo-be/http_cli_create_app.go`) inserts an
        `app_versions` row **inside the create transaction**, at
        `initialAppVersion = "0.0.1"`, with `Snapshot.UIApp = params.uiSnapshot` — so the
        authored block is stored at create time, alongside `Name`, `LogoLink` and
        `DistributionType`. The OAuth half of the snapshot is added only when `auth` was
        provided, which is why a UI app stores cleanly with no OAuth block.
      - `uiSnapshot` is populated from the create request body on the public-apps flow
        (`http_cli_create_app_public.go`), and the handler gates on it explicitly
        (`gateAndCheckUIApp`), so the endpoint does branch on the block rather than
        ignoring it.
      - `GET /cli/apps/{id}` serves it straight back off the latest snapshot:
        `resp.UIApp = uiAppResponseFromSnapshot(snap.UIApp)` (`http_cli_get_app.go`).

      **Consequence, already applied to the CLI.** The bootstrap refusal
      (`recoverableFromRecord` for the UI type, surfaced as
      `APP_SCAFFOLD_BOOTSTRAP_UNRECOVERABLE`) was written on the belief that the platform
      stores `ui_app` *only* from an upload snapshot, so that a created-but-never-uploaded
      UI app could not be recovered. That belief was wrong: such an app **is** recoverable
      immediately, with no upload. The guard itself is still right — a record with no
      block genuinely has nothing to bootstrap from, and writing a config without it would
      read as a valid OAuth app — but it is an **edge case** (an app predating the handler,
      or created outside this CLI), not the ordinary post-create state. The message and its
      comment were corrected to stop asserting the false cause; the guard was kept.

## Wire contracts still assumed

Each is marked in a comment at its call site.

- [ ] **HTTP 422 for deploy's "not uploaded" does not exist.** Verified against
      app-store-backend `origin/main` (prod image 1.5.0): the installs handler
      (`http_create_integration_details.go`) resolves the app by UUID, checks the plan and
      inserts — no configured/uploaded check on the path, so deploying a never-uploaded app
      answers `201` and renders nothing. `assertUploadedBeforeDeploy()` is therefore the
      **only** gate and must hold for every resolution path. The `422` branch in `deploy.ts`
      is dead-but-deliberate defence and is commented as such — don't delete it as dead code,
      and don't weaken the local check on the belief the server will catch it.
- [ ] **The `type === 'corporate'` discriminator on `/v3/account/info`.** Account resolution
      branches on it. It lives on the account API, not in either app-store repo, so reading
      app-store code cannot settle it. Typed optional; an absent or unknown value degrades to
      the plain branch (deterministic, no prompt), so a wrong guess surfaces as a master
      account deploying into itself.
- [ ] **Whether the install `POST` response carries an ID worth surfacing.** It returns
      `{brevo_integration_id, installation_id}` (same value twice); the CLI discards both,
      fine while rollback addresses the install by account rather than by ID.
- [ ] **Confirm `?location=` is honoured** on `GET /v3/app-store/surface-points`, and that an
      unknown value 400s rather than being silently ignored. Until then
      `fetchSurfacePointsForPages` keeps an unfiltered retry: the narrowed read is the only
      row read in the flow, so an early build that 400s on the filter — or honours only the
      first CSV value — would abort or silently drop pages after the partner has already
      answered the page prompt.
- [ ] **Confirm the locations endpoint's response shape** (`{ locations, count }`) and whether
      it takes a filter of its own. `fetchSurfacePointLocations` tolerates a bare array
      alongside the wrapped shape; that tolerance goes once confirmed.
- [ ] **Drop the pre-BEX-361 row-name aliases** in `appService.fetchSurfacePoints`
      (`extension_point`, `location`, `place`, `kind`, `supported_extension_types`) once the
      real shape is confirmed. They exist only because keying strictly on either candidate
      naming would fail closed against the other — every row dropped, and the partner told
      the registry "has not been seeded".
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

## UX decisions — open, and each a choice rather than a bug

- [ ] **What `brevo app credentials` should do for a UI app.** It no longer crashes, but
      prints `Client ID: ` (blank), `Client secret: [hidden — …]`, `Scopes: (none)`,
      `Redirect URLs: (none)` — a credential form with nothing in it, because a UI app has no
      OAuth credentials. Options: refuse with a typed message naming the app type (consistent
      with how `app scaffold` handles a UI-app project), or render a UI-app view the way
      `app list` does. The same call is needed for `--json`, which returns empty strings and
      arrays for all four fields.
- [ ] **Whether the created-app box and the `app upload` diff should render a friendly
      placement label** (`Header "More" (•••) menu — menu entry`) instead of the raw
      `surface_point_name` slug they print today. Both print the authored value, and the
      authored value became the slug when `surface_point_list` moved off the dotted name.
      Neither call site holds the registry row at print time, so this needs a lookup, not a
      formatting change.
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

- [ ] **`iframeExtension` prompt authoring** — parked 2026-08-03. The CLI stays
      actionLink-only until the iframe-embed RFC (trust handshake, JWT, postMessage) lands;
      the delivery-path prompt was removed. A hand-edited `iframeExtension` block still
      validates and uploads, and the platform still accepts it. When the RFC lands, restore
      the prompt plus `permittedUrls.iframe` handling — the postMessage origin allowlist is
      what makes the modal secure.
- [ ] **`permittedUrls` is scaffolded empty** and never validated or populated from
      `ui_app.redirect_link`. Harmless for action links (they open a new tab); load-bearing
      for `iframeExtension` modals.
- [ ] **No local dev story for a UI app.** `brevo app start` has no UI-app equivalent, so a
      partner cannot preview an action link without deploying to a real account. Worth a
      local harness that renders the action menu and forwards context params to the external
      URL.
- [ ] **Per-placement `label` / `more_info` / `redirect_link`.** One set is shared across every
      chosen placement, so an app cannot say *menu entry → link X* alongside *sidebar card →
      link Y*. The nested `surface_point_list` makes this cheap to add later — per-entry text
      would be new fields on an existing object rather than a reshape.
- [ ] **Per-entry context narrowing is structural only.** Every registry row carries the same
      default today, so every authored entry gets an identical list, and the upload endpoint
      does not yet validate context per entry. The shape is forward-compatible; nothing
      enforces narrowing anywhere yet.
- [ ] **Surface the per-slot context allow-list read-only** (e.g. in the create summary) so a
      partner knows which params their URL will receive without a failed upload.

## QA gaps

`QA-TESTCASES.md` is the manual plan for the whole branch. Its public-app and UI-app
sections have drifted, and QA would file passes as failures:

- [ ] **`yarn smoke --against=local` builds the wrong artifact, and fails silently.**
      `stepReinstall` (`scripts/smoke/core.ts`) runs `yarn build`, which since BEX-405 is
      the **public** build — so `app submit` / `status` / `withdraw` / `deploy` /
      `rollback` are not in the binary the suite then tests. The harness turns a missing
      command into a *skip* rather than a failure (`requireCommand()`), so the public
      suite reports `⊘ skipped` on every step and the run **exits green having tested
      nothing**. That is worse than a red run: it looks like coverage.

      **Fix is one line** — `execOrThrow(PKG_YARN, ['build:preview'], state)` instead of
      `['build']`. The gated suites exist to exercise gated commands, so the artifact they
      install has to be the preview one.

      **`--against=published` needs no change.** It installs from npm, where those commands
      genuinely are absent, so skipping is the correct and honest outcome there.

      **Convention to hold going forward:** the public-app and UI-app suites are run
      against a **preview build only** (`PREVIEW=1 yarn link:dev`, or `--against=local`
      once the line above is fixed). Everything else runs against either build. This is
      the same split `QA-TESTCASES.md`'s preamble now states for the manual plan.

- [x] **The public-app and UI-app suites cannot run against a published build** — noted at
      the top of the file and on suites 2 and 12. Every notice now says `PREVIEW=1 yarn
      link:dev` and states explicitly that no account or env var unlocks a published
      build; the earlier `@brevo.com` / `BREVO_ENABLE_PREVIEW=1` wording was left over
      from the interim runtime gate.
- [ ] **No suite covers the gate itself** — that a published build hides the commands, refuses
      `--distribution public`, and ignores `BREVO_ENABLE_PREVIEW`. Automated coverage exists
      (`src/__tests__/lib/preview.test.ts`, `preview-gate.test.ts`, plus the build's own output
      assertions), so this is a nice-to-have.

## Known limit of the build gate

- [ ] **Object-literal properties survive elimination.** esbuild cannot prune a property from
      an object literal, so anything reached as `OBJECT.KEY` stays at zero references. In a
      public build that leaves `CLI.APP_DEPLOY` / `APP_ROLLBACK` / `APP_SUBMIT` /
      `APP_WITHDRAW`, the `/withdraw` and `/installs` entries in `ENDPOINTS` (both
      `src/lib/constants.ts`), and `appService`'s `deployApp` / `rollbackApp` / `withdrawApp`
      (`src/services/app.ts`). All inert — no command reaches them, no help lists them.
      `src/lang/preview-messages.ts` is the pattern that fixes this class if the residue ever
      matters.

## Resolved — kept for the reasoning

Decisions that look re-openable but aren't.

- **Deploy/rollback transport — settled 2026-08-06.** One resource, not two routes:
  `POST /v3/app-store/apps/{id}/installs` to install, `DELETE` on the same path to remove
  (app-store-backend PR #717, BEX-362 / BEX-364). Same body on both. The commands are named
  for the partner-facing verb; the resource is an install.
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
