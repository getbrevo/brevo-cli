# RELEASE CHECKLIST

The GA runbook for pre-GA features — ordered, mechanical steps for the day each one
ships. It sits at this branch's root alongside `docs.md` and `QA-TESTCASES.md` —
**branch-local, never merge into `main`** (see `CLAUDE.md` → *Branch-local working
docs*). The three lived on the retired `docs/public-cli-ui-apps-feature-changes` branch
until 2026-08-24.

One pre-GA feature remains: **public app distribution**. The UI-apps section was
**worked through at BEX-290** — its checklist collapsed into the record further down,
which stays until that release actually publishes.

| Section | Lifetime |
| --- | --- |
| `## Before public-apps GA` | Stays until public app distribution ships. |
| `## UI-apps GA — worked through (BEX-290)` | Record of the flip; stays until the release publishes (CLI PR #68 + the Version Packages PR). |

`RELEASE-CHECKLIST.md` is *what to do on the day*; `docs.md` → *Part 2* is *what is still
unknown*. An item moves from `docs.md` to here when it turns into a release step. Per-branch
verification state does not belong here — it stays on the feature branch.

---

## Before public-apps GA

Public app distribution is not live on the Brevo platform, so the published CLI is
**built without it** (BEX-405): `--distribution public` is refused, the review-lifecycle
commands (`app submit` / `app status` / `app withdraw`) are eliminated from the bundle,
and the agent-facing docs describe only what a public build ships. See `CLAUDE.md` →
*Public app distribution is not GA* for why.

**When public apps go GA, restore them everywhere in one pass** — start with the gate,
because the doc steps below describe surface that does not exist until it is open:

- [ ] **Open the build-time gate (BEX-405).** In `src/lib/preview.ts`, flip
      `FEATURE_STAGE['public-distribution']` and `FEATURE_STAGE['review-lifecycle']`
      to `'ga'`. That one edit is the whole release: the root help, `brevo app --help`,
      the `--distribution` value list, `app create --help`'s examples, the app-type
      prompt and the refusal all read the same table. Do **not** hand-edit
      `src/lib/help.ts` or `src/commands/definitions.ts` to restore the text — they
      derive it.
  - [ ] **Move the released entries out of `src/commands/preview-definitions.ts`** back
        into `definitions.ts`. Flipping the table is *not* enough for these five: they
        are referenced from behind `__BREVO_PREVIEW__`, which is a **build** flag, not a
        stage lookup — a GA feature whose command still lives in that module would be
        eliminated from the published bundle regardless of `FEATURE_STAGE`. Delete the
        module (and its import + the `...(__BREVO_PREVIEW__ ? … : [])` spread) once it
        empties.
  - [ ] **Un-hide `app withdraw`, in both renderers.** It carries `hidden: true` in
        `src/commands/preview-definitions.ts` — a second, independent suppression that
        `FEATURE_STAGE` does not reach, so flipping the table would ship a GA command
        that is still advertised nowhere. Delete that line, **and** restore its two lines
        to the `review-lifecycle` section of `formatRootHelp` in `src/lib/help.ts`, where
        a comment marks the spot; Commander's `hidden` governs only its own generated
        output, so the hand-aligned root screen has to be edited by hand. Then drop
        `GATED_LISTED` and the two `app withdraw` cases from `preview-gate.test.ts`, and
        restore `withdraw` to TC-10.2 in `QA-TESTCASES.md`. The signature to restore:
        ```
        `  brevo app withdraw          [--app-id <id>] [--force] [--json]`,
        `                                                        Withdraw an app from submission`,
        ```
  - [ ] **Drop the freed names from `LEAK_MARKERS` in `scripts/build.mjs`.** The public
        build asserts each one is *absent* and the preview build asserts each is
        *present*, so a released command left in that list fails the build both ways.
  - [ ] Update `src/__tests__/lib/preview.test.ts` → *lists every gated feature as
        preview*, which asserts the table verbatim and is designed to fail here.
  - [ ] Re-point the public-build cases in `preview-gate.test.ts` (`GATED`,
        `GATED_HEADINGS`) and `create.test.ts` (*in a published (public) build*) at
        whatever is still gated.
  - [ ] **If nothing is gated any more**, remove the machinery in one pass:
        `src/lib/preview.ts`, `src/globals.d.ts`, `src/commands/preview-definitions.ts`,
        `jest.setup.js` + its `setupFiles` entry in `jest.config.js`, the `define` block
        and both `LEAK_MARKERS` checks in `scripts/build.mjs`, the `build:preview`
        script (`link:dev` runs the plain `yarn build`, so it needs no edit), the
        `previewFeatureOf` / `assertFeatureAvailable` wiring in
        `src/lib/command-registry.ts`, the two
        `isFeatureAvailable` calls in `src/commands/app/create.ts`, the `gatedSection` /
        `distributionValues` / `createDescription` helpers in `src/lib/help.ts`, and
        `messages.PREVIEW_FEATURE_UNAVAILABLE`.
  - [ ] **Keep esbuild.** The bundler was adopted for the gate but is now the build
        (`scripts/build.mjs`); reverting to `tsc` would change the published layout
        again — `dist/bin/files`, the single-file entry, `sideEffects: false`. Only
        `define` / `LEAK_MARKERS` are gate-specific.
  - [ ] Restore the released commands to `agent-context/SKILL.md` and
        `agent-context/AGENTS.md`, and to `README.md`'s command table. Their reference
        text was **deleted, not hidden**, so recover it from git rather than rewriting
        it — see the per-file steps below for the exact recipe. `CLAUDE.md` →
        *Keep agent docs in sync* makes this part of the same PR, not a follow-up.
- [ ] `agent-context/SKILL.md`
  - [ ] Restore the decision-tree entries for `app status`, `app submit` and
        `app withdraw`. They were deleted rather than rewritten — recover the text rather than
        writing it again: `git log --diff-filter=M -S'Commands you may not see' --
        agent-context/SKILL.md` finds the commit that removed it, and
        `git show <sha>^:agent-context/SKILL.md` prints the version that still had it.
  - [ ] "Create an app": restore `--distribution <private|public>` and the
        private-vs-public guidance ("`private` for apps used exclusively by the user's
        own organisation, `public` for apps distributed to end users or marketplace
        listings; default to `private` when the user hasn't said which"), replacing the
        current "check `--help` for the values your account accepts" wording.
  - [ ] Revisit the *`brevo --help` is the source of truth* section — delete it once
        nothing is gated, or narrow it to whatever still is.
  - [ ] Restore the `app withdraw` mentions in *Locating the linked app* and under
        *JSON errors*. (The `app rollback` JSON-errors example this step used to restore
        came back at UI-apps GA as `app uninstall` — check it still reads right rather
        than restoring it again.)
- [ ] `agent-context/AGENTS.md`
  - [ ] Restore the `brevo app status`, `brevo app submit` and `brevo app withdraw`
        rows to the *Common commands* table. Recover them the same way:
        `git log --diff-filter=M -S'Not available yet' -- agent-context/AGENTS.md`, then
        `git show <sha>^:agent-context/AGENTS.md`.
  - [ ] Restore `--distribution <private|public>` plus the private-vs-public guidance
        on the `brevo app create` row.
  - [ ] Restore the `app withdraw` mentions in the `app-config.json` convention bullet,
        the *JSON errors* section and *Command help*. (The `app rollback` mentions this
        step used to cover came back at UI-apps GA as `app uninstall`.)
  - [ ] Restore `withdraw` to the *Skip prompts* bullet. It reads `--force` for
        `app delete`, `app install`, `app uninstall` and `logout` today — `install` /
        `uninstall` joined it at UI-apps GA. `withdraw` was missed by the original strip
        and corrected later; its absence is not a sign the command never took `--force`.
- [ ] `CLAUDE.md` — delete the `## Public app distribution is not GA` section.
- [ ] `AGENTS.md` (repo root) — delete the `## Public app distribution is not GA`
      section.
- [ ] `README.md`
  - [ ] Restore `--distribution private\|public` on the `brevo app create` row.
  - [ ] Revisit the paragraph under the commands table stating that the table is the
        complete surface of a published release.
- [ ] `QA-TESTCASES.md` — delete the **Public apps are not in any published build
      (BEX-405)** half of the entry-conditions blockquote, and re-baseline the
      preview-build preconditions on suites 2, 5, 6, 7, 10 and 13.
- [ ] Verify nothing was missed:
      `grep -rn "not been released\|source of truth" --include="*.md" .`
      (excluding `node_modules/`, `dist/`, `coverage/`) returns only this file.
- [ ] Delete this whole `## Before public-apps GA` section — and once the UI-apps record
      below has outlived its use (the release published), delete the file and drop the
      *Working docs* reference to it from `CLAUDE.md`.

**Related follow-ups (not blockers for GA removal).** Open questions live in `docs.md`
→ *Part 2 — outstanding work*, not here: this file is the GA runbook, that one is the
open-questions log. Only settled decisions are recorded below, for the reasoning.

- [x] **Decided and shipped (BEX-405): the guard is the build, not a runtime check.**
      The question was whether to guard `--distribution public` at runtime or keep relying
      on documentation. It landed further than either: `scripts/build.mjs` eliminates the
      review-lifecycle commands from the published bundle, and `--distribution public` —
      which must still be parsed before it can be rejected — is refused with a typed
      `CliError` (exit 1) before any filesystem work. *Warn* was rejected because a warning
      still creates the app, which is the outcome the notice existed to prevent.

      **There is no escape hatch.** An interim version unlocked on an `@brevo.com` /
      `@sendinblue.com` account or `BREVO_ENABLE_PREVIEW=1`; both were removed when the flag
      moved to build time, because a compile-time guard a user can switch back on is a
      runtime guard wearing a costume — and it has to ship the surface in order to reveal
      it. Internal testing is `PREVIEW=1 yarn link:dev`, a different artifact.

      That also retires the old "guardrail, not a security boundary" caveat: there is no
      client-side check left to bypass. The two layers are the build and the API.

      **Removal is a GA step — see the list above.**
- [x] `README.md`'s command table drift — **closed.** The stale `brevo app update` row was
      fixed in the BEX-290 branch and `brevo app available-scopes` was added on this one.
      `status` / `submit` / `withdraw` stay out by design until GA, when the list above
      restores them.

---

## UI-apps GA — worked through (BEX-290)

The pre-GA checklist this section used to carry was worked through when UI apps left the
gate at BEX-290. What it required, all verified in code: `FEATURE_STAGE['ui-app-type']`
and `FEATURE_STAGE['account-install']` flipped to `'ga'`; the command definitions moved
out of `preview-definitions.ts` into `definitions.ts` and their strings out of
`preview-messages.ts` into `src/lang/en.ts`; the names dropped from `LEAK_MARKERS` and
added to `GA_MARKERS` in `scripts/build.mjs` (every build now *asserts* the surface
ships); and the agent docs (`agent-context/SKILL.md` / `AGENTS.md`) carry the UI-app
reference again. The account commands were renamed `install` / `uninstall` along the way
(2026-08 — they were `deploy` / `rollback` when this section was written; the wire field
`deploy_client_id` deliberately keeps the server's old vocabulary).

**The release event is still pending.** The GA code merged to `main` in CLI PR #56
(2026-08-19) and was reverted the same day (#66 — merged prematurely); it re-entered
review as **CLI PR #68**. UI apps publish when #68 merges and the changesets "Version
Packages" PR ships — the release copy now travels as the **pending changeset on that
PR**, no longer in `docs.md` Part 1. The platform's own un-gating of UI-app authoring
(BEX-437) must land before or with that release.

Two items this section long tracked as open have since closed:

- **`type === 'corporate'` on `/v3/account/info` — VERIFIED** against a live corporate
  account (2026-08-21). It was the last assumed wire contract; the code comment on
  `AccountResponse.type` (`src/types.ts`) no longer calls it assumed.
- **A repeated install is an idempotent upsert — CONFIRMED in code** (2026-08-24,
  app-store-backend `origin/main`): `findExistingInstallation` keys a developer install
  on caller + app + `is_developer` and a repeat answers `200` with the existing row's
  ID, so the CLI's never-check-first behaviour is safe. (DB-level uniqueness is still
  absent — that ask lives in `docs.md` → *Platform-side asks*.)

One contract changed shape after the flip: the registry's `surface_point_name` slugs
were renamed from kebab-case to **dot notation** (`contact-details-header-menu` →
`contactDetails.header.menu`) by a 2026-08-18 platform migration, verified applied on
prod 2026-08-24 with the stored snapshots rewritten in the same transaction. The CLI
needed no code change — it prompts from the registry and validates shape only — and its
examples were updated in CLI PR #64. The dotted slug is still **not** the dotted
`extension_point_name` grammar (`contactDetails.headerMenu.action`); only the slug is
authorable.

Everything else from this section that outlives the flip lives in `docs.md` → *Part 2*
(the staging registry-seed check, the CLI's consumption of the list endpoint's `?type=`
filter, the remaining platform asks). The full pre-GA checklist — gate mechanics,
wire-contract confirmations and their reasoning — is in this file's git history if a
step ever needs to be retraced.
