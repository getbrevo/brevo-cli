# Testing Criteria — running checklist

A running log of things to **check** and **update** for the CLI. Append new entries at the
top of the "Entries" section as work lands. Each entry = one change/feature, with a short
checklist of what must hold true.

**Status key:** `[ ]` to verify · `[x]` verified · `[~]` in progress · `[!]` needs fixing

**How to append a new entry:** copy the template below, fill it in, drop it under `## Entries`.

```md
### <short title> (<branch or PR>)
_Added: YYYY-MM-DD_

- [ ] <criterion — what must be true> — (Automated: `file.test.ts` | Manual)
- [ ] <criterion>
```

Run before ticking automated items: `yarn test` · `yarn lint` · `yarn build`.

---

## Entries

### Split `app create` (base files) from feature scaffolding (`app scaffold`) (`add-app-version-config`)
_Added: 2026-07-23_

The OAuth test-server code is now a *feature*, not part of `brevo app create`. `create`
writes only the basic project structure (`app-config.json` + `.gitignore`/`AGENTS.md`/
`CLAUDE.md`/`README.md`), then interactively asks whether to scaffold a feature (default
yes) or, under `--json`, auto-scaffolds `oauth`. `brevo app scaffold` is repurposed to add
a feature into an already-created project: it requires `app-config.json` in cwd, reads the
app id from it (no `--app-id`/picker), diffs the config against the server, and refreshes
the base files on consent before writing the feature files (merged in).

**Templates (`templates/index.ts`)**
- [x] `TEMPLATE_MANIFEST`/`loadAllTemplates` replaced by `BASE_TEMPLATE_MANIFEST` +
  `FEATURE_TEMPLATE_MANIFESTS.oauth`, with `loadBaseTemplates`/`loadFeatureTemplates`
  loaders and an exported `FeatureType` — (Manual: `tsc`/`yarn build`)
- [x] Base group = the 5 meta files; oauth feature group = the 6 `src/oauth/*` files — (Manual)

**`scaffold.ts`**
- [x] `runScaffold` split into `buildTemplateVars` + `runBaseScaffold` + `runFeatureScaffold`;
  `promptProjectType` renamed to `promptFeatureType` (prompt name `featureType`) —
  (Automated: `scaffold.test.ts`)
- [x] `scaffoldCommand` errors (no server fetch) when `readProjectConfig()` is null —
  (Automated: `scaffold.test.ts`)
- [x] Reads app id from cwd config, no `--app-id`/picker; no-diff → feature-only merge write,
  no confirm prompt — (Automated: `scaffold.test.ts`)
- [x] Diff detected → shows fields + `differs from the server`, consent → base refresh
  (full overwrite) + feature merge; decline → cancelled, nothing written — (Automated:
  `scaffold.test.ts`)
- [x] `--json` + diff → `{ cancelled: true, diffs }` (no prompt); `--json` + no diff →
  `{ scaffolded, directory }` — (Automated: `scaffold.test.ts`)
- [x] Next steps never prints a `cd` step (scaffold always runs in the project dir) —
  (Automated: `scaffold.test.ts`)
- [x] `--app-id` flag removed from the `scaffold` definition; `CLI.APP_SCAFFOLD` is now a
  plain string — (Automated: `constants.test.ts`, `definitions.test.ts`)
- [x] `init`'s "scaffold this app" action calls `scaffoldCommand({})` (reads cwd config) —
  (Automated: `init.test.ts`)

**`create.ts`**
- [x] Writes base files via `runBaseScaffold` always; interactive asks
  `APP_CREATE_SCAFFOLD_FEATURE_PROMPT` (default yes) then `promptFeatureType` and writes the
  feature — (Automated: `create.test.ts`)
- [x] Interactive order: the created-app box + base-files report
  (`reportBaseScaffoldSuccess`) print **before** the "scaffold a feature?" prompt fires; the
  feature scaffold + its Next steps come after — (Automated: `create.test.ts`)
- [x] Non-interactive runs stay base-only: `--json` and piped (non-TTY) create write base
  files but never call `runFeatureScaffold` — oauth is added later via `brevo app scaffold` —
  (Automated: `create.test.ts`)
