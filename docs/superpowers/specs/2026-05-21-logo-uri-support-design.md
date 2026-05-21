# Spec — `logo_uri` support in `brevo app create` / `update` / `app-config.json`

**Date:** 2026-05-21
**Ticket:** (none yet — internal feature add)
**Status:** Draft for review

## Problem

The Brevo OAuth app API accepts a `logo_uri` field on both `POST /v3/oauth/apps` and `PUT /v3/app-store/apps/{appId}`, but the CLI does not expose it. Users who want to set or change their app's logo must do it through the dashboard. We want full parity with the backend so `brevo app create`, `brevo app update`, and `app-config.json` can carry the logo URL end-to-end.

## Scope

In:

- New `--logo-uri <url>` flag on `brevo app create`.
- New `--logo-uri <url>` flag on `brevo app update`.
- New optional top-level `logoUri` field in `app-config.json` (and the scaffold template).
- `brevo app update` (no flags) pushes `logoUri` from `app-config.json` when present.
- `brevo app update --logo-uri <url>` writes back into `app-config.json` when the file matches the app.
- Update summary, JSON output, and success printout surface the logo URL.
- Docs in `agent-context/SKILL.md` and `agent-context/AGENTS.md` updated together.
- Tests covering each command path + template substitution.
- Changeset (minor bump).

Out (YAGNI):

- No interactive prompt during `create`. `--logo-uri` is a flag-only field, independent of the existing name/distribution/redirect URI prompts.
- No "clear logo" support (no `--no-logo-uri` or empty-string handling). If a user needs to unset the logo, they can do it via dashboard or a future flag.
- No image content validation (MIME type, extension, dimensions). The API owns that.
- No prompting during `scaffold` — the value comes from the API (`OAuthApp.logo_uri`) and lands in the rendered template as-is.

## Endpoints (no change)

| Operation | Method | URL                                            |
| --------- | ------ | ---------------------------------------------- |
| Create    | POST   | `https://api.brevo.com/v3/oauth/apps`          |
| Get       | GET    | `https://api.brevo.com/v3/oauth/apps/{appId}`  |
| Update    | PUT    | `https://api.brevo.com/v3/app-store/apps/{id}` |

Backend already accepts `logo_uri` on POST and PUT.

## CLI surface

### `brevo app create`

New flag:

```
--logo-uri <url>   Optional. App logo URL (http or https). Stored in app-config.json and sent in the create payload.
```

Behavior:

- Validated up front by Commander's parser (re-uses `validateUrl(value, 'logo URL')` from `src/lib/validators.ts`).
- If set, included in the POST body as `logo_uri`.
- If omitted, the field is absent from the payload (backend default applies).
- Success output adds `Logo URL: <uri>` line when set.
- `--json` output includes `logoUri: <uri>` when set; field is omitted when not set.

### `brevo app update`

New flag:

```
--logo-uri <url>   Optional. App logo URL (http or https).
```

Behavior:

- Validated by the same Commander parser.
- Counts toward `hasFlags` (so `brevo app update --logo-uri https://…` alone is a valid invocation — no other flags needed).
- **Flag path (any flag set, including `--logo-uri`):**
  - Existing-value baseline resolution is unchanged for `name` / `redirect_uris` / `scopes`.
  - `logo_uri` baseline: `config.logoUri` (when `shouldWriteBack`), else `app.logo_uri` from the API fetch.
  - `--logo-uri` flag wins. Final value goes into the PUT body when non-empty.
  - Update summary prints `Logo URL: <current> → <next>` when the value changes; just `Logo URL: <next>` when only the next is set.
- **No-flag path (push full `app-config.json`):**
  - If `config.logoUri` is a non-empty string, include `logo_uri` in the PUT body.
  - Update summary prints `Logo URL: <current> → <next>` against the freshly-fetched remote value.
- **Write-back:** when `shouldWriteBack` and `options.logoUri` is set, write `logoUri` into the local `app-config.json`. Do not touch the field when the flag wasn't passed.

### `app-config.json`

`ProjectConfig` (TypeScript interface in `src/lib/config.ts`) gains:

```ts
export interface ProjectConfig {
  appId: string;
  appName: string;
  logoUri?: string; // ← new, optional
  cliVersion?: string;
  // …
}
```

