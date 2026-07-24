# `brevo app upload` replaces `brevo app update` — design

_Date: 2026-07-23_

## Source of truth

[BEX-250 — CLI: Brevo app upload command](https://mailinblue.atlassian.net/browse/BEX-250) is the
canonical ticket for this work. This doc proposes the rewrite of BEX-250's user story and
acceptance criteria (to replace "update" framing with "upload") plus the disposition of
[BEX-254](https://mailinblue.atlassian.net/browse/BEX-254). Once approved here, BEX-250 gets
updated directly on Jira.

Context pulled from:

- [Slack thread, 2026-07-20/22](https://sendinblue.slack.com/archives/CNU7CDD3L/p1784705202914079?thread_ts=1784562756.951049&cid=CNU7CDD3L) —
  Mauricio Mourraille (product) confirms the flow order and that submission metadata
  (description, support/contact info) lives in the Google Form, not the manifest.
- [Notion: Product solutioning — Public Applications via the CLI (v1)](https://app.notion.com/p/sendinblue/Product-solutioning-Public-Applications-via-the-CLI-v1-374449002dcb80cbb029e0f73a044e52) —
  the broader lifecycle design (`Configured → Submitted → In Review → Approved/Rejected`).
- A live example request against `POST /v3/app-store/apps/{app_id}/upload`.

## Decisions (confirmed 2026-07-23)

1. **`brevo app update` is fully removed**, not deprecated-in-place. The command is
   deregistered — `brevo app update` becomes an unknown command, same as any other
   removed subcommand. No stub, no forwarding shim.
2. **The API contract is confirmed** — `POST /v3/app-store/apps/{app_id}/upload`,
   snake_case payload with `auth.distribution_type`/`auth.redirect_urls`/`app_version`.
   See "Resolved" section below for the exact shape and the field-naming quirks to
   preserve. (BEX-250's own ticket text says `POST /cli/apps/{app_id}/upload` — that's
   now known to be stale/inaccurate; the `v3/app-store` path is authoritative.)
3. **`ui_app` (extension_point / action_link / trigger / context_properties) is out of
   scope and never sent.** The CLI does not author, prompt for, or validate this block,
   and does not fetch-and-passthrough an existing value either — confirmed accepted
   risk, see "Resolved" section below.
4. **BEX-254 is superseded, not independently implemented.** See disposition below.
5. **No `--app-id` flag on `upload`.** Unlike `update.ts`, `upload` resolves the app
   *only* from `app-config.json` in the current working directory. There is no flag
   override. If the current directory has no usable `app-config.json`, `upload` hard
   errors — it never silently does nothing and never falls back to a flag.
6. **The pre-upload diff is unconditional.** `upload` always fetches the existing
   remote app state and shows the local-vs-server diff before pushing — even under
   `--yes` (which only skips the confirmation prompt, not the diff) and `--json`
   (which includes the diff in the structured output instead of skipping it).

## Revised user story — BEX-250

> As a developer with a configured Brevo app, I want to push my local `app-config.json`
> to Brevo via `brevo app upload`, so that my scopes, redirect URIs, name, logo, and
> version are validated and synced with the server — with `upload` being the only CLI
> command that pushes config changes (there is no separate `update` command).

### Acceptance criteria

- `brevo app update` no longer exists as a command (removed from `definitions.ts`,
  `constants.ts` `CLI.*`, `en.ts` messages, help output, `AGENTS.md`, `SKILL.md`).
- `brevo app upload` takes **no `--app-id` flag**. It only reads
  `app-config.json` from the current working directory (`readProjectConfig`). There is
  no other way to point it at an app.
- Run outside a directory with a usable `app-config.json` → hard error (exit 1),
  telling the user to either `cd` into the project directory that has the app's
  `app-config.json`, or run `brevo app create`/`brevo app scaffold` to set one up. Same
  applies when the file exists but is invalid JSON or missing `appId` — reuse
  `update.ts`'s existing `assertConfigFileUsable`/`APP_UPDATE_INVALID_JSON`/
  `APP_UPDATE_MISSING_APP_ID`-style checks (renamed to `APP_UPLOAD_*`).
- **Before pushing anything, always fetch the existing remote app state and render a
  local-vs-server diff** (name, redirect URLs, scopes, logo, version) — same shape as
  `update.ts`'s `renderUpdateSummary`/`fetchExistingApp`, but no longer conditional on
  `!options.json`. Under `--json`, the diff is emitted as structured data instead of the
  human-readable block; under `--yes`, the diff still renders, only the confirmation
  prompt is skipped.
- Config → payload mapping covers the fields `update` already handled: `appName`,
  `logoUri`, `auth.scopes`, `auth.redirectUrls`, plus the new `version`/`app_version`
  field. Exact wire field names (snake_case vs camelCase, nesting of distribution type)
  depend on decision #2 above and are **not locked in this doc**.
- Unchanged config → exit 0, "already up to date at version X."
- Accepted new version → exit 0, prints new version, writes the server-confirmed state
  back into `app-config.json` (same pattern as `update.ts`'s existing
  `writeBackProjectConfig`).
- Rejected (e.g. `app_version_outdated`, or any other server-side validation error) →
  exit 1, human-readable message. No CLI-side pre-validation beyond what `update.ts`
  already did (redirect URL protocol check, legacy `all`-scope block) — compliance
  validation (scopes, callback URIs, mandatory-field checks) is server-side, per the
  Notion doc's "Local app-config.json gets validated against the server."
- **Lifecycle gate (absorbed from BEX-254):** if the app's current state is `Submitted`
  or `In Review`, `upload` is blocked — exit 1, current state shown — matching the
  Notion doc's "locked" semantics ("Once the submitted app enters in review then it
  becomes locked, meaning the configuration can't receive further changes until the app
  comes out of this state"). Reuses the same state-read implementation as
  BEX-252 (status) / BEX-253 (withdraw), same as BEX-254 specified for `update`.
- `--json` support on every path; exit codes follow the standard 0/1/2/3/4/5 contract.
- No secrets in any output, `--json` or otherwise.

### Non-goals (carried into BEX-250)

- No `ui_app` authoring or validation (decision #3).
- No change to `brevo app submit`/`status`/`withdraw` beyond what BEX-250 already
  depends on for the lifecycle-state read.
- No client-side compliance pre-validation beyond what `update.ts` already enforced.

## BEX-254 disposition

BEX-254 ("CLI: `brevo app update` [changes]") was scoped around gating **`update`**
specifically. With `update` fully removed, BEX-254 has no command left to gate.
Recommendation: **close BEX-254 as superseded by BEX-250**, and fold its one concrete
requirement — the Submitted/In-Review lock check — into BEX-250's acceptance criteria
above, rather than losing it. BEX-254's soft dependency on BEX-248 ("App Locking
Management") carries over to BEX-250 for the same reason.

## Resolved (2026-07-23, confirmed by user)

### Endpoint and payload — decision #2 is now locked in

`POST /v3/app-store/apps/{app_id}/upload`. Confirmed request/response shape:

```json
{
  "app_id": "b3218c78-0b09-4fef-a5ed-8280b54a6b82",
  "name": "test2.0.0",
  "logo_uri": "",
  "app_version": "0.0.2",
  "auth": {
    "distribution_type": "private",
    "scopes": ["account:read", "account:write", "..."],
    "redirect_urls": ["http://localhost:3010/auth/callback"]
  }
}
```

Two field-naming quirks vs. the rest of the API, both intentional per the confirmed
contract, not to be "normalized" away:

- `distribution_type` moves **into** the `auth` object on the wire, even though local
  `app-config.json` keeps it as a top-level `distribution_type` field (per the
  already-shipped `BEX-255_change` decision) — the CLI's own config shape and the
  upload wire shape are allowed to differ; `upload.ts` is responsible for the
  translation in both directions (request: lift `distribution_type` into `auth`;
  response: pull it back out to top-level before writing `app-config.json`).
- The version field is `app_version` here (top-level, sibling of `auth`), not `version`
  like the `GET`/`list` responses (`OAuthApp.version`). This is upload-specific wire
  naming — do not reuse `OAuthApp` for the upload request/response type; define a
  dedicated `UploadAppPayload`/`UploadAppResponse` shape in `src/types.ts`.
- Redirect URLs are `redirect_urls` (not `redirect_uris`, unlike every other endpoint
  in this codebase — `create`/`update`/`GET` all use `redirect_uris`). Another
  upload-specific wire quirk to preserve exactly, not "fix" for consistency.

### `ui_app` — never sent (decision confirmed, risk accepted)

Local `app-config.json` has no field for `ui_app` and never will in this pass. `upload`
never includes it in the request body. If the server treats a missing `ui_app` as
"clear the existing value" rather than "leave untouched," that's an accepted,
documented risk (flagged in `TODO.md`) — not solved by fetch-and-passthrough. This
keeps `upload`'s payload construction simple and avoids depending on the shape of a
field the CLI doesn't understand.

### Lifecycle gate — deferred entirely

BEX-252 (status)/BEX-253 (withdraw) don't exist in this codebase — no state field on
`OAuthApp`, no state-read endpoint, no submit/withdraw commands. The Submitted/In-Review
lock check from BEX-254's disposition is **out of scope for this implementation pass**.
Everything else in the acceptance criteria ships now; the lock check is a `TODO.md`
follow-up once BEX-252/253 land.

### Flags — full-config push only, no edit flags

`brevo app upload` takes **only** `--yes` and `--json`. Unlike `update`, there is no
`--name`, `--redirect-uri`, `--scope`, or `--logo-uri`. To change any of those values,
edit `app-config.json` directly, then run `upload`. This is a bigger behavior change
than the original BEX-250 ticket implied (it only called out dropping `--app-id`) —
confirmed explicitly with the user because it collapses `update.ts`'s
`updateWithFlags`/`pushFullConfig` dual-path into a single push-only flow, and because
it ripples into every other message in the codebase that told users to run
`brevo app update --scope`/`--redirect-uri` as a one-liner fix.

### Ripple effect: messages referencing removed `update` flags

None of these are in `update.ts` itself — all need rewording to point at editing
`app-config.json` + running `upload` instead of a flag:

- `src/lang/en.ts`: `APP_CREATE_BOX_SCOPE_HINT`, `LEGACY_ALL_SCOPE_DEPRECATED_BLOCK`,
  `LEGACY_ALL_SCOPE_START_BLOCK`, `LEGACY_ALL_SCOPE_SCAFFOLD_SUBSTITUTED`,
  `APP_SCAFFOLD_SCOPES_TIP`, `APP_START_PORT_IN_USE`, `APP_START_CUSTOM_PORT_IN_USE`,
  `APP_START_REDIRECT_DECLINED`, `APP_START_REDIRECT_NON_INTERACTIVE`,
  `APP_SCOPES_USAGE_HINT`, `APP_SCOPES_WEB_SELECTED_PLACEHOLDER`.
- `start.ts`'s `ensureRedirectRegistered` calls `appService.updateApp()` (the `PATCH`
  service method, not the CLI command) directly to auto-register a new localhost
  redirect URL — this is internal, unrelated to the `update` CLI command's flag
  surface, and is **unaffected** by this change. `appService.updateApp()` stays exactly
  as it is; only the CLI-facing `update` command (`update.ts`, its `definitions.ts`
  entry, and its messages) goes away.

## Remaining open questions (non-blocking, deferred)

1. Full list of server error codes beyond `app_version_outdated` still isn't enumerated
   — `upload.ts` surfaces whatever message/status the server returns on rejection
   rather than hard-coding a full error-code catalog.
2. Lifecycle gate (see above) — deferred to a follow-up once BEX-252/253 exist.

## Next steps

1. ~~You review this doc and confirm the BEX-250 rewrite above.~~ Done — endpoint,
   payload, `ui_app`, lifecycle gate, and flag scope all confirmed 2026-07-23.
2. Push the revised description/acceptance criteria to BEX-250 on Jira and add a
   comment/transition on BEX-254 marking it superseded (not done as part of this
   implementation pass — flag to the user separately).
3. Move to an implementation plan via `writing-plans` — new `src/commands/app/upload.ts`
   + `uploadApp()` in `src/services/app.ts` + `UploadAppPayload`/`UploadAppResponse` in
   `src/types.ts`, removal of `src/commands/app/update.ts` and its tests,
   `definitions.ts`/`constants.ts`/`en.ts` updates (including the ripple-effect
   rewording above), and the `AGENTS.md`/`SKILL.md` sync required by this repo's
   CLAUDE.md for any user-visible command change.