- [x] Decline → only base files written, no `runFeatureScaffold`, lighter next-steps note
  pointing at `brevo app scaffold` — (Automated: `create.test.ts`)
- [x] `--json` `scaffolded` count is the base file count; `scaffoldSkipped` still emitted when
  the target directory already existed — (Automated: `create.test.ts`)

**Docs**
- [x] `AGENTS.md` + `SKILL.md` updated: create-writes-base-only, feature prompt,
  scaffold-requires-config / diff-refresh / feature-merge, no `--app-id` on scaffold — (Manual)

**Manual**
- [ ] `brevo app create` in a fresh dir, accept the feature prompt → `src/oauth/*` appears;
  decline → only base files + a note pointing at `brevo app scaffold` — (Manual)
- [ ] `brevo app scaffold` in a dir with no `app-config.json` → friendly error — (Manual)
- [ ] Edit a field in `app-config.json`, run `brevo app scaffold` → it reports the drift and
  on consent rewrites the config to match the server, then writes the feature — (Manual)

Run before ticking automated items: `yarn test` · `yarn lint` · `yarn build`.

### Restore a real `cd` hint in scaffold's Next steps, corrected against the original cwd (`add-app-version-config`)
_Added: 2026-07-23_

Follow-up correction to the "dead cd step" fix above: that fix removed the `cd <dir>` step
from Next steps on the theory it was always a no-op `cd .` (true, but only because it was
computed *after* the CLI's internal `process.chdir()` already ran). The actual bug was that
`process.chdir()` only moves the CLI's own Node process — it never moves the shell the user
typed the command into — so the user's terminal never actually lands inside the scaffolded
directory even though the CLI printed "...and moving into it...". Fixed by capturing
`process.cwd()` at the very top of `createCommand`/`scaffoldCommand`, before any directory
resolution/chdir happens, and computing the `cd` hint relative to *that* original cwd instead
of the CLI's current (already-moved) cwd.

- [x] `computeCdHint(originalCwd, targetDir)` (new export, `scaffold.ts`) returns
  `path.relative(originalCwd, targetDir)`, or `undefined` when they're the same directory —
  (Automated: `en.test.ts`, `scaffold.test.ts`)
- [x] `APP_SCAFFOLD_NEXT_STEPS_LINES(cdDir?)` prepends `1. cd <cdDir>` and renumbers the
  remaining steps only when `cdDir` is given; omits it entirely when `cdDir` is `undefined` —
  (Automated: `en.test.ts`)
- [x] `scaffoldCommand`: scaffolding into a directory other than the one the command was run
  from prints a `cd <relative-path>` step in Next steps — (Automated: `scaffold.test.ts`)
- [x] `scaffoldCommand`: scaffolding into the same directory the command was run from (cwd
  overwrite, or the cwd-linked-app shortcut) omits the `cd` step — (Automated:
  `scaffold.test.ts`)
- [x] `createCommand` captures `process.cwd()` before directory resolution runs, and forwards
  `computeCdHint(originalCwd, targetDir)` into `reportScaffoldSuccess` — (Automated:
  `create.test.ts`)
- [ ] Manually verify `brevo app create` in a fresh directory and in an "overwrite existing
  directory" run both print the correct relative `cd` path in Next steps, and that running
  the printed `cd` actually lands in the scaffolded project — (Manual)

Run before ticking automated items: `yarn test` · `yarn lint` · `yarn build`.

### `brevo app scaffold --json` no longer blocks on interactive prompts (`add-app-version-config`)
_Added: 2026-07-23_

Critical fix: `jsonMode` on `resolveProjectDirectory`/`resolveScaffoldTarget` only suppressed
`logInfo()` before this — it never stopped `inquirer.prompt()` from firing, so `--json` would
hang in CI/scripts on the "Output directory:" prompt, the "Directory already exists" overwrite
prompt, the config-diff confirm prompt, or the different-app-linked choice prompt. `--json` now
never calls `inquirer.prompt()`; every one of those cases is treated as declined/cancelled and
reported via the JSON `cancelled` output instead.

- [x] `resolveProjectDirectory` skips the initial "Output directory:" prompt under `jsonMode`,
  using `defaultDir` directly — (Automated: `scaffold.test.ts`)
- [x] `resolveProjectDirectory` returns `{ targetDir, unresolved: true }` (no prompt) when the
  target directory already exists under `jsonMode`, instead of showing the
  overwrite/merge/choose-path prompt — (Automated: `scaffold.test.ts`)
- [x] `resolveScaffoldTarget` Case B (same app linked, config differs): under `jsonMode`, skips
  the confirm prompt and returns a cancellation carrying the computed `diffs` — (Automated: `scaffold.test.ts`)
- [x] `resolveScaffoldTarget` Case C (different app linked): under `jsonMode`, skips the
  choice prompt and returns a cancellation — (Automated: `scaffold.test.ts`)
- [x] `scaffoldCommand({ json: true })` never calls `inquirer.prompt` in any of the three
  scenarios above, and always emits valid, parseable JSON with `cancelled: true` — (Automated: `scaffold.test.ts`)
- [x] Interactive (non-`--json`) behavior for all of the above is unchanged — every prompt still
  fires exactly as before — (Automated: `scaffold.test.ts`, all pre-existing tests pass unmodified in spirit)
- [x] `create.ts`'s `resolveCreateDirectory` interactive branch still compiles and behaves
  identically against the new `ResolveProjectDirectoryResult` union (defensively throws
  `CliError` if ever handed `unresolved: true`, which can't happen since it's only called with
  `jsonMode=false`) — (Automated: `create.test.ts`; Manual: `tsc`/`yarn build`)

Run before ticking automated items: `yarn test` · `yarn lint` · `yarn build`.

### Upfront directory notice + dead "cd" step removed from scaffold Next steps (`add-app-version-config`)
_Added: 2026-07-23_

`resolveProjectDirectory` and `resolveScaffoldTarget` already `process.chdir()` into the
target directory as part of resolving it — before `reportScaffoldSuccess` ever renders the
"Next steps" box. That made the box's `1. cd <dir>` step always print `cd .` (since cwd
already *is* the target by then), which is both confusing and dead weight. Fixed by (a)
telling the user upfront, before any files are written, where the project is landing
("Scaffolding into the current directory." / "Creating ./my-app and moving into it..."),
and (b) dropping the `cd` step from Next steps entirely, renumbering the remaining steps.

