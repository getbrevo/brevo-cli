# CLI Granular OAuth Scopes — Design Spec

**Ticket:** BEX-197
**Date:** 2026-05-14
**Branch:** `BEX-197_cli`
**Source MoM:** Grooming discussion, 2026-05-14 (Slack `C09CD5UHYUD`, ts `1778760074.408389`)

## Context

Today the Brevo CLI hardcodes `scopes: ['all']` everywhere an OAuth app is created or scaffolded. The Brevo OAuth IdP at `oauth.brevo.com/realms/partner/.well-known/oauth-authorization-server` already advertises granular scopes via `scopes_supported`, so the CLI is the bottleneck for least-privilege OAuth flows. Product wants new apps created via CLI to default to a small, sensible scope set and to let users adjust scopes after the fact.

This spec replaces a prior, more elaborate design (deleted with the previous `BEX-197_cli` branch). The grooming MoM simplifies the surface considerably.

## Goals

1. New apps created via `brevo app create` default to four granular scopes instead of `['all']`.
2. Users can grow that scope list after creation via `brevo app update --scope`.
3. Users (and agents) can discover the full set of supported scopes from the CLI.
4. The CLI does not pretend to be the source of truth for the scope catalog — the IdP is.

## Non-goals

The following were explicitly considered and dropped:

- Interactive scope-picker during `brevo app create`.
- A `--scope` flag on `create` (defaults only — keeps `create` predictable).
- Separate `--scope-add` / `--scope-remove` flags. One repeatable `--scope` that appends is enough.
- Client-side validation of scope names against the IdP catalog. Server is authoritative.
- On-disk caching of the well-known response. One fetch per CLI run when needed.
- Backward-compat handling of the legacy `'all'` value. If an app on the server still returns `['all']`, the CLI displays and scaffolds it verbatim. Migration is the user's choice via `brevo app update --scope`.

## Locked design decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | New apps default to `["contacts:read", "contacts:write", "crm:read", "crm:write"]` | From MoM. Covers the common starter use case. |
| D2 | No `--scope` flag on `create` | MoM literal reading. Keeps `create` a one-shot, predictable command. |
| D3 | `brevo app update --scope <s>` is repeatable and **appends** to existing scopes | Matches the existing `--redirect-uri` pattern on `update`. De-dupe before PUT. |
| D4 | Scope registry source = IdP well-known endpoint, fetched live | Never goes stale. No catalog file to keep in sync with the IdP team. |
| D5 | Exposure = a single CLI command, `brevo app scopes`, with `--json` support | Consistent with how every other surface in this CLI is shaped. No new programmatic API to maintain. |
| D6 | No client-side validation in `create` / `update`. Pass-through. | Avoids a network call on every command and a CLI/server drift surface. Bad scopes fail with a server 400. |
| D7 | `app create` prints a one-line info message after success (suppressed under `--json`) | Surface the defaults so users know they exist and how to change them. Non-blocking, scriptable. |

## Surface

```
brevo app create
  → creates with DEFAULT_SCOPES (no flag change)
  → prints: "Created with default scopes: contacts:read, contacts:write, crm:read, crm:write."
            "Run `brevo app update --scope <scope>` to change them."
  → info line suppressed under --json

brevo app update --scope <scope> [--scope <scope> ...]
  → resolves current scopes (precedence: app-config.json if --app-id matches, else API)
  → appends flag values, de-dupes preserving order
  → PUTs the merged set
  → writes the merged set back to app-config.json if that was the source

brevo app scopes [--json]
  → GET oauth.brevo.com/.../.well-known/oauth-authorization-server
  → prints scopes_supported (one per line, or { "scopes": [...] } under --json)
  → no auth required; well-known is public
```

## Components and file-level changes

| File | Change |
|---|---|
| `src/lib/constants.ts` | Add `DEFAULT_SCOPES = ["contacts:read", "contacts:write", "crm:read", "crm:write"]`. Add `CLI.APP_SCOPES = "brevo app scopes"` and `CLI.APP_UPDATE_SCOPE = "brevo app update --scope"` for use in user-facing strings. Add `OAUTH_WELL_KNOWN_URL` constant (use the existing OAuth base URL constant as the prefix; do not hardcode a new copy of the host). |
| `src/commands/app/create.ts` | Replace `scopes: ['all']` at lines 181 and 213 with `DEFAULT_SCOPES`. After `appService.create()` resolves, call `logInfo(strings.appCreateScopeNotice)` when `!options.json`. |
| `src/commands/app/update.ts` | Add repeatable `--scope <scope>` option. When present, resolve current scopes via the same precedence used by `--redirect-uri`, append flag values, de-dupe preserving order, send in PUT body. Write back to `app-config.json` when it was the source. |
| `src/commands/app/scopes.ts` | **New**. Wrapped with `withCommandHandler()`. Calls `fetchSupportedScopes()`. Text mode: one scope per line. `--json` mode via `jsonOutput()`: `{ scopes: string[] }`. |
| `src/services/oauth-metadata.ts` | **New**. `fetchSupportedScopes(): Promise<string[]>` — GETs the well-known endpoint, returns `scopes_supported`. Throws `ApiError` on network failure or non-2xx; `CliError` when `scopes_supported` is missing/not an array. |
| `src/commands/app/scaffold.ts` | Change `const scopes = ctx.appDetails?.scopes ?? ['all']` at line 179 to `?? DEFAULT_SCOPES`. The fallback shouldn't fire in practice (newly created apps now always have scopes), but keep it consistent with the new defaults. |
| `src/commands/definitions.ts` | Register the new `app scopes` command and its `--json` option. Register the new repeatable `--scope` option on `app update`. |
| `src/lang/en.ts` | Add user-facing strings: `appCreateScopeNotice`, `appScopesHelp`, `appUpdateScopeAppended`, `oauthMetadataMissingScopes`, `oauthMetadataFetchFailed`. |
| `agent-context/SKILL.md` | Document the new command, the `--scope` flag, and the default scope set. |
| `agent-context/AGENTS.md` | Same as above. CLAUDE.md mandates keeping both in sync whenever user-visible CLI behavior changes. |
| `.changeset/*.md` | Add a changeset describing the new defaults, new flag, and new command. Minor bump. |

