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

### Legacy config write-back migration + `auth.type` narrowing (`BEX-255_change`)
_Added: 2026-07-23_

**`readProjectConfig()` / write-back (`config.ts`)**
- [ ] Legacy top-level `distribution` key is absent from the object `readProjectConfig()` returns — (Automated: `config.test.ts`)
- [ ] Reading a legacy config then writing it back (`writeProjectConfig`) drops the top-level `distribution` key from disk and persists `auth.type` — (Automated: `config.test.ts`)
- [ ] `ProjectConfig.auth.type` is typed `'private' | 'public'`, not `string` — (Manual: `tsc`/`yarn build`)
- [ ] Existing legacy-backfill behavior (backfill on read, `auth.type` wins when both present) still holds — (Automated: `config.test.ts`)

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

**`app-config.json` scaffold format**
- [ ] Distribution type recorded under `auth.type` via `{{DISTRIBUTION}}` template var — (Automated: template tests)
- [ ] `{{DISTRIBUTION}}` defaults to `'private'` when `appDetails.distribution_type` absent — (Automated: scaffold)
- [ ] Redundant top-level `distribution` key no longer emitted — (Manual)
- [ ] Public app → `auth.type: "public"`; private app → `auth.type: "private"` — (Manual)

**`readProjectConfig()` legacy backfill (`config.ts`)**
- [ ] Legacy top-level `distribution` key backfills `auth.type` when missing — (Automated: `config.test.ts`)
- [ ] `auth.type` wins when both `auth.type` and legacy `distribution` present — (Automated: `config.test.ts`)
- [ ] New-format config (no `distribution` key) reads `auth.type` directly — (Automated: `config.test.ts`)
- [ ] Malformed config (bad JSON / non-object `auth` / empty `distribution`) does not throw — (Automated: `config.test.ts`)

**`brevo app update` compatibility**
- [ ] Reads project config without top-level `distribution` key (removed from `ProjectConfig`), behaves as before — (Automated: `update.test.ts`)

**Docs in sync**
- [ ] `AGENTS.md` + `SKILL.md` document `--distribution public` and stay aligned — (Manual)
- [ ] `brevo app create --distribution public` example present in `definitions.ts` — (Manual)
