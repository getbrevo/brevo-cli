# `brevo app upload` replaces `brevo app update` — design

_Date: 2026-07-23_

> **Implementation status (as of the `add-app-version-config` branch): NOT
> IMPLEMENTED — proposal only.** On this branch `brevo app upload` does not exist,
> `brevo app update` is still fully registered (`src/commands/app/update.ts`,
> `definitions.ts`), and there is no `uploadApp()` in `src/services/app.ts`. This
> work is tracked separately under BEX-250 (its own worktree) and remains **blocked
> on open question #1** (endpoint + payload shape) below — nothing here has been
> synced to code yet because there is no implementation to sync to. Leaving this doc
> as the design of record; it will be reconciled against the code once BEX-250 lands.

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
2. **The API contract is unconfirmed and stays flagged, not guessed.** BEX-250's own
   description says `POST /cli/apps/{app_id}/upload`; the live example hits
   `POST /v3/app-store/apps/{app_id}/upload` with a different payload shape
   (snake_case, `auth.distribution_type`, `auth.redirect_urls`, plus a `ui_app` block).
   This doc does not pick one — it's called out below as the top blocker for
   implementation, to be confirmed with Shubham/backend before `src/services/app.ts`
   gets a `uploadApp()` implementation.
3. **`ui_app` (extension_point / action_link / trigger / context_properties) is out of
   scope.** The CLI does not author, prompt for, or validate this block. If it's already
   present in a given app's config (as in the live example, which is presumably an
   existing app's full record), `upload` passes it through unmodified. No scaffold
   changes, no new config fields for it in this pass.
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

## Open questions / blockers

1. **Endpoint and payload shape** (decision #2) — needs confirmation with
   Shubham/backend before the config→payload mapping in `src/services/app.ts` can be
   written. This blocks implementation, not this doc.
2. Full list of server error codes beyond `app_version_outdated` still isn't enumerated
   (carried over from BEX-250's original open question #3) — needed before writing exact
   CLI error copy in `en.ts`.
3. Whether the upload response echoes back the full canonical app record (so `upload`
   can write it back into `app-config.json` the way `update.ts` did) depends on
   decision #2 being resolved first.

## Next steps

1. You review this doc and confirm the BEX-250 rewrite above.
2. I push the revised description/acceptance criteria to BEX-250 on Jira (per your
   instruction that BEX-250 is the source of truth) and add a comment/transition on
   BEX-254 marking it superseded.
3. Once open question #1 (endpoint/payload) is resolved, we move to an implementation
   plan via `writing-plans` — new `src/commands/app/upload.ts`, removal of
   `src/commands/app/update.ts` and its tests, `definitions.ts`/`constants.ts`/`en.ts`
   updates, and the `AGENTS.md`/`SKILL.md` sync required by this repo's CLAUDE.md for
   any user-visible command change.
