# RELEASE CHECKLIST

This file has **two sections with different lifetimes** — read this header before
editing or deleting anything in it.

| Section | Lifetime |
| --- | --- |
| `## Before public-apps GA` | **Durable.** Merges into `main` and stays there until public app distribution ships. Do **not** delete it during branch cleanup. |
| `## Per-branch verification` | **Scratch.** Per-branch working state — clear it before merging the branch into `main`, but keep the file and the section heading. |

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
- [ ] `README.md`'s command table is drifted independently of this change: it still
      lists `brevo app update` (replaced by `brevo app upload`) and omits
      `brevo app status` / `submit` / `withdraw` / `available-scopes`. Worth a
      separate pass.

---

## Per-branch verification

Append an entry per change that needs verifying. Clear this section (keep the
heading) before merging into `main`.

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
