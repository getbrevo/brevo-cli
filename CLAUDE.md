# CLAUDE.md — Brevo CLI

## Project

Brevo Developer CLI (`@getbrevo/cli`) — create, manage, and test OAuth integrations from the terminal.

- **Language:** TypeScript (CommonJS, ES2022 target)
- **Runtime:** Node.js >= 20.15.0
- **Package manager:** Yarn >= 1.19.1
- **Public CLI reference:** https://developers.brevo.com/docs/cli-reference — keep behaviour, flags, and exit codes in sync with this page when changing user-facing commands.

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
- **`brevo app update`** supports `--name`, `--redirect-uri` (repeatable, appends), and `--app-id` flags. Without flags it pushes the full `app-config.json` (current behavior). With flags it merges: flag values override/append existing values from `app-config.json` or the API. After a successful update, `app-config.json` is written back if it exists and the app ID matches.
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

**CI/CD:**
- `.github/workflows/push.yaml` — runs lint, test, build on every push/PR to `main`
- `.github/workflows/release.yaml` — when changesets merge to `main`, opens a "Version Packages" PR; merging that PR publishes to npm
- `.github/workflows/pre-release.yaml` — pushes to `release-*` branches publish alpha prereleases to npm

**npm auth: Trusted Publishing (OIDC), no long-lived token.** Publishes authenticate to npm via the GitHub Actions OIDC token (`id-token: write`) — there is no `NPM_TOKEN` secret. The trust relationship is configured on npmjs.com for `@getbrevo/cli` and binds publishes to: repo `getbrevo/brevo-cli`, the specific workflow file, and the GitHub environment (`npm-publish` for stable, `npm-prerelease` for alphas). See https://docs.npmjs.com/trusted-publishers.

**Secrets required:**
- `GITHUB_TOKEN` — auto-provided by GitHub Actions
- `SLACK_*_WEBHOOK_URL` — only for release announcements (configured in the `npm-publish` environment)

**Workflow / publishing changes — treat as security review, not style review.** Any edit to `.github/workflows/release.yaml` or `.github/workflows/pre-release.yaml`:

- Code-owner review is required (enforced via `CODEOWNERS`)
- Keep every **third-party** `uses:` pinned to a commit SHA with a version comment (e.g. `changesets/action`, `andstor/file-existence-action`). First-party `actions/*` (GitHub-published, like `actions/checkout`, `actions/setup-node`, `actions/upload-artifact`) may use a major-version tag (e.g. `actions/checkout@v6`, `actions/setup-node@v6`, `actions/upload-artifact@v4`).
- Keep `persist-credentials: false` on every checkout in any job that has access to publish secrets
- Keep `id-token: write` and `NPM_CONFIG_PROVENANCE=true` on the publishing step
- Do not reintroduce `NPM_TOKEN` — auth is OIDC. If publishing breaks, fix the trusted-publisher config on npmjs.com, do not paper over it with a static token.
- Keep the npm CLI pinned to a version that supports Trusted Publishing (>= 11.5.1). Do not use `npm@latest`.

If a contributor proposes removing any of these, push back — don't silently drop them to make a diff cleaner.
