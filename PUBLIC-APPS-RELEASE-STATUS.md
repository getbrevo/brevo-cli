# Public apps (distribution + review lifecycle) — release status

> Working notes derived from PR #53 (`RELEASE-CHECKLIST.md`, `QA-TESTCASES.md`,
> `docs.md`), the BEX-281 epic and the Action Link Dev PDR, cross-checked against the
> code on `main` / `feat/bex-416-entry-size` as of 2026-08-21. **Since 2026-08-24 the
> public-apps halves of those three docs live at this branch's root** (the
> `docs/public-cli-ui-apps-feature-changes` branch they came from is deleted; its final
> pre-split state is in closed PR #53). **Branch-local working doc — never merge into
> `main`** (see CLAUDE.md). References are Jira keys and PR numbers only.

## Headline: NOT GA — the published build omits the whole surface

`FEATURE_STAGE['public-distribution']` and `FEATURE_STAGE['review-lifecycle']` are still
`'preview'` (`src/lib/preview.ts`). `app status` / `app submit` / `app withdraw` still live
in `src/commands/preview-definitions.ts` behind `__BREVO_PREVIEW__`, their names are still
in `LEAK_MARKERS` (`scripts/build.mjs`), and `--distribution public` is refused with a
typed `CliError`. Everything in the **Before public-apps GA** runbook remains to be done
on release day. The Brevo API independently refuses public creates per account.

---

## ✅ Done (built, decided, or verified — not blocked on GA)

### Decisions settled and shipped (checklist's ✅ items)
- **BEX-405: the guard is the build, not a runtime check.** Review-lifecycle commands are
  eliminated from the published bundle; `--distribution public` refused with exit 1.
  **No escape hatch** — the `@brevo.com` account exception and `BREVO_ENABLE_PREVIEW=1`
  were removed deliberately. Internal testing = `PREVIEW=1 yarn link:dev`. Do not re-add.
- **README command-table drift closed** — stale `app update` row fixed;
  `available-scopes` added. `status`/`submit`/`withdraw` stay out by design until GA.
- The gated questions are still **asked** in a published build, with one choice each
  (Private only / OAuth app only) — revised 2026-08-13 so the flow reads the same in both
  builds.

### Code is built and works in a preview build (QA evidence, sweep 2, 2026-08-13, prod)
- **TC-2.1 ✅** — public app created live with `--distribution public` on a flag-enabled
  account, uploaded to `0.0.2`.
- **TC-6.1 ✅** — `app status` renders the aligned card (`◇ Configured`), resolves from the
  linked config (also covers TC-6.5 case 1).
- **TC-10.2 / 10.3 ✅** — help layout on **both** builds: preview shows the review-command
  headings and hidden `withdraw`; published build omits everything. This is BEX-405
  visible in the output.
- **TC-13.4 ◐** — `app submit` previews the config and opens the form, twice, idempotent.
  (It is a signpost to a Google Form, not an API submission — it never moves app state.)
- **PKCE scaffold for public OAuth apps** — a public app's OAuth flow ran end to end
  (TC-12.14 second run), but whether the scaffold actually differs (PKCE vs confidential)
  was never settled — see QA gaps.

---

## 🔲 Still to take care of