- [x] `APP_SCAFFOLD_NEXT_STEPS_LINES()` takes no `dir` argument and no longer emits a `cd`
  line — (Automated: `en.test.ts`)
- [x] `resolveProjectDirectory` logs a notice before `mkdirSync`+`chdir` into a fresh
  directory, and before `chdir` into an existing one (cwd-specific wording when the
  resolved target *is* `process.cwd()`) — (Automated: `scaffold.test.ts`)
- [x] The notice is suppressed under `--json` (new `jsonMode` param on
  `resolveProjectDirectory`/`resolveScaffoldTarget`, threaded from `scaffoldCommand`'s
  `options.json`) — no stray text before the JSON blob — (Automated: `scaffold.test.ts`)
- [x] The two silent `targetDir: process.cwd()` shortcuts in `resolveScaffoldTarget`
  (same-app-no-diff, and confirmed-diff-overwrite) also print the cwd notice, guarded by
  the same `jsonMode` flag — (Automated: `scaffold.test.ts`)
- [x] End-to-end `scaffoldCommand` run: printed "Next steps" box contains no `cd ` token —
  (Automated: `scaffold.test.ts`)

Run before ticking automated items: `yarn test` · `yarn lint` · `yarn build`.

### Decoupled create/scaffold directory flow (`add-app-version-config`, BEX-255 follow-up)
_Added: 2026-07-23_

`brevo app create` now hard-errors when `app-config.json` already exists in cwd
(no confirm, no override — the old "create a new app anyway?" prompt is gone), and
resolves (`cd`s into) its target directory as its own step right before the create
API call, instead of that happening inside the auto-scaffold step afterward.
`brevo app scaffold` gained a project-type prompt and is now directory-aware:
no linked project → directory setup; linked to the same app → diffs local config
against the server, only prompting (and fully regenerating on consent) if they
differ; linked to a different app → must pick a new directory or cancel.

