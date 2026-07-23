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
