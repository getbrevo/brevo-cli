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
UI app or drive the deploy lifecycle (`app deploy` / `app remove`). This mirrors the
public-apps notice above, including its *Exception — internal Brevo accounts* clause.

**When UI apps go GA, remove the notice everywhere in one pass:**

- [ ] `agent-context/SKILL.md`
  - [ ] Delete the `## ⚠️ UI apps are not available yet` section.
  - [ ] Decision tree — drop the **not available yet** prefix from "Create a UI app /
        action link", "Make a UI app available in an account", and "Remove a UI app
        from an account".
  - [ ] Hard rules — delete rule 7 (*Don't create UI apps for real use*). Keep rule 8
        (*Never mix the two app types*) — that one is a correctness rule, not a
        pre-GA restriction.
- [ ] `agent-context/AGENTS.md`
  - [ ] Delete the `## ⚠️ UI apps are not available yet` section.
  - [ ] Common commands table — drop the **⚠️ Not available yet** prefix from the
        `brevo app deploy` and `brevo app remove` rows.
  - [ ] Conventions — delete the *UI apps are not available yet* bullet. Keep the
        *Two app types, one command surface* and *The `ui_app` block* bullets.
- [ ] `README.md` — delete the **⚠️ UI apps are not available yet** blockquote below
      the commands table.
- [ ] Verify nothing was missed:
      `grep -rn "UI apps are not available yet" --include="*.md" .`
      (excluding `node_modules/`, `dist/`, `coverage/`) returns only this file.
- [ ] Delete this whole `## Before UI-apps GA` section.

**Related follow-ups (not blockers for GA removal):**

- [ ] **Confirm the `ui_app` wire contract with the app-store backend team.** The CLI
      writes the UIApp Support Spec's field names verbatim (`type: "link"`,
      `properties.surface`, `properties.placement`, `trigger.externalUrl`,
      `contextProperties`). The Extension Points ADR names the same concepts
      differently (`action_link`, `location` / `section`, `redirectLink`), and the
      backend validates against its own registry. If it rejects the spec names, remap
      in `src/types.ts` (`UiApp`) — that is the single definition point.
- [ ] **Confirm the deploy/remove endpoint contract.** `ENDPOINTS.APP_STORE_APP_DEPLOY`
      / `APP_STORE_APP_REMOVE` and `appService.deployApp` / `removeApp` currently
      assume `POST /v3/app-store/apps/{id}/deploy|remove` with `account_id` in the
      body, and that the "not yet uploaded" / "not deployed" rejections are HTTP 422.
      All four assumptions are marked in code comments.
- [ ] Confirm whether `GET /v3/app-store/apps/{id}` returns `ui_app`. The upload diff
      and the scaffold-refresh path both read it opportunistically and degrade safely
      when absent (the block reads as new / is carried forward locally), but the diff
      is only fully accurate once the server echoes it.
- [ ] Decide whether the CLI should guard `--type ui` at runtime, the same open
      question as `--distribution public` above. Today the flag is accepted silently.

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

### BEX-290 — UI app support (action links)

**Change:** New app type. `brevo app create --type <oauth|ui>` with a UI-app prompt
path, a `ui_app` block in `app-config.json`, `ui_app` on the upload payload with
local validation and diffing, and two new commands `brevo app deploy <account-id>` /
`brevo app remove <account-id>`. `applyConditionals` generalised from a single
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
      message. `app remove` has no gate and exits `0` when not deployed. Covered by
      `deploy.test.ts` / `remove.test.ts`.
- [ ] Manual, **against a real test account** — the whole point of the assumed
      contracts below. Run `brevo app create --type ui` interactively, inspect the
      generated `app-config.json`, then `brevo app upload` and confirm the backend
      **accepts** the `ui_app` block with the spec's field names. If it 4xx's, the
      naming question in *Before UI-apps GA* is the cause.
- [ ] Manual: `brevo app deploy <account-id>` against a real account, then confirm the
      action link actually renders in that account's contact record action menu, opens
      the external URL in a new tab, and carries the declared context properties.
      Then `brevo app remove <account-id>` and confirm it disappears.
- [ ] Manual: `brevo app deploy <account-id>` on a never-uploaded app must refuse with
      the `brevo app upload` hint — verify the **server** path too (not just the local
      `version` pre-flight) by deleting `version` from a config whose app *was*
      uploaded.
- [ ] Manual: `brevo app create` interactively on an existing OAuth project directory
      and confirm the new app-type prompt appears first and that choosing *OAuth app*
      reproduces the previous flow exactly.
- [ ] Manual: confirm the disabled *Inline card* / *Widget* / *Cloud function* choices
      in the trigger prompt are visible but unselectable.
- [ ] Reviewer: `agent-context/SKILL.md` and `agent-context/AGENTS.md` both document
      the new commands, `--type` and the UI flags, the `ui_app` block, and both carry
      the UI-apps-not-available notice with equivalent wording (CLAUDE.md requires
      those two stay in sync).
- [ ] Reviewer: confirm the four assumed-contract items in *Before UI-apps GA* are
      resolved with the app-store backend team before this ships to users. The code
      is correct given the assumptions; the assumptions are unverified.
