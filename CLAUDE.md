# CLAUDE.md — Brevo CLI

## Project

Brevo Developer CLI (`@getbrevo/cli`) — create, manage, and test OAuth integrations from the terminal.

- **Language:** TypeScript (CommonJS, ES2022 target)
- **Runtime:** Node.js >= 20.15.0
- **Package manager:** Yarn >= 1.19.1
- **Public CLI reference:** https://developers.brevo.com/docs/cli-reference — keep behaviour, flags, and exit codes in sync with this page when changing user-facing commands.

## Public app distribution is not GA — the agent-doc notice is deliberate

Public app distribution is **not live on the Brevo platform**. The CLI already ships the surface for it — `brevo app create --distribution public`, `brevo app submit`, `brevo app status`, `brevo app withdraw` — but nothing behind those commands is usable yet.

Because that surface is shipped and unguarded, `agent-context/SKILL.md` and `agent-context/AGENTS.md` each carry a **⚠️ Public apps are not available yet** notice telling agents never to create a public app or drive the review lifecycle. Root `AGENTS.md`, this file, and `README.md` mirror it.

**This does not restrict work in this repo.** Building, changing, testing, and QA-ing the public-app code paths is expected and unblocked — write the code, run the commands, create public apps against test environments, work through the public-app cases in `QA-TESTCASES.md`. The notice governs what the shipped docs tell an *end user's* agent; it is not a freeze on the feature. Never refuse or hedge on a public-app task in this repo because of it.

- **Do not remove or soften that notice** as part of unrelated cleanup. It is the only thing stopping an AI agent from leading a user into creating a public app they can't do anything with.
- **Keep the *Exception — internal Brevo accounts* clause** in both shipped docs. It tells the agent to run `brevo whoami --json` and skip the restriction when `email` ends in `@brevo.com` or `@sendinblue.com`. Without it the notice blocks dogfooding: an agent helping a Brevo developer or QA test `app submit` would refuse. Gating on the account domain rather than on the user's say-so keeps it objective — an end user can't talk their way past it.
- **The domain check is a guardrail, not a security boundary.** It's client-side guidance in a doc; anyone can ignore the docs and pass `--distribution public` themselves. If public apps must actually be restricted pre-GA, that belongs on the API.
- **This is documentation-level only.** The CLI itself still accepts `--distribution public` without a warning or a guard, by design — a runtime guard is tracked separately (see `RELEASE-CHECKLIST.md`). If one is ever added, it needs the same internal-account escape hatch.
- **When public apps go GA**, work through `RELEASE-CHECKLIST.md` → *Before public-apps GA* to remove the notice everywhere in one pass.

## UI apps are not GA either — same deal (BEX-290)

UI apps (action links that render inside Brevo CRM records) are **not live on the platform**. The CLI ships the surface — the *UI app* choice at `brevo app create`'s app-type prompt, `brevo app deploy <account-id>`, `brevo app rollback <account-id>` — and, exactly as with public apps, `agent-context/SKILL.md` and `agent-context/AGENTS.md` each carry a **⚠️ UI apps are not available yet** notice reusing the same *Exception — internal Brevo accounts* clause. `README.md` mirrors it.

**Every clause of the public-apps section above applies verbatim** — it does not restrict work in this repo, don't remove or soften the notice during unrelated cleanup, keep the internal-account escape hatch, and it's documentation-level only (no runtime guard, by design).

**The `ui_app` block IS the app snapshot the platform stores, field for field.** Field names are confirmed against both of its consumers — the manifest read path and the extensibility UI kit (BEX-308 / BEX-350). Do **not** reintroduce the UIApp Support Spec's `properties`/`trigger` vocabulary: nothing on the platform reads those names.

Five consequences worth knowing before touching this code:

- **A slot has TWO names, and `surface_point_list` takes the slug one.** Each registry row carries a dotted `extension_point_name` in the BEX-350 grammar `<location>.<place>.<kind>` (`contactDetails.headerMenu.action`) AND a kebab-case `surface_point_name` slug (`contact-details-header-menu`), 1:1. An authored entry's `surface_point_name` is the **slug** — the entry key is named for the registry column it is matched against, which is the whole point of the name. The spelling `surface_point` is used nowhere: not as an authored key, not as a hint, and not on the registry response, whose row field is `extension_point_name`. `app upload`'s `checkExtensionPoints` resolves it with `FindByNames`, a `WHERE surface_point_name = ANY(...)` read, and app-store-backend's manifest path resolves it the same way before serving the row's *dotted* name to the frontend as `extensionPoint`. bo-be also **stamps that dotted name onto its stored copy of the entry** as `extension_point_name`, so the snapshot records both identities; it is server-derived and deliberately never echoed, so it must not appear in `app-config.json` (same handling as `link_target`). The dotted form is therefore what renders and what every spec quotes, which makes it the natural thing to author — and authoring it 400s with `ui_app.surface_point_list contains unregistered extension point(s)`. The CLI carried exactly that bug until it was fixed by keying `buildSurfacePointList` on `surface_point_name`; the create tests keep the two identities as distinct strings so a fixture can never make either one pass by accident. A row the registry gives no slug for is dropped from the prompt (`toUsableRows`) — the column is nullable and the platform's lookup skips a NULL, so such a row could only author a placement its own upload rejects.
- **Extension-point names fail silently, and the registry is the only authority on them.** The UI kit matches by exact string equality and the platform *drops* a name with no registry entry — an empty slot, a 200, no error. **Do not reintroduce a local list of valid slot names.** `src/lib/constants.ts` used to mirror the platform's twelve `extension_points` rows so `app upload` could pre-flight offline; that mirror was removed because a copy can only lag the registry, and it failed in both directions — rejecting a slot the platform had added, passing one it had removed. Both paths now read the real thing: `app create` prompts from the registry over two reads that ask different questions — `GET /v3/app-store/surface-points/locations` for the record pages (`{ locations, count }`, no rows), then `GET /v3/app-store/surface-points?location=<csv>` for the placements on the pages that were picked, which is the only row read in the flow — and `app upload` sends the block for the upload endpoint's `checkExtensionPoints` to validate against `extension_points`, which 400s naming every offender. `validateSurfacePoint` is deliberately shape-only (non-blank) and `validators.test.ts` asserts an unregistered name passes it — that test exists to fail if someone adds an allow-list back. Note the page prompt cannot be extension-type-aware (a location list carries no `extension_type_list`): a page whose every placement is un-hostable is offered and then skipped with a warning once the rows are read, so that warning path is load-bearing — don't "simplify" it away.
- **`label` and `more_info` are the two authored text fields, and each renders in two places.** `label` is the menu entry's text on an `.action` slot and the CTA button on a `.widget` slot's card; `more_info` is the menu entry's `subText` and the card's description. They were named `heading`/`subheading` before BEX-290 — `validateUiApp` rejects the old names with a migration hint rather than aliasing them.
- **The only rendered text with no field is a *card's title*, which is the app name.** Don't add a field for it. Also still absent, and not to be added back: partner-declared `contextProperties` — record context is an allow-list on the registry row, chosen by the platform, and an entry's `context` can only narrow it. (An earlier version of this file said there was no per-action label at all. That stopped being true with BEX-290's `label`: the menu entry is labelled from it, which is a rendering change in the UI kit, not just a rename.)
- **`link_target` is not a field in `app-config.json`.** `brevo app upload` injects `_blank` into the payload; `brevo app create` never writes it; the write-back strips it from the server's echo and the upload diff normalizes it away on both sides. There was never a choice to make — the server refuses `_self` — so a field in the file only invited a partner to edit it into a value that 400s. If you re-add it to the file, you must also undo all three of those.
- **`modal_iframe_url` is gated on `extension_type`.** The UI kit keeps it only for `iframeExtension`, so the CLI rejects it on an `actionLink` rather than letting a partner ship a URL that never opens.

**`extension_type` values are camelCase (BEX-350): `actionLink`, `iframeExtension`, `legacyComponent`.** The source of truth is `FEATURE_TYPES` in the extensibility UI kit. The pre-BEX-350 snake_case spellings are **deliberately not accepted** — the kit still maps them for consumers, but that map is slated for removal once every producer emits camelCase, and the CLI is a producer. There's no config in the wild to migrate while the feature is in development, so there is no alias map and no normalize-on-read; `validateUiApp` simply rejects `action_link`. Note the platform's *own* `link_target` default is still gated on the literal `"action_link"`, so it no longer fires for CLI-authored apps — harmless, because `app upload` injects `link_target` explicitly and the kit defaults it client-side too.

