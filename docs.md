# Public apps — outstanding work (post-GA)

**Branch-local — never merge into `main`** (see `CLAUDE.md`). Not in `package.json`
`files:`, so nothing here ships to npm — but the never-merge rule applies regardless,
because branches are public too.

**Public apps went GA in this branch.** The release copy that used to sit in *Part 1* has
been consumed into `.changeset/fix-app-submit-missing-fields.md`, and the GA runbook
(`RELEASE-CHECKLIST.md`) and the consolidated status view (`PUBLIC-APPS-RELEASE-STATUS.md`)
were worked through and deleted. What remains is this: the open-questions log.

When an item here resolves, delete it. When it turns into a release step, it needs a
runbook again — recreate one rather than growing this file into one.

---

## ⚠️ BLOCKER — the platform still refuses CLI-created public apps

**Verified against production on 2026-09-02**, authenticated, no `BREVO_API_URL`
override, on a plain (non-preview) build of this branch:

```
$ brevo app create --name "…" --distribution public --json
{"error":{"name":"CliError","message":"Public apps can't be created from the CLI yet …
  Brevo said:  public apps cannot be created with source \"cli\"; use distribution_type \"private\""}}
```

The CLI-side gate is open and correct — the flag parses, validates and is sent. The
refusal is the **platform's**, and it is keyed on the caller being the CLI, not on an
account flag: the CLI stopped sending `source: 'cli'` (see the BEX-355 item below), so
the backend is deriving it from the `User-Agent` and applying the policy regardless of
the body. That makes it global rather than per-account, and nothing client-side can
change it.

Consequence: **the review lifecycle is unreachable end to end.** `app submit` /
`app status` / `app withdraw` all ship and all work, but there is no way to obtain a
public app to use them on. The CLI degrades gracefully — `APP_CREATE_PUBLIC_REJECTED`
maps the 400 to actionable copy and quotes the server verbatim — and both agent docs now
tell an agent to read that line and not retry.

- [ ] **Decide what ships.** Two options, and this is a product call, not a code one:
      - **Land as-is.** The CLI is complete and lights up the moment the backend policy
        lifts, with no further release. Cost: a documented flag returns a server `400`,
        so users meet the refusal rather than the feature.
      - **Hold the flip.** Set `FEATURE_STAGE['public-distribution']` and
        `['review-lifecycle']` back to `'preview'` and keep everything else (strings and
        constants moved to `en.ts` / `constants.ts`, docs, smoke, the TC-6.3 fix). Note
        the three command definitions would have to move back into a gated module for the
        gate to actually eliminate them — see `src/lib/preview.ts`'s header.
- [ ] **Get the backend policy lifted (BEX-355).** This is the real unblock. The
      `source "cli"` policy needs to allow public creates from the CLI, or expose a
      per-account allowance the CLI can be granted. Until then, GA is CLI-side only.

## Gate machinery — teardown deferred, deliberately

Every `FEATURE_STAGE` row in `src/lib/preview.ts` is `'ga'`, so the pre-GA gate now holds
nothing back. The three modules that carried gated surface — `commands/preview-definitions.ts`,
`lang/preview-messages.ts`, `lib/preview-constants.ts` — emptied and were deleted at GA.
The machinery around them was **kept on purpose**, to keep the GA change reviewable and
because it is the shape the next unreleased feature should arrive in.

- [ ] **Decide whether to tear it down.** If yes, in one pass: `src/lib/preview.ts`,
      `src/globals.d.ts`, `jest.setup.js` + its `setupFiles` entry in `jest.config.js`,
      the esbuild `define` block and both `LEAK_MARKERS` / `LEAK_STRINGS` checks in
      `scripts/build.mjs` (plus `orphanedPreviewMessageKeys`), the `build:preview` script,
      the `previewFeatureOf` / `assertFeatureAvailable` wiring in
      `src/lib/command-registry.ts`, the two `isFeatureAvailable` calls in
      `src/commands/app/create.ts`, the `gatedSection` / `distributionValues` /
      `createDescription` helpers in `src/lib/help.ts`, and
      `messages.PREVIEW_FEATURE_UNAVAILABLE`. Also `src/__tests__/lib/preview.test.ts` and
      `preview-gate.test.ts`, which currently assert the mechanism against a simulated
      gated row.
      **Keep esbuild.** The bundler was adopted for the gate but is now the build
      (`scripts/build.mjs`); reverting to `tsc` would change the published layout again —
      `dist/bin/files`, the single-file entry, `sideEffects: false`. Only `define` and the
      marker checks are gate-specific.
      Against teardown: the next gated feature has to rediscover both traps (a gated
      command's definition must be referenced only from behind `__BREVO_PREVIEW__`, and
      that flag outranks `FEATURE_STAGE` for help text and prompt branches), and both cost
      a release each to learn the first time. They are written down in `preview.ts`'s
      header; deleting the file deletes the note.

