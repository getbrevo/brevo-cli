# AGENTS.md — Brevo CLI

## Project

Brevo Developer CLI (`@getbrevo/cli`) — TypeScript CLI for managing OAuth app integrations with the Brevo platform.

Public CLI reference: https://developers.brevo.com/docs/cli-reference — the authoritative user-facing command/flag/exit-code documentation. Keep this in sync when changing user-visible behaviour.

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
