# Public apps — deferred release notes & outstanding work

**Status: not released. Do not publish any of this as-is.** **Branch-local — never merge
into `main`** (see `CLAUDE.md`). The public-apps halves of the working docs moved here
from the retired `docs/public-cli-ui-apps-feature-changes` branch on 2026-08-24; the
UI-apps halves live on `feat/bex-416-entry-size`.

Two halves. **Part 1** is the release copy, held until GA. **Part 2** is everything
still open. The public-apps surface exists in this repo and is **eliminated from the
published build** by `scripts/build.mjs` (see `CLAUDE.md` → *Public app distribution is
not GA*). The copy was written as changeset text for `2.1.0`, then pulled out when
BEX-405 moved the guard from a runtime check to build-time elimination — a public
CHANGELOG that names `brevo app submit` would send readers to a command their install
answers `unknown command` to.

This file is the holding pen so the copy isn't rewritten from scratch at GA. It is not
in `package.json` `files:`, so it never ships in the npm tarball.

**At GA:** work through `RELEASE-CHECKLIST.md` → *Before public-apps GA*, then move the
sections below into a fresh changeset in the release that turns the feature on.
Re-verify every claim first — the platform has moved under this copy before.

---

# Part 1 — release copy (hold until GA)

## New commands

- **`brevo app status`** — an app's review lifecycle state (`configured`, `submitted`,
  `in_review`, `approved`, `rejected`, `changes_requested`, or `unknown`) with a human
  message. Read-only, `--json` gives `{ state, message }`.
- **`brevo app submit`** — opens the public-app review submission form. Runs a status
  preflight, requires `distribution_type: public`, and verifies the local `app-config.json`
  matches the server (showing a field-by-field diff with `(local only)` / `(server only)`
  tags on drift) before opening the form. `--json` prints `{"app_id","form_url"}`.
- **`brevo app withdraw`** — withdraws an app from submission. Mirrors `app delete`'s UX
  (`--force`, `--json`); an app that was never submitted prints a hint and exits `0`.

All three resolve the target app from `--app-id`, the linked `app-config.json`, or an
interactive picker.

## Public app distribution

`brevo app create --distribution public` no longer errors locally, and Public is a selectable
option in the interactive distribution prompt. The scaffolded OAuth flow branches on
`distribution_type`: **public** apps get Authorization Code + PKCE (RFC 7636) — `/auth/login`
generates a `code_verifier` and sends `code_challenge` + `code_challenge_method=S256`, and the
token exchange and refresh send the `code_verifier` with **no `client_secret`**, so the
generated `.env.local`/`.env.example` carry none. **Private** apps keep the confidential-client
flow unchanged.

The platform refuses public creates per account, independently of anything the CLI does. That
refusal reads *"Public apps can't be created from the CLI yet"*, points at
`--distribution private`, notes that `distribution_type` is fixed at creation, and quotes the
server's own response.

## `app create` prompt order

The interactive prompt order is name → logo → distribution → app type → type-specific
prompts (the logo moved to second on 2026-08-13 — it used to be asked inside each branch).
Flag-driven and non-interactive runs are unaffected. A published build without public apps
asks both gated questions with one choice each (`Private` only; until UI apps publish,
`OAuth app` only) rather than skipping them.

---

## Not release copy — how the guard itself works (BEX-405)

Kept here for the GA author's benefit, **not** to be published. There is no user-visible
"pre-GA gate" to announce: from a user's point of view the surface simply is not in the
binary, which is the whole point of moving the guard into the build.

The published build eliminates the gated surface — now the public-apps surface only — at
compile time. `scripts/build.mjs` sets `__BREVO_PREVIEW__`, gated command definitions live
in `src/commands/preview-definitions.ts` and are referenced from behind that flag, and
`src/lib/preview.ts` → `FEATURE_STAGE` states which features are gated. Build with
`PREVIEW=1 yarn link:dev` (or `yarn build:preview`) to get the full surface locally.

Flipping a `FEATURE_STAGE` row to `'ga'` is **necessary but not sufficient** — a GA feature
left in `preview-definitions.ts` is still eliminated. `RELEASE-CHECKLIST.md` has the full
sequence, and the UI-apps flip (BEX-290) is the worked example: definitions moved, strings
moved, names moved from `LEAK_MARKERS` to `GA_MARKERS` so every build asserts they ship.