## Release gates

- [ ] **`smoke-post-merge.yml` does not exercise the review lifecycle.** It stays pinned at
      `suite: private,ui` against the published package, so no publish gate touches
      `app submit` / `app status` / `app withdraw`. `smoke-pre-merge.yml` covers them via
      `suite: all`, but it is `non_blocking` and runs `against=local`. Widening the
      post-merge lane needs `scripts/smoke/public-app.ts` proven headless on
      `ubuntu-latest` first (CLAUDE.md is explicit that a suite only ever run on a dev
      machine has not been proven headless) — run it from `smoke.yml`'s manual button,
      then decide.

## TC-6.3 — half fixed

The `submit` half is **closed**: an app with no `version` has never been uploaded and
cannot have a review state, so `submitCommand` now fetches the app first and refuses
locally with `APP_SUBMIT_NOT_UPLOADED`, before the review-state read that produced the
misleading copy. Same gate `app install` already applies (`assertInstallable`'s
`requireUploaded`). Covered in `__tests__/commands/app/submit.test.ts`.

- [ ] **`brevo app status` still relays the raw server message** on a never-uploaded app.
      It reads the review state directly and never fetches the app, so the local `version`
      signal isn't available without an extra round trip on a read-only command's happy
      path. Closing it properly means mapping the failure in `apiCodeMessages`
      (`src/api/client.ts`), which needs **the server's error `code` and HTTP status
      captured from a live repro** — neither is recorded anywhere today, and TC-6.3 never
      captured the exit code either. Get those two values, then add one line to the map.
      The server's copy names `name`, `logo_uri`, `scopes` and `redirect_uris` as the
      fields to fix; all four can be present, and the real cause is the absent
      `app_versions` row.

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
- [ ] **BEX-350 coordinated release.** UI kit + reseeded registry + backend must land
      together in every target environment. The schema spec is verified; the
      per-environment data is not.
- [ ] **BEX-437 (bo-be, Backlog)** — UI-app authoring is still coupled to the
      `app-store-bo-be-public-apps` feature toggle (`gateUIApp` 403s un-flagged accounts,
      surfaced as `ERR_UI_APP_NOT_ENABLED`). Decoupling it removes an accidental dependency
      between the two releases.

## QA gaps

`QA-TESTCASES.md` at this branch's root carries the public-app suites. The recorded
2026-08-13 results predate both the install/uninstall rename and this GA change.

- [ ] **Suites 5 (TC-5.13–5.16) and 7 (withdraw) are BLOCKED, not just unrun** — they need
      an app in `submitted`/`in_review`, which the CLI cannot produce, because `submit`
      only opens a form. Needs the form completed or the state set server-side. Same
      blocker for TC-6.2's review states. This is a property of the design, not an
      oversight: while submission is a form hand-off, no CLI-only test can reach those
      states.
- [ ] **TC-2.4 refusal path untested** — needs an account **without**
      `app-store-bo-be-public-apps` (mutually exclusive with TC-2.1's account).
- [ ] **Unrun:** TC-2.2 (interactive Public choice), TC-2.3 (list), TC-6.2 (state→tone map),
      TC-6.4 (`--json`), TC-6.6 (NO_COLOR/FORCE_COLOR), TC-13.4's mismatch branch.
- [ ] **No `--json` / non-TTY path has been run for any public-app suite.**
- [ ] **Re-baseline every public suite against the GA build.** The recorded results were all
      taken on `PREVIEW=1` artifacts. The commands are identical, but "needs a preview
      build" is no longer a precondition anywhere and the sweep should be re-run once on a
      plain `yarn link:dev` to say so with evidence.

**Closed:** the PKCE expectation. `src/templates/index.ts` really does branch on the
`public` / `private` template flag, `.env.example.tmpl` omits `CLIENT_SECRET` and notes
PKCE for a public app, and `__tests__/templates/handler.test.ts` covers the
*public (PKCE, no secret)* variant. The expectation was not stale.

**Closed:** `yarn smoke --against=local` building the wrong artifact. `stepReinstall` no
longer forks on the selected suites — nothing is gated, so every local build is the
published surface and the public suite exercises what npm ships.