- [x] `brevo app create` throws immediately (no API call, no prompts) when
  `app-config.json` exists in cwd, naming the linked app in the error — (Automated: `create.test.ts`)
- [x] `resolveProjectDirectory` (scaffold.ts) creates + `chdir`s into a fresh
  directory; `chdir`s (no re-`mkdir`) when overwriting/merging an existing one;
  does not `chdir` when the user picks a different path — (Automated: `scaffold.test.ts`)
- [x] `promptProjectType` shows a single-choice ("Test OAuth App") list prompt
  when interactive, returns `'oauth'` without prompting otherwise — (Automated: `scaffold.test.ts`)
- [x] `diffLocalConfig` reports differences across `appName`, `distribution_type`,
  redirect URLs, scopes (legacy `'all'` excluded), `logoUri`, `version` — (Automated: `scaffold.test.ts`)
- [x] `brevo app scaffold` with no `app-config.json` in cwd: same directory-setup
  flow as before, now via `resolveProjectDirectory` — (Automated: `scaffold.test.ts`)
- [x] `brevo app scaffold` with `app-config.json` in cwd for the **same** app and
  **no** diff: proceeds merge-only with no confirmation prompt — (Automated: `scaffold.test.ts`)
- [x] `brevo app scaffold` with `app-config.json` in cwd for the **same** app and a
  diff: shows the differing fields, consent → full overwrite of every template
  file; decline → cancels, nothing written — (Automated: `scaffold.test.ts`)
- [x] `brevo app scaffold` with `app-config.json` in cwd for a **different** app:
  offers "choose a different directory" (loops into directory setup) or "cancel";
  never writes into the mismatched directory — (Automated: `scaffold.test.ts`)
- [x] `brevo app create` (interactive): directory prompt appears after
  name/distribution/redirect/logo, before the create API call; `process.chdir`
  is called with the resolved directory; project-type prompt appears **after**
  the app is created, before scaffolding — (Automated: `create.test.ts`)
- [x] `brevo app create --json`: directory resolved and `chdir`'d into
  non-interactively with no prompts; if the default directory already exists,
  both directory setup and scaffolding are skipped (app creation still
  succeeds), reported via `scaffoldSkipped` — (Automated: `create.test.ts`)
- [x] `AGENTS.md` + `SKILL.md` describe the new hard-error guard, the
  directory-first `create` flow, and `scaffold`'s diff-driven same-app behavior
  (no more blanket refusal wording) — (Manual)

Run before ticking automated items: `yarn test` · `yarn lint` · `yarn build`.

### `brevo app create` scaffolds by default (`add-app-version-config`, BEX-255 Part B)
_Added: 2026-07-23_

Directory creation is no longer opt-in. The "Generate starter code now?" confirmation is
gone; `brevo app create` always scaffolds afterward, in both interactive and `--json` mode.

**`scaffold.ts` refactor**
- [ ] `computeSlug(name)` extracted as a pure, exported helper — same slugification as
  before — (Automated: `scaffold.test.ts`)
- [ ] `runScaffold(appId, ctx, targetDir, mergeOnly)` extracted as a side-effect-free-ish
  core (no prompting, no logging/`jsonOutput`) — writes files, returns
  `{ written, targetDir, legacyAllSubstituted, scopes, files }` — (Automated: `scaffold.test.ts`)
- [ ] `fetchAppContext` exported (previously module-private) — (Manual: `tsc`/`yarn build`)
- [ ] `brevo app scaffold` invoked directly is behaviorally unchanged: same single
  `resolveAppCredentials` fetch, same prompts, same output — (Automated: `scaffold.test.ts`)

**`brevo app create` (interactive)**
- [ ] No "Generate starter code now?" prompt appears — `scaffoldCommand` is always called
  with the new app's ID — (Automated: `create.test.ts`)
