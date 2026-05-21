# `logo_uri` Support Implementation Plan (BEX-194)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `logo_uri` (camelCase `logoUri` in CLI/JSON contexts) end-to-end across `brevo app create`, `brevo app update`, `app-config.json` template, and scaffolded project config.

**Architecture:** `--logo-uri <url>` becomes a plain optional flag on both `create` and `update`, no interactive prompt. The value flows: flag → service-layer payload → API (`POST /v3/oauth/apps` for create, `PUT /v3/app-store/apps/{id}` for update). On `update`, the value also gets read from / written back to local `app-config.json`. The scaffolded template gets a new `logoUri` top-level field sourced from `OAuthApp.logo_uri` returned by the GET endpoint.

**Tech Stack:** TypeScript (CommonJS), Node ≥ 20.15, Jest + ts-jest, Commander, inquirer.

**Spec:** `docs/superpowers/specs/2026-05-21-logo-uri-support-design.md`

**Branch / PR:** `BEX-194_logo-uri`, separate PR from the current `BEX-197_cli` branch.

---

## File map

**Modify:**

- `src/types.ts` — add `logo_uri?: string` to `OAuthApp` and `CreateAppResponse`.
- `src/services/app.ts` — add `logo_uri?: string` to `createApp` payload and `updateApp` body types.
- `src/lib/config.ts` — add `logoUri?: string` to `ProjectConfig` interface.
- `src/commands/definitions.ts` — add `--logo-uri <url>` option + examples for `create` and `update`; wire to handlers.
- `src/commands/app/create.ts` — accept `logoUri` option, forward to payload, surface in success/JSON output, preserve through 409 retry.
- `src/commands/app/update.ts` — accept `logoUri` option; include in `hasFlags`; resolve baseline from config/remote; merge with flag; push in PUT body; render in summary; write back to `app-config.json`; handle no-flag path.
- `src/templates/files/app-config.json.tmpl` — add `"logoUri": "{{LOGO_URI}}"` field.
- `src/commands/app/scaffold.ts` — wire `{{LOGO_URI}}` into vars from `ctx.appDetails?.logo_uri`.
- `agent-context/SKILL.md` — document `--logo-uri` and `logoUri` field.
- `agent-context/AGENTS.md` — document `--logo-uri` and `logoUri` field.

**Modify (tests):**

- `src/__tests__/commands/app/create.test.ts` — flag forwarded; absent when not set; JSON output; 409 retry preserves.
- `src/__tests__/commands/app/update.test.ts` — `--logo-uri` alone counts as `hasFlags`; flag wins over baseline; no-flag push from config; write-back; flagless update without config logoUri omits field.
- `src/__tests__/commands/app/scaffold.test.ts` — `{{LOGO_URI}}` substituted from API response; empty default when absent.

**Create:**

- `.changeset/logo-uri-support.md` — minor bump changeset.

**Reference (read-only, do not modify):**

- `src/lib/validators.ts:41-59` — `validateUrl` is the reusable http(s) URL validator.
- `src/lib/constants.ts:72-79` — `ENDPOINTS.OAUTH_APPS` and `ENDPOINTS.APP_STORE_APP_UPDATE`.

---

## Pre-flight

### Task 0: Branch off main

**Files:** none

- [ ] **Step 1: Confirm clean working tree on `BEX-197_cli`**

```bash
git status
```
Expected: `nothing to commit, working tree clean` (or only this plan/spec staged).

- [ ] **Step 2: Stage and commit the spec + plan on `BEX-197_cli`** (optional — only if user wants them merged via the current branch). Otherwise, stash them and apply on the new branch:

```bash
git stash push -u -- docs/superpowers/
git checkout main
git pull --ff-only origin main
git checkout -b BEX-194_logo-uri
git stash pop
git add docs/superpowers/specs/2026-05-21-logo-uri-support-design.md docs/superpowers/plans/2026-05-21-logo-uri-support.md
git commit -m "docs(BEX-194): add logo_uri spec and implementation plan"
```

Expected: new branch `BEX-194_logo-uri` exists with the spec + plan committed.

---

## Phase 1 — Types and service layer

### Task 1: Extend `OAuthApp` and `CreateAppResponse`

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add `logo_uri?: string` to both interfaces**

In `src/types.ts`, after the existing fields in `OAuthApp` (currently ends at `updated_at: string;`), insert a new field. Result for both interfaces:

