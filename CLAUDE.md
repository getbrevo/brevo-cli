# CLAUDE.md — Brevo CLI

## Project

Brevo Developer CLI (`@getbrevo/cli`) — create, manage, and test OAuth integrations from the terminal.

- **Language:** TypeScript (CommonJS, ES2022 target)
- **Runtime:** Node.js >= 20.15.0
- **Package manager:** Yarn >= 1.19.1
- **Public CLI reference:** https://developers.brevo.com/docs/cli-reference — keep behaviour, flags, and exit codes in sync with this page when changing user-facing commands.

## Public app distribution is not GA — the published build omits it (BEX-405)

Public app distribution is **not live on the Brevo platform**. The repo contains the whole surface — `brevo app create --distribution public`, `brevo app submit`, `brevo app status`, `brevo app withdraw` — but a **published build does not**: `scripts/build.mjs` eliminates the review-lifecycle commands from the bundle, and `--distribution public` is refused with a typed `CliError`.

**This does not restrict work in this repo.** Building, changing, testing, and QA-ing the public-app code paths is expected and unblocked — write the code, run the commands, create public apps against test environments. Build with `PREVIEW=1 yarn link:dev` (or `yarn build:preview`) and the full surface is there. Never refuse or hedge on a public-app task in this repo.

- **The guard is the build, not the docs.** This replaced a documentation-only notice (and then a runtime check). `agent-context/SKILL.md` and `AGENTS.md` no longer carry a *⚠️ not available yet* section or an *Exception — internal Brevo accounts* clause; they carry one rule instead — `brevo --help` is the complete surface. Don't reintroduce prohibition prose: an agent can't be led into a command that isn't in the binary.
- **There is deliberately no runtime escape hatch.** The earlier gate unlocked on an `@brevo.com` account or `BREVO_ENABLE_PREVIEW=1`; both are gone. A compile-time guard any user can switch back on is a runtime guard wearing a costume, and it has to ship the surface in order to reveal it. Internal testing is a different artifact, not a different flag. **Do not add one back.**
- **Two layers, no soft middle.** The build removes the surface; the Brevo API refuses public-app creation independently (`400 invalid_parameter`). There is no longer a client-side check for a user to talk past, so the old "guardrail, not a security boundary" caveat no longer applies.
- **`src/lib/preview.ts` → `FEATURE_STAGE` is the single source of truth** for what is gated. Flipping a row to `'ga'` is necessary but **not sufficient** for a command: gated command definitions live in `src/commands/preview-definitions.ts` and are referenced from behind `__BREVO_PREVIEW__`, a *build* flag, so a GA feature left in that module is still eliminated. See the GA runbook (`RELEASE-CHECKLIST.md` on `feature_set-brevo-cli-v2`) → *Before public-apps GA* for the full sequence.
- **When public apps go GA**, work through the runbook's *Before public-apps GA* section in one pass.

## UI apps are GA — they ship in every build (BEX-290)

UI apps (action links that render inside Brevo CRM records) are **out of the pre-GA gate**: the *UI app* choice at `brevo app create`'s app-type prompt, `brevo app install [account-id]` and `brevo app uninstall [account-id]` all ship in the published build. `FEATURE_STAGE['ui-app-type']` and `FEATURE_STAGE['account-install']` are `'ga'`, the two command definitions live in `src/commands/definitions.ts` (not `preview-definitions.ts`), their strings live in `src/lang/en.ts` (not `preview-messages.ts`), and their names are gone from `LEAK_MARKERS` in `scripts/build.mjs`. Only the public-apps surface above remains gated.

Everything below in this section is durable technical reference for the `ui_app` contract and stays load-bearing.

**The `ui_app` block IS the app snapshot the platform stores, field for field.** Field names are confirmed against both of its consumers — the manifest read path and the extensibility UI kit (BEX-308 / BEX-350). Do **not** reintroduce the UIApp Support Spec's `properties`/`trigger` vocabulary: nothing on the platform reads those names.

Five consequences worth knowing before touching this code:

- **A slot has TWO names, and `surface_point_list` takes the slug one.** Each registry row carries a dotted `extension_point_name` in the BEX-350 grammar `<location>.<place>.<kind>` (`contactDetails.headerMenu.action`) AND a `surface_point_name` slug (`contactDetails.header.menu`), 1:1. **The slug is dot-notation too** — a 2026-08-18 registry migration renamed the slugs from kebab-case (`contact-details-header-menu`) and rewrote the stored snapshots in the same transaction (verified applied on prod 2026-08-24), so the two identities are now easier than ever to confuse: same style, different segmentation, and only the slug is authorable. The CLI needed no code change for the rename (it prompts from the registry and validates shape only); PR #64 updated its examples and comments. An authored entry's `surface_point_name` is the **slug** — the entry key is named for the registry column it is matched against, which is the whole point of the name. The spelling `surface_point` is used nowhere: not as an authored key, not as a hint, and not on the registry response, whose row field is `extension_point_name`. `app upload`'s `checkExtensionPoints` resolves it with `FindByNames`, a `WHERE surface_point_name = ANY(...)` read, and app-store-backend's manifest path resolves it the same way before serving the row's *dotted* name to the frontend as `extensionPoint`. bo-be also **stamps that dotted name onto its stored copy of the entry** as `extension_point_name`, so the snapshot records both identities; it is server-derived and deliberately never echoed, so it must not appear in `app-config.json` (same handling as `link_target`). The dotted form is therefore what renders and what every spec quotes, which makes it the natural thing to author — and authoring it 400s with `ui_app.surface_point_list contains unregistered extension point(s)`. The CLI carried exactly that bug until it was fixed by keying `buildSurfacePointList` on `surface_point_name`; the create tests keep the two identities as distinct strings so a fixture can never make either one pass by accident. A row the registry gives no slug for is dropped from the prompt (`toUsableRows`) — the column is nullable and the platform's lookup skips a NULL, so such a row could only author a placement its own upload rejects.
- **Extension-point names fail silently, and the registry is the only authority on them.** The UI kit matches by exact string equality and the platform *drops* a name with no registry entry — an empty slot, a 200, no error. **Do not reintroduce a local list of valid slot names.** `src/lib/constants.ts` used to mirror the platform's twelve `extension_points` rows so `app upload` could pre-flight offline; that mirror was removed because a copy can only lag the registry, and it failed in both directions — rejecting a slot the platform had added, passing one it had removed. Both paths now read the real thing: `app create` prompts from the registry over two reads that ask different questions — `GET /v3/app-store/surface-points/locations` for the record pages (`{ locations, count }`, no rows), then `GET /v3/app-store/surface-points?location=<csv>` for the placements on the pages that were picked, which is the only row read in the flow — and `app upload` sends the block for the upload endpoint's `checkExtensionPoints` to validate against `extension_points`, which 400s naming every offender. `validateSurfacePoint` is deliberately shape-only (non-blank) and `validators.test.ts` asserts an unregistered name passes it — that test exists to fail if someone adds an allow-list back. Note the page prompt cannot be extension-type-aware (a location list carries no `extension_type_list`): a page whose every placement is un-hostable is offered, and the surprise surfaces only at the row read — since BEX-426 made the page prompt single-select, that dead end is an abort with the precise error (`APP_CREATE_UI_POINTS_NONE_FOR_TYPE` vs `_EMPTY`), no longer a skip-with-warning, because there are no other picked pages left to continue with.
- **`label` and `more_info` are the two authored text fields, each renders in two places, and both live PER ENTRY (BEX-426).** `label` is the menu entry's text on an `.action` slot and the CTA button on a `.widget` slot's card; `more_info` is the menu entry's `subText` and the card's description. They were named `heading`/`subheading` before BEX-290 — `validateUiApp` rejects the old names with a migration hint rather than aliasing them. BEX-426 moved them, plus `redirect_link` and `modal_iframe_url`, from the `ui_app` root into each `surface_point_list` entry, so an app on three slots can label each differently and deep-link each somewhere else — the same move `context` and `size` already made, for the same reason. **Hard move, no root fallback:** `validateUiApp` refuses the root spellings by name with a migration hint (`rejectRootCtaFields`), the server does the same (`rejectSupersededUIAppKeys` in bo-be), and every per-entry violation names its entry (`ui_app.surface_point_list["<slug>"].label: …`). `link_target` followed them per entry (see its own note below), which leaves **`extension_type` as the only field at the root** — don't move it: a per-entry `extension_type` would let one app be two kinds at once.
- **The only rendered text with no field is a *card's title*, which is the app name.** Don't add a field for it. Also still absent, and not to be added back: partner-declared `contextProperties` — record context is an allow-list on the registry row, chosen by the platform, and an entry's `context` can only narrow it. (An earlier version of this file said there was no per-action label at all. That stopped being true with BEX-290's `label`: the menu entry is labelled from it, which is a rendering change in the UI kit, not just a rename.)
- **`link_target` is not a field in `app-config.json`, and it lives PER ENTRY on the wire.** `brevo app upload` injects `_blank` onto every `actionLink` entry (`withInjectedLinkTargets`); `brevo app create` never writes it; the write-back strips it from the server's echo and the upload diff normalizes it away on both sides. There was never a choice to make — the server refuses `_self` — so a field in the file only invited a partner to edit it into a value that 400s. If you re-add it to the file, you must also undo all three of those.

  It moved off the root as the last part of BEX-426, one PR behind the other four, because it qualifies a per-entry destination: it says where THAT entry's `redirect_link` opens, so a root copy could only ever say one thing about every slot. The move is what the read path already assumed — app-store-backend's `snapshotSurfacePoint` binds `link_target` per entry and treats the entry as its only source, with no root fallback — so while bo-be still stored it at the root, the value it stored was never read; serving stayed correct only because `_blank` is simultaneously the one legal value and the reader's default for an `actionLink`. Three consequences: `validateUiApp` refuses the **root** spelling by name (hint is *remove it*, not *move it* — the CLI has never wanted this field in the file), a per-entry value is checked against `UPLOADABLE_LINK_TARGETS` and refused outright on an `iframeExtension` entry, and bo-be defaults an omitted entry value in `applyEntryLinkTarget` rather than leaving it to a reader.

  **Sequencing:** the per-entry key is a 400 (`unknown key`) on a bo-be that predates its side of the move, since `uploadUIAppSurfaceKeys` reflects over `uiAppSurfacePointRequest`. Any build pointed at an un-updated environment will fail on `app upload` of a UI app.
- **`modal_iframe_url` is gated on `extension_type`.** The UI kit keeps it only for `iframeExtension`, so the CLI rejects it on an `actionLink` rather than letting a partner ship a URL that never opens.

**`extension_type` values are camelCase (BEX-350): `actionLink`, `iframeExtension`, `legacyComponent`.** The source of truth is `FEATURE_TYPES` in the extensibility UI kit. The pre-BEX-350 snake_case spellings are **deliberately not accepted** — the kit still maps them for consumers, but that map is slated for removal once every producer emits camelCase, and the CLI is a producer. There's no config in the wild to migrate while the feature is in development, so there is no alias map and no normalize-on-read; `validateUiApp` simply rejects `action_link`. Note the *frontend's* legacy `link_target` default is still gated on the literal `"action_link"`, so it no longer fires for CLI-authored apps — harmless, because `app upload` injects `link_target` explicitly per entry, bo-be defaults an omitted one in `applyEntryLinkTarget` (selected by the camelCase type), and the kit defaults it client-side too.

**`app create` authors ONE placement, and that is the CLI's rule, not the platform's (BEX-426).** The page prompt is a single-select `list` and the placement prompt on that page is another (`placement:<location>`), so the flow authors exactly one complete `surface_point_list` entry — its slot, seeded context, label, optional `more_info`, and destination. One page rather than the old multi-select because the CTA fields are per-entry now: N placements would mean re-asking three questions per placement. **More placements are hand-authored in `app-config.json`** as further `surface_point_list` entries (each with its own label and URL) and pushed with `brevo app upload` — the created-app box's hint says exactly that, so don't drop it. The platform is looser on the wire: `validateSnapshot` rejects only a *duplicate* slot, so a hand-edited config with several entries — even two spots on one page — uploads fine. Don't "restore" a multi-select to match the wire; the earlier grouped multi-select also carried a prompt-lock bug (a page the registry offered nothing on could not satisfy its own validate), and the per-page-prompt flow that replaced it, plus its dropped-pages warning, went away with the single-page change.

**A UI app is prompt-only — there is no `--type` flag and no per-field flags.** `brevo app create` asks the app type first; a UI app can only be authored from an interactive terminal, so every non-interactive run (`--json` or piped stdin) creates an OAuth app, exactly as before BEX-290. This is deliberate: a scriptable create surface would invite pipelines to pin to a shape that can still change. Don't add flags back without revisiting that.

**Wire contracts — what is confirmed and what is still assumed.** The upload contract is confirmed against the platform's CLI upload endpoint: the block travels under the `ui_app` key on `POST /v3/app-store/apps/{id}/upload` (the earlier `snapshot` key was rejected server-side; "snapshot" on the platform names the whole stored app config).

