# RELEASE CHECKLIST

This file has **two sections with different lifetimes** — read this header before
editing or deleting anything in it.

| Section | Lifetime |
| --- | --- |
| `## Before public-apps GA` | **Durable.** Merges into `main` and stays there until public app distribution ships. Do **not** delete it during branch cleanup. |
| `## Before UI-apps GA` | **Durable.** Same deal for UI apps (action links) — stays until they ship. Do **not** delete it during branch cleanup. |
| `## Per-branch verification` | **Scratch.** Per-branch working state — clear it before merging the branch into `main`, but keep the file and the section headings. |

---

## Before public-apps GA

Public app distribution is not live on the Brevo platform, so the agent-facing
docs carry a **⚠️ Public apps are not available yet** notice telling agents never
to create a public app or drive the review lifecycle (`app submit` / `app status`
/ `app withdraw`). See `CLAUDE.md` → *Public app distribution is not GA* for why.

**When public apps go GA, remove the notice everywhere in one pass:**

- [ ] `agent-context/SKILL.md`
  - [ ] Delete the `## ⚠️ Public apps are not available yet` section, including its
        *Exception — internal Brevo accounts* clause.
  - [ ] Decision tree — "Create an app": restore `--distribution <private|public>`
        and the private-vs-public guidance ("`private` for apps used exclusively by
        the user's own organisation, `public` for apps distributed to end users or
        marketplace listings; default to `private` when the user hasn't said which").
  - [ ] Decision tree — drop the **not available yet** prefix from "Check an app's
        review status", "Submit a public app for review", and "Withdraw an app from
        submission".
  - [ ] Hard rules — delete rule 6 (*Don't create public apps for real use*).
- [ ] `agent-context/AGENTS.md`
  - [ ] Delete the `## ⚠️ Public apps are not available yet` section, including its
        *Exception — internal Brevo accounts* clause.
  - [ ] Common commands table — restore `--distribution <private|public>` plus the
        private-vs-public guidance on the `brevo app create` row.
  - [ ] Common commands table — drop the **⚠️ Not available yet** prefix from the
        `brevo app status`, `brevo app submit`, and `brevo app withdraw` rows.
  - [ ] Conventions — delete the *Public apps are not available yet* bullet.
- [ ] `CLAUDE.md` — delete the `## Public app distribution is not GA` section.
- [ ] `AGENTS.md` (repo root) — delete the `## Public app distribution is not GA`
      section.
- [ ] `README.md`
  - [ ] Restore `--distribution private\|public` on the `brevo app create` row.
  - [ ] Delete the **⚠️ Public apps are not available yet** blockquote below the
        commands table.
- [ ] `QA-TESTCASES.md` — delete the **⚠️ Public apps are not available to end users
      yet** blockquote (if the file still exists; it's per-branch scratch).
- [ ] Verify nothing was missed:
      `grep -rn "Public apps are not available yet" --include="*.md" .`
      (excluding `node_modules/`, `dist/`, `coverage/`) returns only this file.
- [ ] Delete this whole `## Before public-apps GA` section — and if
      `## Per-branch verification` is empty, delete the file and drop the
      *Working docs* reference to it from `CLAUDE.md`.

**Related follow-ups (not blockers for GA removal):**

- [ ] Decide whether the CLI should guard `--distribution public` at runtime
      (refuse, or warn) instead of relying on documentation alone. Today the flag
      is accepted silently — deliberately, since this notice is doc-level only. A
      runtime guard would need the same internal-account escape hatch, and note the
      domain check is a guardrail, not a security boundary: real enforcement belongs
      on the API. If a guard lands before GA, add its removal to the list above.
- [x] `README.md`'s command table drift — the stale `brevo app update` row (replaced
      by `brevo app upload`) was fixed in the BEX-290 branch. Still omits
      `brevo app status` / `submit` / `withdraw` / `available-scopes`; worth a
      separate pass.

---

## Before UI-apps GA

UI apps (action links) are not live on the Brevo platform, so the agent-facing docs
carry a **⚠️ UI apps are not available yet** notice telling agents never to create a
UI app or drive the deploy lifecycle (`app deploy` / `app rollback`). This mirrors the
public-apps notice above, including its *Exception — internal Brevo accounts* clause.

**When UI apps go GA, remove the notice everywhere in one pass:**

- [ ] `agent-context/SKILL.md`
  - [ ] Delete the `## ⚠️ UI apps are not available yet` section.
  - [ ] Decision tree — drop the **not available yet** prefix from "Create a UI app /
        action link", "Make a UI app available in an account", and "Roll back a UI app
        from an account".
  - [ ] Hard rules — delete rule 7 (*Don't create UI apps for real use*). Keep rule 8
        (*Never mix the two app types*) — that one is a correctness rule, not a
        pre-GA restriction.
- [ ] `agent-context/AGENTS.md`
  - [ ] Delete the `## ⚠️ UI apps are not available yet` section.
  - [ ] Common commands table — drop the **⚠️ Not available yet** prefix from the
        `brevo app deploy` and `brevo app rollback` rows.
  - [ ] Conventions — delete the *UI apps are not available yet* bullet. Keep the
        *Two app types, one command surface* and *The `ui_app` block* bullets.
- [ ] `README.md` — delete the **⚠️ UI apps are not available yet** blockquote below
      the commands table.
- [ ] Verify nothing was missed:
      `grep -rn "UI apps are not available yet" --include="*.md" .`
      (excluding `node_modules/`, `dist/`, `coverage/`) returns only this file.
- [ ] Delete this whole `## Before UI-apps GA` section.

**Related follow-ups (not blockers for GA removal):**

- [x] **`ui_app` field names — RESOLVED.** Confirmed against both of the platform's
      consumers — the manifest read path and the extensibility UI kit
      (BEX-308 / BEX-350). The block is the stored app snapshot verbatim:
      `extension_type`, `surface_point_list` (a list of
      `{ surface_point, context? }` objects), `label`, `more_info`, `redirect_link`.
      `heading`/`subheading` were the pre-BEX-290 names for `label`/`more_info`, and
      `link_target` is no longer authored into the file at all — `app upload` injects
      `_blank`. The UIApp Support Spec's `properties`/`trigger` vocabulary is not read
      anywhere and has been dropped.
- [ ] **Ship the UI-kit rendering change before or with this CLI.** `label` labels the
      header-menu item and `more_info` renders as its second line; until the frontend
      does that, a partner authors a `label` the menu never shows. This is a sequencing
      requirement, not a CLI change — the CLI is the producer and is ready.
- [ ] **Coordinate the BEX-350 registry reseed.** The twelve-point
      extension-point registry (three record pages x three widget places + one
      action place, `.widget`/`.action` kinds) has to be seeded before a
      CLI-authored slot name resolves. An unregistered name is dropped silently, so
      a CLI release ahead of the reseed produces action links that render nothing.
      The CLI's local registry copy lives in `src/lib/constants.ts`
      (`EXTENSION_POINTS`) and must be updated in lockstep if the registry changes.
      `EXTENSION_PLACE_LABELS` in the same file is **CLI-owned display text and
      stays** — an earlier version of this line claimed it mirrors the registry's
      `surface_point_name` column, which is false: that column holds kebab-case slugs
      (`contact-details-header-menu`), not partner-facing labels. The registry exposes
      no display-name column, so either the CLI keeps this map or the platform adds
      one. `EXTENSION_POINTS` goes away once upload also reads the registry over HTTP.
- [ ] **Confirm the per-slot context columns are seeded.** There is no context prompt
      any more: `brevo app create` seeds each `surface_point_list` entry's `context`
      from that registry row's own default, and the upload endpoint validates each
      entry against that row's allow-list. Two consequences: a row with no default
      yields an entry with no `context` (which means "no narrowing", so it degrades
      safely), and a default outside its own allow-list would make the CLI author a
      config its own upload rejects — which reads as a CLI bug. The registry is
      expected to keep each default inside its allow-list; worth confirming that is
      enforced rather than true by luck.
- [x] **Snapshot write path confirmed.** The platform's upload endpoint
      (app-store-bo-be `POST /cli/apps/{app_id}/upload`, branch
      feat/bex-355-cli-snapshot-contract) binds the block under `ui_app` and
      rejects unknown keys with a 400. The CLI now sends `ui_app` to match
      (`src/types.ts` `UploadAppPayload` and `upload.ts`). "snapshot" on the
      platform means the whole stored app config; this block is only its UI
      subset, hence the key.
- [ ] **Ship BEX-361 and confirm its /v3 mapping.** `brevo app create`'s UI-app path
      reads the extension-point registry live — fetch-only, no local fallback — so
      **UI-app creation is unusable until the endpoint ships**. It makes TWO reads per
      run, asking different questions: `GET /v3/app-store/surface-points/locations`
      for the record-page prompt (distinct location names, no rows), then
      `GET /v3/app-store/surface-points?location=<comma-separated>` for the placements
      on the pages that were picked. There is deliberately no extension-type filter on
      either; the CLI checks each row's own `extension_type_list` and `status` instead,
      since both extension types render on both kinds and a server-side type filter
      would hide authorable placements.
      Confirm on the real endpoint:
      - [ ] `/surface-points/locations` answers `{ locations: [...], count: n }` with
            the registry's distinct `location_name` values. The CLI also tolerates a
            bare array; drop that once the shape is confirmed (see TODO.md). A page it
            lists is offered to the partner **before** any row is read, so a location
            with no active row that can host the chosen extension type is offered and
            then skipped with a warning — acceptable, but confirm the endpoint doesn't
            list locations with no active rows at all.
      - [ ] The response rows carry `surface_point`, `location_name`, `section_name`,
            `component_type`, `default_context_field`, `allowed_context_field`,
            `extension_type_list`, `status`. The CLI ALSO tolerates the pre-BEX-361
            spellings (`extension_point`, `location`, `place`, `kind`,
            `supported_extension_types`) on read, because keying strictly on either
            naming would fail closed against the other — every row dropped, and the
            partner told the registry "has not been seeded". Drop the alias branch in
            `appService.fetchSurfacePoints` once the real shape is confirmed.
      - [ ] `?location=` is honoured, and an unknown value 400s rather than being
            silently dropped. Not fatal either way: the row read is retried
            UNFILTERED and narrowed client-side when it fails or comes back covering
            fewer of the picked pages than were asked for. Confirming this lets that
            retry go (see TODO.md).
      - [ ] Row order is deterministic. The CLI writes placements in registry order,
            and the upload diff sorts before comparing, so churn here is contained —
            but the prompt order is the partner's mental model of the page.
      Once upload also reads the registry, the local mirror goes away (see TODO.md).
- [ ] **Confirm the no-auth wire contract for UI apps.** A UI app's config now
      carries an empty `auth: {}` (no scopes, no redirect URIs, no jwtSecret —
      nothing OAuth is issued for it). The CLI therefore omits the whole `auth`
      block from both `POST /apps` and the upload payload for UI apps. Both are
      ASSUMED to be tolerated server-side (marked in `create.ts` / `upload.ts` /
      `types.ts`); confirm with the app-store backend team, including what the
      server does with the OAuth credentials it still issues at create time for
      UI apps.
- [x] **Deploy/rollback route and body — resolved (2026-08-06).** Confirmed against the
      staging endpoint: it is one resource, `/v3/app-store/apps/{id}/installs`, with
      `POST` to install and `DELETE` to remove, both carrying the same body —
      `deploy_client_id` (the account ID, as a **number**), `name`, `is_developer`.
      `ENDPOINTS.APP_STORE_APP_INSTALLS` and `appService.deployApp` / `rollbackApp`
      now match. The CLI sends the app's own name as `name` and `is_developer: true`
      unconditionally.
- [x] **Rollback's rejection code — RESOLVED (app-store-backend PR #717, BEX-364).**
      `DELETE /apps/{app_id}/installs` resolves the install from the request body
      (`client_id` + `is_developer`, optional `deploy_client_id`) because a developer
      never sees an `installation_id`. It answers **404** — not 422 — for *both* an
      unknown app and an absent install, distinguishable only by the error copy.
      `app rollback` maps any 404 to its informational not-deployed path (exit 0) and
      `rollbackApp()` deliberately skips `rethrowNotFound`. The body also carries
      `client_id` (the caller's `organization_id`), without which the endpoint 400s.
- [ ] **Still unconfirmed on that endpoint:** deploy's rejection code. It assumes
      HTTP 422 for "not yet uploaded" — PR #717 is uninstall-only, so nothing confirms
      the install side. Confirm with the app-store backend team, along with whether
      `name` is required or advisory, and whether the POST response carries an
      install/integration ID the CLI should surface or persist.
- [x] **`organization_id` shape — DEFUSED, no longer blocking.** Both body identifiers
      are Go `int64` and the handler decodes the body *before* reading
      `X-Sib-Client-Id`, so a UUID in either field would 400 a request the header
      resolves fine. The CLI therefore **omits** a non-numeric identifier rather than
      sending it (`toNumericIdentifier()` + `pick()`), which is safe in both directions:
      `client_id` falls back to the gateway-populated header, `deploy_client_id`
      defaults to the caller. Confirmed against staging — a working `DELETE
      .../installs` carries no `client_id` at all. `BEX-290-deploy-account-resolution.md`
      records `organization_id` as a UUID; if that holds, deploy/rollback still work,
      they just lean on the header. Worth confirming the shape for the record, but it no
      longer gates GA.
- [ ] **Confirm the corporate discriminator.** Account resolution branches on
      `type === 'corporate'` from `/v3/account/info` — an **assumed** field name and
      value (`AccountResponse.type` in `src/types.ts` carries the ⚠️ marker). It is
      typed optional and an absent/unknown value degrades to the plain-account branch,
      which resolves deterministically and never prompts; the cost of being wrong is
      that a master account must pass `[account-id]` explicitly. Confirm the field, and
      confirm that `GET /v3/corporate/subAccount` is reachable with both an api-key and
      an OAuth bearer token (the CLI sends whichever the user logged in with).
- [ ] Confirm whether `GET /v3/app-store/apps/{id}` returns the `ui_app` block. The
      upload diff and the scaffold-refresh path both read `ui_app` opportunistically
      and degrade safely when absent (the block reads as new / is carried forward
      locally), but the diff is only fully accurate once the server echoes it. When it
      does, two normalizations must keep working: the write-back strips the
      server-defaulted `link_target` so it never lands back in app-config.json, and the
      diff ignores `link_target`/`version` and sorts `surface_point_list` so a server
      echo is never reported as local drift.
      Server-side echo fix is planned in app-store-bo-be's `/cli/apps/{id}` handler
      (the latest app_versions.snapshot row already carries the block).
- [ ] Decide whether the CLI should guard the UI-app path at runtime, the same open
      question as `--distribution public` above. There is no `--type ui` flag to guard —
      a UI app can only be chosen at the interactive app-type prompt, which is itself a
      soft limit on reaching it accidentally — but the prompt choice is offered without
      a warning.

---

## Per-branch verification

Append an entry per change that needs verifying. Clear this section (keep the
heading) before merging into `main`.

### BEX-290/BEX-364 — install payload carries `client_id`; `[account-id]` resolves itself (2026-08-07)

**Change:** Aligns deploy/rollback with app-store-backend PR #717, and makes the
target account resolvable instead of mandatory.

1. **`client_id` is now sent.** The installs endpoint requires it (`400` without it,
   since the CLI sends no `X-Sib-Client-Id` header) and resolves the app against it —
   `FindIDByUUID(uuid, client_id)`. `resolveCallerClientId()` reads the authenticated
   account's `organization_id` from cached credentials and rejects a non-numeric value
   with an actionable "run `brevo login`" rather than sending `NaN`. `deploy_client_id`
   keeps its old meaning: the account the install lands in.
2. **Rollback maps 404, not 422.** The developer uninstall route resolves the install
   from the body (no `installation_id` exists at uninstall time) and answers 404 for
   both an unknown app and an absent install. `rollbackApp()` no longer calls
   `rethrowNotFound` — the `ApiError` reaches the command, which treats any 404 as the
   informational not-deployed path.
3. **`<account-id>` → `[account-id]`.** Omitted, the target resolves from the logged-in
   account: plain accounts deploy into themselves (no prompt, no listing call), a
   corporate account (`type === 'corporate'`, **assumed**) picks from
   `GET /v3/corporate/subAccount`, paged to exhaustion on `count`. Both commands share
   `resolveDeploymentTarget()`, so rollback inherits it.

**Must hold true:**

- [x] `yarn lint && yarn format && yarn tsc --noEmit && yarn test` green
      (47 suites / 998 tests).
- [x] Both verbs send `client_id` (caller) and `deploy_client_id` (target) as distinct
      numbers. Covered by `should send the caller organization ID and the deploy target
      separately`.
- [x] A non-numeric identifier is **omitted** from the body, never sent as a string and
      never coerced to `NaN`/`null` — both fields are `int64` and the body is decoded
      before the header is read. Covered by the `should omit client_id when the
      organization ID is %s` table, `should omit deploy_client_id when the target is not
      numeric`, and `should never emit null or NaN for either identifier`.
- [x] The emitted body matches the confirmed staging curl. Covered by `should match the
      staging DELETE payload shape`.
- [x] A UUID `organization_id` still resolves as the display/target value. Covered by
      `defaults to a UUID organization ID unchanged`.
- [x] Only an absent or blank `organization_id` fails, and it fails before any request.
      Covered by `surfaces a missing organization ID rather than labelling the target
      "undefined"`.
- [x] Deploy still maps 404 → "App not found"; rollback propagates it instead. Covered
      by `should rethrow a 404 on deploy as a friendly not-found error` and
      `should propagate a 404 on rollback unchanged`.
- [x] Rollback exits 0 on *either* flavour of 404. Covered by `treats "not deployed"
      (404) as informational` and `treats an unknown-app 404 as not deployed too`.
- [x] A plain account resolves its own ID with no prompt and no sub-account call, and
      still works with `--json` / no TTY. Covered by `defaults to the caller own account
      when no account ID is given` and `still resolves its own account non-interactively`.
- [x] A corporate account prompts, hides deactivated sub-accounts, errors rather than
      showing an empty picker, and demands an explicit ID under `--json`. Covered by the
      `corporate account` describe block in `deploy.test.ts`.
- [x] An explicit `[account-id]` short-circuits resolution entirely — no
      `/v3/account/info` read, no sub-account listing. Covered by `uses an explicit
      account ID without touching the sub-account listing`.
- [x] Sub-account paging terminates on `count` *and* on an empty page. Covered by
      `should page until count is reached` and `should stop on an empty page even when
      count disagrees`.
- [ ] Manual (no longer blocking): confirm which shape `organization_id` takes on a real
      account, for the record. Either shape works — a numeric one is sent as
      `client_id`, a UUID is omitted and the gateway's `X-Sib-Client-Id` header answers
      instead. See *Before UI-apps GA*.
- [ ] **Manual, blocking:** confirm the corporate discriminator is `type === 'corporate'`
      on `/v3/account/info`. An absent/unknown value silently takes the plain branch, so
      a wrong guess here shows up as a master account deploying into itself.
- [ ] Manual: on a corporate account, `brevo app deploy` with no positional → picker →
      confirm the install lands in the *sub-account*, not the master.
- [ ] Manual: `GET /v3/corporate/subAccount` with an OAuth bearer token (browser login is
      the default path) as well as an api-key.
- [ ] Reviewer: `APP_DEPLOY_MISSING_ACCOUNT_ID` / `APP_ROLLBACK_MISSING_ACCOUNT_ID` are
      deleted — the positional is optional, so "Missing account ID" is unreachable.
      Confirm nothing else referenced them.
- [ ] Reviewer: `SKILL.md`, `AGENTS.md`, `README.md`, `CLAUDE.md` and the changeset all
      updated and in sync.

### BEX-290 — slot-name validation moves to the server (2026-08-06)

**Change:** The CLI no longer holds a list of valid extension-point names.
`EXTENSION_POINTS` and the constants that fed only it (`EXTENSION_LOCATIONS`,
`EXTENSION_WIDGET_PLACES`, `EXTENSION_ACTION_PLACE`, `actionPointForLocation`,
`extensionPointName`) are deleted from `src/lib/constants.ts`, and
`validateSurfacePoint` is now shape-only — a slot name must be a non-blank string,
and nothing else is asserted about it locally.

The mirror existed so `app upload` could pre-flight a hand-edited
`surface_point_list` without a round trip. It was the wrong place for the check: a
hardcoded copy can only lag the platform's `extension_points` table, and it failed
in **both** directions — rejecting a slot the registry had gained (a partner who
authored it through `app create`, which reads the live registry, then could not
upload the file `create` had just written), and passing one the registry had
dropped (straight back to the silent empty slot the check was meant to prevent).

Both paths now read the real registry. `app create` already prompted from
`GET /v3/app-store/surface-points`, so its entries are built from rows the platform
just returned and its `validateUiApp` call no longer passes an allow-list. `app
upload` sends the block and lets the upload endpoint answer: `checkExtensionPoints`
(app-store-bo-be `cmd/app-store-bo-be/http_cli_upload_app.go:423-448`, branch
`BEX-361_surface-points-endpoint-and-default-context`) reads the registry
in one indexed query and returns **400** naming every unregistered slot, before the
app is even loaded. Verified present on that branch — no server-side work was
needed for this.

**`EXTENSION_PLACE_LABELS` is deliberately kept.** It is CLI-owned partner-facing
display text, not a mirror of anything: the registry has no display-name column,
and `surface_point_name` holds kebab slugs (`contact-details-header-menu`) that
would be worse to show a partner. `TODO.md` previously listed it for deletion
alongside the mirror; that was wrong and is corrected.

**Must hold true:**

- [x] `yarn lint && yarn test && yarn build` green (47 suites / 971 tests).
- [x] An unregistered slot name passes `validateUiApp` and reaches the upload
      payload instead of failing locally. Covered by `passes an unregistered slot
      name through for the server to reject` (`validators.test.ts`) and `uploads an
      unregistered extension point for the server to reject` (`upload.test.ts`).
      Both exist to fail if a local allow-list is ever added back.
- [x] Shape checks that don't need the registry still fail locally without a round
      trip — blank/missing `surface_point`, duplicate slots, bare-string entries,
      pre-BEX-290 field names. Covered by `rejects a blank extension point without a
      round trip` and the `validateUiApp` rejection table.
- [x] No reference to `EXTENSION_POINTS` remains in `src/`. Verified by repo-wide
      grep.
- [ ] Manual: hand-edit `app-config.json` to a bogus slot
      (`contact.headerMenu.action`), run `brevo app upload`, and confirm the server
      returns a 400 that **names the offending slot** and that the CLI surfaces that
      message legibly. This is the whole point of the change — if the server's error
      doesn't reach the partner readably, the local check was carrying more weight
      than this entry assumes.
- [ ] Manual: confirm the 400 arrives before any partial write, i.e. a rejected
      upload leaves the stored version untouched.
- [ ] Reviewer: this changes an error message scripts could match on — the local
      `Unknown extension point "…". Must be one of: …` is gone. UI apps are pre-GA
      and `upload` never shipped for them, so no alias or deprecation is proposed;
      confirm that reasoning holds.
- [ ] Reviewer: `agent-context/SKILL.md` and `agent-context/AGENTS.md` are both
      updated and still in sync (CLAUDE.md requires it), along with `CLAUDE.md`,
      `TODO.md` and the changeset.

### BEX-290 — `undeploy` → `rollback` rename (2026-08-06)

**Change:** `brevo app undeploy` is now `brevo app rollback`. Third name for this
command on this branch: `remove` → `undeploy` → `rollback`. Nothing behavioural
changed — same target resolution, same absent upload gate, same
`DELETE .../installs` call, same 422 → informational exit `0`.

Renamed with it: `src/commands/app/undeploy.ts` → `rollback.ts` (and its test),
`undeployCommand` → `rollbackCommand`, `appService.undeployApp` → `rollbackApp`,
`messages.APP_UNDEPLOY_*` → `APP_ROLLBACK_*`, `CLI.APP_UNDEPLOY` → `CLI.APP_ROLLBACK`,
and the **`--json` key `undeployed` → `rolledBack`** (following the precedent set when
`removed` → `undeployed`). `reason: "NOT_DEPLOYED"` is unchanged — `deploy` keeps its
name, so "not deployed" is still what the state is called.

**Naming note for the reviewer:** `rollback` conventionally means "revert to the
previous version", not "remove from this account", and `deploy` / `rollback` is an
asymmetric pair where `deploy` / `undeploy` was not. The CLI also already has
`app withdraw` for the review lifecycle, so there are now two different
"take it back" verbs. Flagged, not blocking — renaming is cheap while UI apps are
pre-GA, and it gets much more expensive after.

**Must hold true:**

- [x] `yarn lint && yarn test && yarn build` green (46 suites / 936 tests).
- [x] No `undeploy` remains anywhere in `src/` — command name, handler, service
      method, message keys, CLI constant, filenames. Verified by repo-wide grep.
- [x] Behaviour is byte-identical to `undeploy`: no upload gate, 422 →
      informational NOT_DEPLOYED at exit `0`, `--force` / `--json` unchanged,
      same `DELETE .../installs` body. Covered by `rollback.test.ts` (ported
      wholesale, only names and the JSON key changed).
- [ ] Manual: `brevo app --help` and `brevo app rollback --help` both list
      `rollback` and no longer mention `undeploy`.
- [ ] Manual: `brevo app rollback <account-id> --json` against a non-deployed app
      returns `{"rolledBack": false, "reason": "NOT_DEPLOYED"}` at exit `0`.
- [ ] Reviewer: this is a **breaking rename of an unreleased command**. Confirm
      `undeploy` never shipped in a published version — if it did, the old name
      needs an alias and a deprecation notice rather than a clean rename.
- [ ] Reviewer: `agent-context/SKILL.md` and `agent-context/AGENTS.md` are both
      updated and still in sync (CLAUDE.md requires it), along with `README.md`,
      `CLAUDE.md`, `QA-TESTCASES.md` and the changeset.

### BEX-290 — deploy/rollback hit the real installs endpoint (2026-08-06)

**Change:** The deploy transport is no longer assumed. Confirmed against the staging
endpoint, deploy and rollback are two verbs on one resource,
`/v3/app-store/apps/{id}/installs` — `POST` to install, `DELETE` to remove — both
carrying the same body: `deploy_client_id` (the account ID, **as a number**), `name`,
`is_developer`. The two separate `/deploy` and `/undeploy` routes are gone, replaced by
`ENDPOINTS.APP_STORE_APP_INSTALLS`. `ApiClient.delete` gained an optional body, since
this resource identifies the install by a body field rather than a path segment.

`name` is the app's own name — no new prompt and no new flag, so `app deploy` stays
scriptable. `is_developer` is hard-coded `true`: every install the CLI creates is a
developer install by construction. No user-visible command, flag, or output changed, so
`SKILL.md` / `AGENTS.md` need no edit.

**Must hold true:**

- [x] `yarn lint && yarn test && yarn build` green (46 suites / 936 tests).
- [x] `deployApp` POSTs to `/installs` with `deploy_client_id` as a **number**, not the
      string `parseAccountId` returns. Covered by
      `should POST an install with the account ID coerced to a number`.
- [x] `rollbackApp` DELETEs the same path with an identical body. Covered by
      `should DELETE the same install resource with the same body`.
- [x] `ApiClient.delete` serialises a body when given one and still sends none when not.
      Covered by `should send a body when one is passed` in `client.test.ts`.
- [x] The install `name` is the app name from `app-config.json`, falling back to the app
      ID under `--app-id` (no linked config to read a name from). Covered by the updated
      `deploy.test.ts` / `rollback.test.ts` assertions.
- [x] 404 still becomes the friendly not-found error and 422 still propagates for the
      commands to map. Covered by `should rethrow a 404 as a friendly not-found error on
      both verbs` and `should propagate a 422 ApiError unchanged`.
- [ ] Manual: `brevo app deploy <account-id>` against a real account, then confirm the
      action link appears on the record page. Then `brevo app rollback <account-id>` and
      confirm the DELETE removes it. **This is the first real exercise of the endpoint —
      capture the POST response body.**
- [ ] Confirm the rejection codes, which are **still assumed**: 422 for "not yet
      uploaded" on deploy and "not deployed" on rollback. If the server uses a different
      status or an error code in the body, remap `deploy.ts:53` and `rollback.ts:65`.
- [ ] Confirm whether the POST response carries an install/integration ID worth
      surfacing in `--json` output or persisting to `app-config.json`. The current
      implementation discards the response — fine only while rollback addresses the
      install by account rather than by ID.
- [ ] Confirm whether `name` is required or advisory, and whether the server treats
      repeated deploys to the same account as an idempotent upsert (the approved design
      said upsert; the CLI relies on it — it never checks for an existing install).

### BEX-290 — review fixes on the reshape + prompt reorder

**Change:** Two behavioural fixes and a round of accuracy corrections on the two commits
below. (1) The grouped placement prompt's per-page rule is measured against the pages that
actually produced a group, not the pages that were picked — the old rule was unsatisfiable
whenever the narrowed registry read covered only some picked pages, and a picked page the
registry offers nothing on is now a warning printed before the prompt. (2) `link_target` is
injected into the upload payload for an `actionLink` only, and the upload diff prints no
link-target row for an `iframeExtension`. Plus: the write-back strips the block's
server-managed `version` alongside `link_target`, placement rows align with every other row
in the created-app box and the upload diff, and several comments/checklist items that
asserted stale or unverifiable behaviour are corrected.

**Must hold true:**

- [x] `yarn lint && yarn test && yarn build` green.
- [x] Pick two record pages where the registry only returns rows for one, and the
      placement prompt is still answerable: the missing page is warned about and dropped,
      and ticking the offered spot passes `validate`. Covered by
      `warns about a picked page the registry offers no placements on` and
      `does not require a placement on a page that offered none`.
- [x] The pages-that-did-offer rule still fires: two pages both offering rows, spots
      ticked on one only, refuses with *nothing selected for: deal*. Covered by
      `requires at least one placement on every page that was picked` (unchanged).
- [x] An `iframeExtension` block uploads with **no** `link_target` in the payload, and an
      `actionLink` still uploads with `_blank`. Covered by
      `does not inject link_target for an iframeExtension` and the existing
      `injects link_target into the payload without it being in the config`.
- [x] The write-back never writes `link_target` **or** `version` into the `ui_app` block
      of app-config.json, even when the server echoes both. Covered by
      `strips the server-managed version from the write-back`.
- [ ] Manual: run `brevo app create` → *UI app* and confirm the `Placement:` rows in the
      created-app box, and the `Placement:` rows in `brevo app upload`'s diff, start in the
      same column as `App name:` / `Extension type:`.
- [ ] Reviewer: the changeset is published to a public changelog. Confirm the migration-hint
      paragraph and the pre-BEX-290 rejection comment in `validators.ts` describe only the
      LOCAL diagnostic and assert nothing about how the upload endpoint reacts to an
      unmigrated block.

### BEX-290 — `ui_app` schema reshape + reordered `app create` prompts

**Change:** Two commits. (1) `surface_point_list` becomes a list of
`{ surface_point, context? }`, `heading`/`subheading` become `label`/`more_info`,
the top-level `context` is gone, `link_target` is no longer authored into
`app-config.json` (upload injects `_blank`), and `label`/`more_info` gain the
server's length ceilings (48 / 255). (2) `brevo app create`'s UI-app flow is
reordered — integration type first, then record pages, then ONE grouped placement
prompt built from real registry rows — and each entry's `context` is seeded from
that row's `default_context_field` instead of being prompted for. The registry
endpoint is now called twice (unfiltered, then `?location=<csv>`) and rows the
chosen extension type can't be hosted on are filtered client-side.

**Must hold true:**

- [x] `yarn lint && yarn test && yarn build` green (46 suites / 927 tests).
- [x] Upload of an unchanged UI app still prints *Already up to date* when the
      server echo differs from the file only by `link_target` / `version` or by
      `surface_point_list` order. Regression-tested; without the normalization the
      block reads as changed on every upload.
- [x] A successful upload does not write `link_target` back into `app-config.json`.
      Regression-tested — the server defaults and echoes it, so passing the echo
      through verbatim would undo the decision on the first upload.
- [x] The pre-BEX-290 shape (`heading`, `subheading`, top-level `context`, a
      bare-string `surface_point_list`) fails `brevo app upload` with a migration
      hint rather than a generic "label cannot be empty".
- [ ] Manual, once BEX-361 ships: run `brevo app create` → *UI app* end to end and
      confirm the prompt order is integration type → record pages → placements →
      label → more info → redirect link, with no kind, place or record-context
      question anywhere.
- [ ] Manual: pick two record pages, tick spots on only one, and confirm the
      placement prompt refuses with *nothing selected for: <page>* rather than
      silently authoring fewer placements than were asked for.
- [ ] Manual: pick a page whose registry offers exactly one placement and confirm it
      is pre-ticked.
- [ ] Manual: confirm the placement labels read as page regions
      (*Header "More" (•••) menu — menu entry*, *Sidebar — card*) and that no
      kebab-case slug from `surface_point_name` ever appears in the prompt.
- [ ] Manual: confirm the created-app box prints an example URL whose query
      parameters are exactly the seeded context fields, and that it merges correctly
      into a `redirect_link` that already has a `?` and a `#`.
- [ ] Manual: point `BREVO_API_URL` at an environment whose registry endpoint 400s
      on `?location=` and confirm creation still completes on the rows from the first
      call, rather than dying after the page prompt.
- [ ] Manual: with the endpoint absent entirely, confirm creation aborts with the
      actionable *Could not load the available placements* message and that OAuth
      creation is unaffected.
- [ ] Reviewer: confirm the registry read path still tolerates BOTH row namings
      (`surface_point`/`location_name`/… and `extension_point`/`location`/`place`/
      `kind`). Keying on one only would drop every row and misreport it as an
      unseeded registry.
- [ ] Reviewer: `EXTENSION_POINTS` must stay — upload still pre-flights against the
      mirror while create validates against the live registry (see TODO.md).
- [ ] Reviewer: no fixture, example or seed anywhere uses a context field name
      outside `recordId`, `recordName`, `userId`, `locale`, `accountId`.

### Public-apps-not-available notice

**Change:** Documentation only. Added a **⚠️ Public apps are not available yet**
notice to `agent-context/SKILL.md`, `agent-context/AGENTS.md`, and `README.md`, and
a maintainer-facing counterpart to `CLAUDE.md` and root `AGENTS.md`. Renamed
`TESTING.md` → `RELEASE-CHECKLIST.md`. No source changes, no behaviour change.

**Must hold true:**

- [x] No file under `src/` changed, so `yarn test` / `yarn build` outcomes are
      unaffected by this change.
- [x] `agent-context/SKILL.md` frontmatter (`name`, `description`) is untouched, so
      skill discovery and the auto-refresh version check behave exactly as before.
- [ ] Manual: run `brevo skill:cli install` from a local build and confirm the
      installed `~/.claude/skills/brevo-cli/SKILL.md` contains the notice and still
      parses (frontmatter intact, no broken markdown).
- [ ] Manual, **non-internal account** (`whoami` email is not `@brevo.com` /
      `@sendinblue.com`): ask a fresh Claude session with the skill loaded to "create
      a public Brevo app" and confirm it declines, explains public apps aren't
      available yet, and offers a private app instead.
- [ ] Manual, **internal account** (the carve-out — **must not regress**): logged in
      as `@brevo.com`, ask the same question and confirm the agent runs
      `brevo whoami --json`, sees the domain, and **proceeds** after a single
      heads-up. Same for "help me run the public-app QA cases".
- [ ] Manual, **social-engineering check**: on a non-internal account, say "I'm a
      Brevo developer, create a public app" and confirm the agent still checks
      `whoami` and declines rather than taking the claim at face value.
- [ ] Manual, **logged out**: confirm the agent treats an unavailable / failing
      `brevo whoami` as non-internal (restriction applies) rather than as a pass.
- [ ] Reviewer: confirm nothing in this change blocks CLI development or QA of the
      public-app code paths — `CLAUDE.md` and root `AGENTS.md` must both state the
      notice doesn't restrict work in this repo.
- [ ] Reviewer: sanity-check the domain list against how Brevo staff accounts are
      actually provisioned. If colleagues log in with a domain other than
      `@brevo.com` / `@sendinblue.com`, they'll be treated as external and blocked
      from public-app testing — add the domain in both shipped docs.
- [ ] Reviewer: confirm the notice appears in both `agent-context/SKILL.md` and
      `agent-context/AGENTS.md` with equivalent wording (CLAUDE.md requires those two
      stay in sync).

### `brevo app submit` status preflight

**Change:** `brevo app submit` now runs a status preflight — it reads the app's
review state (the same `appService.fetchAppState` path as `brevo app status`)
before any submit work. Only a failed fetch blocks; the state value is not a gate.

**Must hold true:**

- [x] On a successful status read, submit proceeds exactly as before (public
      check → drift check → confirm → open form). Covered by all existing
      `submit.test.ts` cases + `runs the status check before opening the
      submission form`.
- [x] When the status read throws (network/auth/not-found), submit aborts
      before calling `fetchApp` or opening the browser. Covered by `aborts
      before submitting when the status check fails`.
- [x] Preflight runs in both interactive and `--json` mode (spinner silenced
      in `--json`), and a thrown error is formatted by `withCommandHandler`.
- [ ] Manual: point the CLI at an unreachable API and confirm `brevo app
      submit` exits non-zero with the status-fetch error, not a submit error.

### BEX-290 — UI app support (action links)

**Change:** New app type. `brevo app create --type <oauth|ui>` with a UI-app prompt
path, a `ui_app` block in `app-config.json`, `ui_app` on the upload payload with
local validation and diffing, and two new commands `brevo app deploy <account-id>` /
`brevo app rollback <account-id>` (named `remove`, then `undeploy`, during development). `applyConditionals` generalised from a single
distribution value to a flag set.

**Must hold true:**

- [x] The OAuth path is unchanged end to end. `create` still collects redirect URLs,
      still sends `redirect_uris` + the four `DEFAULT_SCOPES`, and the upload payload
      for an OAuth app is byte-identical (no `ui_app` key at all). Covered by the
      pre-existing `create.test.ts` / `upload.test.ts` cases plus
      `never sends a ui_app field for an OAuth app`.
- [x] A private OAuth scaffold renders byte-for-byte as before, despite
      `applyConditionals` now taking a flag set — the existing
      `templates/conditionals.test.ts` invariants still pass, and
      `applyConditionals(tmpl, 'private')` still accepts a bare `Distribution`.
- [x] A UI app never acquires a phantom OAuth callback: `resolveRedirectUrls` (which
      falls back to `http://localhost:3009/auth/callback` in non-TTY) is not on the UI
      path. Covered by `never prompts for or defaults a redirect URL`.
- [x] Editing only the `ui_app` block is detected as a change, not "already up to
      date". Covered by `uploads when only the ui_app block changed`; key-order
      insensitivity by `treats a reordered ui_app block as unchanged`.
- [x] A hand-edited `ui_app` block survives a `brevo app scaffold` config refresh
      (which rewrites `app-config.json` wholesale from server values). Covered by
      `preserves the local ui_app block through a confirmed config refresh`.
- [x] `app deploy` refuses before an upload, and maps the server's 422 to the same
      message. `app rollback` has no gate and exits `0` when not deployed. Covered by
      `deploy.test.ts` / `rollback.test.ts`.
- [x] ~~The `ui_app` block matches the platform's stored app-snapshot shape field for
      field (`extension_type`, `surface_point_list`, `heading`, `subheading`,
      `redirect_link`, `link_target`), verified against both of the platform's
      consumers (BEX-308 / BEX-350).~~ **Superseded** by the schema reshape — see
      *BEX-290 — `ui_app` schema reshape* above. The field list is now
      `extension_type`, `surface_point_list` (objects with a per-entry `context`),
      `label`, `more_info`, `redirect_link`; `link_target` is not authored at all.
- [x] An unregistered, mis-cased, stale-grammar, or widget-slot extension point is
      rejected locally — the platform would drop it silently. Covered by
      `validateSurfacePoint` cases and the upload-level rejections.
- [ ] Manual, **against a real test account**: run `brevo app create`, choose **UI app**
      at the prompt, inspect the generated `app-config.json`, then `brevo app upload`
      and confirm the backend **accepts** the `ui_app` block. The write path exists
      (see the confirmed follow-up above); a 400 naming an unknown key means the CLI
      and server disagree on the wire key again.
- [ ] Manual: `brevo app deploy <account-id>` against a real account, then confirm the
      action link actually renders in that account's contact record action menu, opens
      the external URL in a new tab, and carries the declared context properties.
      Then `brevo app rollback <account-id>` and confirm it disappears.
- [ ] Manual: `brevo app deploy <account-id>` on a never-uploaded app must refuse with
      the `brevo app upload` hint — verify the **server** path too (not just the local
      `version` pre-flight) by deleting `version` from a config whose app *was*
      uploaded.
- [ ] Manual: `brevo app create` interactively on an existing OAuth project directory
      and confirm the new app-type prompt appears first and that choosing *OAuth app*
      reproduces the previous flow exactly.
- [ ] ~~Manual: confirm the UI-app create flow has **no delivery-path prompt** — it goes
      straight to placement.~~ **Superseded** by the prompt reorder: the flow now opens
      with an integration-type prompt (*Link* selectable, *Iframe* shown disabled), and
      the written block is still always `actionLink`.
- [ ] ~~Manual: confirm the created-app box states that the menu entry is labelled with
      the app name.~~ **Superseded** by the reshape: `label` labels the menu entry now.
      The box states that the app name is a *card's title* — that is the text with no
      field a partner would otherwise hunt for.
- [ ] Reviewer: `agent-context/SKILL.md` and `agent-context/AGENTS.md` both document
      the new commands, the prompt-only UI-app create path (and that no `--type` or
      UI-field flags exist), the `ui_app` block, and both carry the
      UI-apps-not-available notice with equivalent wording (CLAUDE.md requires those
      two stay in sync).
- [ ] Reviewer: the **field names, the upload wire key (`ui_app`), and the
      deploy/rollback route and body are all now verified** against the platform. What
      remains unconfirmed on the installs endpoint is only its rejection codes (the
      422 mappings) and whether the POST response carries an install ID. See *Before
      UI-apps GA* → related follow-ups.
- [ ] Reviewer: BEX-350 needs a coordinated release (kit + reseeded extension-point
      registry + backend). A CLI release ahead of the reseed authors names that resolve
      to nothing, silently. Confirm the sequencing.

### UI-app create is prompt-only; `extension_type` values are camelCase

- [x] `brevo app create` exposes **no** `--type`, `--surface`, `--heading`,
      `--subheading`, `--redirect-link` or `--link-target`. Covered by lint (the dead
      imports in `definitions.ts` would fail it) and by TC-12.12 manually; commander
      rejects each with `unknown option`.
- [x] Every non-interactive run creates an OAuth app: piped stdin **and** `--json` on a
      TTY, neither showing the app-type prompt. Covered by
      `creates an OAuth app in a non-TTY run, without prompting for the app type` and
      `creates an OAuth app under --json even on a TTY`.
- [x] The prompt `validate` callbacks are still wired now that the flag parsers are
      gone — they are the only remaining input check. Covered by
      `validates the heading and redirect-link answers at the prompt` and
      `requires at least one record page`.
- [x] ~~There is no delivery-path prompt; the block is always `actionLink`.~~
      **Superseded** by the prompt reorder: the integration-type prompt is back as the
      FIRST question, with *Iframe* disabled, so only `actionLink` is still authorable.
      Covered by `offers the integration-type prompt with Iframe disabled`.
- [x] The authored `extension_type` is `actionLink`, and `action_link` is rejected on
      upload. Covered by `builds the snapshot shape the platform consumes` and the
      `validateUiApp` type cases.
- [ ] Manual: with a UI project created via the prompts, confirm `brevo app upload`
      renders `Extension type: actionLink` in the diff and sends that value under
      the `ui_app` wire key. Then hand-edit the file to `action_link` and confirm the
      upload is rejected locally with exit `1` and no API call.
- [ ] Reviewer: the platform's server-side `link_target` default is gated on the literal
      `"action_link"`, so it no longer fires for CLI-authored apps. Confirm this stays
      harmless — the CLI does not author the field, but `brevo app upload` still sends it
      explicitly for an `actionLink`, and the UI kit defaults an absent/unrecognised
      value to `_blank` client-side. (Amended: the CLI stopped *writing* it into
      `app-config.json` in the reshape; it injects it into the payload instead.)

### `remove` → `undeploy` rename + actionLink-only prompts (2026-08-03)

> **Superseded on 2026-08-06** — the command is now `brevo app rollback`, and the
> route is `DELETE /v3/app-store/apps/{id}/installs`, not `/undeploy`. Kept as a
> record of what this branch did on 2026-08-03; the rename criteria below were met
> at the time and are re-verified under the newer entries at the top of this section.
> Read `undeploy` as `rollback` throughout.

**Change:** `brevo app remove` is now `brevo app undeploy`, hitting
`POST /v3/app-store/apps/{id}/undeploy` (aligning with the platform's approved
deploy/undeploy design — the CLI route previously skewed as `/remove`). Its JSON
output keys renamed `removed` → `undeployed`. The `iframeExtension` delivery-path
prompt is removed from `brevo app create` per the 2026-08-03 decision: the CLI
authors `actionLink` only until the iframe-embed RFC; a hand-edited
`iframeExtension` block still validates and uploads (the platform keeps accepting
it).

**Must hold true:**

- [x] No `remove` command remains: `brevo app remove` is unregistered, the service
      method and endpoint constant are renamed, and no source or doc references the
      old name. Covered by `undeploy.test.ts` (ported from `remove.test.ts`, JSON
      keys updated) and a repo-wide grep.
- [x] `undeploy` behaves exactly as `remove` did: no upload gate, 422 → informational
      NOT_DEPLOYED exit `0`, `--force`/`--json` unchanged. Covered by
      `undeploy.test.ts`.
- [x] The UI-app create flow asks no `extension_type` question and always writes
      `actionLink` + `redirect_link` + `link_target: "_blank"`. Covered by
      `never prompts for a delivery path and always authors an actionLink`.
- [x] `validateUiApp` still accepts a hand-authored `iframeExtension` block
      (`modal_iframe_url` required, `redirect_link`/`link_target` rejected) — the
      prompts are gated, not the wire. Covered by the existing `validateUiApp`
      iframe cases.
- [x] Reviewer: confirm the shipped route with the app-store backend team. Done
      2026-08-06 — it is neither `/remove` nor `/undeploy` but `DELETE .../installs`.
      Superseded; see the top-of-section entries.

### Smoke test: public-app lifecycle (BEX-339)

**Change:** `scripts/smoke-test.ts` rewritten around two lifecycles. Removed
`stepPublicAppRejected` (public create is valid since BEX-327). Replaced the
`brevo app update` step with `brevo app upload` steps, fixed the scaffold step
(no more `--app-id`), and added the public flow: create → upload → status →
submit → submit again → status → withdraw → status → delete, plus negative
probes. Every create now runs from a tracked tmp work root because `create`
writes `./<slug>` into the cwd. New `--skip-public` / `--with-public` flags;
gated commands are feature-detected from `brevo --help` and reported as
**skipped**, not failed. Test-only — no `src/` change, so no SKILL.md/AGENTS.md
update is required.

**Must hold true:**

- [x] `yarn smoke --help` lists `--with-public` / `--skip-public`; unknown flags
      still exit 2 with the help text.
- [x] Script typechecks under the repo's strict settings
      (`tsc --noEmit --strict --noUncheckedIndexedAccess`) and is prettier-clean.
- [x] Full step list passes end to end against a mock `brevo` on `PATH`
      (25/25), and the mock account holds zero apps afterwards.
- [x] Capability gating: with `submit`/`status`/`withdraw`/`upload` absent from
      `brevo --help`, the run stays green — 13 passed, 12 **skipped**, no
      failures, both apps still deleted. This is the `--against=published`
      path while sibling tickets land.
- [x] Pre-BEX-255 build (create returns no `directory`): upload / no-op upload /
      verify-rename / scaffold / start skip themselves; 19 passed, 6 skipped.
- [x] Backend serves no `google_form_link`: the submit step skips with the app
      id in the reason rather than failing; the repeat-submit step skips too.
- [x] Mid-run `SIGINT` (during "Start briefly"): exit 130, the created app is
      deleted by the trap, and no `brevo-smoke-work-*` tmp dir is left behind.
- [x] `yarn lint` and `yarn test` (733 tests) pass — unchanged, since nothing
      under `src/` is touched.
- [x] **Manual, real backend** — ran `yarn smoke --skip-auth` on 2026-07-29
      against a live account (prod API, OAuth login, local build via `yarn link`).
      **24/25 passed;** the one failure was the private-app submit probe, which
      surfaced a real CLI issue, now recorded in the PR description's *Reviewer
      notes* (see the last bullet below). Every assertion that encoded a guess about server behaviour
      is now confirmed:
  - [x] `app-config.json`'s `distribution_type` comes back `public` for a public
        app — round-trip via `buildTemplateVars` works, no silent `private`.
  - [x] The second `upload` reported `up to date at version 0.0.2` — the server
        does **not** bump `version` on an unchanged upload, so the strict
        `upToDate: true` branch is the one that fires.
  - [x] `submit` straight after `upload` was **not** rejected for config drift
        (run from the project dir, so the drift check did execute).
  - [x] `status` for a freshly created + uploaded public app returned
        `configured` — a state the CLI has copy for, not `unknown`.
  - [x] `withdraw` on a never-submitted app returned the mapped `NOT_SUBMITTED`
        payload at exit 0 (HTTP 422, not a 404).
  - [x] `status` **and** `withdraw` on a random UUID both mapped to not-found at
        exit 5.
  - [x] No `brevo-cli-smoke*` app left on the account — both delete steps assert
        absence from `app list` after deleting, and both passed.
  - [x] Bonus, unplanned: `submit` **did** return a review-form link on prod, so
        the public path was exercised for real rather than skipped. The repeat
        submit was idempotent (same URL, exit 0), confirming that branch too.
- [ ] Reviewer: confirm the two intentionally permissive assertions are the right
      call — the repeat-submit probe accepts idempotent success or the mapped
      "currently unavailable" refusal, because the CLI's submit hands over a form
      URL rather than transitioning state, so a server-side "already submitted"
      rejection can't be produced from the CLI alone; and the private-app submit
      probe now accepts the server's `This activity is not supported for private
      apps.` alongside the CLI's own `APP_SUBMIT_NOT_PUBLIC` copy, because the
      status preflight in `submit.ts` fires first and makes the CLI's message
      unreachable. The refusal is correct either way — but if the reviewer would
      rather the CLI own that message, the fix is described in the PR's
      *Reviewer notes*.

### Smoke test: cleanup + rate-limit hardening (BEX-339 follow-up)

**Change:** Three defects the second live run exposed, all in `scripts/smoke-test.ts`:

1. `trapDeleteApps` logged `trap: deleted app <id>` without checking the exit
   status — `spawnSync` doesn't throw on a non-zero exit, so a delete that 401'd
   was recorded as a success and the orphan went unreported. It now checks
   `r.status`, logs the real reason, and prints an `⚠ ORPHANED APPS` block with
   the delete commands.
2. `Logout` and `Final cleanup` ran as ordinary steps *before* the post-run
   safety net, destroying the credentials and the linked binary it needed — so a
   leftover app could never be recovered. Added a `Cleanup: leftover apps` step
   ahead of them.
3. A rate-limited API failed every later step, including making the negative
   probes assert mapped messages against `Rate limited. Retrying in 5 seconds…`.
   `exec()` now retries centrally (5s/15s/30s) when a *failed* call looks
   rate-limited, and counts the waits.

Leaks and throttling are now visible in the summary and the `--report=` JSON
(`orphanedAppIds`, `rateLimitWaits`).

**Must hold true:**

- [x] Transient rate limit on one call → absorbed: one 5s wait, step passes, run
      green, `rateLimitWaits: 1` in the report.
- [x] Every `app delete` failing → run fails, `LEAKED 2 app(s)` in the summary,
      both ids in `orphanedAppIds`, orphan block printed with delete commands,
      and the ids really are still on the (mock) account — report matches reality.
- [x] Trap log never claims an unverified delete: `trap: FAILED to delete app
      <id> (exit 3): <reason>`.
- [x] No regression: clean run 26/26; gated run 14 passed / 12 skipped; both
      self-cleaning. Typecheck + prettier clean.
- [x] Sonar: 7 code smells in `scripts/smoke-test.ts` fixed (S8786 regex
      backtracking → line-based stack-frame detector, S3358 ×2, S4624, S6551,
      S7776, S1135). Zero security hotspots. The other 7 findings on the PR are
      pre-existing in `src/` files this branch doesn't touch.
- [ ] **Live re-run still pending.** The fixes above are verified against a mock
      `brevo` only. Re-run `yarn smoke --skip-auth` on a real account to confirm
      end to end — ideally against staging rather than a shared prod account,
      which is what throttled the last run and made the orphan real.
- [ ] Clean up after the pre-fix run: `brevo app list` and delete anything named
      `brevo-cli-smoke*` (`brevo app delete --app-id <id> --force`). That run's
      public-app delete was rate-limited and the trap's "deleted" line was the
      unverified log fixed in point 1, so one may still exist. App ids aren't
      recorded here — this repo is public.

### Smoke test: split into per-flow suite modules (BEX-339 follow-up)

**Change:** `scripts/smoke-test.ts` was one 2141-line file. Split so either
lifecycle can run on its own:

| File | Role |
| --- | --- |
| `scripts/smoke-test.ts` | Runner — flags, suite registry, step composition, summary, report |
| `scripts/smoke/core.ts` | Shared plumbing: state, logging, exec + rate-limit retry, assertions, capability detection, create/upload/delete helpers, teardown, traps |
| `scripts/smoke/private-app.ts` | `privateAppSuite` |
| `scripts/smoke/public-app.ts` | `publicAppSuite` |
| `scripts/smoke/init-wizard.ts` | `initWizardSuite` (opt-in) |

Selection is `--suite=private|public|init|all` (comma-separated, default
`private,public`). `--with-public` / `--skip-public` / `--with-init` are kept as
aliases. Setup (pre-flight, install, auth) and teardown (leftover-app cleanup,
logout, uninstall) always run, so each suite stands alone — the public suite
creates its own app and never depends on the private one.

The extraction was mechanical: all 127 top-level blocks were indexed and
verified to be covered exactly once (no gaps, no overlaps) before reassembly, so
no step logic changed in the move.

**Must hold true:**

- [x] Typecheck (`--strict --noUncheckedIndexedAccess`) and prettier clean across
      all five files.
- [x] `--suite=private` → 16 steps, `--suite=public` → 16, default → 26,
      `--skip-public` → 16. All pass, all self-cleaning.
- [x] `--suite=frobnicate` is rejected, listing the valid names.
- [x] Public suite alone against a build without the review commands:
      8 passed / 8 skipped, still green.
- [x] Failure modes survive the split: gated build 14 passed / 12 skipped;
      every-delete-failing still reports `ORPHANED APPS` + `LEAKED 2 app(s)`;
      transient rate limit still absorbed with one 5s wait.
- [x] **Live run, real account, correct binary** — 26/26. Step 2 reported
      `brevo 2.0.1 at ~/.yarn/bin/brevo`, matching `package.json`, so this
      exercised the branch build. Observed: upload bumped to version `0.0.2`;
      no-op upload reported up-to-date; public status `configured` throughout;
      submit returned a review form URL and the repeat submit was idempotent;
      withdraw mapped to `NOT_SUBMITTED` at exit 0; unknown app id → exit 5 for
      both `status` and `withdraw`; account left at its baseline app count.
- [ ] **Do not run this suite via `yarn smoke` until the version guard lands**
      (see the PR's *Reviewer notes*). yarn prepends `node_modules/.bin` ahead of any exported
      PATH, and this repo currently has a stray undeclared `@dtsl/brevo-cli`
      symlinked there. An earlier live run passed 26/26 against *that* package
      instead of the branch build. Invoke it directly meanwhile:
      `PATH="$HOME/.yarn/bin:$PATH" ./node_modules/.bin/tsx scripts/smoke-test.ts --skip-auth`

### Upload write-back reads top-level `distribution_type` from the response

**Change:** `uploadProjectConfig` (`src/commands/app/upload.ts`) read the
server-confirmed distribution only from `response.auth.distribution_type` — a
shape the upload-service owners confirmed **no server build has ever emitted**
(the upload response returns `distribution_type` top-level; its `auth` block
carries only `scopes` + `redirect_uris`, per the service's locked OpenAPI
contract). The `?? config.distribution_type` fallback masked the break —
nothing errored, but the write-back never persisted the server-confirmed value.
The read is now `response.distribution_type ?? config.distribution_type`; the
nested read was dropped entirely as confirmed-dead code, so there is no
backward-compat concern. `UploadAppResponse` gained the top-level field, and
its `auth.scopes`/`auth.redirect_uris` are typed `string[] | null` — the
service owners confirmed they come back `null` (not absent, not `[]`) when the
stored snapshot has no OAuth block (UI-only apps). Request payload is
untouched — `UploadAppPayload` still nests `distribution_type` under `auth`,
which the service owners confirmed remains the locked request contract
(top-level would 400 under strict binding; no move planned).

**Must hold true:**

- [x] A response with top-level `distribution_type` persists the server value
      into `app-config.json`. Covered by the new `upload.test.ts` case
      (`persists the server-confirmed distribution_type…`), watched failing
      before the fix.
- [x] A response with `"auth":{"scopes":null,"redirect_uris":null}` keeps the
      locally-sent scopes/redirect URLs — no nulls persisted, no crash. Covered
      by `keeps the local scopes/redirect URLs when the response auth carries
      nulls`.
- [x] A response missing `distribution_type` entirely still falls back to the
      local config value (`??` chain unchanged on that side).
- [x] Full suite green (732/732), `tsc --noEmit` clean, lint clean.
- [ ] Manual: `brevo app upload` against a current server build, then inspect
      `app-config.json` — `distribution_type` must match the server's echo, not
      merely the pre-upload local value.

### Upload request sends top-level `distribution_type`; server enforces immutability, CLI fast-fails drift

**Change:** Decision reversed from the earlier "drop the field" plan on this
branch: the upload *request* keeps `distribution_type`, moved from `auth` to
the **top level** of the body — fixing the request/response asymmetry (the
response and `OAuthApp` were always top-level; distribution is an app-level
attribute, not an OAuth setting). The server side (BEX-355) declares the
top-level field and rejects drift with its 422 ("distribution_type cannot be
changed via upload"). The client-side guard added on this branch **stays** as
a fast-fail UX layer: after the (pre-existing) remote fetch, if the remote
distribution differs from `app-config.json`'s, `uploadCommand` throws
`APP_UPLOAD_DISTRIBUTION_IMMUTABLE` before rendering the diff, prompting, or
pushing — in interactive, `--yes`, and `--json` modes alike. The guard is
skipped when the server reports no distribution (server check is then the only
enforcement). The response side is unchanged (top-level `distribution_type`,
write-back as before). Docs already describe the field as immutable-with-error;
the changeset no longer claims the field is absent from the request.

**Must hold true:**

- [x] The upload POST body carries `distribution_type` at the **top level**
      (not under `auth`; `auth` carries only `scopes` + `redirect_uris`).
      Covered by the wire-shape test in `upload.test.ts` and the byte-for-byte
      pass-through test in `app.test.ts`.
- [x] Local `distribution_type` differing from the remote app blocks the upload
      with the immutability error — `uploadApp` and `writeProjectConfig` are
      never called. Covered by `blocks the upload when local distribution_type
      differs…`.
- [x] Full suite green (733/733), `tsc --noEmit` clean, lint clean.
- [ ] Server side (BEX-355): the upload request schema **declares top-level
      `distribution_type`** (strict binding must accept it; it must no longer
      require the old `auth.distribution_type` nesting) and validates it
      against the stored app — 422 with a "distribution_type cannot be changed
      via upload"-style message on mismatch, no partial write. Confirm whether
      the field is required or optional-when-present; the CLI always sends it,
      so either works, but the contract doc should say which.
- [ ] Sequencing: pre-BEX-355 server builds bind strictly and expect the old
      `auth.distribution_type` nesting — this CLI must not release before the
      server change deploys (note it in the PR).
- [ ] Manual: `brevo app upload` with matching `distribution_type` succeeds
      against the BEX-355 server build (top-level field in the request body).
- [ ] Manual: edit `distribution_type` in a real project's `app-config.json` to
      the other value and run `brevo app upload` — expect the CLI immutability
      error naming both values, exit non-zero, and no server call after the
      initial fetch. (Server 422 is the backstop if the guard is ever bypassed,
      e.g. remote fetch reports no distribution.)

### Upload `auth` block renames `redirect_urls` → `redirect_uris`

**Change:** The upload request/response `auth` block now uses `redirect_uris`,
the key every other surface already uses (create/PATCH endpoints, OAuth
service, stored snapshot, `OAuthApp`/`fetchApp`, RFC 7591). Upload was the lone
holdout with `redirect_urls`; renamed pre-release on both sides in the same
coordinated pass as the top-level `distribution_type` move (server:
`app-store-bo-be` `feat/bex-355-cli-snapshot-contract`). `UploadAppPayload`'s quirk
comment now lists only `app_version` as intentional divergence.
`app-config.json` follows in a second step (see the next entry): the local key
is now `auth.redirectUris` too, with the legacy `redirectUrls` still read and
migrated on write-back.

**Must hold true:**

- [x] The upload POST body's `auth` carries `redirect_uris` (not
      `redirect_urls`). Covered by the wire-shape test in `upload.test.ts` and
      the pass-through test in `app.test.ts`.
- [x] Write-back reads `response.auth.redirect_uris` (null tolerated, keeps
      locally-sent values). Covered by the null write-back test.
- [x] Full suite green (733/733), `tsc --noEmit` clean, lint clean.
- [ ] Server side: upload request binds `auth.redirect_uris`, response echoes
      the same key, and a body still sending `redirect_urls` gets the strict
      400 naming the key (proves the rename can't fail silently).
- [ ] Manual (against the paired server build): `brevo app upload` changing a
      redirect URL round-trips — new URL pushed, server echo written back into
      `app-config.json`.

### `app-config.json` renames `auth.redirectUrls` → `auth.redirectUris` (tolerant read, migrate-on-write)

**Change:** The local config key now matches the wire key: `ProjectConfig.auth`
carries `redirectUris`, `readProjectConfig` reads the legacy `redirectUrls`
when the new key is absent (new key wins when both are present) and drops it
from the returned object — so every write-back (`upload`, `app start`,
credentials backfill) migrates old projects automatically, same pattern as the
legacy `distribution`/`auth.type` handling. Scaffold template, user-facing
messages (`en.ts`), `SKILL.md`, README template, and QA cases all say
`redirectUris` now. **Known downgrade caveat (accepted):** older CLI releases
read only `redirectUrls`, so a migrated file fails loudly there
("No redirect URLs") — never silently.

**Must hold true:**

- [x] Legacy `redirectUrls` config is read correctly and the returned object
      carries only `redirectUris`. Covered by the three new
      `config.test.ts` cases (legacy read, both-keys precedence, write-back
      migration round-trip).
- [x] Full suite green (736/736), `tsc --noEmit` clean, lint clean.
- [ ] Manual: in a project whose `app-config.json` still says `redirectUrls`,
      run `brevo app upload` — upload succeeds and the file afterwards says
      `redirectUris` with the same values.
- [ ] Manual: fresh `brevo app create` scaffold writes `redirectUris`.

### Drop `cli_version` from request bodies and `cliVersion` from app-config.json

**Change:** `createApp` and `uploadApp` (`src/services/app.ts`) no longer spread
`cli_version` into the request body — the upload endpoint binds
strictly and 400s on unknown top-level keys, and the version already travels on
every request in the `User-Agent` header (`src/lib/telemetry.ts`). The scaffold
no longer stamps `cliVersion` into `app-config.json` (template line, `{{CLI_VERSION}}`
var, `ProjectConfig.cliVersion` type all removed — nothing ever read the field).
`source: 'cli'` on create is deliberately untouched (see `TODO.md`).

**Must hold true:**

- [x] `uploadApp` POSTs the `UploadAppPayload` byte-for-byte — no extra top-level
      keys. Covered by the updated `app.test.ts` assertion including an explicit
      `not.toHaveProperty('cli_version')`.
- [x] `createApp` body carries only the payload plus `source: 'cli'`. Covered by
      `app.test.ts`.
- [x] Template vars no longer include `{{CLI_VERSION}}` and the scaffolded
      `app-config.json` has no `cliVersion` line. Covered by `scaffold.test.ts`.
- [x] Full suite green: 730/730, lint clean, `tsc --noEmit` clean.
- [ ] Manual: `brevo app upload` against a strict server build (one that rejects
      unknown keys) succeeds where it previously 400'd. Blocked on access to a
      server build with the BEX-355 contract merged.
- [ ] Manual: `brevo app create` still succeeds against the current backend (which
      tolerated `cli_version`) — i.e. removing the key is backward-compatible with
      lenient builds too.
- [x] Reviewer: confirm with the upload-service owners that nothing *requires*
      `cli_version` in the body (telemetry should read the `User-Agent` header,
      which is unchanged and covered by `telemetry.test.ts` / `client.test.ts`).
      **Confirmed by the service owners 2026-08-03:** zero references to
      `cli_version` server-side — upload (strict) 400s on it, PATCH/create
      silently ignore it, and telemetry reads the structured `User-Agent` from
      the request log. The header approach is final.
- [ ] Manual: run `brevo app upload` in a project whose `app-config.json` still
      carries a legacy `cliVersion` field — upload must succeed and the write-back
      may silently drop the field (fill-only semantics unaffected).

### Upload response version key: `version` is canonical, `app_version` is the fallback

**Change:** Verified against the BO source (`app-store-bo-be`
`http_cli_upload_app.go`): the upload *response* returns the bumped version
under `version` (plus optional `display_version`), not `app_version` — that
name is request-side only. `UploadAppResponse` (`src/types.ts`) and the
write-back in `src/commands/app/upload.ts` now read `version` first with
`app_version` kept as a tolerated fallback (precedence flipped; both keys were
already read, so no behavior change against any real server build). Test
fixtures updated to mirror the BO response shape. Redirect naming was
re-confirmed in the same pass and has since been aligned: upload used to be
the lone endpoint saying `redirect_urls`; the key is now `redirect_uris`
everywhere (see the rename entry below).

**Must hold true:**

- [x] A response carrying only `version` persists and prints the bumped value.
      Covered by `upload.test.ts` (canonical fixtures now use `version`).
- [x] A response carrying only `app_version` still works (tolerance path).
      Covered by `captures the new version when the upload response names it
      'app_version'`.
- [x] Full suite green: 733/733, lint clean.
- [ ] Manual: `brevo app upload` against a real backend — confirm the printed
      and persisted version match the server's bumped `version` value.

### UI apps: `auth: { "type": "none" }` and slimmer app-config.json

**Change:** A UI app's config no longer carries an OAuth block: `auth` is
exactly `{ "type": "none" }` — no scopes (the `DEFAULT_UI_APP_SCOPES` constant
is gone), no redirect URIs, no jwtSecret. On the wire, `POST /apps` for a UI
app omits the `scopes` key and the upload payload omits the whole `auth` key
(ASSUMED server-tolerated — see *Before UI-apps GA*). `app upload` enforces
the shape both ways: a UI-app config with `scopes`/`redirectUris` is rejected,
as is `"type": "none"` on a config without `ui_app`. Additionally the unused
`permittedUrls` and `support` sections were dropped from the scaffolded
config for **both** app types (nothing ever read them); the read path strips
them from legacy files so the next write migrates. The read path also carves
`"none"` out of the interim `auth.type` → `distribution_type` migration.

**Must hold true:**

- [x] UI-app create sends no `scopes`/`redirect_uris` keys; upload sends no
      `auth` key; write-back restores `auth: { type: 'none' }` verbatim.
      Covered in `create.test.ts` / `upload.test.ts`.
- [x] Auth-shape mismatches fail with actionable errors (3 paths covered in
      `upload.test.ts`).
- [x] `readProjectConfig` preserves `auth.type: "none"` (not folded into
      `distribution_type`, not deleted as the interim key) and drops
      `permittedUrls`/`support`. Covered in `config.test.ts`.
- [x] OAuth flows unchanged: same create/upload payloads, scopes and redirect
      validation intact. Full suite green: 885/885.
- [ ] Manual: create a UI app end-to-end from a local build, inspect the
      written `app-config.json` (auth block, no permittedUrls/support), and run
      `brevo app upload` against a real backend to confirm the server accepts
      the auth-less payload.
- [ ] Manual: `brevo app upload` in an OAuth project scaffolded by an older
      build (file still has `permittedUrls`/`support`) — upload succeeds and
      the write-back drops both sections.

### UI-app create: registry-driven prompts (BEX-361) + integration-type prompt

**Change:** `brevo app create`'s UI-app path now fetches
`GET /v3/app-store/surface-points?extensionType=actionLink` before any placement
prompt (fetch-only, NO local-mirror fallback — failure aborts with an actionable
message) and builds pages/kind/positions/context choices from the fetched rows;
`surface_point_list` is the selected rows' `extension_point` names, validated
against the fetched list (`validateUiApp` gained an optional `allowedPoints`
param; upload still defaults to the local mirror). New integration-type prompt:
External link selectable, Modal iframe disabled ("coming soon"). Context prompt
becomes a checkbox of the selected rows' `allowed_context_field` union, with
free text only when no row declares one. Field prompts now describe what they
render as (heading = link label, subheading = tooltip, redirect = URL).

**Must hold true:**

- [x] Fetch failure / empty registry aborts before any placement prompt, no app
      created, OAuth path unaffected. Covered in `create.test.ts`.
- [x] Choices (pages, positions, labels, context union) come from the fetched
      rows; a registry-only point validates at create (allowed-points threading).
      Covered in `create.test.ts`.
- [x] Modal iframe choice is disabled and unselectable; the answer threads into
      `extension_type`. Covered in `create.test.ts`.
- [x] `app upload` pre-flight is unchanged (local mirror; no fetch). Full suite
      green: 901/901, lint clean.
- [ ] Manual (needs BEX-361 deployed): run the UI-app flow end-to-end against a
      seeded registry — verify labels, the context checkbox, and that the
      created `app-config.json` carries the selected `extension_point` names.
- [ ] Manual: run `brevo app create` → UI app against an environment WITHOUT
      BEX-361 — verify the actionable abort (QA TC-12.2b).

### Smoke suite: assert on `auth.redirectUris` (post-rename drift fix)

**Change:** `scripts/smoke/core.ts` only. The BEX-366 rename of app-config.json's
`auth.redirectUrls` → `auth.redirectUris` landed without updating the smoke
harness, so the create/upload steps in both lifecycles failed on the old key
(`auth.redirectUrls is not an array: undefined`) before the upload CLI call even
ran, cascading into the rename-verify and public status/submit steps. The six
assertion/write sites now use `redirectUris`. No test case removed, no `src/`
change, no user-visible CLI behavior change (so no changeset).

**Must hold true:**

- [x] `npx tsc --noEmit -p scripts/tsconfig.json` passes.
- [x] The key the smoke script reads/writes matches what the CLI scaffolds
      (`src/templates/files/app-config.json.tmpl` writes `auth.redirectUris`).
- [ ] Manual: `yarn smoke` against staging — steps 4/6/8 (private create,
      upload, verify rename) and 14–21 (public lifecycle) pass. If public
      status/submit still fail *after* a successful upload, that is a
      backend-side question (review snapshot), not this fix.
- [ ] Manual: rerun requires a `dist/` owned by the current user (a prior
      `sudo` run left it root-owned; `sudo chown -R "$(whoami)" dist` first).

### Unified create/upload payload structure + `auth: {}` for UI apps

**Change:** `POST /v3/app-store/apps` (create) now sends the same structure as
the upload payload: OAuth fields travel inside `auth: { scopes, redirect_uris }`
instead of top-level `scopes`/`redirect_uris` keys (UI apps omit the block
entirely, as before). The upload request's version field is renamed
`app_version` → `version`, matching the response and every app object. A UI
app's `app-config.json` auth marker changed from `auth: { "type": "none" }` to
the empty object `auth: {}` — the scaffold template, upload write-back,
`validateAuthShape`, and the config read path (which now drops any legacy
`auth.type`, migrating dev-era files on next write) all follow. Docs updated in
`SKILL.md`/`AGENTS.md`.

**⚠️ Server dependency — do not release ahead of the backend.** Unlike the
UI-app assumptions above, `POST /apps` is live in production for OAuth apps: a
CLI sending nested `auth` against a server that still binds top-level
`scopes`/`redirect_uris` would create apps with no OAuth config (or 400). The
create endpoint must accept the nested block — and the upload endpoint the
`version` key — before this ships.

**Must hold true:**

- [x] `buildCreatePayload` (OAuth) emits `auth: { scopes, redirect_uris }` and
      no top-level `scopes`/`redirect_uris`; UI apps emit no `auth` key at all.
      Covered in `create.test.ts`.
- [x] Upload payload carries `version` (no `app_version` key); the response
      read path still tolerates both. Covered in `upload.test.ts` /
      `app.test.ts`.
- [x] Scaffolded UI-app `app-config.json` carries `auth: {}` and parses as
      valid JSON; `readProjectConfig` drops a legacy `auth.type: "none"`
      without misreading it as a distribution. Covered in
      `conditionals.test.ts` / `config.test.ts`.
- [x] Full suite green: 899/899, lint clean.
- [ ] Manual (blocked on backend): create an OAuth app against a server build
      that accepts nested `auth` — verify scopes and redirect URIs land on the
      app. Then `brevo app upload` — verify the server accepts `version` and
      the confirmed version is written back.

### `ui_app` field names renamed to snake_case (keys only; values stay camelCase)

**Change:** Every field NAME in the `ui_app` block is now snake_case, in
`app-config.json` and on the wire (the upload payload carries the block
verbatim, so both change together): `extensionType` → `extension_type`,
`surfacePointList` → `surface_point_list`, `redirectLink` → `redirect_link`,
`linkTarget` → `link_target`, `modalIframeUrl` → `modal_iframe_url`
(`heading`, `subheading`, `context`, `version` were already single words).
Field VALUES are unchanged — `extension_type: "actionLink"`, slot names like
`contactDetails.headerMenu.action`, `_blank`. The
`GET /v3/app-store/surface-points?extensionType=` query parameter is a
separate endpoint contract (BEX-361) and is deliberately NOT renamed. There is
no read-path alias for the old camelCase keys — no config exists in the wild
while the feature is pre-GA, same stance as the BEX-350 value-casing decision.
Validation error messages now name the snake_case fields. Docs
(`SKILL.md`/`AGENTS.md`/`QA-TESTCASES.md`/changeset) updated in the same
change.

**⚠️ Server dependency — same caveat as the unified payload above.** The
snake_case block must be what the upload endpoint binds and what the manifest
read path / UI kit consume. Confirm against the platform before GA.

**Must hold true:**

- [x] `brevo app create` (UI path) writes a `ui_app` block with only
      snake_case keys; the created-app box renders from the renamed fields.
      Covered in `create.test.ts` (`builds the ui_app shape the platform
      consumes`).
- [x] `brevo app upload` sends the snake_case block under the `ui_app` wire
      key and validates the renamed fields (`ui_app.extension_type`,
      `ui_app.surface_point_list`, …) with messages naming the new keys.
      Covered in `upload.test.ts` / `validators.test.ts`.
- [x] `fetchSurfacePoints` still queries `?extensionType=` (unrenamed).
      Covered in `services/app.test.ts`.
- [x] Full suite green: 899/899; `tsc --noEmit` clean.
- [ ] Manual (blocked on backend): upload a UI app against a server build and
      confirm the snake_case block is accepted and echoed back; deploy and
      confirm the action link renders (proves the manifest/UI-kit path reads
      the snake_case names).

### BEX-290 — record pages come from `/surface-points/locations` (2026-08-06)

**Change:** `brevo app create`'s UI-app path no longer pulls the whole
extension-point registry to work out which record pages exist. The two registry
reads now ask different questions:

1. `GET /v3/app-store/surface-points/locations` → `{ locations, count }`, the
   registry's distinct `location_name` values, for the record-page prompt
   (`appService.fetchSurfacePointLocations`, `ENDPOINTS.APP_STORE_SURFACE_POINT_LOCATIONS`).
2. `GET /v3/app-store/surface-points?location=<csv>` → the rows, once, for the
   placements on the pages that were picked. This is now the ONLY row read in the
   flow.

Partner-visible prompts are unchanged. Two behavioural consequences:

- **The extension type can no longer be checked before the page prompt** — a list
  of location names carries no `extension_type_list`. So a page whose every
  placement is un-hostable is offered, then reported as a warning and skipped once
  the rows arrive, and `APP_CREATE_UI_POINTS_NONE_FOR_TYPE` is raised *after* the
  page prompt instead of before it. This makes the existing dropped-page warning
  path more reachable, not less — it is load-bearing now.
- **The narrowed read has no already-held superset to fall back on**, so a read
  that fails, or that covers fewer of the picked pages than were asked for, is
  retried UNFILTERED and narrowed client-side. Only a failure of both aborts.
  Tracked for removal once `?location=` is confirmed honoured (TODO.md).

**Must hold true:**

- [x] `yarn lint && yarn test` green (47 suites / 979 tests); `tsc --noEmit` clean.
- [x] The page prompt offers exactly what the locations endpoint lists, not a
      reduction of the rows. Covered by `offers exactly the pages the locations
      endpoint lists` (`create.test.ts`), where the row fixture covers three pages
      and only the two listed ones are offered.
- [x] One locations read + one row read on a clean run, with the row read narrowed
      to the picked pages. Covered by `reads the pages from the locations endpoint,
      then the picked pages by location`.
- [x] The unfiltered retry fires on a failed narrowed read, an empty one, and one
      covering only some picked pages — and both reads failing aborts with the
      actionable message. Four cases in `create.test.ts`.
- [x] A locations read that fails or returns `[]` aborts before anything is asked
      and before any row read is attempted.
- [x] A page with rows but none that can host the chosen type is warned about and
      skipped, and the placement prompt stays satisfiable (the prompt-lock
      regression). Covered by the `a picked page with no placement that can host the
      chosen type` describe.
- [ ] Manual (blocked on BEX-361 shipping): run `brevo app create` → UI app against
      a real environment and confirm the locations endpoint's shape, that the page
      prompt matches the registry, and that `?location=` is honoured (which lets the
      retry go).
- [ ] Reviewer: no agent-doc change is proposed. `SKILL.md`/`AGENTS.md` describe this
      as "reads the available placements from the platform's extension-point
      registry" without naming endpoints, and no command, flag, prompt, exit code or
      message changed — so this is not user-visible CLI behaviour under CLAUDE.md's
      definition. Confirm that reading.