```ts
export interface OAuthApp {
  app_id: string;
  name: string;
  client_id: string;
  client_secret?: string;
  public?: boolean;
  redirect_uris: string[];
  scopes?: string[];
  logo_uri?: string;
  created_at: string;
  updated_at: string;
}

export interface CreateAppResponse {
  app_id: string;
  name: string;
  client_id: string;
  client_secret: string;
  public?: boolean;
  redirect_uris: string[];
  logo_uri?: string;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 2: Type-check**

```bash
yarn build
```
Expected: clean build (no TS errors).

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(BEX-194): add logo_uri to OAuthApp and CreateAppResponse types"
```

---

### Task 2: Add `logo_uri` to `appService.createApp` and `updateApp` signatures

**Files:**
- Modify: `src/services/app.ts:127-145`

- [ ] **Step 1: Add `logo_uri` to `createApp` payload type**

Replace the existing `createApp` block (currently `payload: { name; public; redirect_uris?; scopes? }`):

```ts
    async createApp(payload: {
      name: string;
      public: boolean;
      redirect_uris?: string[];
      scopes?: string[];
      logo_uri?: string;
    }): Promise<CreateAppResponse> {
      const raw = await client.post<CreateAppResponse>(ENDPOINTS.OAUTH_APPS, {
        ...payload,
        source: 'cli',
      });
      return normalizeAppId(raw);
    },
```

- [ ] **Step 2: Add `logo_uri` to `updateApp` body type**

Replace the existing `updateApp` block:

```ts
    async updateApp(
      appId: string,
      body: { name?: string; redirect_uris: string[]; scopes?: string[]; logo_uri?: string },
    ): Promise<void> {
      await client.put(ENDPOINTS.APP_STORE_APP_UPDATE(appId), body);
    },
```

- [ ] **Step 3: Type-check**

```bash
yarn build
```
Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add src/services/app.ts
git commit -m "feat(BEX-194): accept logo_uri in app service create/update signatures"
```

---

## Phase 2 — `ProjectConfig` interface

### Task 3: Add `logoUri` to `ProjectConfig`

**Files:**
- Modify: `src/lib/config.ts:401-427`

- [ ] **Step 1: Add the optional field**

In the `ProjectConfig` interface, insert `logoUri?: string;` directly under `appName: string;`:

```ts
export interface ProjectConfig {
  appId: string;
  appName: string;
  logoUri?: string;
  cliVersion?: string;
  minCliVersion?: string;
  createdAt?: string;
  updatedAt?: string;
  auth: {
    type: string;
    scopes: string[];
    redirectUrls?: string[];
  };
  // …rest unchanged
}
```

No change needed to `readProjectConfig` / `writeProjectConfig` — they already spread unknown fields through.

- [ ] **Step 2: Type-check**

```bash
yarn build
```
Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add src/lib/config.ts
git commit -m "feat(BEX-194): add optional logoUri to ProjectConfig"
```

---

## Phase 3 — `brevo app create`

### Task 4: Failing test — `--logo-uri` is forwarded to API payload

**Files:**
- Modify: `src/__tests__/commands/app/create.test.ts`

- [ ] **Step 1: Add a new `it` block at the end of the `describe('app/create', ...)` block**

```ts
  it('should forward --logo-uri to the create payload', async () => {
    (appService.createApp as jest.Mock).mockResolvedValue({
      app_id: 1,
      name: 'Test App',
      client_id: 'cli-123',
      client_secret: 'secret-456',
      redirect_uris: ['http://localhost:3009/auth/callback'],
      logo_uri: 'https://example.com/logo.png',
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    });

    mockPrompt.mockResolvedValueOnce({ shouldScaffold: false });

    await createCommand({
      name: 'Test App',
      distribution: 'private',
      redirectUri: ['http://localhost:3009/auth/callback'],
      logoUri: 'https://example.com/logo.png',
    });

    expect(appService.createApp).toHaveBeenCalledWith(
      expect.objectContaining({ logo_uri: 'https://example.com/logo.png' }),
    );
  });

  it('should omit logo_uri from the create payload when --logo-uri is not provided', async () => {
    (appService.createApp as jest.Mock).mockResolvedValue({
      app_id: 1,
      name: 'Test App',
      client_id: 'cli-123',
      client_secret: 'secret-456',
      redirect_uris: ['http://localhost:3009/auth/callback'],
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    });

    mockPrompt.mockResolvedValueOnce({ shouldScaffold: false });

    await createCommand({
      name: 'Test App',
      distribution: 'private',
      redirectUri: ['http://localhost:3009/auth/callback'],
    });

    const payload = (appService.createApp as jest.Mock).mock.calls[0][0];
    expect(payload).not.toHaveProperty('logo_uri');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
yarn jest src/__tests__/commands/app/create.test.ts -t "logo_uri" --no-coverage
```
Expected: both tests FAIL — `createCommand` doesn't accept `logoUri` yet (TS or runtime error).

