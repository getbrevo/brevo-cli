# AGENTS.md — Brevo CLI

## Project

Brevo Developer CLI (`@getbrevo/cli`) — TypeScript CLI for managing OAuth app integrations with the Brevo platform.

Public CLI reference: https://developers.brevo.com/docs/cli-reference — the authoritative user-facing command/flag/exit-code documentation. Keep this in sync when changing user-visible behaviour.

## Public app distribution is not GA — the agent-doc notice is deliberate

Public app distribution is **not live on the Brevo platform**. The CLI already ships the surface for it — `brevo app create --distribution public`, `brevo app submit`, `brevo app status`, `brevo app withdraw` — but nothing behind those commands is usable yet.

Because that surface is shipped and unguarded, `agent-context/SKILL.md` and `agent-context/AGENTS.md` each carry a **⚠️ Public apps are not available yet** notice telling agents never to create a public app or drive the review lifecycle. This file, `CLAUDE.md`, and `README.md` mirror it.

**This does not restrict work in this repo.** Building, changing, testing, and QA-ing the public-app code paths is expected and unblocked — write the code, run the commands, create public apps against test environments, work through the public-app cases in `QA-TESTCASES.md`. The notice governs what the shipped docs tell an *end user's* agent; it is not a freeze on the feature. Never refuse or hedge on a public-app task in this repo because of it.

- **Do not remove or soften that notice** as part of unrelated cleanup. It is the only thing stopping an AI agent from leading a user into creating a public app they can't do anything with.
- **Keep the *Exception — internal Brevo accounts* clause** in both shipped docs. It tells the agent to run `brevo whoami --json` and skip the restriction when `email` ends in `@brevo.com` or `@sendinblue.com`. Without it the notice blocks dogfooding: an agent helping a Brevo developer or QA test `app submit` would refuse. Gating on the account domain rather than on the user's say-so keeps it objective — an end user can't talk their way past it.
- **The domain check is a guardrail, not a security boundary.** It's client-side guidance in a doc; anyone can ignore the docs and pass `--distribution public` themselves. If public apps must actually be restricted pre-GA, that belongs on the API.
- **This is documentation-level only.** The CLI itself still accepts `--distribution public` without a warning or a guard, by design — a runtime guard is tracked separately (see `RELEASE-CHECKLIST.md`). If one is ever added, it needs the same internal-account escape hatch.
- **When public apps go GA**, work through `RELEASE-CHECKLIST.md` → *Before public-apps GA* to remove the notice everywhere in one pass.

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