**The block travels on `POST /v3/app-store/apps` (create) too, under the same key.** It used to be upload-only, on the reasoning that create merely registers the record while upload is the platform's validation authority for the configuration. That was wrong in one specific way: `ui_app` is the app-type discriminator on the wire exactly as it is in `app-config.json`, so a create that omits it *and* omits `auth` (as a UI app must — an action link has no OAuth callback) reads as an OAuth app that forgot its callbacks, and the endpoint answers `400 invalid_request` / `redirect_uris is required and must not be empty`. The two blocks are mutually exclusive on both requests: a UI app sends `ui_app` and no `auth`, an OAuth app sends `auth` and no `ui_app`. Upload still sends the block and remains the validation authority; create sends it so the record is created as the right type. **Confirmed against the deployed handler** (`http_cli_create_app_public.go`, bo-be `origin/main` at prod image 1.7.0): the presence of `auth` *or* `ui_app` is literally what selects the contract — `isPublicAppsRequestBody` sniffs for those two keys, a body carrying neither routes to the legacy flat-OAuth flow, and `validatePublicAppsBlocks` then enforces "at least one of auth or ui_app". So the discriminator is the same on the wire as it is in `app-config.json`, and the endpoint both branches on the block and persists it.

**A created app is immediately readable as a UI app — create writes the snapshot, not upload.** `persistCreateResultTx` (`http_cli_create_app.go`) inserts the initial `app_versions` row **inside the create transaction**, and that row's snapshot carries the `ui_app`; `GET /cli/apps/{id}` then serves it straight back via `applyLatestVersionFields` → `uiAppResponseFromSnapshot`. Verified against app-store-bo-be, 2026-08-13. **An earlier version of this file said the server "only learns about `ui_app` on `app upload`" — that was true before create accepted the block and is false now.** It had been used to justify two things, both of which have been re-grounded rather than deleted: `create` passes its `ui_app` to `fetchAppContext` (still right, but because a re-read is the *wrong source* — `fetchAppContext` ignores `appDetails.ui_app` so stale server data can't reclassify an app — not because the server lacks it), and `recoverableFromRecord` refuses a blockless record (still right, but because the CLI's own classifier can label a blockless record `ui` — see that guard's own note above). Don't reintroduce the "upload-only" claim.

**`client_secret` is retrievable after create.** `GET /cli/apps/{id}` is a credential-reveal endpoint: `cliOAuthAppResponse` carries `client_id` *and* `client_secret`, fetched from the OAuth service by the app's stored `oauth_id`. The local cache in `~/.brevo/credentials.json` is a convenience and a round-trip saver, **not** the only copy — the comment at `createApp`'s call site once implied otherwise.

**The create response echoes that nesting back**, which is the one thing this design costs: credentials arrive as `auth: {client_id, client_secret, scopes, redirect_uris}`, not at the top level. `createApp()` lifts them in `flattenCreateAuth` so no call site has to know — see BEX-405, which is what happens when they aren't lifted. The response is a closed struct of `{app_id, name, logo_uri, version, distribution_type, auth?, ui_app?}`: there are **no timestamps on it**. `link_target` *is* echoed now, on each `surface_point_list` entry — it stopped being the one withheld field when it moved per entry, and `uiAppResponse` became a plain alias of `uiAppRequest` because the two then carried identical keys. The CLI still strips it before the write-back, so the echo never reaches `app-config.json`. The install transport is confirmed too, and it is **one resource, not two routes** — `POST /v3/app-store/apps/{id}/installs` to install and `DELETE` on the same path to remove (app-store-backend PR #717, BEX-362/BEX-364). Both carry the same body: `client_id`, `deploy_client_id`, `name`, `is_developer` — of which only `name` and `is_developer` are always present, see below. The `install` / `uninstall` commands are named for the resource itself (they were `deploy` / `rollback` until 2026-08); the wire field `deploy_client_id` keeps the server's old vocabulary and must not be renamed.

**`client_id` and `deploy_client_id` are not interchangeable.** `client_id` is the *caller* — the account that owns the app, which the server resolves it against via `FindIDByUUID(uuid, client_id)`; the CLI sends the authenticated account's `organization_id` (`getOrganizationId()` in `src/lib/config.ts`, read by `buildInstallPayload()` in `src/services/app.ts`). `deploy_client_id` is the *target* the install lands in, and the server falls back to `client_id` when it is absent. They differ only for a corporate install into a sub-account — collapsing them 404s the app lookup.