---

### Task 5: Implement `--logo-uri` in `createCommand`

**Files:**
- Modify: `src/commands/app/create.ts`

- [ ] **Step 1: Add `logoUri` to options type**

In the function signature, add `logoUri?: string;` to the options object literal type (currently has `name`, `distribution`, `redirectUri`, `json`):

```ts
  async (options: {
    name?: string;
    distribution?: string;
    redirectUri?: string[];
    logoUri?: string;
    json?: boolean;
  }): Promise<void> => {
```

- [ ] **Step 2: Forward to payload**

Locate the payload construction (currently around `src/commands/app/create.ts:177-182`):

```ts
    const payload = {
      name: appName!,
      public: distribution === 'public',
      redirect_uris: redirectUrls,
      scopes: [...DEFAULT_SCOPES],
    };
```

Replace with:

```ts
    const payload = {
      name: appName!,
      public: distribution === 'public',
      redirect_uris: redirectUrls,
      scopes: [...DEFAULT_SCOPES],
      ...(options.logoUri ? { logo_uri: options.logoUri } : {}),
    };
```

- [ ] **Step 3: Preserve `logo_uri` through the 409 retry**

In the 409 retry path (around `src/commands/app/create.ts:209-214`), update the retried `createApp` call:

```ts
          result = await appService.createApp({
            name: retry.name,
            public: distribution === 'public',
            redirect_uris: redirectUrls,
            scopes: [...DEFAULT_SCOPES],
            ...(options.logoUri ? { logo_uri: options.logoUri } : {}),
          });
```

- [ ] **Step 4: Surface in success and JSON output**

Just before the `redirectUris.forEach(...)` block (around `src/commands/app/create.ts:252-254`), add:

```ts
    if (options.logoUri) {
      logInfo(`  Logo URL:      ${options.logoUri}`);
    }
```

Update the `--json` branch (around `src/commands/app/create.ts:237-243`):

```ts
    if (options.json) {
      jsonOutput({
        appId: result.app_id,
        appName,
        clientId: result.client_id,
        clientSecret: messages.CLIENT_SECRET_HIDDEN_JSON,
        redirectUri: resultRedirectUris,
        ...(options.logoUri ? { logoUri: options.logoUri } : {}),
      });
      return;
    }
```

- [ ] **Step 5: Re-run the two new tests**

```bash
yarn jest src/__tests__/commands/app/create.test.ts -t "logo_uri" --no-coverage
```
Expected: both tests PASS.

- [ ] **Step 6: Run the full create test file to confirm nothing regressed**