**One placement per record page, and that is the CLI's rule, not the platform's.** The placement prompt is a single-select `list` per picked page (`placement:<location>`), so a page can be neither skipped nor given two spots — the constraint is structural rather than a validation message, which is why the flow asks N prompts instead of the one grouped multi-select it used briefly. The platform disagrees: `validateSnapshot` rejects only a *duplicate* slot, so a hand-edited config with two spots on one page uploads fine. Don't "restore" the grouped prompt to match the wire — and if the rule is ever lifted, the messages `APP_CREATE_UI_PLACEMENT_REQUIRED` / `_PAGE_MISSING` were deleted with it, along with the prompt-lock bug they caused (a page the registry offered nothing on could not satisfy its own validate).

**A UI app is prompt-only — there is no `--type` flag and no per-field flags.** `brevo app create` asks the app type first; a UI app can only be authored from an interactive terminal, so every non-interactive run (`--json` or piped stdin) creates an OAuth app, exactly as before BEX-290. This is deliberate: UI apps aren't live, and a scriptable create surface would invite pipelines to pin to a shape that can still change. Don't add flags back without revisiting that.

**Wire contracts — what is confirmed and what is still assumed.** The upload contract is confirmed against the platform's CLI upload endpoint: the block travels under the `ui_app` key on `POST /v3/app-store/apps/{id}/upload` (the earlier `snapshot` key was rejected server-side; "snapshot" on the platform names the whole stored app config).

**The block travels on `POST /v3/app-store/apps` (create) too, under the same key.** It used to be upload-only, on the reasoning that create merely registers the record while upload is the platform's validation authority for the configuration. That was wrong in one specific way: `ui_app` is the app-type discriminator on the wire exactly as it is in `app-config.json`, so a create that omits it *and* omits `auth` (as a UI app must — an action link has no OAuth callback) reads as an OAuth app that forgot its callbacks, and the endpoint answers `400 invalid_request` / `redirect_uris is required and must not be empty`. The two blocks are mutually exclusive on both requests: a UI app sends `ui_app` and no `auth`, an OAuth app sends `auth` and no `ui_app`. Upload still sends the block and remains the validation authority; create sends it so the record is created as the right type. Whether the create endpoint actually branches on it is **not yet confirmed** — see `RELEASE-CHECKLIST.md` → *Per-branch verification*. The deploy transport is confirmed too, and it is **one resource, not two routes** — `POST /v3/app-store/apps/{id}/installs` to install and `DELETE` on the same path to remove (app-store-backend PR #717, BEX-362/BEX-364). Both carry the same body: `client_id`, `deploy_client_id`, `name`, `is_developer` — of which only `name` and `is_developer` are always present, see below. The `deploy` / `rollback` commands are named for the partner-facing verb; the resource is an install.

**`client_id` and `deploy_client_id` are not interchangeable.** `client_id` is the *caller* — the account that owns the app, which the server resolves it against via `FindIDByUUID(uuid, client_id)`; the CLI sends the authenticated account's `organization_id` (`resolveCallerClientId()` in `src/services/app.ts`). `deploy_client_id` is the *target* the install lands in, and the server falls back to `client_id` when it is absent. They differ only for a corporate deploy into a sub-account — collapsing them 404s the app lookup.

