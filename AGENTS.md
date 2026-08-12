# AGENTS.md — Brevo CLI

## Project

Brevo Developer CLI (`@getbrevo/cli`) — TypeScript CLI for managing OAuth app integrations with the Brevo platform.

Public CLI reference: https://developers.brevo.com/docs/cli-reference — the authoritative user-facing command/flag/exit-code documentation. Keep this in sync when changing user-visible behaviour.

## Public app distribution is not GA — the published build omits it (BEX-405)

Public app distribution is **not live on the Brevo platform**. The repo contains the whole surface — `brevo app create --distribution public`, `brevo app submit`, `brevo app status`, `brevo app withdraw` — but a **published build does not**: `scripts/build.mjs` eliminates the review-lifecycle commands from the bundle, and `--distribution public` is refused with a typed `CliError`.

**This does not restrict work in this repo.** Building, changing, testing, and QA-ing the public-app code paths is expected and unblocked — write the code, run the commands, create public apps against test environments. Build with `PREVIEW=1 yarn link:dev` (or `yarn build:preview`) and the full surface is there. Never refuse or hedge on a public-app task in this repo.

- **The guard is the build, not the docs.** This replaced a documentation-only notice (and then a runtime check). `agent-context/SKILL.md` and `agent-context/AGENTS.md` no longer carry a *⚠️ not available yet* section or an *Exception — internal Brevo accounts* clause; they carry one rule instead — `brevo --help` is the complete surface. Don't reintroduce prohibition prose: an agent can't be led into a command that isn't in the binary.
- **There is deliberately no runtime escape hatch.** The earlier gate unlocked on an `@brevo.com` account or `BREVO_ENABLE_PREVIEW=1`; both are gone. A compile-time guard any user can switch back on is a runtime guard wearing a costume, and it has to ship the surface in order to reveal it. **Do not add one back.**
- **Two layers, no soft middle.** The build removes the surface; the Brevo API refuses public-app creation independently (`400 invalid_parameter`).
- **`FEATURE_STAGE` in `src/lib/preview.ts` is the single source of truth** for what is gated — but flipping a row to `'ga'` is necessary and **not sufficient** for a command, because gated definitions live in `src/commands/preview-definitions.ts` behind a *build* flag. See `RELEASE-CHECKLIST.md`.
- **When public apps go GA**, work through `RELEASE-CHECKLIST.md` → *Before public-apps GA* in one pass.

## UI apps are not GA either — same deal (BEX-290)

UI apps (action links that render inside Brevo CRM records) are **not live on the platform**. The repo contains the surface — the *UI app* choice at `brevo app create`'s app-type prompt, `brevo app deploy [account-id]`, `brevo app rollback [account-id]` — and a **published build does not**: both commands are eliminated and the app-type prompt is not asked, so a public build creates an OAuth app exactly as it did before BEX-290.

A UI app is **prompt-only**: there is no `--type` flag and no per-field flags, so non-interactive runs always create an OAuth app. `extension_type` values are camelCase (`actionLink`, `iframeExtension`, `legacyComponent`) and the old snake_case spellings are rejected. See `CLAUDE.md` for why.

**Every clause of the public-apps section above applies verbatim**, including that it does **not** restrict work in this repo — building, testing, and QA-ing the UI-app code paths is expected and unblocked (`PREVIEW=1 yarn link:dev`). Never refuse or hedge on a UI-app task here.

The `ui_app` block's **field names are confirmed** against both of the platform's consumers, the manifest read path and the extensibility UI kit (BEX-308 / BEX-350) — it is the stored app snapshot verbatim. What remains **assumed is the transport**: nothing on the platform writes that snapshot yet. See `CLAUDE.md` → *UI apps are not GA either* and `RELEASE-CHECKLIST.md` → *Before UI-apps GA*.

- **When UI apps go GA**, work through `RELEASE-CHECKLIST.md` → *Before UI-apps GA*.

## Public repository

Repo (`github.com/getbrevo/brevo-cli`) and package (`@getbrevo/cli` on the public npm registry) are **public**. Every commit, PR, and issue is world-readable.