```bash
yarn jest src/__tests__/commands/app/create.test.ts --no-coverage
```
Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/commands/app/create.ts src/__tests__/commands/app/create.test.ts
git commit -m "feat(BEX-194): add --logo-uri flag to brevo app create"
```

---

## Phase 4 — `brevo app update`

### Task 6: Failing tests — `--logo-uri` on update

**Files:**
- Modify: `src/__tests__/commands/app/update.test.ts`

- [ ] **Step 1: Add four new tests at the end of the `describe('app/update', ...)` block**

```ts
  it('should treat --logo-uri alone as a flag-driven update', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    (readProjectConfig as jest.Mock).mockReturnValue(null);
    (appService.fetchApp as jest.Mock).mockResolvedValue({
      app_id: '42',
      name: 'Remote Name',
      client_id: 'cli',
      redirect_uris: ['https://example.com/cb'],
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    });

    await updateCommand({
      appId: '42',
      logoUri: 'https://example.com/logo.png',
      yes: true,
    });

    expect(appService.updateApp).toHaveBeenCalledWith(
      '42',
      expect.objectContaining({ logo_uri: 'https://example.com/logo.png' }),
    );
  });

  it('should preserve existing logo_uri from remote when --logo-uri is not passed', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    (readProjectConfig as jest.Mock).mockReturnValue(null);
    (appService.fetchApp as jest.Mock).mockResolvedValue({
      app_id: '42',
      name: 'Remote',
      client_id: 'cli',
      redirect_uris: ['https://example.com/cb'],
      logo_uri: 'https://existing.example.com/logo.png',
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    });

    await updateCommand({ appId: '42', name: 'Renamed', yes: true });

    expect(appService.updateApp).toHaveBeenCalledWith(
      '42',
      expect.objectContaining({ logo_uri: 'https://existing.example.com/logo.png' }),
    );
  });

  it('should push logoUri from app-config.json on flagless update', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (readProjectConfig as jest.Mock).mockReturnValue({
      ...VALID_CONFIG,
      logoUri: 'https://example.com/from-config.png',
    });
    (appService.fetchApp as jest.Mock).mockResolvedValue({
      app_id: '42',
      name: 'My Test App',
      client_id: 'cli',
      redirect_uris: VALID_CONFIG.auth.redirectUrls,
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    });

    await updateCommand({ yes: true });

    expect(appService.updateApp).toHaveBeenCalledWith(
      '42',
      expect.objectContaining({ logo_uri: 'https://example.com/from-config.png' }),
    );
  });

  it('should write logoUri back into app-config.json when --logo-uri matches the local app', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (readProjectConfig as jest.Mock).mockReturnValue({ ...VALID_CONFIG });
    (appService.fetchApp as jest.Mock).mockResolvedValue({
      app_id: '42',
      name: 'My Test App',
      client_id: 'cli',
      redirect_uris: VALID_CONFIG.auth.redirectUrls,
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    });

    await updateCommand({
      logoUri: 'https://example.com/new.png',
      yes: true,
    });

    expect(writeProjectConfig).toHaveBeenCalledWith(
      expect.objectContaining({ logoUri: 'https://example.com/new.png' }),
    );
  });

  it('should omit logo_uri from the PUT body when no flag and no config logoUri', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (readProjectConfig as jest.Mock).mockReturnValue({ ...VALID_CONFIG });
    (appService.fetchApp as jest.Mock).mockResolvedValue({
      app_id: '42',
      name: 'My Test App',
      client_id: 'cli',
      redirect_uris: VALID_CONFIG.auth.redirectUrls,
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    });

    await updateCommand({ yes: true });

    const body = (appService.updateApp as jest.Mock).mock.calls[0][1];
    expect(body).not.toHaveProperty('logo_uri');
  });
```

- [ ] **Step 2: Run the new tests to verify they fail**

```bash
yarn jest src/__tests__/commands/app/update.test.ts -t "logo" --no-coverage
```
Expected: all five tests FAIL (TS error because `logoUri` isn't on `UpdateOptions`, or no `logo_uri` in the PUT body).

---

### Task 7: Implement `--logo-uri` in `updateCommand`

**Files:**
- Modify: `src/commands/app/update.ts`

- [ ] **Step 1: Add `logoUri` to `UpdateOptions`**

```ts
interface UpdateOptions {
  appId?: string;
  name?: string;
  redirectUri?: string[];
  scope?: string[];
  logoUri?: string;
  yes?: boolean;
  json?: boolean;
}
```

- [ ] **Step 2: Extend `hasFlags`**

Replace the existing `hasFlags` constant (around `src/commands/app/update.ts:26-30`):

```ts
  const hasFlags = !!(
    options.name !== undefined ||
    (options.redirectUri && options.redirectUri.length > 0) ||
    (options.scope && options.scope.length > 0) ||
    options.logoUri !== undefined
  );
```

- [ ] **Step 3: Handle the no-flag path (push from config)**

In the no-flag branch (around `src/commands/app/update.ts:99-162`), update the `updateApp` call (around line 142) to include logo_uri when present in config:

```ts
    const spinner = createSpinner('Updating app...', { silent: options.json });
    await appService.updateApp(appId, {
      name: config!.appName,
      redirect_uris: redirectUrls,
      ...(config!.logoUri ? { logo_uri: config!.logoUri } : {}),
    });
    spinner.stop();
```

In the same no-flag branch, also extend `renderUpdateSummary` so the diff shows the logo. Locate the `renderUpdateSummary` call (around line 117-123) and add `currentLogoUri` / `nextLogoUri` to its params:

```ts
      renderUpdateSummary({
        appId,
        currentName: remote.name,
        nextName: config!.appName,
        currentUrls: remote.redirect_uris ?? [],
        nextUrls: redirectUrls,
        currentLogoUri: remote.logo_uri,
        nextLogoUri: config!.logoUri,
      });
```

And in the JSON output for the no-flag path (around line 151):

```ts
    if (options.json) {
      jsonOutput({
        app_id: appId,
        name: config!.appName,
        redirect_uris: redirectUrls,
        ...(config!.logoUri ? { logo_uri: config!.logoUri } : {}),
      });
      return;
    }