- [ ] `messages.APP_CREATE_SCAFFOLD_PROMPT` removed from `src/lang/en.ts`, no references
  remain — (grep)
- [ ] The old "What's next?" fallback box (shown only when scaffold was declined) is
  removed along with the decline path — (Manual)

**`brevo app create --json`**
- [ ] Scaffolds into the same default directory `app scaffold` would offer
  (`./<slugified-app-name>`), computed from the app's name with **no extra API fetch**
  for the slug itself — (Automated: `create.test.ts`)
- [ ] On success, response includes `directory` (absolute path) and `scaffolded` (file
  count) alongside the existing app fields, still as a single JSON blob (no double
  output) — (Automated: `create.test.ts`)
- [ ] When the target directory already exists, scaffolding is skipped (never
  overwritten) and the response carries `scaffoldSkipped` (message) + `directory`
  instead of `scaffolded` — the rest of the app-creation output is unaffected —
  (Automated: `create.test.ts`)

**Docs in sync**
- [ ] `AGENTS.md` + `SKILL.md` describe automatic scaffolding (no confirm) and the
  `directory`/`scaffolded`/`scaffoldSkipped` `--json` fields — (Manual)

### App `version` tracked in config (`add-app-version-config`)
_Added: 2026-07-23_

The app-store API now returns a `version` field on every app (create + list + get); this
threads it through the CLI and backfills it into local `app-config.json` files written
before the field existed.

**Types (`types.ts`, `config.ts`)**
- [ ] `OAuthApp.version` / `CreateAppResponse.version` / `ProjectConfig.version` are all
  optional `string` — (Manual: `tsc`/`yarn build`)
- [ ] `readProjectConfig()` round-trips `version` unchanged when present, leaves it
  `undefined` for a legacy config that predates the field — (Automated: `config.test.ts`)

**`brevo app create`**
- [ ] Server-assigned `version` shown in the created-app box (`App version: X`) and in
  `--json` output — (Automated: `create.test.ts`)
- [ ] Omitted from both outputs when the API response has no `version` — (Automated: `create.test.ts`)

**`brevo app scaffold`**
- [ ] `{{APP_VERSION}}` sourced from `ctx.appDetails.version`, written into the new
  `app-config.json`'s `version` key — (Automated: `scaffold.test.ts`)
- [ ] Falls back to `''` when the app has no version — (Automated: `scaffold.test.ts`)

**`brevo app list`**
- [ ] Human output shows a `Version:` line per app, `(none)` when absent — (Automated: `list.test.ts`)
- [ ] `--json` output includes `version` per app — (Automated: `list.test.ts`)

**`brevo app update` (backward compatibility for existing apps/configs)**
- [ ] Fast path (config already has `redirectUrls` **and** `version`): no extra API
  fetch — (Automated: `update.test.ts`)
- [ ] Legacy config missing `version` (flag-driven update): one fetch backfills it into
  `app-config.json` and the update output — (Automated: `update.test.ts`)
- [ ] Flagless push (no `--json`): backfill reuses the existing diff-summary fetch, no
  second network call — (Automated: `update.test.ts`)
- [ ] Flagless push under `--json` (previously never fetched at all): one dedicated fetch
  backfills `version` into `app-config.json` and the JSON output — (Automated: `update.test.ts`)
- [ ] A failed backfill fetch doesn't fail the update — the push still succeeds, `version`
  is just left out — (Automated: `update.test.ts`)
- [ ] No repeated write when the resolved version already matches what's on disk — (Automated: `update.test.ts`)
- [ ] No `--app-version` (or similar) flag exists — version is never CLI-settable — (Manual: `definitions.ts` / `--help`)

**Docs in sync**
- [ ] `AGENTS.md` + `SKILL.md` mention the `version` field in `app-config.json` alongside
  `logoUri`/`cliVersion` — (Manual)

### `distribution_type` moved to a top-level field (`BEX-255_change`)
_Added: 2026-07-23_

Supersedes the "Legacy config write-back migration + `auth.type` narrowing" entry below —
`auth.type` itself was relocated the same day per the Notion product-solutioning doc decision.

