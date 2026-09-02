# AGENTS.md — Brevo CLI

## Project

Brevo Developer CLI (`@getbrevo/cli`) — TypeScript CLI for managing OAuth app integrations with the Brevo platform.

Public CLI reference: https://developers.brevo.com/docs/cli-reference — the authoritative user-facing command/flag/exit-code documentation. Keep this in sync when changing user-visible behaviour.

## Public apps are GA — the whole surface ships (BEX-405)

Public app distribution and the review lifecycle are **live**: `brevo app create --distribution public`, `brevo app submit`, `brevo app status` and `brevo app withdraw` all ship in the published build. A build-time gate used to eliminate them; `scripts/build.mjs` now asserts they are **present** in the bundle (`GA_MARKERS`).

**Nothing is gated, and the gate is gone** — `src/lib/preview.ts`, `src/globals.d.ts`, the esbuild `define` block, the `LEAK_MARKERS` / `LEAK_STRINGS` checks, `build:preview` and the three preview modules (`commands/preview-definitions.ts`, `lang/preview-messages.ts`, `lib/preview-constants.ts`) are all deleted. **There is one build** — no `PREVIEW=1`, no `__BREVO_PREVIEW__`. If a feature ever has to be held back from a published build again, read `CLAUDE.md` → *If you ever need to gate a feature again* first: the mechanism and its two traps are written down there, and flipping a readiness row is not sufficient on its own.

**`brevo app submit` is a form hand-off, not a state transition** — it opens a Google Form and changes nothing server-side, so exit `0` does not mean "submitted". The initial review state is `draft` (not `configured`, renamed by BEX-382), and reviewer feedback goes out by email, never through `app status`.

## UI apps are GA — the whole surface ships (BEX-290)

UI apps (action links that render inside Brevo CRM records) shipped at BEX-290: the *UI app* choice at `brevo app create`'s app-type prompt, `brevo app install [account-id]` and `brevo app uninstall [account-id]` are all in the published build. Their command definitions live in `src/commands/definitions.ts`, their strings in `src/lang/en.ts`, and their bindings are asserted **present** by `GA_MARKERS` in `scripts/build.mjs`. Public apps followed at BEX-405 and the pre-GA gate was torn down after it.

A UI app is **prompt-only**: there is no `--type` flag and no per-field flags, so non-interactive runs always create an OAuth app. `extension_type` values are camelCase (`actionLink`, `iframeExtension`, `legacyComponent`) and the old snake_case spellings are rejected. The `ui_app` block's **field names are confirmed** against both of the platform's consumers, the manifest read path and the extensibility UI kit (BEX-308 / BEX-350) — it is the stored app snapshot verbatim. See `CLAUDE.md` → *UI apps are GA* for the full contract.

**One stored configuration, shared by every install.** `brevo app upload` is what changes an installed UI app — there is no per-account copy, no publish step and no re-install — so both commands show the change before making it: `upload`'s diff renders the block placement by placement (`formatPlacementDiffLines`, `before → after`, `(new)` / `(removed)`) and warns that the app may already be installed before its confirmation, and `install` prints the **server's** stored configuration and version before asking. The warning is unconditional for a UI app because the CLI cannot count installs — no install-listing read exists — so a claim either way would be invented.

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