```

- [ ] **Step 4: Handle the flag path**

In the flag-path baseline resolution (around `src/commands/app/update.ts:165-190`), add `existingLogoUri` tracking:

```ts
  let existingName: string | undefined;
  let existingRedirectUrls: string[] = [];
  let existingScopes: string[] = [];
  let existingLogoUri: string | undefined;

  const configRedirectUrls = config?.auth?.redirectUrls;
  const hasUsableConfigRedirectUrls =
    Array.isArray(configRedirectUrls) && configRedirectUrls.length > 0;

  if (config && shouldWriteBack && hasUsableConfigRedirectUrls) {
    existingName = config.appName;
    existingRedirectUrls = configRedirectUrls;
    existingScopes = config.auth?.scopes ?? [];
    existingLogoUri = config.logoUri;
  } else if (config && shouldWriteBack) {
    const app = await fetchExistingApp(appId, options.json);
    existingName = config.appName ?? app.name;
    existingRedirectUrls = app.redirect_uris ?? [];
    existingScopes = config.auth?.scopes ?? app.scopes ?? [];
    existingLogoUri = config.logoUri ?? app.logo_uri;
  } else {
    const app = await fetchExistingApp(appId, options.json);
    existingName = app.name;
    existingRedirectUrls = app.redirect_uris ?? [];
    existingScopes = app.scopes ?? [];
    existingLogoUri = app.logo_uri;
  }
```

Right after the existing merge block (around line 192-211), add the logo merge:

```ts
  const finalLogoUri = options.logoUri ?? existingLogoUri;
```

Update the `renderUpdateSummary` call (around line 221-231):

```ts
  if (!options.json) {
    renderUpdateSummary({
      appId,
      currentName: existingName,
      nextName: finalName,
      currentUrls: existingRedirectUrls,
      nextUrls: mergedUrls,
      currentScopes: hasScopeFlag ? existingScopes : undefined,
      nextScopes: hasScopeFlag ? mergedScopes : undefined,
      currentLogoUri: existingLogoUri,
      nextLogoUri: finalLogoUri,
    });
  }
```

Update the `updateApp` call (around line 253-258):

```ts
  const spinner = createSpinner('Updating app...', { silent: options.json });
  await appService.updateApp(appId, {
    name: finalName,
    redirect_uris: mergedUrls,
    ...(hasScopeFlag ? { scopes: mergedScopes } : {}),
    ...(finalLogoUri ? { logo_uri: finalLogoUri } : {}),
  });
  spinner.stop();
```

Update the write-back block (around line 263-275):

```ts
  if (shouldWriteBack && config) {
    const updatedConfig = { ...config };
    if (options.name) {
      updatedConfig.appName = options.name;
    }
    if (options.logoUri) {
      updatedConfig.logoUri = options.logoUri;
    }
    updatedConfig.auth = {
      ...updatedConfig.auth,
      redirectUrls: mergedUrls,
      ...(hasScopeFlag ? { scopes: mergedScopes } : {}),
    };
    writeProjectConfig(updatedConfig);
  }
```

Update the JSON output (around line 277-284):

```ts
  if (options.json) {
    jsonOutput({
      app_id: appId,
      name: finalName,
      redirect_uris: mergedUrls,
      ...(hasScopeFlag ? { scopes: mergedScopes } : {}),
      ...(finalLogoUri ? { logo_uri: finalLogoUri } : {}),
    });
    return;
  }
```

Update the human success output (around line 287-298): add a `Logo URL:` line before the `if (shouldWriteBack && config)` block:

```ts
  if (finalLogoUri) {
    logInfo(`  Logo URL:      ${finalLogoUri}`);
  }