Scaffolded template (`src/templates/files/app-config.json.tmpl`) — `logoUri` rendered directly under `appName`:

```json
{
  "appId": "{{APP_ID}}",
  "appName": "{{APP_NAME}}",
  "logoUri": "{{LOGO_URI}}",
  ...
}
```

`{{LOGO_URI}}` is sourced from `ctx.appDetails?.logo_uri ?? ''` in `src/commands/app/scaffold.ts`. Empty string is the rendered default when the app has no logo. `readProjectConfig` returns `logoUri` as-is when it's a non-empty string, and treats empty string / missing field as "no logo" (downstream code uses `config.logoUri` truthiness checks).

## Implementation breakdown by file

### `src/types.ts`

```ts
export interface OAuthApp {
  ...
  logo_uri?: string;
}

export interface CreateAppResponse {
  ...
  logo_uri?: string;
}
```

### `src/services/app.ts`

- `createApp` payload type gains `logo_uri?: string`.
- `updateApp` body type gains `logo_uri?: string`.
- No other service-layer logic changes.

### `src/lib/validators.ts`

- No new validator function needed. `validateUrl(value, 'logo URL')` already enforces http(s) + no whitespace/commas. The Commander parser for `--logo-uri` is one line:

  ```ts
  // in src/commands/definitions.ts (inline)
  parser: (v: string) => {
    validateUrl(v, 'logo URL');
    return v;
  };
  ```

### `src/commands/definitions.ts`

- Add the `--logo-uri <url>` option to both `create` and `update` definitions.
- Wire through to the handler `options.logoUri`.
- Add one new example per command:
  - `'brevo app create --name "My App" --distribution private --logo-uri https://example.com/logo.png'`
  - `'brevo app update --logo-uri https://example.com/logo.png'`

### `src/commands/app/create.ts`

- Add `logoUri?: string` to the `options` type.
- Build payload as `{ name, public, redirect_uris, scopes, ...(options.logoUri ? { logo_uri: options.logoUri } : {}) }`.
- After "Redirect URL N:" lines, add `if (options.logoUri) logInfo('  Logo URL:      ' + options.logoUri);`.
- `--json` output: spread `...(options.logoUri ? { logoUri: options.logoUri } : {})`.
- On the 409 retry path, reuse the same `logoUri` in the retried payload.

### `src/commands/app/update.ts`

- Add `logoUri?: string` to `UpdateOptions`.
- Update `hasFlags`: `options.logoUri !== undefined` is part of the disjunction.
- Existing baseline resolution stays. Add a parallel `existingLogoUri` (from config when `shouldWriteBack` && `config.logoUri`, else from the remote fetch).
- Merge: `const finalLogoUri = options.logoUri ?? existingLogoUri`.
- PUT body: include `logo_uri` when `finalLogoUri` (truthy).
- Pass `currentLogoUri` / `nextLogoUri` into `renderUpdateSummary`; render a `Logo URL:` line with the same `current → next` pattern used for name.
- Write-back: when `shouldWriteBack && options.logoUri`, set `updatedConfig.logoUri = options.logoUri` before `writeProjectConfig`.
- JSON output: include `logo_uri: finalLogoUri` only when set.
- Human output: add `Logo URL: <finalLogoUri>` line when set.
- **No-flag path:** include `logo_uri: config.logoUri` in the PUT body when non-empty; show it in `renderUpdateSummary` with `currentLogoUri` from the remote fetch.

### `src/lib/config.ts`

- Add `logoUri?: string` to `ProjectConfig`. No change to `readProjectConfig` / `writeProjectConfig` — they already pass through unknown fields via spread.

### `src/templates/files/app-config.json.tmpl`

- Add `"logoUri": "{{LOGO_URI}}",` line directly after `"appName": "{{APP_NAME}}",`.

### `src/commands/app/scaffold.ts`

- Add `'{{LOGO_URI}}': ctx.appDetails?.logo_uri ?? ''` to the `vars` object.

### `src/lang/en.ts`

- No new prompts (we dropped the interactive prompt).
- Reuse hardcoded `'Logo URL'` label inline in both commands — matches how `Redirect URLs:` is currently inlined. (If lint flags hardcoded strings, surface a `APP_LOGO_LABEL = 'Logo URL'` constant.)
- Validation error messages come from `validateUrl` and don't need new strings.