### 1. Confirmed defect — fix before GA
- **TC-6.3 FAILS.** On a never-uploaded app, `app status` and `app submit` surface a raw,
  misleading server message ("ensure your app is correctly configured with … name,
  logo_uri, scopes and redirect_uris" — all four were present). Nothing in
  `apiCodeMessages` maps it (verified: no such string in `src/lang/en.ts` today). Two
  problems: unmapped server copy reaching the user, and a wrong precondition (the real
  cause is "no `app_versions` row yet"). Needs a decision: map the message, or fix the
  case's precondition and delete the dead empty-state path. Exit code was never captured.

### 2. Blocking items from `docs.md` Part 2 — settle before the gate opens
- **BEX-355: server must accept the unified create/upload payload** (OAuth fields nested
  under `auth`; upload sends `version` not `app_version`) — confirmed working on staging,
  needs owner sign-off, plus the "one resource, two shapes" inconsistency (create/upload
  echo nested, GET returns flat) raised on the ticket.
- **BEX-355: absent `source` sign-off** — staging accepts a create with no `source`/
  `cli_version`, but owners must confirm attribution / rate-limiting / gating don't change.
- **BEX-350 coordinated release** — UI kit + reseeded registry + backend must land together
  in every target environment (schema spec is verified; per-environment data is not).

### 3. The GA runbook itself (`RELEASE-CHECKLIST.md` → Before public-apps GA — all unchecked)
Work in one pass, in order:
1. Flip `FEATURE_STAGE['public-distribution']` + `['review-lifecycle']` to `'ga'`.
2. Move `status`/`submit`/`withdraw` out of `preview-definitions.ts` into `definitions.ts`;
   delete the module + `__BREVO_PREVIEW__` spread once empty.
3. Un-hide `app withdraw` in **both** renderers (drop `hidden: true`; hand-restore its two
   lines in `formatRootHelp`); fix `preview-gate.test.ts` and QA TC-10.2.
4. Drop the freed names from `LEAK_MARKERS` (build fails both ways otherwise).
5. Update `preview.test.ts` (asserts the table verbatim — designed to fail here) and
   re-point the public-build cases in `preview-gate.test.ts` / `create.test.ts`.
6. If nothing is gated any more, remove the whole gate machinery (preview.ts, globals.d.ts,
   jest.setup.js, define block, build:preview, gatedSection helpers, …) — **keep esbuild**.
7. Restore docs — recover deleted text from git, don't rewrite:
   - `agent-context/SKILL.md`: decision-tree entries for `status`/`submit`/`withdraw`,
     `--distribution <private|public>` guidance, drop/narrow the "help is source of truth"
     section (`git log -S'Commands you may not see'` finds the commit).
   - `agent-context/AGENTS.md`: the three command rows, `--distribution` guidance,
     withdraw/rollback mentions, `withdraw` in the *Skip prompts* bullet
     (`git log -S'Not available yet'`).
   - `README.md`: `--distribution private|public` on the create row; revisit the
     "complete surface" paragraph.
   - `CLAUDE.md` + root `AGENTS.md`: delete the *Public app distribution is not GA* sections.
8. Sweep: `grep -rn "not been released\|source of truth" --include="*.md" .` returns only
   the checklist; then delete the *Before public-apps GA* section (and the file, if the
   UI-apps section is already gone — it should be, UI apps are GA).
9. Ship the changeset + move `docs.md` Part 1 release copy into it — **re-verify every
   claim first**; the copy predates BEX-416/422/426 and the install/uninstall rename.

### 4. QA blocked or unrun (sign-off table: "Not yet signed off")
- **Suites 5 (TC-5.13–5.16) and 7 (withdraw) are BLOCKED, not just unrun** — they need an
  app in `submitted`/`in_review`, which the CLI cannot produce (submit only opens a form).
  Needs the form completed or state set server-side. Same blocker for TC-6.2's review
  states.
- **TC-2.4 refusal path untested** — needs an account **without**
  `app-store-bo-be-public-apps` (mutually exclusive with TC-2.1's account).
- **Unrun:** TC-2.2 (interactive Public choice), TC-2.3 (list), TC-6.2 (state→tone map),
  TC-6.4 (`--json`), TC-6.6 (NO_COLOR/FORCE_COLOR), TC-13.4's mismatch branch.
- **No `--json` / non-TTY path has been run for any public-app suite.**
- **Settle the PKCE expectation** by reading the scaffold templates: does a public OAuth
  app actually get a PKCE variant, or is the expectation stale?

### 5. From BEX-281 / the Action Link Dev PDR (added 2026-08-21)

The epic and PDR are almost entirely UI-apps scope; what touches public apps:
- **BEX-437 (bo-be, Backlog)** — UI-app authoring is still coupled to the
  `app-store-bo-be-public-apps` feature toggle (`gateUIApp` 403s un-flagged accounts).
  Decoupling it removes an accidental dependency between the two releases: today a
  public-apps toggle rollout decision also gates GA'd UI apps. Land before the CLI ships.
- The review-lifecycle surface (`status`/`submit`/`withdraw`, upload blocked while
  `submitted`/`in_review`, delete refused while under review) has **no open platform
  work** on the PDR — the remaining work is all on this repo's side (runbook + QA above).
- npm `latest` is still **2.1.0**; the next CLI release carries the UI-apps GA and is a
  prerequisite step before any public-apps GA release stacks on top of it.

### 6. Known limits / housekeeping
- **Object-literal residue in the public build** — `CLI.APP_SUBMIT`/`APP_WITHDRAW`, the
  `/withdraw` + `/installs` `ENDPOINTS` entries, `appService.withdrawApp` survive
  elimination (esbuild can't prune object properties). Inert; `preview-messages.ts` is the
  fix pattern if it ever matters.
- **No suite covers the gate itself** manually (published build hides commands / refuses
  the flag) — automated coverage exists; nice-to-have.
- ✅ `QA-TESTCASES.md`'s public suites were refreshed 2026-08-24 (entry conditions,
  TC-10.2's re-baseline note for the post-UI-apps-GA help layout) and now live at this
  branch's root — done; keep them in step with future surface changes.