```

- [ ] **Step 5: Extend `renderUpdateSummary` signature**

Update the function signature (around `src/commands/app/update.ts:315-323`):

```ts
function renderUpdateSummary(params: {
  appId: string;
  currentName: string | undefined;
  nextName: string | undefined;
  currentUrls: string[];
  nextUrls: string[];
  currentScopes?: string[];
  nextScopes?: string[];
  currentLogoUri?: string;
  nextLogoUri?: string;
}): void {
  const {
    appId,
    currentName,
    nextName,
    currentUrls,
    nextUrls,
    currentScopes,
    nextScopes,
    currentLogoUri,
    nextLogoUri,
  } = params;
```

And, after the existing scopes block inside `renderUpdateSummary`, append:

```ts
  if (nextLogoUri !== undefined || currentLogoUri !== undefined) {
    const label = '  Logo URL:      ';
    if (currentLogoUri && nextLogoUri && currentLogoUri !== nextLogoUri) {
      logInfo(`${label}${currentLogoUri} → ${nextLogoUri}`);
    } else if (nextLogoUri) {
      logInfo(`${label}${nextLogoUri}`);
    } else if (currentLogoUri) {
      logInfo(`${label}${currentLogoUri} (unchanged)`);
    }
  }
```

- [ ] **Step 6: Re-run the new update tests**

```bash
yarn jest src/__tests__/commands/app/update.test.ts -t "logo" --no-coverage
```
Expected: all five tests PASS.

- [ ] **Step 7: Run the full update test file**

```bash
yarn jest src/__tests__/commands/app/update.test.ts --no-coverage
```
Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/commands/app/update.ts src/__tests__/commands/app/update.test.ts
git commit -m "feat(BEX-194): add --logo-uri flag and config push to brevo app update"
```

---

## Phase 5 — Commander wiring

### Task 8: Add `--logo-uri` option to `create` and `update` definitions

**Files:**
- Modify: `src/commands/definitions.ts`

- [ ] **Step 1: Import `validateUrl`**

At the top of `src/commands/definitions.ts`, extend the validators import:

```ts
import { parseAppId, parsePositiveInt, collectUrls, validateUrl } from '../lib/validators';
```

- [ ] **Step 2: Add `--logo-uri` to the `create` command**

In the `create` definition (around `src/commands/definitions.ts:62-87`), add to the `options` array:

```ts
        {
          flags: '--logo-uri <url>',
          description: 'App logo URL (http or https)',
          parser: (v: string) => {
            validateUrl(v, 'logo URL');
            return v;
          },
        },
```

Extend the handler:

```ts
      handler: (opts) =>
        createCommand({
          name: opts.name as string | undefined,
          distribution: opts.distribution as string | undefined,
          redirectUri: opts.redirectUri as string[] | undefined,
          logoUri: opts.logoUri as string | undefined,
          json: Boolean(opts.json),
        }),
```

Add an example to the `examples` array:

```ts
        'brevo app create --name "My App" --distribution private --logo-uri https://example.com/logo.png',
```

- [ ] **Step 3: Add `--logo-uri` to the `update` command**

In the `update` definition (around `src/commands/definitions.ts:119-160`), add to the `options` array:

```ts
        {
          flags: '--logo-uri <url>',
          description: 'App logo URL (http or https)',
          parser: (v: string) => {
            validateUrl(v, 'logo URL');
            return v;
          },
        },
```

Extend the handler:

```ts
      handler: (opts) =>
        updateCommand({
          appId: opts.appId,
          name: opts.name,
          redirectUri: opts.redirectUri,
          scope: opts.scope as string[] | undefined,
          logoUri: opts.logoUri as string | undefined,
          yes: Boolean(opts.yes),
          json: Boolean(opts.json),
        }),
```

Add an example:

```ts
        'brevo app update --logo-uri https://example.com/logo.png',
```

- [ ] **Step 4: Run full test suite**

```bash
yarn test
```
Expected: all tests PASS.

- [ ] **Step 5: Build to catch any TS issue**

```bash
yarn build
```
Expected: clean build.

- [ ] **Step 6: Commit**

```bash
git add src/commands/definitions.ts
git commit -m "feat(BEX-194): wire --logo-uri option on create and update commands"
```

---

## Phase 6 — Template and scaffold

### Task 9: Failing scaffold test — `{{LOGO_URI}}` is wired

**Files:**
- Modify: `src/__tests__/commands/app/scaffold.test.ts`

- [ ] **Step 1: Add a new `it` block at the end of the `describe`**

```ts
  it('should pass logo_uri into template vars when present', async () => {
    (appService.resolveAppCredentials as jest.Mock).mockResolvedValue({
      diffs: [],
      app: {
        app_id: '1',
        name: 'Test App',
        client_id: 'cli-123',
        client_secret: 'secret',
        redirect_uris: [],
        logo_uri: 'https://example.com/logo.png',
      },
    });

    mockPrompt.mockResolvedValueOnce({ outputDir: tmpPath('test-logo') });

    await scaffoldCommand({ appId: '1' });

    const { loadAllTemplates } = require('../../../templates');
    const vars = (loadAllTemplates as jest.Mock).mock.calls[0][0];
    expect(vars['{{LOGO_URI}}']).toBe('https://example.com/logo.png');
  });

  it('should pass an empty string for {{LOGO_URI}} when the app has no logo_uri', async () => {
    (appService.resolveAppCredentials as jest.Mock).mockResolvedValue({
      diffs: [],
      app: {
        app_id: '1',
        name: 'Test App',
        client_id: 'cli-123',
        client_secret: 'secret',
        redirect_uris: [],
      },
    });

    mockPrompt.mockResolvedValueOnce({ outputDir: tmpPath('test-no-logo') });

    await scaffoldCommand({ appId: '1' });

    const { loadAllTemplates } = require('../../../templates');
    const vars = (loadAllTemplates as jest.Mock).mock.calls[0][0];
    expect(vars['{{LOGO_URI}}']).toBe('');
  });
```

- [ ] **Step 2: Run scaffold tests — they should fail**

```bash
yarn jest src/__tests__/commands/app/scaffold.test.ts -t "LOGO_URI" --no-coverage
```
Expected: both tests FAIL — `{{LOGO_URI}}` key is missing from `vars`.

---

### Task 10: Wire `{{LOGO_URI}}` into scaffold

**Files:**
- Modify: `src/commands/app/scaffold.ts:187-200`

- [ ] **Step 1: Add `{{LOGO_URI}}` to vars**

Replace the existing `vars` literal with the addition of one line:

```ts
    const vars = {
      '{{APP_NAME}}': appName,
      '{{APP_SLUG}}': slug,
      '{{APP_ID}}': String(appId),
      '{{CLIENT_ID}}': ctx.clientId,
      '{{CLIENT_SECRET}}': ctx.clientSecret,
      '{{REDIRECT_URI}}': ctx.redirectUri,
      '{{REDIRECT_URLS_JSON}}': JSON.stringify(ctx.redirectUrls),
      '{{SCOPES_JSON}}': JSON.stringify(scopes),
      '{{LOGO_URI}}': ctx.appDetails?.logo_uri ?? '',
      '{{OAUTH_BASE}}': OAUTH_BASE,
      '{{OAUTH_REALM}}': OAUTH_REALM,
      '{{CLI_VERSION}}': cliVersion,
      '{{MIN_CLI_VERSION}}': MIN_CLI_VERSION,
    };
```

- [ ] **Step 2: Re-run the scaffold tests**

```bash
yarn jest src/__tests__/commands/app/scaffold.test.ts --no-coverage
```
Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/commands/app/scaffold.ts src/__tests__/commands/app/scaffold.test.ts
git commit -m "feat(BEX-194): pass logo_uri into scaffold template vars"
```

---

### Task 11: Add `logoUri` field to `app-config.json` template

**Files:**
- Modify: `src/templates/files/app-config.json.tmpl`

- [ ] **Step 1: Insert `logoUri` directly under `appName`**

Replace the current template (`src/templates/files/app-config.json.tmpl`) with:

```json
{
  "appId": "{{APP_ID}}",
  "appName": "{{APP_NAME}}",
  "logoUri": "{{LOGO_URI}}",
  "cliVersion": "{{CLI_VERSION}}",
  "minCliVersion": "{{MIN_CLI_VERSION}}",
  "auth": {
    "type": "private",
    "scopes": {{SCOPES_JSON}},
    "redirectUrls": {{REDIRECT_URLS_JSON}}
  },
  "distribution": "private",
  "permittedUrls": {
    "fetch": [],
    "img": [],
    "iframe": [],
    "js": [],
    "css": []
  },
  "support": {
    "supportEmail": "",
    "documentationUrl": "",
    "supportUrl": "",
    "supportPhone": ""
  }
}
```

- [ ] **Step 2: Verify the rendered template still parses as valid JSON**

```bash
yarn jest src/__tests__/templates --no-coverage
```
Expected: all tests PASS (including the existing handler-template "no unsubstituted variables" check).

- [ ] **Step 3: Commit**

```bash
git add src/templates/files/app-config.json.tmpl
git commit -m "feat(BEX-194): add logoUri field to app-config.json template"
```

---

## Phase 7 — Docs and changeset

### Task 12: Update `agent-context/SKILL.md` and `agent-context/AGENTS.md`

**Files:**
- Modify: `agent-context/SKILL.md`
- Modify: `agent-context/AGENTS.md`

- [ ] **Step 1: Read both files to find the right insertion points**

```bash
grep -n "redirect-uri\|app-config.json" agent-context/SKILL.md agent-context/AGENTS.md
```

- [ ] **Step 2: For each file, in the `brevo app create` section, add `--logo-uri <url>` to the flag list with a one-line description**

Use the same wording in both:

> `--logo-uri <url>` — Optional. App logo URL (http or https).

- [ ] **Step 3: For each file, in the `brevo app update` section, add `--logo-uri <url>` to the flag list with the same wording**

- [ ] **Step 4: For each file, in the `app-config.json` reference section, document the new top-level field**

Insertion text:

> `logoUri` (string, optional) — App logo URL. Pushed in the PUT body on flagless `brevo app update`. Empty string means "no logo set".

- [ ] **Step 5: Confirm both files are still in sync per CLAUDE.md rule**

Eyeball: same flag in both, same wording, same `logoUri` description. Per CLAUDE.md "Keep AGENTS.md and SKILL.md in sync".

- [ ] **Step 6: Commit**

```bash
git add agent-context/SKILL.md agent-context/AGENTS.md
git commit -m "docs(BEX-194): document --logo-uri flag and logoUri config field"
```

---

### Task 13: Add changeset

**Files:**
- Create: `.changeset/logo-uri-support.md`

- [ ] **Step 1: Create the changeset file**

```markdown
---
'@getbrevo/cli': minor
---

Add `logo_uri` support to `brevo app create` (`--logo-uri`), `brevo app update` (`--logo-uri`), and the `logoUri` top-level field in `app-config.json`. Flagless `brevo app update` pushes `logoUri` from the config file when present.
```

- [ ] **Step 2: Commit**

```bash
git add .changeset/logo-uri-support.md
git commit -m "chore(BEX-194): add changeset for logo_uri support"
```

---

## Phase 8 — Verification and PR

### Task 14: Full local verification

**Files:** none

- [ ] **Step 1: Lint**

```bash
yarn lint
```
Expected: no errors (warnings allowed but should also be clean).

- [ ] **Step 2: Full test suite**

```bash
yarn test
```
Expected: all tests PASS.

- [ ] **Step 3: Build**

```bash
yarn build
```
Expected: clean build, `dist/` populated.

- [ ] **Step 4: Smoke-test the new flag locally** (optional but recommended)

```bash
yarn link:dev
# In a scratch directory:
# brevo app create --name "Logo Test" --distribution private \
#   --redirect-uri http://localhost:3009/auth/callback \
#   --logo-uri https://example.com/logo.png --json
# Inspect the JSON output for `"logoUri": "https://example.com/logo.png"`.
```

Skip if not in a position to hit the real API.

---

### Task 15: Push branch and open PR

**Files:** none

- [ ] **Step 1: Push the branch**

```bash
git push -u origin BEX-194_logo-uri
```

- [ ] **Step 2: Open PR via `gh`**

```bash
gh pr create --title "feat(BEX-194): add logo_uri support to app create/update and config" --body "$(cat <<'EOF'
## Summary
- Adds `--logo-uri <url>` flag to `brevo app create` and `brevo app update`, validated as http(s) URL.
- Adds optional top-level `logoUri` field to `app-config.json` and the scaffold template.
- Flagless `brevo app update` now pushes `logoUri` from the local config file when present.
- `update --logo-uri` writes the value back into `app-config.json` when the config file matches the app.

## Test plan
- [ ] `yarn test` passes locally
- [ ] `yarn lint` clean
- [ ] `yarn build` clean
- [ ] Smoke-test against staging: create app with `--logo-uri`, confirm via `app credentials` / API
- [ ] Smoke-test `update --logo-uri` write-back into `app-config.json`
- [ ] Smoke-test flagless `update` pushes `logoUri` from config

BEX-194
EOF
)"
```

- [ ] **Step 3: Capture the PR URL for the user**

```bash
gh pr view --json url -q .url
```

---

## Self-review checklist (Claude runs this before claiming done)

1. **Spec coverage:** Every section in `2026-05-21-logo-uri-support-design.md` maps to a task above. Spot-check:
   - CLI `create` flag → Task 5 ✓
   - CLI `update` flag, no-flag path, write-back → Tasks 6–7 ✓
   - `ProjectConfig.logoUri` → Task 3 ✓
   - Template + scaffold → Tasks 9–11 ✓
   - Docs sync → Task 12 ✓
   - Changeset → Task 13 ✓
   - Acceptance criteria 1–10 from spec → covered by Tasks 4–15 ✓
2. **Placeholder scan:** All steps have concrete code or commands. No "TBD" / "TODO" / "similar to". ✓
3. **Type consistency:** `logoUri` (camelCase) for CLI option name + `ProjectConfig` field + JSON output on create; `logo_uri` (snake_case) for API payloads + `OAuthApp` field + JSON output on update — matches the asymmetry already in the codebase (`redirectUri` on create.json vs `redirect_uris` on update.json). Render label is `Logo URL` in both places. ✓