**Never commit:**
- Real API keys (`xkeysib-…`), OAuth secrets, refresh/session tokens, contents of `~/.brevo/credentials.json`
- `.env`, `.brevo.json`, real `app-config.json`
- Internal hostnames or non-production URLs, internal Slack/Confluence/Jira-content references
- Real customer/account IDs, emails, PII, screenshots containing any of the above

**Test fixtures use placeholders only:** `xkeysib-test-…`, fake UUIDs, `example.com`, `user@example.com`.

**Public commit messages and PR bodies:** reference Jira tickets by key (`BEX-169`); don't restate private ticket content. Keep security-fix commit messages high-level.

**Before every commit:** `git diff --staged` and `git status` — confirm no secrets, real data, internal URLs, or stray files (`.env`, `credentials.json`, scratch files).

## Build & test

```bash
yarn install            # install dependencies
yarn build              # compile TS + copy templates to dist/
yarn test               # run all tests (jest)
yarn lint               # eslint
yarn format:check       # prettier check
```

Pre-commit hook runs lint, format, and full test suite on every commit.

## Project structure

```
src/
  bin/index.ts              Entry point — commander setup, signal/error handling
  commands/
    definitions.ts          Declarative command + option registry
    login.ts, logout.ts     Authentication
    init.ts, whoami.ts      Setup and user info
    app/                    App subcommands:
      create.ts             Create OAuth app
      list.ts               List apps
      credentials.ts        Show app credentials
      scaffold.ts           Generate starter project
      start.ts              Run scaffolded feature locally
      update.ts             Push app config to Brevo
      delete.ts             Delete an app
  services/                 Business logic layer
    app.ts                  App CRUD, credential resolution
    account.ts              Account validation
  api/client.ts             HTTP client with retry, auth, debug logging
  lib/
    config.ts               Credential storage (~/.brevo/credentials.json)
    constants.ts            CLI command strings, API endpoints, defaults
    errors.ts               CliError, ApiError, AbortError
    logger.ts               Colored terminal output
    validators.ts           Input validation helpers
    ui.ts                   Spinners, boxes
    command-handler.ts      withCommandHandler() wrapper
    json-output.ts          --json output helper
    auth-guard.ts           Pre-command auth check
  lang/en.ts                All user-facing strings
  templates/
    index.ts                Template loader, manifest, variable substitution
    files/*.tmpl            11 scaffold templates (see manifest in templates/index.ts)
  types.ts                  Shared interfaces (OAuthApp, AccountResponse, etc.)
  __tests__/                Jest tests (mirrors src/ structure)
```

## Code conventions

- User-facing strings: `src/lang/en.ts` (never hardcode in commands)
- CLI references: `src/lib/constants.ts` → `CLI.*`
- Commands registered in `src/commands/definitions.ts`
- All commands wrapped with `withCommandHandler()` for error handling
- All commands support `--json` flag
- Scaffold templates (`*.tmpl`) use `{{VARIABLE}}` placeholders; must mention both npm and yarn
- Credentials stored at `~/.brevo/credentials.json`

## Testing

- Framework: Jest + ts-jest
- Tests in `src/__tests__/` mirror `src/` layout
- Mock pattern: inline `jest.mock()` at top of test file
- Output capture: `jest.spyOn(process.stdout, 'write')`

## Adding a command

1. Handler in `src/commands/` (wrap with `withCommandHandler()`)
2. Register in `src/commands/definitions.ts`
3. Strings in `src/lang/en.ts`
4. Constants in `src/lib/constants.ts` if referenced elsewhere
5. Tests in `src/__tests__/commands/`

## Changesets — one file per branch, append don't multiply

Any change to user-visible behavior needs a [changeset](https://github.com/changesets/changesets) (`.changeset/*.md`).

**Keep exactly ONE pending changeset file per branch/PR.** Before creating a new one, check `.changeset/` for an existing pending changeset (any `.md` other than `README.md`):

- **If one exists:** append your change details as new lines in its summary body — do NOT create a second file. If your change warrants a higher bump than the file currently declares, raise the bump level in its frontmatter (`patch` → `minor` → `major`).
- **If none exists:** create one (via `yarn changeset`, or write the file directly) and commit it with your changes.

Changeset file shape, for reference:

```md
---
"@getbrevo/cli": patch
---

First change description.
Second change description appended later on the same branch.
```
