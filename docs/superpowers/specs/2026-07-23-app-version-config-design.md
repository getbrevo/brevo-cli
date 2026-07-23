# App version in config — design

_Date: 2026-07-23_

## Problem

`OAuthApp`/`CreateAppResponse` from the app-store API now include a `version` field
(confirmed via the API's swagger docs — `GET /v3/app-store/apps` already returns
`"version": "0.0.1"` per app, and `POST /v3/app-store/apps` assigns/returns one on
creation). The CLI doesn't surface this anywhere: it isn't in `types.ts`, isn't written
into the scaffolded `app-config.json`, and isn't shown by any command.

## Goal

Track the app's `version` end-to-end: capture it at creation, persist it in
`app-config.json`, and display it wherever an app's other identifying details
(name, client ID, scopes) are already shown.

## Non-goals

- No CLI-side way to *change* the version. It's server-assigned; the CLI only ever
  reads and displays it. No `--app-version` flag on `brevo app update`.
- No changes to `brevo app credentials` in this pass (not requested — flagged as a
  natural low-effort follow-up in the PR description).
- No backend changes — the API already supports the field.

## Design

### Data model

- `types.ts`: add `version?: string` to `OAuthApp` and `CreateAppResponse`.
- `lib/config.ts`: add `version?: string` to `ProjectConfig`, next to `appName`.

Optional on both sides: the API guarantees a value today, but the CLI shouldn't hard
crash if a field it doesn't control is ever absent from a response.

### `brevo app create`

The API assigns the version at creation — the CLI sends no version in the create
payload, it just reads `result.version` back and displays it (in the created-app box
and `--json` output), same treatment as every other field on that response.

### `brevo app scaffold`

New `{{APP_VERSION}}` template var, sourced from `ctx.appDetails?.version` (already
fetched via `resolveAppCredentials`). `app-config.json.tmpl` gets a `"version"` key
next to `appName`, mirroring how `logoUri`/`cliVersion` are already threaded through.

### `brevo app list`

Add a `Version:` line to the human-readable per-app output. The `--json` output needs
no code change — it already spreads every field off the API response (minus
`client_secret`), so `version` flows through automatically once the type has it.

### `brevo app update`

This is where "backward compatibility for apps already created" actually gets solved,
without a separate migration command:

- `ExistingAppState` gains a `version` field.
- `resolveExistingState()`: when local config already has `redirectUrls` and a
  `version`, resolve entirely from config (today's fast path, no API call — unchanged
  for already-migrated projects). When config is usable but **missing** `version**
  (a legacy `app-config.json` from before this feature), fetch the app once to
  backfill it — this is the one-time cost of migrating an old project, nothing more.
  The two branches that already fall back to the API (mismatched/absent redirect URLs)
  pick up `version` from that same fetch for free.
- `writeBackProjectConfig()` writes the resolved `version` back into
  `app-config.json` whenever it writes anything else back (flag-driven updates).
- `pushFullConfig()` (the no-flags "push local config as-is" path) **did not
  previously touch `app-config.json` at all**. It now also writes the resolved
  `version` back — and only that field; every other value keeps coming from the local
  config being pushed, so push semantics are otherwise unchanged. This is deliberately
  scoped to reuse the diff-summary fetch that already happens in non-JSON mode; in
  `--json` mode (which skips that fetch today) a version-only fetch is added, but
  **only when the local config doesn't already have one** — so an already-migrated
  project pays no extra network cost in either mode.
- Both paths surface the resolved version in `reportUpdateResult` (human + JSON).

Rejected alternative: read the `version` back from the `PATCH` response body instead of
a separate `GET`. Rejected because it assumes a response shape the update endpoint may
not actually return (e.g. `204 No Content`), and because `version` isn't mutated by this
endpoint anyway — a `GET` fetched moments before the `PATCH` is already authoritative,
so there is no freshness reason to prefer reading it off the `PATCH` response.

### Backward compatibility

- **Server-side** (apps created before this field existed): already backfilled by the
  backend — confirmed via the swagger example. No CLI work needed.
- **Local `app-config.json` predating this feature**: backfilled the first time
  `brevo app update` runs against that project (see above). Verified via a
  `TESTING.md` entry, not deferred to `TODO.md`, since it's implemented in this change.
- **Follow-up flagged in `TODO.md`**: `brevo app credentials` and re-running
  `brevo app scaffold` against an existing project don't backfill `version` into
  `app-config.json` — only `brevo app update` does. Mirrors the existing "migrate old
  users' config distribution type" TODO entry already in this repo.

### Docs

`agent-context/AGENTS.md` and `agent-context/SKILL.md` both document
`app-config.json`'s fields (currently `logoUri`) — add `version` there, per
`CLAUDE.md`'s rule that new/changed local-config fields are user-visible behavior.

### Testing

New unit test coverage (mirroring existing patterns in each file):

- `types`/`config.ts`: `version` round-trips through `readProjectConfig`.
- `create.test.ts`: version shown in box + `--json`, absent gracefully when the API
  omits it.
- `scaffold.test.ts`: `app-config.json` written with `version` from `appDetails`.
- `list.test.ts`: `Version:` line in human output; JSON includes `version`.
- `update.test.ts`: version read from config fast path (no extra fetch); version
  backfilled from API when config lacks it; `pushFullConfig` writes `version` into
  `app-config.json` for the first time; JSON output includes `version`.

A `TESTING.md` entry tracks all of the above as verification criteria for this branch.
