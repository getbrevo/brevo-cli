# RELEASE CHECKLIST — UI apps

The UI-apps GA record: the pre-GA checklist was worked through at BEX-290, and this
record stays until the release publishes (CLI PR #68 + the Version Packages PR). It sits
at this branch's root alongside `docs.md` and `QA-TESTCASES.md` — **branch-local, never
merge into `main`** (see `CLAUDE.md` → *Branch-local working docs*). The public-apps GA
runbook moved to `feature_set-brevo-cli-v2` on 2026-08-24.

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
wire-contract confirmations and their reasoning — is preserved in closed PR #53 (the
retired docs branch's final state) if a step ever needs to be retraced.