There is deliberately **no runtime escape hatch**. An earlier iteration unlocked on an
`@brevo.com` / `@sendinblue.com` account or `BREVO_ENABLE_PREVIEW=1`; both are gone, and
`CLAUDE.md` says not to add one back — a compile-time guard a user can switch on is a runtime
guard wearing a costume, and it has to ship the surface in order to reveal it.

---

# Part 2 — outstanding work

Nothing below blocks *this* release — the build-time gate is what makes that true. It
blocks GA.

**This half is the open-questions log; `RELEASE-CHECKLIST.md` is the GA runbook.** Keep
them apart: this answers *what is still unknown*, that answers *what to do on the day*.
When an item here resolves, delete it; when it becomes a release step, move it there.
`PUBLIC-APPS-RELEASE-STATUS.md` is the consolidated status view over both.

## Wire contracts / sign-offs still open

- [ ] **BEX-355 sign-off that an absent `source` is contract-valid.** The CLI stopped sending
      `source: 'cli'` after the platform started reading it as policy (`400
      invalid_parameter`, *public apps cannot be created with source "cli"*). The backend
      derives the caller from the `User-Agent` header instead. **Staging accepts the omission**
      — a private create with no `source` and no `cli_version` returned `201` (2026-08-12) —
      but that only proves it is not *rejected*. Still needs the owners to confirm it does
      not change attribution, rate-limiting or gating.
- [ ] **The app-read responses disagree on shape, and the CLI absorbs it.** Confirmed on
      staging 2026-08-12: `POST /apps` and `POST /apps/{id}/upload` return OAuth fields
      **nested** under `auth`, while `GET /apps/{id}` returns them **flat** (`client_id`,
      `redirect_uris` at the top level). The CLI copes — `flattenCreateAuth` tolerates both
      on create, and the read path expects flat — so nothing is broken. But it is one
      resource described two ways, which is how the original nesting regression hid as long
      as it did. Worth raising on BEX-355 rather than leaving each new consumer to
      rediscover it.

## QA gaps

`QA-TESTCASES.md` at this branch's root carries the public-app suites (moved here
2026-08-24, refreshed the same day). The recorded 2026-08-13 results predate the
install/uninstall rename and say so inline where it matters.

- [x] **`yarn smoke --against=local` built the wrong artifact — FIXED, pending a
      verifying run.** `stepReinstall` (`scripts/smoke/core.ts`) now runs the build with
      `PREVIEW=1` when the suite under test needs the preview surface, so the gated
      suites no longer silently skip every step against a public artifact.
      `--against=published` still installs from npm, where the gated commands genuinely
      are absent, so skipping stays the correct outcome there. Re-run the local suite
      once to confirm before relying on it.
- [ ] **The real QA gaps are the never-run cases**, consolidated in Suite 12's sign-off
      table: `install`/`uninstall` have never been manually invoked (TC-12.7, 12.9,
      12.10, 12.11(g)/(h)), `ui_app` has never been verified **on disk** (TC-12.3's file
      half, TC-12.4's push half, TC-12.5(b)/(c)), the migration-hint and
      extension-point-validation cases (TC-12.5b, TC-12.6) are unrun, and no `--json` /
      non-TTY path has been exercised (TC-12.12).
- [ ] **No suite covers the gate itself** — that a published build hides the commands and
      refuses `--distribution public`. Automated coverage exists
      (`src/__tests__/lib/preview.test.ts`, `preview-gate.test.ts`, plus the build's own
      output assertions), so this is a nice-to-have.

## Known limit of the build gate

- [ ] **Object-literal properties survive elimination.** esbuild cannot prune a property from
      an object literal, so anything reached as `OBJECT.KEY` stays at zero references. In a
      public build that leaves `CLI.APP_SUBMIT` / `APP_WITHDRAW`, the `/withdraw` entry in
      `ENDPOINTS` (both `src/lib/constants.ts`), and `appService.withdrawApp`
      (`src/services/app.ts`). All inert — no command reaches them, no help lists them.
      (The install-side names left this list at UI-apps GA — they ship for real now.)
      `src/lang/preview-messages.ts` is the pattern that fixes this class if the residue ever
      matters.

