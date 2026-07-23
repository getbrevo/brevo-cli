# Decouple directory setup from scaffolding — design

_Date: 2026-07-23_

## Problem

`brevo app create` and `brevo app scaffold` currently entangle two distinct
responsibilities inside one code path:

- **Directory setup** — deciding where the project lives on disk, creating that
  folder if needed.
- **Scaffolding** — writing starter template files (currently a single OAuth
  starter) into that folder.

Today, `create` always auto-invokes `scaffoldCommand` after the app is created, and
`scaffoldCommand` is the *only* place that resolves/creates a target directory
(`resolveTargetDir`) — it never actually moves the running process into that
directory, it just writes files at a resolved path. Additionally, `scaffoldCommand`
run standalone refuses outright if **any** `app-config.json` exists in the current
directory, regardless of which app it belongs to, pointing the user at
`brevo app update` instead.

## Goal

- `brevo app create` owns directory setup directly: prompt for a directory, create
  it, and `chdir` into it, as its own step — not bundled inside the scaffold call.
- Scaffolding gains an explicit "what kind of project?" prompt (single option today:
  *Test OAuth App*), shown both when `create` continues into scaffolding and when
  `brevo app scaffold` is run standalone.
- `brevo app scaffold` run standalone becomes directory-aware instead of a blanket
  refusal: it distinguishes "no linked project here" (do directory setup, same as
  create), "already linked to this app" (confirm before re-scaffolding in place),
  and "linked to a different app" (must pick another directory or cancel).

## Non-goals

- No new scaffold *types* beyond the existing OAuth starter. The project-type prompt
  is introduced now purely as a UI seam for cleaner separation of concerns, not
  because a second type is planned — it will offer exactly one choice.
- No change to `confirmCreateOverLinkedApp()` — the existing "app-config.json for
  *this* app already exists, create a new app anyway?" guard inside `create` is
  unrelated to the scaffold-directory rework and stays as-is.
- No "proceed anyway" override for Case C (scaffold pointed at a directory linked to
  a *different* app) — that path only ever offers "choose a different directory" or
  "cancel", to avoid mixing two apps' files in one folder.
- No `--json` prompt for project type — `--json` is scripting-oriented and
  non-interactive; it defaults to the one existing type (`'oauth'`), same as it
  implicitly does today.

## Design

### Shared helpers

Two new shared pieces of logic, used by both `create.ts` and `scaffold.ts`:

- **`resolveProjectDirectory(defaultSlug: string): Promise<string>`** — prompts for
  a directory (default `./<defaultSlug>`), `mkdirSync(targetDir, { recursive: true })`,
  then `process.chdir(targetDir)`. Returns the resolved absolute path. This replaces
  the directory-prompting half of today's `resolveTargetDir` — the actual `chdir`
  call is new behavior (today's scaffold only ever writes to a resolved path, it
  never changes the process's cwd).
- **`promptProjectType(): Promise<'oauth'>`** — single-choice `list` prompt
  ("What kind of project do you want to scaffold?" → `Test OAuth App`). Returns a
  fixed `'oauth'` value. Skipped under `--json` (defaults to `'oauth'` directly, no
  prompt).

`runScaffold(appId, ctx, targetDir, mergeOnly)` is unchanged — it stays the pure,
prompt-free file-writing core.

### `brevo app create`

Prompt order becomes: app name → distribution → redirect URL(s) → logo URL →
**directory** (new) → API call → project-type prompt → scaffold write.

```
? App name: my-app
? Distribution type: Private / Public
? Redirect URL: http://localhost:8080/auth/callback
? Logo URL (optional):
? Directory: ./my-app                          ← new: resolveProjectDirectory(slug)
  Creating app...
  App created (App ID, Client ID, ...)
  Directory ./my-app created — moved into it.

? What kind of project do you want to scaffold?  ← new: promptProjectType()
❯ Test OAuth App
  Scaffolding "my-app"...
  Created 11 files
```

- The directory prompt sits right before the create API call (confirmed placement),
  defaulting to the slugified app name — same default scaffold already uses.
- After a successful create, `create.ts` calls scaffold's core logic directly with
  the already-resolved directory (now the process's cwd) — no second directory
  prompt. It runs `promptProjectType()`, then `runScaffold(appId, ctx, '.', false)`.
- `--json` mode: same directory resolution, non-interactively — creates
  `./<slug>`, chdirs in, skips the project-type prompt (defaults to `'oauth'`),
  writes files, and includes `directory` in the JSON output (as it does today).

### `brevo app scaffold` (standalone or as create's continuation)

Replaces today's `hasLocalApp() → throw` guard with a three-case branch, evaluated
after an app is selected (via `--app-id` or the interactive picker):

```
Case A — no app-config.json in cwd:
  ? Directory: ./my-app        ← resolveProjectDirectory(slug), same as create

Case B — app-config.json in cwd, SAME app (matching app ID):
  App "my-app" is already linked in this directory.
  ? Update/re-scaffold it here? (Y/n)
    yes → proceed in place (merge-only write, same as today's scaffold-over-existing-dir behavior)
    no  → cancel

Case C — app-config.json in cwd, DIFFERENT app:
  This directory is linked to a different app ("other-app").
  ? What would you like to do?
  ❯ Choose a different directory for "my-app"   ← re-runs Case A
    Cancel

→ ? What kind of project do you want to scaffold?
  ❯ Test OAuth App
  Scaffolding "my-app"...
```

- Case A is the new default when a user runs `brevo app scaffold` from a bare
  directory (or one with no `app-config.json`) — it now creates+chdirs instead of
  just writing to a subpath as before.
- Case B replaces today's blanket refusal for the matching-app case with a
  confirmation; on yes it proceeds with the existing merge-only write behavior.
- Case C is new — today's code treats this identically to Case B (hard refusal).
  Only "choose a different directory" or "cancel" are offered — no "proceed anyway"
  override, to avoid writing one app's files into a directory tied to another app.
- The project-type prompt runs after directory resolution, in all three cases,
  right before `runScaffold`.

### Files touched

- `src/commands/app/scaffold.ts` — add `resolveProjectDirectory`, `promptProjectType`;
  replace `resolveTargetDir`'s directory-only prompt usage and the `hasLocalApp`
  guard with the three-case branch; `scaffoldCommand` calls the new helpers.
- `src/commands/app/create.ts` — call `resolveProjectDirectory` before the API call;
  after creation, call `promptProjectType` + `runScaffold` directly instead of
  routing through `scaffoldCommand`'s own directory prompt.
- `src/lang/en.ts` — new prompt strings: directory prompt (if not already covered by
  `APP_SCAFFOLD_DIR_PROMPT`), project-type prompt, Case B confirmation, Case C
  choice list.
- Tests: `create.test.ts` (directory prompt + chdir behavior, continuation into
  scaffold with project-type prompt), `scaffold.test.ts` (three-case directory
  branch, shared helpers, project-type prompt).

### Docs

Per `CLAUDE.md`'s "keep agent docs in sync" rule, this changes user-visible
`create`/`scaffold` prompts and flow — update both `agent-context/AGENTS.md` and
`agent-context/SKILL.md`:

- New directory prompt placement in `create`.
- New project-type prompt in both `create`'s continuation and standalone `scaffold`.
- New Case B/C behavior replacing the old blanket `app-config.json` refusal.

### Testing

New/updated coverage, mirroring existing patterns in each file:

- `create.test.ts`: directory prompt appears before the API call; `process.chdir`
  is called with the resolved directory; `--json` mode resolves the same default
  directory non-interactively; continuation into scaffold shows the project-type
  prompt and skips a second directory prompt.
- `scaffold.test.ts`: Case A creates+chdirs when no `app-config.json` is present;
  Case B confirms before re-scaffolding when the config matches the target app;
  Case C offers choose-a-different-directory/cancel when the config is for a
  different app, and never writes into that directory without the user first
  picking a new one; project-type prompt appears in all three cases and is skipped
  under `--json`.

A `TESTING.md` entry tracks all of the above as verification criteria for this
branch, following the existing template.

## Rejected alternatives

- **Project-type prompt with no visible menu (fixed internal value).** Rejected —
  the user explicitly wants the one-item menu shown now so a future second scaffold
  type is a pure additive change to the choice list, not a flow change.
- **"Proceed anyway" option in Case C.** Rejected — writing a new app's scaffold
  files into a directory already linked to a different app risks silently mixing
  two projects' files; the safer default is to force the user to pick a clean
  directory or cancel.
- **Directory prompt earlier in `create`'s flow (before app name, or right after
  it).** Rejected in favor of keeping it last, immediately before the API call —
  keeps today's existing name/distribution/redirect/logo prompt order completely
  unchanged, directory setup is purely additive at the end.