**Both body identifiers are optional, and a non-numeric one is omitted rather than sent.** Brevo identifies accounts numerically in some places (a sub-account listing's `id`) and by UUID in others (`organization_id` may be either), but both fields are Go `int64` and **the handler decodes the body before it reads `X-Sib-Client-Id`** — so a UUID in either field is a decode failure (400) that kills a request the header would have resolved fine. `toNumericIdentifier()` therefore yields `undefined` for anything non-numeric and `pick()` drops the key. Omission loses nothing: the server resolves `client_id` from the gateway-populated header, and defaults `deploy_client_id` to the caller — which is exactly right for the only case that can produce a non-numeric target, a plain account deploying into itself.

Do **not** "tidy" this into `Number()` on everything (`NaN` → `null` → also a decode failure), and do **not** send a UUID as a string "to let the server decide" — it cannot, it 400s first. Confirmed against staging: a working `DELETE .../installs` sends `{deploy_client_id, is_developer}` with **no `client_id` at all**. `getCallerAccountId()` is the separate display/target path and does keep a UUID intact; only an absent/blank org ID throws there. `parseAccountId()` is a third contract and stays numeric-only — it validates the explicit `[account-id]` positional, whose real-world source is a sub-account `id`. Coverage in `__tests__/services/app.test.ts`.

**DELETE answers 404, not 422**, and for both "app doesn't exist" and "no such install" — the developer uninstall route has no `installation_id` to delete by, so it resolves the install from the body and can't distinguish the two in the status code. `rollbackApp()` therefore deliberately skips `rethrowNotFound` and `app rollback` maps *any* 404 to its informational not-deployed path (exit 0). Do not "fix" that by matching on the server's error copy.

Still assumed: HTTP 422 for deploy's "not uploaded" (PR #717 is uninstall-only), whether the POST response carries an install ID worth surfacing, and the `type === 'corporate'` discriminator on `/v3/account/info` that account resolution branches on — all marked in code comments and tracked in `RELEASE-CHECKLIST.md` → *Before UI-apps GA*.

**`[account-id]` is optional on both commands.** Omitted, the target resolves from the authenticated account: a plain account deploys into itself (no prompt, so `--json`/CI still work), a corporate account picks from `GET /v3/corporate/subAccount`. Resolution lives once in `resolveDeploymentTarget()` (`src/commands/app/account-deployment.ts`) and both commands inherit it. The explicit positional is checked first — it keeps CI unchanged and is the only way to reach an account the listing won't show, notably a deactivated sub-account.

**The presence of `ui_app` is the app-type discriminator** — there is no `appType` key in `app-config.json`. Every branch that needs to tell the two types apart goes through `isUiAppConfig()` in `src/lib/config.ts`; use it rather than testing for the key inline, so the discriminator can change in one place.

## Public repository — review before committing

This repo is **public** at `github.com/getbrevo/brevo-cli` and the package publishes to the **public npm registry** under `@getbrevo`. Every commit, PR title, PR description, issue, and review comment is world-readable and indexed by search engines. Treat each commit and PR as a public release.

**Never commit:**

- Real API keys (`xkeysib-…`), OAuth client secrets, refresh tokens, session tokens, or anything from `~/.brevo/credentials.json`
- `.env` files, `.brevo.json` linked-project config, real `app-config.json` from a Brevo account
- Internal infrastructure URLs, non-production hostnames, internal Slack/Confluence links, or internal Jira issue *content*
- Customer or account identifiers (real org IDs, account IDs, app UUIDs from production), names, emails, IP addresses, log dumps containing PII
- Screenshots that contain any of the above
- Internal-only design docs, RFCs, or roadmap details

**Test fixtures must use placeholders.** API keys → `xkeysib-test-…`, app IDs → fake UUIDs, hostnames → `example.com` or `localhost`, emails → `user@example.com`. Mirror the format of real values without using real values.

**PR titles, descriptions, and commit messages are public.** Reference Jira tickets by key only (`BEX-169`) — the URL maps to a private Jira so the link is fine, but don't restate private ticket content (customer names, internal incident details, security-sensitive context) in the public PR body. If a change is driven by a security fix, keep the public commit message high-level and coordinate disclosure separately.

**Before every commit:**

1. Run `git diff --staged` and skim the full diff — confirm no secrets, real customer data, or internal URLs slipped in
2. Check `git status` for accidentally staged files (`.env`, `credentials.json`, `.brevo.json`, screenshots, scratch files)
3. Confirm the commit message and any PR body would be safe to publish on a billboard

**Before every PR:**

- Re-read the title and body for internal context that doesn't belong in public
- Confirm any added test fixtures use placeholder data
- If you're unsure whether something is sensitive, ask before pushing

## Build & run

```bash
yarn install            # install dependencies
yarn build              # compile TS + copy templates to dist/
yarn link:dev           # build + yarn link for local testing
yarn dev                # watch mode (tsc --watch)
```

## Test

```bash
yarn test               # jest --passWithNoTests
yarn test:ci            # jest --coverage
```

All tests live in `src/__tests__/` mirroring the `src/` structure. Tests use Jest with `ts-jest`. Mocks go inline in test files (no shared mock directory).

## Lint & format

```bash
yarn lint               # eslint (quiet mode)
yarn lint:fix           # eslint --fix
yarn format             # prettier --write
yarn format:check       # prettier --check
```

Pre-commit hook (husky + lint-staged) runs prettier and eslint on staged `.ts` files, then runs the full test suite.

## Sonar hotspots — always fix, don't dismiss

SonarCloud runs on every PR (`getbrevo_brevo-cli`). **Treat every security hotspot it raises as an issue to fix in the same PR, not to mark as "Safe" / "Acknowledged".** This includes hotspots in test files — Sonar doesn't distinguish, and neither do we. Common patterns and the standard fix:

- **`Math.random()` for IDs, temp paths, tokens, or anything name-like** → swap to `node:crypto`. For temp directories use `fs.mkdtempSync(path.join(os.tmpdir(), 'prefix-'))`; for a random string use `crypto.randomBytes(n).toString('hex')` or `crypto.randomUUID()`. Never silence with `// NOSONAR`.
- **Hard-coded credentials / regex that looks like a secret** → use placeholders that don't match the credential format (`xkeysib-test-…`, fake UUIDs). See the public-repo rules above.
- **Insecure protocol (`http://`)** → fine for `127.0.0.1` / `localhost` loopback (OAuth callback, scope-catalog `--web` page); for anything else, use `https://`.
- **`child_process.exec` with interpolated input** → switch to `execFile` / `spawn` with arg arrays, never shell-concat user input.

If a hotspot genuinely doesn't apply, fix the code anyway when the fix is cheap (one-line swap to `crypto.*`). Only argue "Safe" in the Sonar UI when the fix would meaningfully hurt readability or correctness — and document the reason in the PR description, not just in Sonar.

## Project structure

```
src/
  bin/index.ts              CLI entry point (commander setup, error handling)
  commands/
    definitions.ts          Command/option registry (all commands declared here)
    login.ts, logout.ts     Auth commands
    init.ts, whoami.ts      Setup/info commands
    app/                    App subcommands (create, list, scaffold, start, test, update, delete, credentials)
  services/                 Business logic (appService, accountService)
  api/                      HTTP client (client.ts)
  lib/                      Shared utilities (config, constants, errors, logger, validators, ui)
  lang/en.ts                All user-facing strings (single source of truth)
  templates/
    index.ts                Template loader + manifest
    files/*.tmpl            Scaffold templates (11 files; manifest in `templates/index.ts`)
  types.ts                  Shared TypeScript interfaces
  __tests__/                Tests (mirrors src/ structure)
```

## Key conventions

- **All user-facing strings** live in `src/lang/en.ts` — never hardcode messages in command files.
- **CLI command references** (e.g. `brevo app create`) are defined in `src/lib/constants.ts` as `CLI.*` — use these instead of string literals.
- **Commands** are registered declaratively in `src/commands/definitions.ts` — handler functions live in their own files.
- **Error handling** uses `CliError` (user-facing) and `ApiError` (HTTP errors) from `src/lib/errors.ts`. Commands are wrapped with `withCommandHandler()`.
- **JSON output** — every command supports `--json` via `jsonOutput()` from `src/lib/json-output.ts`.
- **`brevo app update`** supports `--name`, `--redirect-uri` (repeatable, appends), `--logo-uri`, and `--app-id` flags. Without flags it pushes the full `app-config.json` (current behavior; includes `logoUri` when non-empty). With flags it merges: flag values override/append existing values from `app-config.json` or the API. After a successful update, `app-config.json` is written back if it exists and the app ID matches (and `--logo-uri` writes the new value into the file).
- **Scaffold templates** in `src/templates/files/*.tmpl` use `{{VARIABLE}}` placeholders. Variables are defined in `scaffold.ts` and listed in `templates/index.ts`. Templates must reference both `npm` and `yarn` (not npm-only). Use `brevo app start oauth` (not `brevo app start`).
- **Credentials** are stored in `~/.brevo/credentials.json`. App credentials (clientId/clientSecret) are cached per app ID under an `apps` key.

## Keep agent docs in sync with CLI behavior

The CLI ships two agent-facing docs at the repo root, both bundled into the published tarball via `package.json` `files:`:

- `agent-context/SKILL.md` — the Claude Code skill. Installed into `~/.claude/skills/brevo-cli/` by `brevo skill:cli install` and **auto-refreshed** on every subsequent `brevo` invocation (opt out: `BREVO_NO_SKILL_AUTOREFRESH=1`). It is also the source `src/skills/index.ts` reads via `SKILLS_BUNDLE_DIR` — there is no second copy.
- `agent-context/AGENTS.md` — the broader `agents.md`-format reference for any agent-aware tool.

**Whenever you change user-visible CLI behavior, update both files in the same PR.** An out-of-sync skill actively misleads any AI helping a user with this CLI — that's worse than no skill at all.

**Keep `AGENTS.md` and `SKILL.md` in sync with each other.** Even when no CLI behavior changed, if you edit one of these files, check the other still aligns before opening the PR. They cover the same command surface, hard rules, version-check procedure, and exit codes — `AGENTS.md` is the broader reference (also documents env vars and the Claude-vs-non-Claude install path), `SKILL.md` is the Claude-focused subset. Pure-doc edits aren't "user-visible CLI behavior," so the rule above doesn't catch them — this rule does. If a difference is intentional (e.g. AGENTS.md branches by agent type because SKILL.md is Claude-only by construction), say so in the PR description so a future reader doesn't try to "fix" it.

**What counts as user-visible:**

- New or removed commands or subcommands.
- New, removed, or renamed flags on existing commands.
- New or removed `BREVO_*` env vars, or changes to existing-var semantics.
- Changed defaults (new opt-in/opt-out, changed prompt behavior).
- Changed exit codes or error messages that scripts may match on.
- Removed features that the docs currently advertise (e.g. removing `brevo skill:cli update` requires removing it from both docs).

**What does NOT count:** internal refactors, bug fixes that preserve UX, dependency bumps, test-only changes, log-line formatting tweaks that aren't part of the documented contract.

**Skill version tracks the CLI version automatically.** `SKILL_CATALOG[brevo-cli].version` is computed at module-init from `package.json` (`CLI_VERSION` in `src/skills/index.ts`), so every published CLI release auto-refreshes installed skills — even when `SKILL.md` content didn't change. You only need to land your changeset; the skill version takes care of itself.

## Testing patterns

- Mock external dependencies (`inquirer`, `../container`, `../lib/config`) at the top of test files.
- Use `jest.spyOn(process.stdout, 'write')` to capture CLI output.
- Services are tested against mocked API client responses.
- Template tests verify variable substitution, not file I/O.

## Working docs: RELEASE-CHECKLIST.md and TODO.md

`RELEASE-CHECKLIST.md` (formerly `TESTING.md`) and `TODO.md` track in-flight work at the repo
root. `TODO.md` is a running work tracker. `RELEASE-CHECKLIST.md` has **two sections that live
by different rules** — read its header before editing it:

- `## Before public-apps GA` — **durable.** Survives into `main` and stays there until public
  app distribution ships. Do not delete it as part of branch cleanup.
- `## Per-branch verification` — **scratch.** Same role the old `TESTING.md` had; exists only
  for the lifetime of a branch/PR.

Working rules:

- **Whenever you make a change that needs verification**, append an entry under
  `## Per-branch verification` (follow its template) covering what must hold true — new
  criteria, not a rewrite of old ones.
- **Whenever you identify follow-up work that isn't done in the current change**, append an
  item to `TODO.md` under `## Open` rather than letting it fall through silently.
- **Before merging the branch into `main`, delete `TODO.md` and clear the
  `## Per-branch verification` section of `RELEASE-CHECKLIST.md`** — per-branch working state
  doesn't belong in `main`'s history. **Keep the file itself and its
  `## Before public-apps GA` section.**

## Adding a new command

1. Create handler in `src/commands/` (or `src/commands/app/` for app subcommands)
2. Wrap with `withCommandHandler()` for consistent error handling
3. Register in `src/commands/definitions.ts`
4. Add user-facing strings to `src/lang/en.ts`
5. Add CLI references to `src/lib/constants.ts` if needed
6. Write tests in `src/__tests__/commands/`

## Versioning & releases

This project uses [changesets](https://github.com/changesets/changesets) for versioning. Packages publish to the public npm registry (`registry.npmjs.org`) under the `@getbrevo` scope.

```bash
yarn changeset            # create a new changeset (interactive)
yarn version:packages     # consume changesets, bump version, update CHANGELOG
yarn publish:packages     # publish to npm
```

**When to add a changeset:** any PR that changes user-visible behavior (new feature, bug fix, breaking change). Run `yarn changeset` and commit the generated file with your PR.

**One changeset file per branch/PR — append, don't multiply.** Before creating a new changeset, check `.changeset/` for an existing pending one (any `.md` other than `README.md`). If one exists, append your change description as new lines in its summary body instead of creating a second file, and raise the bump level in its frontmatter if your change warrants it (`patch` → `minor` → `major`). Only create a new file when none exists.

**CI/CD:**
- `.github/workflows/push.yaml` — runs lint, test, build on every push/PR to `main`
- `.github/workflows/release.yaml` — when changesets merge to `main`, opens a "Version Packages" PR; merging that PR publishes to npm
- `.github/workflows/pre-release.yaml` — pushes to `release-*` branches publish alpha prereleases to npm

**npm auth: Trusted Publishing (OIDC), no long-lived token.** Publishes authenticate to npm via the GitHub Actions OIDC token (`id-token: write`) — there is no `NPM_TOKEN` secret. The trust relationship is configured on npmjs.com for `@getbrevo/cli` and binds publishes to: repo `getbrevo/brevo-cli`, the specific workflow file, and the GitHub environment (`npm-publish` for stable, `npm-prerelease` for alphas). See https://docs.npmjs.com/trusted-publishers.

**Secrets required:**
- `GITHUB_TOKEN` — auto-provided by GitHub Actions
- `SLACK_*_WEBHOOK_URL` — only for release announcements (configured in the `npm-publish` environment)
- `HOMEBREW_TAP_TOKEN` — fine-grained PAT scoped to **only** `getbrevo/homebrew-tap` (contents + pull-requests write), in the `npm-publish` environment. Used solely by the Homebrew auto-bump step; has no npm access. Has an expiry — rotate before it lapses or the auto-bump silently stops.

**Homebrew distribution.** The CLI is also installable via `brew install getbrevo/tap/brevo`. The formula lives in the separate public repo [`getbrevo/homebrew-tap`](https://github.com/getbrevo/homebrew-tap) (`Formula/brevo.rb`), which builds from the published npm tarball. After every npm publish, the `Bump Homebrew formula` step in `release.yaml` recomputes the tarball `url` + `sha256` and opens a bump PR on the tap; the tap's own CI (`brew audit`/`brew test`) gates it and a human merges. This is a distribution channel only — no CLI command/flag/env-var surface — so it does **not** require `SKILL.md`/`AGENTS.md` edits, only the README install section.

**Workflow / publishing changes — treat as security review, not style review.** Any edit to `.github/workflows/release.yaml` or `.github/workflows/pre-release.yaml`:

- Code-owner review is required (enforced via `CODEOWNERS`)
- Keep every **third-party** `uses:` pinned to a commit SHA with a version comment (e.g. `changesets/action`, `andstor/file-existence-action`). First-party `actions/*` (GitHub-published, like `actions/checkout`, `actions/setup-node`, `actions/upload-artifact`) may use a major-version tag (e.g. `actions/checkout@v6`, `actions/setup-node@v6`, `actions/upload-artifact@v4`).
- Keep `persist-credentials: false` on every checkout in any job that has access to publish secrets
- Keep `id-token: write` and `NPM_CONFIG_PROVENANCE=true` on the publishing step
- Do not reintroduce `NPM_TOKEN` — auth is OIDC. If publishing breaks, fix the trusted-publisher config on npmjs.com, do not paper over it with a static token.
- Keep the npm CLI pinned to a version that supports Trusted Publishing (>= 11.5.1). Do not use `npm@latest`.
- Keep `HOMEBREW_TAP_TOKEN` scoped to **only** `getbrevo/homebrew-tap` with the minimum permissions (contents + pull-requests). Do not widen its repo scope or grant it npm access, and do not move the Homebrew bump step out from behind the `published == 'true'` gate.

If a contributor proposes removing any of these, push back — don't silently drop them to make a diff cleaner.
