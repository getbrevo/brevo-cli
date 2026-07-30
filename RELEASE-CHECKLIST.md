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

### Smoke test: correct-binary resolution + fatal abort

**Change:** Test/harness only — nothing under `src/` changed, so no changeset.

Three related fixes to "`yarn smoke` can silently test the wrong binary":

1. **Deterministic resolution.** `stepReinstall` asks the package manager where
   it put the shim (`yarn global bin` for `--against=local`, `npm prefix -g`
   otherwise) instead of taking the first `brevo` on PATH. PATH remains a
   fallback. This is the actual fix: yarn prepends `./node_modules/.bin`, so a
   stray `brevo` there outranked the freshly linked build.
2. **Version guard as backstop.** When `--against=local`, the run now fails if
   `brevo --version` doesn't match this repo's `package.json`. New exports:
   `REPO_ROOT`, `localPackageVersion()`.
3. **Fatal abort.** New `FatalStep` / `fatal()`; the guard raises it and
   `runSteps` reports every remaining suite step ⊘ skipped. `stepLogout` and
   `stepDeleteLeftoverApps` skip on a fatal so teardown can't drive an
   unidentified CLI. Without this the guard failed one step and the run carried
   on against the wrong binary for 22 more — and **logged the operator out**.

Closes the PR #42 reviewer note about `yarn smoke` silently testing the wrong
binary. A separate note from that list — that `APP_SUBMIT_NOT_PUBLIC` is
unreachable because `submit` preflights the review state before checking
`distribution_type` — was **reviewed and closed as won't-fix**: submit is not
supported for private apps, the API owns that refusal, and which of the two
strings comes back isn't a CLI contract. The private-submit probe keeps
accepting both; see the comment on `stepNegativeSubmitPrivate`.

**Must hold true:**

- [x] `REPO_ROOT` resolves from `__dirname`, not `process.cwd()`, so the guard
      reads the right `package.json` when the script is invoked from elsewhere.
      Verified under `tsx`: `REPO_ROOT` → repo root, `localPackageVersion()` →
      `2.0.1`.
- [x] The guard fires on the real shadowing case: the stray
      `node_modules/@dtsl/brevo-cli` reports `2.0.1-alpha.0` against this repo's
      `2.0.1`, so a run that picks it up now fails instead of passing 26/26.
- [x] `--against=published` is exempt — it installs `@latest`, whose version
      this repo can't predict.
- [x] `eslint`, prettier, and `tsc --strict --noUncheckedIndexedAccess
      --noUnusedLocals` all clean on `scripts/`; 733 unit tests still pass
      (unchanged — nothing under `src/`).
- [x] Guard fires and aborts cleanly: with the stray `@dtsl/brevo-cli` still
      symlinked into `node_modules/.bin`, `yarn smoke --skip-auth` reported
      `2 passed, 1 failed, 23 skipped` — one real failure at step 2, everything
      downstream skipped, `Logout` skipped, credentials left intact, and
      `Final cleanup` still unlinked.
- [x] Resolution fix verified with the symlink **still in place**: plain
      `yarn smoke --skip-auth` now reports
      `brevo 2.0.1 at ~/.yarn/bin/brevo` at step 2. No workaround needed.
- [x] **Live run, 26/26**, invoked directly with `~/.yarn/bin` leading PATH.
      Step 2 confirmed `brevo 2.0.1 at ~/.yarn/bin/brevo`; all four gated
      commands detected; `orphanedAppIds: []`, `rateLimitWaits: 0`; both apps
      deleted; nothing left in the repo root. Public flow: `configured` →
      submit returned a form URL → repeat submit idempotent → withdraw
      `NOT_SUBMITTED` → `configured`.
- [x] The private-submit probe passes by matching the **API's** string
      (`This activity is not supported for private apps.`), confirming
      `APP_SUBMIT_NOT_PUBLIC` is unreachable and that accepting both patterns
      is what keeps this green. See the won't-fix note above.
- [ ] Manual: one full `yarn smoke --skip-auth` run (not the direct
      invocation) end-to-end at 26/26, to close the loop on the resolution fix
      past step 2. Needs an authenticated session.
- [ ] Reviewer: `@dtsl/brevo-cli` is in `node_modules` but in neither
      `package.json` nor `yarn.lock`, and nothing depends on it — almost
      certainly left from the `@dtsl` → `@getbrevo` rename. The harness no
      longer cares, but it's worth deleting so nothing else trips on it.