**`readProjectConfig()` / write-back (`config.ts`)**
- [ ] Top-level `distribution_type` config backfills correctly when it's the only shape present — (Automated: `config.test.ts`)
- [ ] Interim `auth.type` (never released) backfills into `distribution_type` when present — (Automated: `config.test.ts`)
- [ ] Oldest legacy top-level `distribution` (every currently-published scaffold) backfills into `distribution_type` when present — (Automated: `config.test.ts`)
- [ ] Precedence holds when multiple shapes coexist: `distribution_type` > `auth.type` > legacy `distribution` — (Automated: `config.test.ts`)
- [ ] Defaults to `'private'` when no shape is present — (Automated: `config.test.ts`)
- [ ] None of the three legacy shapes (`distribution`, `auth.type`) appear in the object `readProjectConfig()` returns — (Automated: `config.test.ts`)
- [ ] Reading any legacy shape then writing it back (`writeProjectConfig`) converges the on-disk file to top-level `distribution_type` only, with `auth` reduced to `{ scopes, redirectUrls }` — (Automated: `config.test.ts`)
- [ ] `ProjectConfig.distribution_type` is typed `'private' | 'public'`, not `string`; `auth` no longer has a `type` field — (Manual: `tsc`/`yarn build`)
- [ ] Scaffold template (`app-config.json.tmpl`) writes `distribution_type` as a top-level key, not nested in `auth` — (Manual)

### OAuth callback URL hint wording (`enable-public-app`)
_Added: 2026-07-23_

**`brevo app create` redirect prompt (`APP_CREATE_REDIRECT_HINT`)**
- [ ] Hint labels the localhost default as a "local test-server callback URL" and mentions `brevo app start oauth` — (Automated: `create.test.ts`)
- [ ] Hint still suppressed under `--json` — (Automated: `create.test.ts`)
- [ ] Hint still not printed when `--redirect-uri` is provided — (Automated: `create.test.ts`)
- [ ] Wording change only; no prompt-flow, validation, or payload change — (Manual)

### Public app distribution (`enable-public-app`)
_Added: 2026-07-23_

**`brevo app create --distribution public`**
- [ ] Creates a public app; no "coming soon" error, no early short-circuit before the API call — (Automated: `create.test.ts`)
- [ ] API called with `distribution_type: 'public'` + resolved name, redirect URIs, default scopes — (Automated: `create.test.ts`)
- [ ] `--distribution private` still creates a private app (unchanged) — (Automated: `create.test.ts`)
- [ ] Invalid `--distribution` value fails validation, no API call — (Automated: `create.test.ts`)
- [ ] Interactive prompt: **Public** is selectable (no `disabled: 'coming soon'`) and works — (Manual)
- [ ] `APP_CREATE_PUBLIC_UNAVAILABLE` fully removed from `src/lang/en.ts`, no references remain — (grep)

**`app-config.json` scaffold format** — *(updated: see "`distribution_type` moved to a top-level field" entry above — this now records under top-level `distribution_type`, not `auth.type`)*
- [ ] Distribution type recorded as a top-level `distribution_type` key via `{{DISTRIBUTION}}` template var — (Automated: template tests)
- [ ] `{{DISTRIBUTION}}` defaults to `'private'` when `appDetails.distribution_type` absent — (Automated: scaffold)
- [ ] Redundant top-level `distribution` key no longer emitted, `auth` has no `type` field — (Manual)
- [ ] Public app → `distribution_type: "public"`; private app → `distribution_type: "private"` — (Manual)

**`readProjectConfig()` legacy backfill (`config.ts`)** — *(superseded by the three-shape precedence in the entry above)*
- [ ] Malformed config (bad JSON / non-object `auth` / empty `distribution`) does not throw — (Automated: `config.test.ts`)

**`brevo app update` compatibility**
- [ ] Reads project config without top-level `distribution` key (removed from `ProjectConfig`), behaves as before — (Automated: `update.test.ts`)

**Docs in sync**
- [ ] `AGENTS.md` + `SKILL.md` document `--distribution public` and stay aligned — (Manual)
- [ ] `brevo app create --distribution public` example present in `definitions.ts` — (Manual)
