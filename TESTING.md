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