## Data flow

**`brevo app create`:**

1. Resolve `app-config.json` (existing behavior).
2. POST `/apps` with `scopes: DEFAULT_SCOPES` (was `['all']`).
3. Persist credentials (existing behavior).
4. If `!options.json`, print `appCreateScopeNotice` listing the four defaults and pointing to `brevo app update --scope`.

**`brevo app update --scope X --scope Y`:**

The resolution and write-back semantics MUST match `--redirect-uri` exactly. If the two flags ever diverge in behavior, that is a bug, not a feature.

1. Resolve target app the same way `--redirect-uri` does today: prefer `app-config.json` if it matches `--app-id` or contains an app ID, else fetch the app from the API by `--app-id`.
2. Read current scopes from whichever source provided the app.
3. `merged = dedupePreserveOrder([...current, ...flagValues])`.
4. PUT `/apps/{id}` with the merged scopes (alongside any other flag-driven fields).
5. If `app-config.json` was the source, write the merged scopes back to it.

**`brevo app scopes`:**

1. GET the well-known URL. No auth.
2. Parse JSON. Require `scopes_supported` to be `string[]`.
3. Print one per line in text mode, or `{ scopes: string[] }` via `jsonOutput()` in JSON mode.

## Error handling

| Failure | Surface |
|---|---|
| Well-known GET non-2xx or network error | `ApiError` with the well-known URL and status. Exit code from `exit-codes.ts`. |
| Well-known response missing or malformed `scopes_supported` | `CliError("IdP well-known response did not include scopes_supported")`. Non-zero exit. |
| `app update --scope` with no value | Commander default option-requires-argument error. |
| `app update --scope` with no resolvable app (no `--app-id`, no `app-config.json`) | Same `CliError` the existing `--redirect-uri` path emits. |
| Server 400 on bad scope | Existing `ApiError` surfacing. We do not pre-validate. |

All command handlers stay wrapped by `withCommandHandler()` so error mapping to exit codes is uniform.

## Testing

All new code is TDD'd. Tests in `src/__tests__/` mirror `src/`. Mocks are inline per file convention.

| Test file | Coverage |
|---|---|
| `src/__tests__/commands/app/create.test.ts` (extend) | Body sent to `appService.create()` contains `DEFAULT_SCOPES`; info line printed in text mode; info line suppressed under `--json`. |
| `src/__tests__/commands/app/update.test.ts` (extend) | `--scope` appends; de-dupes; preserves order; works alongside `--name` and `--redirect-uri`; writes back to `app-config.json` when present; errors when no app resolvable. |
| `src/__tests__/commands/app/scopes.test.ts` (new) | Text mode prints one per line; `--json` shape matches; missing field → `CliError`; network failure → `ApiError`. |
| `src/__tests__/commands/app/scaffold.test.ts` (extend) | Fallback uses `DEFAULT_SCOPES` instead of `['all']`. |
| `src/__tests__/services/oauth-metadata.test.ts` (new) | Mocked `fetch`: happy path returns the array; non-2xx → `ApiError`; missing `scopes_supported` → `CliError`. |
| `src/__tests__/lib/constants.test.ts` (light, optional) | `DEFAULT_SCOPES` snapshot to prevent silent drift. |

## Risks and mitigations

- **Existing apps that still have `['all']` on the server.** Display and scaffold them verbatim. If the user wants to migrate, they call `brevo app update --scope <s>` repeatedly (which appends — they cannot drop `'all'` with this surface). Acceptable for v1; replacing-semantics is out of scope.
- **Well-known endpoint outage.** `brevo app scopes` fails loudly with the URL in the error. `create` and `update` are unaffected (no validation call).
- **Agent docs drift.** Mitigated by CLAUDE.md's hard rule that `agent-context/SKILL.md` and `agent-context/AGENTS.md` are updated in the same PR as user-visible behavior changes.
- **MoM "appends" interpretation.** "Appends" means: in a single `brevo app update` invocation, every `--scope X` value on the command line is added to the app's current scope set, with duplicates dropped. Same shape as `--redirect-uri`. The CLI does not memorize prior invocations or stage changes across calls — each invocation is a self-contained PUT.

## Out-of-scope, deferred

- A `--scope-remove` or `--scope-replace` flag. Will be added if and when users ask. The current MoM does not.
- Caching the well-known across CLI invocations.
- A separate `brevo scopes describe <scope>` lookup. Dev docs (owned by Mauricio per the MoM) will carry descriptions.
- Migrating existing apps that still have `'all'`. Server team's call whether to keep accepting `'all'` or to do a one-time backfill.