### `agent-context/SKILL.md` and `agent-context/AGENTS.md`

- Document `--logo-uri` on the `create` and `update` sections.
- Document the new `logoUri` top-level field in the `app-config.json` reference.
- Note that the field is optional; absent / empty means "no logo".

### `.changeset/<random>.md`

```md
---
'@getbrevo/cli': minor
---

Add `logo_uri` support to `brevo app create` (`--logo-uri`), `brevo app update` (`--logo-uri`), and the `logoUri` top-level field in `app-config.json`. Flagless `brevo app update` pushes `logoUri` from the config file.
```

## Tests

### Existing test files to extend

- `src/__tests__/commands/create.test.ts`
  - `--logo-uri https://…` is forwarded to the API payload as `logo_uri`.
  - Without `--logo-uri`, the payload omits `logo_uri`.
  - Invalid URL fails fast (Commander parser).
  - JSON output includes `logoUri` when set, omits it otherwise.
  - 409 retry path preserves `logo_uri`.
- `src/__tests__/commands/update.test.ts`
  - `--logo-uri` alone is a valid update (counts toward `hasFlags`).
  - Flag value overrides existing config / remote value.
  - Without `--logo-uri`, existing value is preserved in the PUT body when reachable.
  - No-flag path pushes `config.logoUri` when set.
  - Write-back: `--logo-uri` updates `app-config.json` when `shouldWriteBack`.
  - JSON output includes `logo_uri` when set.
- Template var test (whichever file currently asserts `SCOPES_JSON` substitution — most likely under `src/__tests__/`):
  - `{{LOGO_URI}}` substitutes correctly.
  - Empty `LOGO_URI` renders as `"logoUri": ""`.

No new validator unit test is needed — `validateUrl` is already covered by the redirect URI suite, and adding the new field name (`'logo URL'`) doesn't change behavior under test.

## Risks & open questions

- **Empty-string semantics.** The template renders `"logoUri": ""` when scaffolded for an app with no logo. Flagless update reads this as "no logo" (truthy check fails) and omits `logo_uri` from the PUT body. This preserves existing backend state — but it also means once a logo is set on the API, the only way to update it via flagless `update` is to manually edit `app-config.json`. If the API treats `"" ` as "clear logo," we'd accidentally clear it on every flagless update. Mitigation: omit `logo_uri` from the PUT body when the config value is empty (the implementation does this). Confirmed by user: this is the intended behavior.
- **Order of fields in `app-config.json`.** Putting `logoUri` directly under `appName` is a deliberate choice (top-level metadata sits together). Existing scaffolded files in the wild won't have the field, which is fine — `readProjectConfig` treats it as `undefined`.
- **Endpoints are different for create vs. update.** POST goes to `/v3/oauth/apps`, PUT goes to `/v3/app-store/apps/{id}`. Backend accepts `logo_uri` on both. Not a change for this work, but worth noting because the user briefly thought they were the same.

## Acceptance criteria

1. `brevo app create --logo-uri https://example.com/logo.png --name "Test" --distribution private` creates an app whose `logo_uri` (via `GET /v3/oauth/apps/{id}`) matches the input.
2. `brevo app update --app-id <id> --logo-uri https://example.com/new.png` updates the logo and shows the diff in the summary.
3. `brevo app update --logo-uri https://example.com/x.png` (inside a scaffolded project) updates the API and writes `logoUri` into the local `app-config.json`.
4. `brevo app update` with no flags, when `app-config.json` includes `"logoUri": "https://example.com/x.png"`, pushes that value in the PUT body.
5. Invalid logo URL (`brevo app create --logo-uri "not a url"`) fails before any network call with `Invalid logo URL: …`.
6. Scaffolded `app-config.json` always has a `logoUri` field (empty string when the app has no logo).
7. `--json` output for both commands includes `logoUri` (or `logo_uri` for update) when the value is set.
8. `yarn lint`, `yarn test`, `yarn build` all pass.
9. `agent-context/SKILL.md` and `agent-context/AGENTS.md` both document the new flag and field.
10. A changeset file exists for the minor bump.
