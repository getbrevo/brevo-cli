# TODO — running work tracker

A running list of work to do. Append new items at the bottom of "Open"; move finished
items to "Done" with the date.

**Status key:** `[ ]` open · `[~]` in progress · `[x]` done · `[!]` blocked

---

## Open

- [ ] **Backfill `version` into `app-config.json` from `brevo app credentials` / re-scaffold.**
  `brevo app upload` (formerly `update`) now backfills a legacy `app-config.json`
  missing the `version` field (added in `add-app-version-config`) on its next run —
  see `TESTING.md`. But a project a developer never runs `upload` on stays without
  `version` indefinitely:
  `brevo app credentials` doesn't write to `app-config.json` at all, and re-running
  `brevo app scaffold` against an existing project only fills in missing template
  files (`mergeOnly`), it doesn't update the config's `version` if the file already
  exists. Mirrors the existing distribution-type migration pattern above — worth
  wiring the same one-time backfill into at least `app credentials` for parity.
  — (relates to `add-app-version-config`; see `TESTING.md`)

- [ ] **Extract the `chooseAgain` directory-retry loop into a shared helper.**
  The pattern `let dir = await resolveProjectDirectory(...); while (dir.chooseAgain)
  { dir = await resolveProjectDirectory(...); }` used to be duplicated 3 times. The
  create/scaffold feature split removed the two copies in `scaffold.ts` (the
  `resolveDirectoryOrCancel`/`resolveScaffoldTarget` helpers were deleted), leaving
  a single copy in `create.ts`'s `resolveCreateDirectory`. Low priority now that
  it's no longer duplicated, but still worth folding the loop into
  `resolveProjectDirectory` itself if it ever grows a second caller again.
  — (relates to `add-app-version-config`; see `TESTING.md`)

- [ ] **Wrap directory-resolution filesystem calls in try/catch with a friendly
  `CliError`.** Neither `resolveProjectDirectory` (scaffold.ts) nor
  `resolveCreateDirectory`'s non-interactive branch (create.ts) wraps
  `fs.mkdirSync`/`process.chdir` in a try/catch — a permissions error or a TOCTOU
  race (directory removed between mkdir and chdir) would surface as a raw Node
  error instead of a friendly `CliError` message. Worth fixing in both places
  together in a follow-up. — (relates to `add-app-version-config`; see `TESTING.md`)

- [ ] **Wire the Submitted/In-Review lifecycle lock into `brevo app upload`.** BEX-254's
  disposition (superseded by BEX-250) calls for blocking `upload` when the app's
  current state is `Submitted` or `In Review`. Deferred because BEX-252 (status)/
  BEX-253 (withdraw) — the tickets that would introduce a state field/endpoint to
  read — don't exist in this codebase yet. Wire this in once either lands.
  — (relates to `BEX-250-app-upload`; see `TESTING.md`)

- [ ] **Confirm `ui_app` passthrough risk with backend.** `brevo app upload` never
  sends `ui_app` (local config has no field for it). If the upload endpoint treats a
  missing `ui_app` as "clear the existing value" rather than "leave untouched," any
  app that has one set (e.g. via a future dashboard UI) would have it silently wiped
  on the next CLI upload. Confirmed accepted risk for this pass — revisit if/when
  `ui_app` authoring becomes CLI-relevant.
  — (relates to `BEX-250-app-upload`; see `docs/superpowers/specs/2026-07-23-app-upload-replaces-update-design.md`)

- [ ] **Fix case mismatch so app-limit-reached shows the friendly error message.**
  `brevo app create` (and `brevo app scaffold`'s create step) fails silently with
  the raw API fallback message instead of `messages.APP_CREATE_LIMIT_REACHED` when
  a user hits the 10-app limit. Root cause: the API returns `{"code":
  "app_limit_reached"}` (lowercase — confirmed from a real `422` debug log), but
  `mapErrorCode`/`apiCodeMessages` in `src/api/client.ts:26-33,106-108` only match
  the uppercase literal `'APP_LIMIT_REACHED'`, so `ApiError.errorCode` never gets
  set and the friendly-message branch in `src/commands/app/create.ts:294` never
  fires. Fix by comparing case-insensitively (or normalizing `apiCode` to
  uppercase before the lookup) in both `apiCodeMessages` and `mapErrorCode`.

- [ ] **De-duplicate `CLI.APP_SUBMIT` with the `brevo app submit` work.** `feat/app-withdraw`
  added `CLI.APP_SUBMIT` in `src/lib/constants.ts` purely for the withdraw `422` "submit first"
  hint; `brevo app submit` itself is WIP by another dev. When that branch lands, keep a single
  declaration rather than two. — (relates to `feat/app-withdraw`; see `TESTING.md`)

- [ ] **Verify the `brevo app withdraw` request body shape against the real API.**
  `withdrawApp` currently POSTs with no body (`client.post(ENDPOINTS.APP_STORE_APP_WITHDRAW(id))`).
  Confirm the endpoint doesn't require a payload (e.g. `cli_version`, which `create`/`upload`
  send). If it does, add it in `src/services/app.ts` and update the service test.
  — (relates to `feat/app-withdraw`; see `TESTING.md`)

---

## Done

- [x] **Migrate old users' config distribution type on write-back.** (2026-07-23)
  Existing users have `app-config.json` files carrying the distribution type in the
  legacy top-level `distribution` key (or none at all). `readProjectConfig()` already
  backfilled `auth.type` at read time, but the on-disk file was never rewritten. Fixed
  centrally in `readProjectConfig()`: the legacy top-level `distribution` key is no
  longer forwarded into the returned config object, so any caller that writes it back
  (`update.ts`, `start.ts`) now naturally drops it and re-affirms `auth.type` on the
  next write — no per-call-site changes needed. Also narrowed `auth.type` from `string`
  to `'private' | 'public'`. — (relates to `enable-public-app`; see `TESTING.md`)
  **Superseded by the entry below** — `auth.type` itself was relocated the same day.

- [x] **Move `distribution_type` out of `auth` to a top-level field.** (2026-07-23)
  Per the resolved discussion on the [Product solutioning doc](https://app.notion.com/p/374449002dcb80cbb029e0f73a044e52#376449002dcb80ce81b7ddb295ec1614)
  ("distribution_type would be moved out and reflect auth as well"), `ProjectConfig`
  now carries `distribution_type: 'private' | 'public'` as a top-level field (matching
  the real `brevo app upload` payload shape), and `auth` is back to just
  `{ scopes, redirectUrls }`. `readProjectConfig()` backfills `distribution_type` from
  whichever shape is on disk, in order: new top-level `distribution_type` → interim
  `auth.type` (never actually released) → oldest legacy top-level `distribution`
  (every currently-published scaffold) → defaults to `'private'` if none are present.
  All three legacy shapes are dropped on the next write-back. — (relates to
  `BEX-255_change`; see `TESTING.md`)