**Both body identifiers are optional, and a non-numeric one is omitted rather than sent.** Brevo identifies accounts numerically in some places (a sub-account listing's `id`) and by UUID in others (`organization_id` may be either), but both fields are Go `int64` and **the handler decodes the body before it reads `X-Sib-Client-Id`** — so a UUID in either field is a decode failure (400) that kills a request the header would have resolved fine. `toNumericIdentifier()` therefore yields `undefined` for anything non-numeric and `pick()` drops the key. Omission loses nothing: the server resolves `client_id` from the gateway-populated header, and defaults `deploy_client_id` to the caller — which is exactly right for the only case that can produce a non-numeric target, a plain account installing into itself.

Do **not** "tidy" this into `Number()` on everything (`NaN` → `null` → also a decode failure), and do **not** send a UUID as a string "to let the server decide" — it cannot, it 400s first. Confirmed against staging: a working `DELETE .../installs` sends `{deploy_client_id, is_developer}` with **no `client_id` at all**. `getCallerAccountId()` is the separate display/target path and does keep a UUID intact; only an absent/blank org ID throws there. `parseAccountId()` is a third contract and stays numeric-only — it validates the explicit `[account-id]` positional, whose real-world source is a sub-account `id`. Coverage in `__tests__/services/app.test.ts`.

**DELETE answers 404, not 422**, and for both "app doesn't exist" and "no such install" — the developer uninstall route has no `installation_id` to delete by, so it resolves the install from the body and can't distinguish the two in the status code. `uninstallApp()` therefore deliberately skips `rethrowNotFound` and `app uninstall` maps *any* 404 to its informational not-installed path (exit 0). Do not "fix" that by matching on the server's error copy.

**Install has no server-side upload gate — the CLI's is the only one.** The assumed `422 app_not_configured` for "installed before it was uploaded" **does not exist**: app-store-backend's installs handler (`http_create_integration_details.go`, verified on `origin/main` at prod image 1.5.0) resolves the app by UUID, checks the plan, and inserts. There is no configured/uploaded check on the path, so installing a never-uploaded app answers `201` and renders nothing. `assertUploadedBeforeInstall()` therefore has to hold for *every* resolution path, not just the linked-project one: a linked project is answered from `app-config.json`'s `version` (no round trip), and `--app-id` / the picker read the app's server-side `version`. Do not weaken it back to a "pre-flight" on the belief that the server will catch it — and if a server-side check does land, keep the local one, because it is what avoids a wasted install. The 422 branch in `install.ts` is kept as dead-but-deliberate defence; its comment says so.

Also confirmed on that endpoint: **the body's `client_id` is ignored whenever the gateway sets `X-Sib-Client-Id`** — `extractClientID` reads the header *first* and only falls back to the body. That is why omitting a non-numeric identifier is safe rather than merely tolerable. The POST response is `{brevo_integration_id, installation_id}` (both the same value); the CLI discards it, which is fine while uninstall addresses the install by account rather than by ID.

The `type === 'corporate'` discriminator on `/v3/account/info` that account resolution branches on was the last assumed wire contract, and it is now **verified** — confirmed against a live corporate account on 2026-08-21. It lives on the account API, not in either app-store repo, so reading app-store code could never settle it; a corporate account did.

**`[account-id]` is optional on both commands.** Omitted, the target resolves from the authenticated account: a plain account installs into itself (no prompt, so `--json`/CI still work), a corporate account picks from `GET /v3/corporate/subAccount`. Resolution lives once in `resolveInstallTarget()` (`src/commands/app/account-install.ts`) and both commands inherit it. The explicit positional is checked first — it keeps CI unchanged and is the only way to reach an account the listing won't show, notably a deactivated sub-account.

**There is no install listing, which is why the upload warning is unconditional.** The platform exposes no read for "which accounts is this app installed in" — `POST`/`DELETE .../installs` are the whole resource the CLI can reach, and the POST response (`{brevo_integration_id, installation_id}`) is discarded. So `app upload` states the impact as a possibility (`APP_UPLOAD_INSTALLED_IMPACT`, "may already be installed") for every UI app rather than counting installs or suppressing itself when there are none: either would be an assertion the CLI cannot make. If an install-listing read ever lands, that is the moment to make the notice specific — not before. The notice prints under `--yes` too (only the question is skipped, exactly as `app delete --force` still prints its install-loss line) and never under `--json`.

**`app install` shows the SERVER's configuration, and shares one read with its gates.** The install makes the stored snapshot visible in an account, so the summary (`renderInstallSummary` in `src/commands/app/install.ts`) prints what `GET /cli/apps/{id}` answers — version, `extension_type`, every placement — never the local `app-config.json`, which may have moved on since the last upload. Two consequences worth keeping:

- **The read is one read.** `fetchInstallSnapshot()` (`account-install.ts`) performs it and `assertInstallable` takes the record via its `serverApp` option instead of fetching its own. The linked-project branch of that gate still answers from `app-config.json` — precedence unchanged, and a server record that reads as OAuth cannot reclassify an app whose local config says otherwise — but the command no longer skips the round trip in a linked project, because the summary needs it. Do not "restore" the no-round-trip path: that would put the file's copy on screen under a header that says the server's.
- **A failed read prints nothing rather than falling back to the file.** Same reasoning as the gates it shares the record with (an unavailable GET must not become a new way to fail), plus one of its own: a summary sourced locally would be a claim about the server the CLI never verified. Drift between the two is reported separately (`APP_INSTALL_CONFIG_DRIFT`) and only when the app ID came from the linked config — `--app-id` names a different app, about which the directory's file says nothing — and it is a notice, not a gate: installing an already-uploaded configuration is legitimate.

**Two blocks are compared through one normalization**, `canonicalizeUiApp` / `uiAppEquals` in `src/app-types/ui/compare.ts` (it delegates the wire-only strip to `src/app-types/wire.ts`). It was private to `app upload` until `app install`'s drift check needed the same answer; a second implementation would have drifted from this one the first time a server-stamped key was added. `app upload`'s per-field diff is `formatPlacementDiffLines` in `src/app-types/ui/fields.ts`, table-driven off the same `VALUE_ROWS` as the plain renderer so a new per-entry field cannot appear in one and not the other. It matches entries by `surface_point_name` (never by index — list order is registry order, not authored order) and falls back to plain lines when the server echoes no block at all, since an absent block is no evidence that a placement is new.

**The presence of `ui_app` is the app-type discriminator** — the `app_type` key in `app-config.json` is informational only (written by `app create` / `app scaffold`, never read for detection). **Every key in `app-config.json` is snake_case** (`app_id`, `app_name`, `logo_uri`, `app_type`, `auth.redirect_uris`, …); the camelCase spellings earlier releases wrote are folded on read by the alias tables in `src/lib/config.ts` and dropped on the next write, and `app upload` / `app scaffold` rewrite an in-sync legacy file on their no-op paths (`migrateProjectConfigKeys`) so the migration is not gated on drift. Every branch that needs to tell the two types apart goes through `isUiAppConfig()` in `src/lib/config.ts`; use it rather than testing for the key inline, so the discriminator can change in one place.

## Non-interactive (non-TTY) UI app creation — required before merging `feat/ui-app-noninteractive-create` to `main`

`brevo app create` for a UI app used to be reachable only from an interactive
terminal — any non-interactive run (`--json`, piped stdin, or an agent's
non-interactive shell tool) silently created an OAuth app instead, with no error.
`feat/ui-app-noninteractive-create` adds two non-interactive entry points,
`--ui-config <file>` and the `--ui-app`/`--record-page`/`--placement`/`--label`/
`--more-info`/`--url` flag set, both scoped to `extension_type: "actionLink"` only
(`iframeExtension`/`legacyComponent` are explicitly out of scope and rejected).
Both reuse the interactive wizard's own registry validation
(`fetchRecordPageLocations`/`fetchSurfacePointsForPages`) and `validateUiApp()` —
no local slot-name list, no new validation logic — and still create exactly one
placement per call, matching the wizard's existing one-placement rule.

**Before this branch merges into `main`, all of the following must be true — this
is a merge gate, not a nice-to-have:**

- `--ui-config` and `--ui-app` both work end-to-end and are covered by tests in
  `src/__tests__/app-types/ui/authoring.test.ts` and
  `src/__tests__/commands/app/create.test.ts` (registry-validation reuse,
  actionLink-only rejection, mutual exclusivity, missing-flag rejection,
  OAuth-flag rejection, unregistered `--record-page`/`--placement` with the
  valid-options-listed error).
- `agent-context/SKILL.md` and `agent-context/AGENTS.md` no longer state that a UI
  app "can only be authored from an interactive terminal" — both describe the new
  flags instead, per the "Keep agent docs in sync with CLI behavior" rule above.
- A changeset is present (`yarn changeset`) — this is new user-facing CLI surface.
- `yarn lint`, `yarn test:ci`, and `yarn build` are all green.
- The design spec this feature was planned from
  (`docs/superpowers/specs/2026-09-02-ui-app-noninteractive-create-design.md`) is
  deleted before merge, once implemented — it was working scratch, not a doc meant
  to live in `main`.

Don't merge partway — e.g. flags implemented but docs not updated, or `--ui-config`
shipped without `--ui-app` or vice versa. A half-shipped non-interactive path is
worse than the old all-or-nothing OAuth fallback: it would silently succeed for one
input shape and silently fall back to OAuth for the other, which is exactly the
footgun this feature exists to remove.

## Branch-local working docs — NEVER merge into `main`

The internal working docs are committed on feature branches only and **must never land
on `main`** — this repo is public, and they consolidate internal release state:

- `UI-APPS-RELEASE-STATUS.md`, `RELEASE-CHECKLIST.md`, `docs.md` and `QA-TESTCASES.md`
  on `feat/bex-416-entry-size` (this branch — the UI-apps halves)
- `PUBLIC-APPS-RELEASE-STATUS.md`, `RELEASE-CHECKLIST.md`, `docs.md` and
  `QA-TESTCASES.md` on `feature_set-brevo-cli-v2` (the public-apps halves)

Before merging any branch that carries one of these files into `main`, delete the file
from the branch first. Do not "helpfully" move their content into README, docs, or the
changelog either. (The checklist / open-questions / QA files lived on a separate
`docs/public-cli-ui-apps-feature-changes` branch until 2026-08-24; that branch is
deleted — its final pre-split state is preserved in closed PR #53.)

## Public repository — review before committing

This repo is **public** at `github.com/getbrevo/brevo-cli` and the package publishes to the **public npm registry** under `@getbrevo`. Every commit, PR title, PR description, issue, and review comment is world-readable and indexed by search engines. Treat each commit and PR as a public release.

**Never commit:**

- Real API keys (`xkeysib-…`), OAuth client secrets, refresh tokens, session tokens, or anything from `~/.brevo/credentials.json`
- `.env` files, `.brevo.json` linked-project config, real `app-config.json` from a Brevo account
- Internal infrastructure URLs, non-production hostnames, internal Slack/Confluence links, or internal Jira issue *content*
- Customer or account identifiers (real org IDs, account IDs, app UUIDs from production), names, emails, IP addresses, log dumps containing PII
- Screenshots that contain any of the above
- Internal-only design docs, RFCs, or roadmap details

**Test fixtures must use placeholders.** API keys → `xkeysib-test-…`, app IDs → fake UUIDs, hostnames → `example.com` or `localhost`, emails → `user@example.com`. Mirror the format of real values without using real values.

**PR titles, descriptions, and commit messages are public.** Reference Jira tickets by key only (`BEX-169`) — the URL maps to a private Jira so the link is fine, but don't restate private ticket content (customer names, internal incident details, security-sensitive context) in the public PR body. If a change is driven by a security fix, keep the public commit message high-level and coordinate disclosure separately.

**Before every commit:**

1. Run `git diff --staged` and skim the full diff — confirm no secrets, real customer data, or internal URLs slipped in
2. Check `git status` for accidentally staged files (`.env`, `credentials.json`, `.brevo.json`, screenshots, scratch files)
3. Confirm the commit message and any PR body would be safe to publish on a billboard

**Before every PR:**

- Re-read the title and body for internal context that doesn't belong in public
- Confirm any added test fixtures use placeholder data
- If you're unsure whether something is sensitive, ask before pushing

## Build & run

```bash
yarn install            # install dependencies
yarn build              # compile TS + copy templates to dist/
yarn link:dev           # build + yarn link for local testing
yarn dev                # watch mode (tsc --watch)
```

## Test

```bash
yarn test               # jest --passWithNoTests
yarn test:ci            # jest --coverage
```

All tests live in `src/__tests__/` mirroring the `src/` structure. Tests use Jest with `ts-jest`. Mocks go inline in test files (no shared mock directory).

## Lint & format

```bash
yarn lint               # eslint (quiet mode)
yarn lint:fix           # eslint --fix
yarn format             # prettier --write
yarn format:check       # prettier --check
```

Pre-commit hook (husky + lint-staged) runs prettier and eslint on staged `.ts` files, then runs the full test suite.

## Sonar hotspots — always fix, don't dismiss

SonarCloud runs on every PR (`getbrevo_brevo-cli`). **Treat every security hotspot it raises as an issue to fix in the same PR, not to mark as "Safe" / "Acknowledged".** This includes hotspots in test files — Sonar doesn't distinguish, and neither do we. Common patterns and the standard fix:

- **`Math.random()` for IDs, temp paths, tokens, or anything name-like** → swap to `node:crypto`. For temp directories use `fs.mkdtempSync(path.join(os.tmpdir(), 'prefix-'))`; for a random string use `crypto.randomBytes(n).toString('hex')` or `crypto.randomUUID()`. Never silence with `// NOSONAR`.
- **Hard-coded credentials / regex that looks like a secret** → use placeholders that don't match the credential format (`xkeysib-test-…`, fake UUIDs). See the public-repo rules above.
- **Insecure protocol (`http://`)** → fine for `127.0.0.1` / `localhost` loopback (OAuth callback, scope-catalog `--web` page); for anything else, use `https://`.
- **`child_process.exec` with interpolated input** → switch to `execFile` / `spawn` with arg arrays, never shell-concat user input.

If a hotspot genuinely doesn't apply, fix the code anyway when the fix is cheap (one-line swap to `crypto.*`). Only argue "Safe" in the Sonar UI when the fix would meaningfully hurt readability or correctness — and document the reason in the PR description, not just in Sonar.

## Project structure

```
src/
  bin/index.ts              CLI entry point (commander setup, error handling)
  commands/
    definitions.ts          Command/option registry (all commands declared here)
    login.ts, logout.ts     Auth commands
    init.ts, whoami.ts      Setup/info commands
    app/                    App subcommands (create, list, scaffold, start, test, update, delete, credentials)
      project-writer.ts     Shared project writer (primitives) — imported by BOTH `create` and `scaffold`
      finish-project.ts     Shared command tail (the flow) — same two callers
  services/                 Business logic (appService, accountService)
  api/                      HTTP client (client.ts)
  lib/                      Shared utilities (config, constants, errors, logger, validators, ui)
  lang/en.ts                All user-facing strings (single source of truth)
  templates/
    index.ts                Template loader + manifest
    files/*.tmpl            Scaffold templates (11 files; manifest in `templates/index.ts`)
  types.ts                  Shared TypeScript interfaces
  __tests__/                Tests (mirrors src/ structure)
```

## Key conventions

- **All user-facing strings** live in `src/lang/en.ts` — never hardcode messages in command files.
- **CLI command references** (e.g. `brevo app create`) are defined in `src/lib/constants.ts` as `CLI.*` — use these instead of string literals.
- **Commands** are registered declaratively in `src/commands/definitions.ts` — handler functions live in their own files.
- **Error handling** uses `CliError` (user-facing) and `ApiError` (HTTP errors) from `src/lib/errors.ts`. Commands are wrapped with `withCommandHandler()`.
- **JSON output** — every command supports `--json` via `jsonOutput()` from `src/lib/json-output.ts`.
- **`brevo app upload`** replaced `brevo app update` (BEX-250). It takes only `--yes` and `--json`; there are no edit flags. It pushes the whole of `app-config.json` after showing a local-vs-server diff, and writes the server-confirmed state back. To change an app's name, redirect URLs, scopes or logo, edit `app-config.json` and upload. `distribution_type` is immutable after `app create` — `APP_UPLOAD_DISTRIBUTION_IMMUTABLE` refuses locally before anything is pushed.
- **A removed command stays registered, hidden, to name its replacement.** `src/lib/removed-commands.ts` is the table; `command-registry.ts` registers each entry as a hidden command whose action throws its message, and `auth-guard.ts` exempts them so a logged-out user reaches the message rather than `brevo login`. The one entry today is `app update` → `messages.APP_UPDATE_REMOVED`. This is **not** a shim: nothing is forwarded, nothing is uploaded, and it exits `1`. Do not "clean up" the hidden command — without it Commander answers `unknown command 'update'` plus a string-distance guess, which was `create`, i.e. the CLI's own suggestion for the most likely stale invocation was to make a second app. The registration also sets `allowUnknownOption` / `allowExcessArguments` (so the removed flags reach the message instead of `unknown option '--name'`) and `helpOption(false)` (so `--help` can't print a usage screen and exit `0`), and it replaces the instance's `help()` because `brevo app help update` calls that method directly — Commander's help command does not skip hidden commands and has no hook in front of it. All four are load-bearing and covered in `__tests__/lib/removed-commands.test.ts`. `agent-context/SKILL.md` and `agent-context/AGENTS.md` each carry a migration note for it — the name may appear there **only** as removed, never as a command-table row, example or decision-tree entry.
- **Writing a project is `src/commands/app/project-writer.ts`, not a command.** `app create` and `app scaffold` both write projects, so the file-writing half — `fetchAppContext`, `resolveProjectDirectory` / `applyProjectDirectory`, `runBaseScaffold` / `runFeatureScaffold`, the reporters, `computeSlug`, `computeCdHint` — lives in its own module that both import. **The dependency runs one way** (`scaffold.ts` → `project-writer.ts`, never the reverse) and the two commands never reach each other. This was one 935-line `scaffold.ts`, which made `create.ts` read as though it depended on the `scaffold` *command*; it never did. Don't re-export the writer's surface from `scaffold.ts` to save an import — that is exactly the confusion the split removed. `scaffold.ts` keeps only what decides *which* app and *whether* to write: the drift diff, the bootstrap plan, the app picker.
- **The tail after the base project lands is `src/commands/app/finish-project.ts`.** `finishProject()` is the one place the UI-app sign-off, the feature offer, the conflict question, the feature write and its report live; `app create` and `app scaffold`'s bootstrap both call it. Two knobs carry the only real differences, and both are load-bearing: `offerFeature: false` means *don't ask at all* (what `--json` and a piped run pass — asking-and-defaulting would block), and `onConflict` is `'ask'` for `scaffold` (routinely pointed at a populated directory) but the already-known answer for `create`, which asked that exact question about that exact directory moments earlier. **The base write itself deliberately stays with each caller** — `create` must not print under `--json`, `scaffold` defers the write off a TTY, and forcing that half through one function needs more flags than it saves. Kept out of `project-writer.ts` because the two are different kinds of thing: that file is primitives (render, write, report) and knows nothing about a flow; this one asks questions and branches.
- **`brevo app scaffold` has two modes, selected by whether cwd holds an `app-config.json`.** With one it adds a feature to the linked app (the original meaning). Without one it *bootstraps* — sets the directory up for an app that already exists — which is the only path that produces a config for an existing app, and the migration off `brevo app update --app-id`. `--app-id` names the app; omitted on a TTY, the command offers (`APP_SCAFFOLD_BOOTSTRAP_CONFIRM`, default yes) and then shows `promptAppSelection`, because someone who lost their folder has the app but not its ID. The offer is interactive-only — under `--json`/non-TTY it raises `APP_SCAFFOLD_NO_CONFIG` — so scripts keep their old behaviour and a decline exits `0`. Three refusals fire before any network call, and each exists because its failure is silent rather than loud:
  - **`findEnclosingProjectDir()`** (`src/lib/config.ts`) blocks bootstrapping *inside* another project. `readProjectConfig` reads cwd and deliberately never walks up — every other command wants that — so one stray `cd` would otherwise nest a second `app-config.json` and the next `app upload` from there would push the wrong app. Do not "fix" `readProjectConfig` to walk up instead; the walk belongs only to this branch, and it excludes cwd by design.
  - **`recoverableFromRecord`** on the app-type registry blocks a record the server answered without a `ui_app` block — a config missing it reads as a valid *OAuth* app, since the block's presence is the discriminator. Asked of the type rather than tested as `!record.ui_app`, so a third type answers the same question. An OAuth app is always recoverable (its config is the record). **What makes it reachable is the classifier, not the server:** `isUiAppRecordShape` (`src/app-types/ui/detect.ts`) calls a record a UI app whenever it carries no OAuth material — no `client_id`, no `redirect_uris` — *block or no block*. So a record with neither is classified `ui` and arrives with nothing to write, which is exactly what this refuses. Do **not** reuse `isUiAppRecordShape` as the recoverability test; its fallback is right for labelling a row and wrong for deciding there is a config. **This entry used to justify the guard with a different case — "a UI app that was never uploaded" — on the belief that the read endpoint could only source `ui_app` from an upload snapshot. That case is false** (see the wire-contract note below), and correcting it is not a reason to drop the guard.
  - **the app-ID mismatch check** blocks `--app-id` against a directory linked to a different app.
- **`ui_app` wire-only keys are stripped in exactly one place**, `stripUiAppWireOnlyKeys` in `src/app-types/wire.ts`, reading `uiAppType.wireOnlyKeys`. Its three consumers are the upload diff, the upload write-back, and the scaffold bootstrap's write. That traversal used to be duplicated per consumer and had to be fixed separately each time a new server-stamped key appeared (`link_target`, then `extension_point_name` one level down inside an entry) — do not add a fourth copy. Because it strips at **every depth**, `link_target` moving into each entry needed no change here at all: the same list caught it one level down.
- **Scaffold templates** in `src/templates/files/*.tmpl` use `{{VARIABLE}}` placeholders. Variables are defined in `scaffold.ts` and listed in `templates/index.ts`. Templates must reference both `npm` and `yarn` (not npm-only). Use `brevo app start oauth` (not `brevo app start`).
- **Credentials** are stored in `~/.brevo/credentials.json`. App credentials (clientId/clientSecret) are cached per app ID under an `apps` key.

## Keep agent docs in sync with CLI behavior

The CLI ships two agent-facing docs at the repo root, both bundled into the published tarball via `package.json` `files:`:

- `agent-context/SKILL.md` — the Claude Code skill. Installed into `~/.claude/skills/brevo-cli/` by `brevo skill:cli install` and **auto-refreshed** on every subsequent `brevo` invocation (opt out: `BREVO_NO_SKILL_AUTOREFRESH=1`). It is also the source `src/skills/index.ts` reads via `SKILLS_BUNDLE_DIR` — there is no second copy.
- `agent-context/AGENTS.md` — the broader `agents.md`-format reference for any agent-aware tool.

**Whenever you change user-visible CLI behavior, update both files in the same PR.** An out-of-sync skill actively misleads any AI helping a user with this CLI — that's worse than no skill at all.

**Keep `AGENTS.md` and `SKILL.md` in sync with each other.** Even when no CLI behavior changed, if you edit one of these files, check the other still aligns before opening the PR. They cover the same command surface, hard rules, version-check procedure, and exit codes — `AGENTS.md` is the broader reference (also documents env vars and the Claude-vs-non-Claude install path), `SKILL.md` is the Claude-focused subset. Pure-doc edits aren't "user-visible CLI behavior," so the rule above doesn't catch them — this rule does. If a difference is intentional (e.g. AGENTS.md branches by agent type because SKILL.md is Claude-only by construction), say so in the PR description so a future reader doesn't try to "fix" it.

**What counts as user-visible:**

- New or removed commands or subcommands.
- New, removed, or renamed flags on existing commands.
- New or removed `BREVO_*` env vars, or changes to existing-var semantics.
- Changed defaults (new opt-in/opt-out, changed prompt behavior).
- Changed exit codes or error messages that scripts may match on.
- Removed features that the docs currently advertise (e.g. removing `brevo skill:cli update` requires removing it from both docs).
- **A feature going GA.** Taking a feature out of a `## Before …GA` section in `RELEASE-CHECKLIST.md` is a user-visible change like any other — it adds commands, flags or prompts to the published CLI. **Update `agent-context/SKILL.md` and `agent-context/AGENTS.md` for that feature in the same PR**, before ticking it off the checklist. Their reference text for a gated feature was *deleted* rather than hidden, so recover it from git rather than rewriting it — each GA section names the commit to recover from. A GA release that ships the commands but not the docs is the worst of both: agents keep telling users the feature doesn't exist, and the docs say so in writing.

**What does NOT count:** internal refactors, bug fixes that preserve UX, dependency bumps, test-only changes, log-line formatting tweaks that aren't part of the documented contract.

**A feature going GA must join the smoke test's live suites, in the same PR.** The smoke runner splits by surface: `scripts/smoke-test.ts`'s `SUITES` registry holds one suite per app type, and `.github/workflows/smoke.yml`'s `suite` input defaults to the **live** set — the suites whose commands are in the published bundle. A preview suite (today: `public`) is only meaningful on a `PREVIEW=1` build, which is why `smoke.yml` **refuses** a public-containing suite unless `against=local` rather than letting its steps auto-skip into a green run. So when a feature leaves `FEATURE_STAGE`'s `'preview'`:

1. Move its steps out of the preview suite, or add a suite for it, in `scripts/smoke/`.
2. Add it to `smoke.yml`'s `suite` **default** and its `options`, so the manual button and any new lane cover it.
3. Decide, deliberately, whether the release lanes should cover it — `smoke-pre-merge.yml`, `smoke-post-merge.yml` and `release.yaml`'s dispatch each **pin** `suite` explicitly so a retuned default can never silently change what a publish gate verifies. Widening a gate is a real decision: verify the suite passes on `ubuntu-latest` first, since a suite that only ever ran on a dev machine (a pty-driven one especially) has not been proven headless.

A GA'd feature the smoke never exercises is the mirror of the docs problem above: the release gate reports green on a surface it never touched.

**Skill version tracks the CLI version automatically.** `SKILL_CATALOG[brevo-cli].version` is computed at module-init from `package.json` (`CLI_VERSION` in `src/skills/index.ts`), so every published CLI release auto-refreshes installed skills — even when `SKILL.md` content didn't change. You only need to land your changeset; the skill version takes care of itself.

## Testing patterns

- Mock external dependencies (`inquirer`, `../container`, `../lib/config`) at the top of test files.
- Use `jest.spyOn(process.stdout, 'write')` to capture CLI output.
- Services are tested against mocked API client responses.
- Template tests verify variable substitution, not file I/O.

## Working docs: `RELEASE-CHECKLIST.md`, `docs.md` and `QA-TESTCASES.md`

Three working docs with different jobs, **split by feature across the two feature
branches** (all branch-local — see the never-merge rule above): this branch's copies
carry the **UI-apps halves**, and `feature_set-brevo-cli-v2`'s copies carry the
**public-apps halves** (release copy, the *Before public-apps GA* runbook, QA suites 2,
5, 6, 7, 10 and 13). They lived on a separate `docs/public-cli-ui-apps-feature-changes`
branch until 2026-08-24; that branch is deleted (final pre-split state in closed PR
#53). Read this before editing any of them.

- **`RELEASE-CHECKLIST.md` — the GA runbook.** Ordered, mechanical steps for the day a
  feature ships. The public-apps runbook (on `feature_set-brevo-cli-v2`) is **durable**:
  it stays until public apps ship — do not delete it as cleanup. This branch's copy is
  the record of the UI-apps flip (worked through at BEX-290); it stays until the release
  publishes.
- **`docs.md` — the open-questions log.** Part 1 is release copy held until GA (the
  UI-apps half is superseded by this branch's pending changeset and kept as background);
  Part 2 is everything still unknown or undecided, including assumptions that survive a
  GA.
- **`QA-TESTCASES.md` — the manual test plan**, with the recorded sweep results. This
  branch's copy is Suite 12 (UI apps), which matches this branch's surface and runs on a
  plain build; the public-app suites (on `feature_set-brevo-cli-v2`) need `PREVIEW=1`.

None of the three is in `package.json` `files:`, so nothing ships to npm — but the
never-merge rule applies regardless, because branches are public too.

The split is *what to do on the day* versus *what is still unknown*. An item moves from
`docs.md` to `RELEASE-CHECKLIST.md` when it turns into a release step, and is deleted from
`docs.md` when it resolves.

Working rules:

- **Whenever you identify follow-up work that isn't done in the current change**, add it to
  `docs.md` → *Part 2* rather than letting it fall through silently — this branch's copy
  for UI-apps work, `feature_set-brevo-cli-v2`'s for public-apps work. (There was a
  `TODO.md` here; it was folded into `docs.md` because its contents were entirely
  public-app / UI-app follow-ups.)
- **Per-branch verification notes are scratch.** When a branch keeps a
  `## Per-branch verification` section in a local `RELEASE-CHECKLIST.md`, clear it before
  merging into `main` — per-branch working state doesn't belong in `main`'s history.

## Adding a new command

1. Create handler in `src/commands/` (or `src/commands/app/` for app subcommands)
2. Wrap with `withCommandHandler()` for consistent error handling
3. Register in `src/commands/definitions.ts`
4. Add user-facing strings to `src/lang/en.ts`
5. Add CLI references to `src/lib/constants.ts` if needed
6. Write tests in `src/__tests__/commands/`

## Versioning & releases

This project uses [changesets](https://github.com/changesets/changesets) for versioning. Packages publish to the public npm registry (`registry.npmjs.org`) under the `@getbrevo` scope.

```bash
yarn changeset            # create a new changeset (interactive)
yarn version:packages     # consume changesets, bump version, update CHANGELOG
yarn publish:packages     # publish to npm
```

**When to add a changeset:** any PR that changes user-visible behavior (new feature, bug fix, breaking change). Run `yarn changeset` and commit the generated file with your PR.

**One changeset file per branch/PR — append, don't multiply.** Before creating a new changeset, check `.changeset/` for an existing pending one (any `.md` other than `README.md`). If one exists, append your change description as new lines in its summary body instead of creating a second file, and raise the bump level in its frontmatter if your change warrants it (`patch` → `minor` → `major`). Only create a new file when none exists.

**CI/CD:**
- `.github/workflows/push.yaml` — runs lint, test, build on every push/PR to `main`
- `.github/workflows/release.yaml` — when changesets merge to `main`, opens a "Version Packages" PR; merging that PR publishes to npm
- `.github/workflows/pre-release.yaml` — pushes to `release-*` branches publish alpha prereleases to npm

**Release gates: `scripts/release-check.mjs`.** `release.yaml` runs `pre` before the publish (on the tarball `npm pack` produces) and `post` after it (on the tarball the registry serves), both through the same assertions — a pre-publish gate on a different artifact than the post-publish one isn't a gate. Run either locally: `yarn release:check pre`, `yarn release:check post --version=2.2.0`.

Shared: required files present, forbidden files absent (the branch-local working docs above, plus `.env` / `credentials.json` / `.brevo.json` / keys), every `src/templates/files/*.tmpl` shipped, no secret-shaped string in packed content, and **the tarball installs into an empty tree where `brevo --version` runs** — the only check on the dependency closure, since deps stay external and one that drifted into `devDependencies` would pack fine and die on the first install. `post` adds the registry metadata: `latest` moved, a SLSA provenance attestation is attached, the publisher is the OIDC identity, and the download matches `dist.integrity`. If those last two fail, fix the trusted publisher on npmjs.com — **do not** add an `NPM_TOKEN`.

Two things it deliberately doesn't do: re-check the gated public-app surface (`scripts/build.mjs` owns `LEAK_MARKERS` / `GA_MARKERS` and `prepublishOnly` reruns it, so a copy here could only drift), and stand in for the smoke test (`smoke.yml` authenticates and drives real commands; this only proves the artifact). `.tmpl` paths are skipped in the forbidden-*filename* scan — the template set includes `.env.example.tmpl` and `app-config.json.tmpl` on purpose — but their content is still secret-scanned.

**npm auth: Trusted Publishing (OIDC), no long-lived token.** Publishes authenticate to npm via the GitHub Actions OIDC token (`id-token: write`) — there is no `NPM_TOKEN` secret. The trust relationship is configured on npmjs.com for `@getbrevo/cli` and binds publishes to: repo `getbrevo/brevo-cli`, the specific workflow file, and the GitHub environment (`npm-publish` for stable, `npm-prerelease` for alphas). See https://docs.npmjs.com/trusted-publishers.

**Secrets required:**
- `GITHUB_TOKEN` — auto-provided by GitHub Actions
- `SLACK_*_WEBHOOK_URL` — only for release announcements (configured in the `npm-publish` environment)
- `HOMEBREW_TAP_TOKEN` — fine-grained PAT scoped to **only** `getbrevo/homebrew-tap` (contents + pull-requests write), in the `npm-publish` environment. Used solely by the Homebrew auto-bump step; has no npm access. Has an expiry — rotate before it lapses or the auto-bump silently stops.

**Homebrew distribution.** The CLI is also installable via `brew install getbrevo/tap/brevo`. The formula lives in the separate public repo [`getbrevo/homebrew-tap`](https://github.com/getbrevo/homebrew-tap) (`Formula/brevo.rb`), which builds from the published npm tarball. After every npm publish, the `Bump Homebrew formula` step in `release.yaml` recomputes the tarball `url` + `sha256` and opens a bump PR on the tap; the tap's own CI (`brew audit`/`brew test`) gates it and a human merges. This is a distribution channel only — no CLI command/flag/env-var surface — so it does **not** require `SKILL.md`/`AGENTS.md` edits, only the README install section.

**Workflow / publishing changes — treat as security review, not style review.** Any edit to `.github/workflows/release.yaml` or `.github/workflows/pre-release.yaml`:

- Code-owner review is required (enforced via `CODEOWNERS`)
- Keep every **third-party** `uses:` pinned to a commit SHA with a version comment (e.g. `changesets/action`, `andstor/file-existence-action`). First-party `actions/*` (GitHub-published, like `actions/checkout`, `actions/setup-node`, `actions/upload-artifact`) may use a major-version tag (e.g. `actions/checkout@v6`, `actions/setup-node@v6`, `actions/upload-artifact@v4`).
- Keep `persist-credentials: false` on every checkout in any job that has access to publish secrets
- Keep `id-token: write` and `NPM_CONFIG_PROVENANCE=true` on the publishing step
- Do not reintroduce `NPM_TOKEN` — auth is OIDC. If publishing breaks, fix the trusted-publisher config on npmjs.com, do not paper over it with a static token.
- Keep the npm CLI pinned to a version that supports Trusted Publishing (>= 11.5.1). Do not use `npm@latest`.
- Keep `HOMEBREW_TAP_TOKEN` scoped to **only** `getbrevo/homebrew-tap` with the minimum permissions (contents + pull-requests). Do not widen its repo scope or grant it npm access, and do not move the Homebrew bump step out from behind the `published == 'true'` gate.

If a contributor proposes removing any of these, push back — don't silently drop them to make a diff cleaner.
