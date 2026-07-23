# BEX-255 — Implementation Plan

## Context

BEX-255 ("Brevo CLI app versioning + create and field + creating directory by default") originally asked for a CLI-defaulted `version: "1.0.0"` field plus `description`/`support.*` prompts. Per a Slack decision from Mauricio (2026-07-20, thread linked in the ticket), the `description`/`support.*` fields were dropped from scope entirely — that metadata will live in a future dedicated submission form, not the CLI manifest. The Jira ticket has already been updated to reflect this.

Since then, the `version` sub-scope has been superseded by a more accurate, already-authored design: **`docs/superpowers/specs/2026-07-23-app-version-config-design.md`**. That spec discovered the app-store API already returns a server-assigned `version` per app (confirmed via swagger — `GET`/`POST /v3/app-store/apps` return `"version": "0.0.1"`). So the CLI's job is not to invent/default a version string — it's to **surface the value the API already returns**, end-to-end: capture it at creation, persist it in `app-config.json`, display it in `create`/`list`, and backfill it for pre-existing local configs via `update`. This plan adopts that spec as the authoritative design for the version work (the Jira ticket's "initialized to `1.0.0`" language is stale and should be corrected in a follow-up Jira edit once this lands).

This work also sits alongside unrelated-but-adjacent already-landed work (public distribution enablement, `distribution_type` relocation to a top-level `ProjectConfig` field). **Do not touch or revert that** — it's separate, already-merged/in-progress work, not part of this plan. `--distribution public` no longer throws (the old `APP_CREATE_PUBLIC_UNAVAILABLE` block is gone from `create.ts`), which is what makes public distribution and version-tracking both real, working paths now rather than blocked/hypothetical ones.

This plan covers the two pieces of BEX-255 that remain: **(A) end-to-end `version` tracking** (per the spec doc) and **(B) default directory creation on `brevo app create`**.

**Note:** as of this file landing on the `add-app-version-config` branch, Part A already has substantial uncommitted implementation in this worktree (`types.ts`, `config.ts`, `create.ts`, `list.ts`, `scaffold.ts`, `update.ts`, `AGENTS.md`, `SKILL.md`, and matching test files all show as modified). Treat Part A below as a spec to verify against that in-progress code, not a from-scratch task list. Part B (directory-by-default) does not appear to be part of that in-progress work yet.

---

## Part A — `version` tracking end-to-end

Follow `docs/superpowers/specs/2026-07-23-app-version-config-design.md` section by section. Key points, condensed:

### A1. Data model
- `src/types.ts`: add `version?: string` to `OAuthApp` and `CreateAppResponse`. Optional on both — API guarantees a value today, but the CLI shouldn't hard-crash if a field it doesn't control is ever absent.
- `src/lib/config.ts`: add `version?: string` to `ProjectConfig` (interface at line ~402), placed next to `appName`. No change needed to `readProjectConfig()`'s parsing logic — unlike `distribution_type`, there's no legacy shape to migrate; the field just passes through via the existing `...raw` spread since it's a new, previously-nonexistent key.

### A2. `brevo app create` (`src/commands/app/create.ts`)
- The API assigns `version` at creation — **the CLI sends nothing new in the create payload** (`buildCreatePayload()` is unchanged). Just read `result.version` back off the `CreateAppResponse`.
- `renderCreatedApp()`: add a `Version:` line to `boxLines`, alongside the existing `App ID:`/`Client ID:` lines, guarded for the case `result.version` is absent (per the "optional" data model above).
- `createCommand`'s `jsonOutput({...})` call: add `version: result.version` to the emitted object, same treatment as `appId`/`clientId`.

### A3. `brevo app scaffold` (`src/commands/app/scaffold.ts`)
- New `{{APP_VERSION}}` template var in the `vars` object, alongside `{{CLI_VERSION}}`, sourced from `ctx.appDetails?.version` (already fetched via `fetchAppContext`/`resolveAppCredentials` — same object `{{DISTRIBUTION}}` already reads `ctx.appDetails?.distribution_type` from).
- `src/templates/files/app-config.json.tmpl`: add a `"version": "{{APP_VERSION}}"` key next to `"appName"`, mirroring how `logoUri`/`cliVersion` are already threaded through as sibling top-level keys.

### A4. `brevo app list`
- Add a `Version:` line to the human-readable per-app output (wherever name/client ID/scopes are currently printed per app).
- No `--json` code change needed — list's JSON output already spreads every field off the API response (minus `client_secret`), so `version` flows through automatically once `OAuthApp` has the field (per A1).

### A5. `brevo app update` (`src/commands/app/update.ts`) — this is the actual backward-compat mechanism
No separate migration command; `update` backfills lazily, once, per project:
- `ExistingAppState` gains a `version` field.
- `resolveExistingState()`: today it has a fast path (use local config only, no API call) that currently checks for `redirectUrls` presence. Extend that condition to also require `version` presence — i.e., fast path only fires when local config has **both** `redirectUrls` and `version`. If `redirectUrls` is present but `version` is missing (a legacy `app-config.json` predating this feature), fall through to the existing API-fetch branch to backfill `version` — this is a one-time cost per legacy project, not a new fetch for already-migrated ones. The two branches that already fall back to the API (mismatched/absent redirect URLs) pick up `version` from that same fetch for free — no extra network call needed there.
- `writeBackProjectConfig()`: write the resolved `version` back into `app-config.json` whenever anything else gets written back (flag-driven updates) — this is the existing write-back path, just include `version` in the object being serialized.
- `pushFullConfig()` (the no-flags "push local config as-is" path): today this **does not touch `app-config.json` at all**. Change it to also write the resolved `version` back — and *only* that field; every other value keeps coming from the local config being pushed (push semantics otherwise unchanged). Reuse the diff-summary fetch that already happens in non-JSON mode for this. In `--json` mode (which skips that fetch today), add a version-only fetch — but **only when the local config doesn't already have a `version`** — so an already-migrated project pays no extra network cost in either mode.
- `reportUpdateResult()` (human + JSON output builder): surface the resolved `version` in both output paths.
- **Rejected alternative** (already decided in the spec, don't re-litigate): reading `version` back from the `PATCH` response body instead of a separate `GET` — rejected because it assumes a response shape the update endpoint may not return (e.g. `204 No Content`), and `version` isn't mutated by that endpoint anyway.

### A6. Backward compatibility
- Server-side (apps created before this field existed): already backfilled by the backend per the swagger example — no CLI work needed.
- Local `app-config.json` predating this feature: backfilled the first time `brevo app update` runs against that project (A5).
- **Flag in `TODO.md`** (don't implement now, mirrors the existing "migrate old users' config distribution type" entry pattern already in this repo): `brevo app credentials` and re-running `brevo app scaffold` against an existing project don't backfill `version` — only `brevo app update` does.

### A7. Docs — required by `CLAUDE.md`'s "keep agent docs in sync" rule
`agent-context/AGENTS.md` and `agent-context/SKILL.md` both document `app-config.json`'s fields (currently `logoUri`, `cliVersion`, etc.) and `brevo app create`/`brevo app list` output — add `version` to both, in both files, since this is a new field in user-visible CLI output and local config.

### A8. Testing
New unit coverage mirroring each file's existing test patterns:
- `config.test.ts` / type-level: `version` round-trips through `readProjectConfig`.
- `create.test.ts`: version shown in the box + `--json` output; absent gracefully when the API omits it.
- `scaffold.test.ts`: `app-config.json` written with `version` sourced from `appDetails`.
- `list.test.ts`: `Version:` line in human output; JSON includes `version`.
- `update.test.ts`: version read from the config fast path (no extra fetch when already present); version backfilled from the API when config lacks it; `pushFullConfig` writes `version` into `app-config.json` for the first time; JSON output includes `version`.

Add a `TESTING.md` entry (per this repo's convention — see existing entries for the pattern) listing all of the above as verification criteria for this branch, under a new dated section.

---

## Part B — Default directory creation on `brevo app create`

### Current behavior (baseline, before this branch's work)
- Interactive mode: `createCommand` calls `offerScaffoldHandoff()` after printing the created-app box. That function asks a yes/no confirm ("Generate starter code now?", `messages.APP_CREATE_SCAFFOLD_PROMPT`, default `true`) — only on "yes" does it call `scaffoldCommand({ appId: result.app_id })`, which itself prompts again for the output directory (`resolveTargetDir`, defaulting to `./${slug}`).
- `--json` mode: returns right after `jsonOutput({...})`, **before** `offerScaffoldHandoff` is ever called. No directory is created at all today under `--json`.

### Target behavior (confirmed with user: applies to both interactive and `--json`)
Directory creation becomes the default in both modes, non-interactively where it needs to be for `--json`:

1. **Extract scaffold's core logic out of the prompt/output wrapper.** In `scaffold.ts`, pull the body of `scaffoldCommand` (context fetch, slug computation, vars building, `loadAllTemplates`/`writeScaffoldFiles`) into a plain exported helper — e.g. `runScaffold(appId: string, targetDir: string, options: { mergeOnly: boolean }): Promise<{ written: number; targetDir: string; legacyAllSubstituted: boolean; files: Array<{name:string}> }>` — with **no** prompting and **no** logging/jsonOutput side effects. This is needed because `scaffoldCommand` already does its own `jsonOutput()` — reusing it as-is from `create.ts`'s `--json` path would emit two separate JSON blobs on stdout, breaking script parsing (`| jq` etc.).
2. **`scaffoldCommand`** (the `brevo app scaffold` CLI entry point) keeps its exact current UX: resolve `targetDir` via the existing interactive `resolveTargetDir()` prompt, then call `runScaffold()`, then do its existing human/JSON output. No behavior change for direct `brevo app scaffold` invocations.
3. **`create.ts`'s `offerScaffoldHandoff`**: remove the "Generate starter code now?" confirm entirely — always call `scaffoldCommand({ appId: result.app_id })` (unchanged call, still uses the interactive directory prompt with its already-sensible `./${slug}` default). Delete the now-unused `messages.APP_CREATE_SCAFFOLD_PROMPT` string and the `shouldScaffold`/"What's next?" fallback-box branch (or keep the box as an error-recovery hint only if scaffolding itself throws — decide inline during implementation, not a hard requirement).
4. **`create.ts`'s `--json` path**: before the existing `jsonOutput({...})` call, compute the default target directory the same way `scaffold.ts` does (extract/share the slug-computation logic — either export it from `scaffold.ts` or inline the same slug logic), call `runScaffold(result.app_id, defaultTargetDir, { mergeOnly: false })` directly (no prompts), and merge `directory: result.targetDir` (and optionally `scaffolded: result.written`) into the single JSON object already being emitted. If the target directory already exists (unlikely right after a fresh `create`, but possible), surface a clear error/skip rather than silently overwriting — exact behavior (throw vs. warn-and-skip) to confirm during implementation, since `--json` has no interactive fallback to offer `overwrite`/`merge`/`choose-new-path`.

### Files touched
- `src/commands/app/scaffold.ts` — extract `runScaffold()`, keep `scaffoldCommand` as a thin wrapper around it.
- `src/commands/app/create.ts` — simplify `offerScaffoldHandoff`, add the `--json` scaffold call + merged JSON output.
- `src/lang/en.ts` — remove `APP_CREATE_SCAFFOLD_PROMPT` if no longer referenced anywhere; grep to confirm before deleting.
- Tests: `src/__tests__/commands/app/create.test.ts` has extensive coverage of the `shouldScaffold` prompt flow (`inquirer.prompt` mocked to return `{ shouldScaffold: false }` in most tests) and of `--json` mode — these all need updating to match the new no-confirm, scaffold-by-default flow. `src/__tests__/commands/app/scaffold.test.ts` needs a new describe block for `runScaffold()` in isolation.

### Docs
Per `CLAUDE.md`'s "keep agent docs in sync" rule — this is a changed default (new opt-out-less behavior), so both `agent-context/AGENTS.md` and `agent-context/SKILL.md` need their `brevo app create` sections updated to describe automatic scaffolding/directory creation instead of the old opt-in prompt.

---

## Repo housekeeping (per this repo's `CLAUDE.md`)

- Append entries to `TESTING.md` (both Part A and Part B changes) and `TODO.md` (the A6 backfill-gap follow-up) as work lands — don't rewrite existing entries, append new ones following the existing template.
- Run `yarn changeset` once (check `.changeset/` first — if one already exists for this branch, append to it and bump the level rather than creating a second file).
- Delete `TESTING.md`/`TODO.md` before merging to `main` (not before — they track this branch's in-flight work).
- `TESTING.md`/`TODO.md` are not to be committed as permanent docs, but each individual code change *should* get an entry as it lands.

## Verification

- `yarn test` / `yarn test:ci` — all new + existing tests pass, including the updated `create.test.ts` scaffold-flow tests.
- `yarn lint` / `yarn build` — no type errors from the new optional `version`/`version?` fields.
- Manual smoke test: `brevo app create --name "Test App" --distribution private` (interactive) → confirm no "Generate starter code now?" prompt appears, directory gets created, `app-config.json` contains `version` and `cliVersion`. Repeat with `--json` and confirm a single JSON blob containing `appId`, `clientId`, `version`, and `directory`.
- `brevo app list` shows `Version:` per app; `brevo app list --json` includes `version` per entry.
- `brevo app update` (no flags) against a **pre-existing** scaffolded project missing `version` in its `app-config.json` — confirm one API fetch happens and `version` gets written back; running `update` again immediately after should NOT trigger another fetch (fast path).
