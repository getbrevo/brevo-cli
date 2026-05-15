# Granular OAuth Scopes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `scopes: ['all']` everywhere in the CLI with a granular four-scope default for new apps, add a repeatable append flag `--scope` to `brevo app update`, and ship a new `brevo app scopes` command that prints the IdP's `scopes_supported`.

**Architecture:** Server-trusting. The CLI sends whatever scope strings it has — no client-side validation. The only consumer of the IdP well-known endpoint is the new `app scopes` command. The four default scopes live in `src/lib/constants.ts` as a single source of truth; every site that used `['all']` switches to it.

**Tech Stack:** TypeScript (CommonJS, ES2022), commander, inquirer, Jest with `ts-jest`. Pre-commit hook runs prettier + eslint + the full test suite.

**Source spec:** `docs/superpowers/specs/2026-05-14-cli-oauth-scopes-design.md`

---

## Conventions used in this plan

- Every task is one TDD cycle ending in one commit. If a step's command fails for a reason this plan didn't predict, stop and surface the failure — do not paper over it.
- All test files live under `src/__tests__/` mirroring `src/`. Mocks are inline per file, never shared.
- All user-facing strings live in `src/lang/en.ts`. Commands reference them via `messages.XXX`, never hardcoded literals.
- CLI command references (e.g. `brevo app update --scope`) are constants in `src/lib/constants.ts` (`CLI.*`), used inside messages so we have one source of truth for command spelling.
- Commit messages follow the repo style: `<type>(<scope>): <subject> (BEX-197)`. Each commit ends with the standard `Co-Authored-By` trailer.

## Pre-flight (do once, before Task 1)

- [ ] **Step P1: Confirm branch and clean tree**

Run: `git status && git rev-parse --abbrev-ref HEAD`
Expected: branch `BEX-197_cli`, working tree clean (only the spec is committed).

- [ ] **Step P2: Confirm baseline tests pass**

Run: `yarn test`
Expected: all 478 tests passing.

---

## Task 1: Add `DEFAULT_SCOPES` constant and CLI helpers

**Why first:** Every other task references these constants. Land them once, then reuse.

**Files:**
- Modify: `src/lib/constants.ts` (add `DEFAULT_SCOPES`, `OAUTH_WELL_KNOWN_URL`, `CLI.APP_SCOPES`, `CLI.APP_UPDATE_SCOPE`)
- Test: `src/__tests__/lib/constants.test.ts` (extend)

- [ ] **Step 1.1: Write the failing tests**

Append to `src/__tests__/lib/constants.test.ts`:

```typescript
import { DEFAULT_SCOPES, OAUTH_WELL_KNOWN_URL, CLI } from '../../lib/constants';

describe('DEFAULT_SCOPES', () => {
  it('is the locked four-scope set in the documented order', () => {
    expect(DEFAULT_SCOPES).toEqual([
      'contacts:read',
      'contacts:write',
      'crm:read',
      'crm:write',
    ]);
  });

  it('is a readonly tuple-style array (no accidental push at runtime)', () => {
    // Snapshot length so a stray push elsewhere in the codebase fails this test.
    expect(DEFAULT_SCOPES).toHaveLength(4);
  });
});

describe('OAUTH_WELL_KNOWN_URL', () => {
  it('is built from OAUTH_BASE and OAUTH_REALM', () => {
    expect(OAUTH_WELL_KNOWN_URL).toBe(
      'https://oauth.brevo.com/realms/partner/.well-known/oauth-authorization-server',
    );
  });
});

describe('CLI scope helpers', () => {
  it('exposes APP_SCOPES and APP_UPDATE_SCOPE strings', () => {
    expect(CLI.APP_SCOPES).toBe('brevo app scopes');
    expect(CLI.APP_UPDATE_SCOPE).toBe('brevo app update --scope');
  });
});
```

- [ ] **Step 1.2: Run the tests, confirm they fail**

Run: `yarn jest src/__tests__/lib/constants.test.ts -t "DEFAULT_SCOPES|OAUTH_WELL_KNOWN_URL|CLI scope helpers"`
Expected: 4 FAILs — symbols not exported.

- [ ] **Step 1.3: Implement the constants**

Open `src/lib/constants.ts`. Below the existing `OAUTH_REALM` line (line 108), add:

```typescript
export const OAUTH_WELL_KNOWN_URL = `${OAUTH_BASE}/realms/${OAUTH_REALM}/.well-known/oauth-authorization-server`;

export const DEFAULT_SCOPES: readonly string[] = [
  'contacts:read',
  'contacts:write',
  'crm:read',
  'crm:write',
] as const;
```

In the `CLI` object (around line 95–101), add two new keys before the closing brace:

```typescript
  APP_SCOPES: 'brevo app scopes',
  APP_UPDATE_SCOPE: 'brevo app update --scope',
```

- [ ] **Step 1.4: Run the tests, confirm they pass**

Run: `yarn jest src/__tests__/lib/constants.test.ts`
Expected: PASS, no other tests broken.

- [ ] **Step 1.5: Run the full suite**

Run: `yarn test`
Expected: all green.

- [ ] **Step 1.6: Commit**

```bash
git add src/lib/constants.ts src/__tests__/lib/constants.test.ts
git commit -m "$(cat <<'EOF'
feat(scopes): add DEFAULT_SCOPES constant and CLI helpers (BEX-197)

DEFAULT_SCOPES = [contacts:read, contacts:write, crm:read, crm:write]
is the new starter set replacing the legacy scopes: ['all']. Adds
OAUTH_WELL_KNOWN_URL for the upcoming `brevo app scopes` command and
two CLI.* helpers so user-facing strings reference one canonical
spelling of each command.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add user-facing strings

**Why second:** Tasks 3, 6, 8 reference these strings. Land them once.

**Files:**
- Modify: `src/lang/en.ts`
- Test: `src/__tests__/lang/en.test.ts` (extend)

- [ ] **Step 2.1: Write the failing tests**

Append a new `describe` block to `src/__tests__/lang/en.test.ts`:

```typescript
describe('scope-related messages', () => {
  it('exports the create-time info notice that names the four defaults and points to the update command', () => {
    const notice = messages.APP_CREATE_SCOPE_NOTICE([
      'contacts:read',
      'contacts:write',
      'crm:read',
      'crm:write',
    ]);
    expect(notice).toContain('contacts:read');
    expect(notice).toContain('contacts:write');
    expect(notice).toContain('crm:read');
    expect(notice).toContain('crm:write');
    expect(notice).toContain('brevo app update --scope');
  });

  it('exports the update-time appended summary', () => {
    expect(messages.APP_UPDATE_SCOPES_APPENDED(['contacts:read'])).toContain('contacts:read');
  });

  it('exports the app scopes empty-result message', () => {
    expect(messages.APP_SCOPES_EMPTY).toBeDefined();
    expect(messages.APP_SCOPES_EMPTY).toMatch(/scope/i);
  });

  it('exports IdP well-known error messages', () => {
    expect(messages.OAUTH_METADATA_MISSING_SCOPES).toMatch(/scopes_supported/);
    expect(messages.OAUTH_METADATA_FETCH_FAILED('https://x/y', 500)).toContain('https://x/y');
    expect(messages.OAUTH_METADATA_FETCH_FAILED('https://x/y', 500)).toContain('500');
  });
});
```

- [ ] **Step 2.2: Run the tests, confirm they fail**

Run: `yarn jest src/__tests__/lang/en.test.ts -t "scope-related messages"`
Expected: 4 FAILs — properties not on `messages`.

- [ ] **Step 2.3: Add the strings to `src/lang/en.ts`**

Find the `// App create` section (around line 53). Inside the `messages` object, after the existing `APP_CREATE_*` block, add:

```typescript
  APP_CREATE_SCOPE_NOTICE: (scopes: string[]): string =>
    `Created with default scopes: ${scopes.join(', ')}.\n  Run \`${CLI.APP_UPDATE_SCOPE} <scope>\` to add more.`,
```

Find the `// App update` section. After the last `APP_UPDATE_*` key, add:

```typescript
  APP_UPDATE_SCOPES_APPENDED: (scopes: string[]): string =>
    `Scopes appended: ${scopes.join(', ')}`,
```

At the end of the `messages` object (before its closing `}`), add a new section:

```typescript
  // App scopes
  APP_SCOPES_EMPTY: 'The IdP returned an empty scope list.',
  OAUTH_METADATA_MISSING_SCOPES:
    'IdP well-known response did not include scopes_supported.',
  OAUTH_METADATA_FETCH_FAILED: (url: string, status: number): string =>
    `Failed to fetch OAuth metadata from ${url} (HTTP ${status}).`,
```

- [ ] **Step 2.4: Run the tests, confirm they pass**

Run: `yarn jest src/__tests__/lang/en.test.ts`
Expected: PASS.

- [ ] **Step 2.5: Run the full suite**

Run: `yarn test`
Expected: all green.

- [ ] **Step 2.6: Commit**

```bash
git add src/lang/en.ts src/__tests__/lang/en.test.ts
git commit -m "$(cat <<'EOF'
feat(scopes): add user-facing strings for scope flows (BEX-197)

Adds five new messages: APP_CREATE_SCOPE_NOTICE,
APP_UPDATE_SCOPES_APPENDED, APP_SCOPES_EMPTY,
OAUTH_METADATA_MISSING_SCOPES, OAUTH_METADATA_FETCH_FAILED.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `app create` uses `DEFAULT_SCOPES` and prints the info line

**Files:**
- Modify: `src/commands/app/create.ts` (replace `scopes: ['all']` at lines 181 and 213; add info line after `logSuccess(messages.APP_CREATE_SUCCESS)`)
- Test: `src/__tests__/commands/app/create.test.ts` (extend)

- [ ] **Step 3.1: Write the failing tests**

Append three tests inside the `describe('app/create', ...)` block in `src/__tests__/commands/app/create.test.ts`:

```typescript
it('sends DEFAULT_SCOPES on create (not the legacy "all")', async () => {
  (appService.createApp as jest.Mock).mockResolvedValue({
    app_id: 1,
    name: 'Test App',
    client_id: 'cli-123',
    client_secret: 'secret-456',
    redirect_uris: ['http://localhost:3009/auth/callback'],
  });
  mockPrompt
    .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' })
    .mockResolvedValueOnce({ anotherRaw: 'n' })
    .mockResolvedValueOnce({ shouldScaffold: false });

  await createCommand({ name: 'Test App', distribution: 'private' });

  expect(appService.createApp).toHaveBeenCalledWith(
    expect.objectContaining({
      scopes: ['contacts:read', 'contacts:write', 'crm:read', 'crm:write'],
    }),
  );
});

it('prints the scope info line in text mode', async () => {
  (appService.createApp as jest.Mock).mockResolvedValue({
    app_id: 1,
    name: 'Test App',
    client_id: 'cli-123',
    client_secret: 'secret-456',
    redirect_uris: ['http://localhost:3009/auth/callback'],
  });
  mockPrompt
    .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' })
    .mockResolvedValueOnce({ anotherRaw: 'n' })
    .mockResolvedValueOnce({ shouldScaffold: false });

  await createCommand({ name: 'Test App', distribution: 'private' });

  const stdoutCalls = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
  expect(stdoutCalls).toContain('Created with default scopes');
  expect(stdoutCalls).toContain('contacts:read');
  expect(stdoutCalls).toContain('brevo app update --scope');
});

it('suppresses the scope info line under --json', async () => {
  (appService.createApp as jest.Mock).mockResolvedValue({
    app_id: 1,
    name: 'Test App',
    client_id: 'cli-123',
    client_secret: 'secret-456',
    redirect_uris: ['http://localhost:3009/auth/callback'],
  });

  await createCommand({
    name: 'Test App',
    distribution: 'private',
    redirectUri: ['http://localhost:3009/auth/callback'],
    json: true,
  });

  const stdoutCalls = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
  expect(stdoutCalls).not.toContain('Created with default scopes');
});
```

- [ ] **Step 3.2: Run the tests, confirm they fail**

Run: `yarn jest src/__tests__/commands/app/create.test.ts -t "DEFAULT_SCOPES|scope info line"`
Expected: 3 FAILs — current code still sends `['all']` and never prints the notice.

- [ ] **Step 3.3: Update `src/commands/app/create.ts`**

At the top of the file, change the import line for constants (line 2) to also import `DEFAULT_SCOPES`:

```typescript
import { CLI, DEFAULT_PORT, DEFAULT_REDIRECT_URI, DEFAULT_SCOPES } from '../../lib/constants';
```

Line 181 — change:

```typescript
      scopes: ['all'],
```

to:

```typescript
      scopes: [...DEFAULT_SCOPES],
```

Line 213 — same change inside the 409-retry block:

```typescript
            scopes: [...DEFAULT_SCOPES],
```

After the existing `logSuccess(messages.APP_CREATE_SUCCESS)` call (around line 247), and after the `process.stdout.write('\n')` that closes the credentials block (around line 255), insert the scope notice before the scaffold prompt. Concretely, replace:

```typescript
    resultRedirectUris.forEach((uri, i) => {
      logInfo(`  Redirect URL ${i + 1}: ${uri}`);
    });
    process.stdout.write('\n');

    // 4. Smart hand-off → scaffold
```

with:

```typescript
    resultRedirectUris.forEach((uri, i) => {
      logInfo(`  Redirect URL ${i + 1}: ${uri}`);
    });
    logInfo(`  ${messages.APP_CREATE_SCOPE_NOTICE([...DEFAULT_SCOPES])}`);
    process.stdout.write('\n');

    // 4. Smart hand-off → scaffold
```

The notice sits inside the existing `if (options.json) { ... return; }` guard already covering this section — text-mode only by construction. Verify by reading the surrounding code: the `if (options.json) { ... return; }` block returns before this point (around line 244), so anything printed below it is text-mode-only. No new branch needed.

- [ ] **Step 3.4: Run the tests, confirm they pass**

Run: `yarn jest src/__tests__/commands/app/create.test.ts`
Expected: PASS (new tests green, existing tests still green).

- [ ] **Step 3.5: Run the full suite**

Run: `yarn test`
Expected: all green.

- [ ] **Step 3.6: Commit**

```bash
git add src/commands/app/create.ts src/__tests__/commands/app/create.test.ts
git commit -m "$(cat <<'EOF'
feat(scopes): app create uses DEFAULT_SCOPES and announces them (BEX-197)

New apps are created with the four-scope starter set instead of the
legacy ['all']. After successful creation, the CLI prints a one-line
notice listing the defaults and pointing to \`brevo app update --scope\`.
Suppressed under --json.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `app scaffold` fallback uses `DEFAULT_SCOPES`

**Files:**
- Modify: `src/commands/app/scaffold.ts:179` (change `?? ['all']` to `?? [...DEFAULT_SCOPES]`)
- Test: `src/__tests__/commands/app/scaffold.test.ts` (extend)

- [ ] **Step 4.1: Write the failing test**

Append a test inside the `describe('app/scaffold', ...)` block in `src/__tests__/commands/app/scaffold.test.ts`. This mirrors the existing "should pass cliVersion and minCliVersion into template vars" test (around lines 155–175 in that file), which captures `loadAllTemplates`'s first arg and reads template variables off it:

```typescript
it('falls back to DEFAULT_SCOPES in {{SCOPES_JSON}} when fetched app has no scopes', async () => {
  (appService.resolveAppCredentials as jest.Mock).mockResolvedValue({
    diffs: [],
    app: {
      app_id: '1',
      name: 'Test App',
      client_id: 'cli-123',
      client_secret: 'secret',
      redirect_uris: ['http://localhost:3009/auth/callback'],
      // scopes intentionally omitted to exercise the fallback
    },
  });

  mockPrompt.mockResolvedValueOnce({ outputDir: tmpPath('test-default-scopes') });

  await scaffoldCommand({ appId: '1' });

  const { loadAllTemplates } = require('../../../templates');
  const vars = (loadAllTemplates as jest.Mock).mock.calls[0][0];
  expect(vars['{{SCOPES_JSON}}']).toBe(
    JSON.stringify(['contacts:read', 'contacts:write', 'crm:read', 'crm:write']),
  );
});
```

- [ ] **Step 4.2: Run the test, confirm it fails**

Run: `yarn jest src/__tests__/commands/app/scaffold.test.ts -t "DEFAULT_SCOPES"`
Expected: FAIL — fallback still emits `["all"]`.

- [ ] **Step 4.3: Update `src/commands/app/scaffold.ts`**

Find the imports at the top of `src/commands/app/scaffold.ts` and add `DEFAULT_SCOPES` alongside the existing `OAUTH_BASE`, `OAUTH_REALM`, `MIN_CLI_VERSION` import. The exact import line currently reads:

```typescript
import { OAUTH_BASE, OAUTH_REALM, MIN_CLI_VERSION } from '../../lib/constants';
```

Change to:

```typescript
import { OAUTH_BASE, OAUTH_REALM, MIN_CLI_VERSION, DEFAULT_SCOPES } from '../../lib/constants';
```

Line 179 — change:

```typescript
    const scopes = ctx.appDetails?.scopes ?? ['all'];
```

to:

```typescript
    const scopes = ctx.appDetails?.scopes ?? [...DEFAULT_SCOPES];
```

- [ ] **Step 4.4: Run the test, confirm it passes**

Run: `yarn jest src/__tests__/commands/app/scaffold.test.ts`
Expected: PASS.

- [ ] **Step 4.5: Run the full suite**

Run: `yarn test`
Expected: all green.

- [ ] **Step 4.6: Commit**

```bash
git add src/commands/app/scaffold.ts src/__tests__/commands/app/scaffold.test.ts
git commit -m "$(cat <<'EOF'
feat(scopes): scaffold falls back to DEFAULT_SCOPES instead of 'all' (BEX-197)

The fallback path in app scaffold (when the fetched app details have no
scopes field) now writes the four-scope starter set into the scaffolded
app-config.json. In practice the fallback should not fire — new apps
have explicit scopes — but keeping it aligned with DEFAULT_SCOPES means
no stray ['all'] strings remain.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Extend `updateApp` service signature to accept `scopes`

**Why split from Task 6:** The service is consumed by `update.ts` (Task 6); the type change is mechanical and worth its own commit so the diff stays readable.

**Files:**
- Modify: `src/services/app.ts:140-144` (extend `updateApp` body type)
- Test: `src/__tests__/services/app.test.ts` (extend)

- [ ] **Step 5.1: Write the failing test**

Append inside the `describe('services/app', ...)` block of `src/__tests__/services/app.test.ts`:

```typescript
describe('updateApp', () => {
  it('forwards scopes when present', async () => {
    (mockClient.put as jest.Mock).mockResolvedValue(undefined);
    await service.updateApp('42', {
      name: 'X',
      redirect_uris: ['https://x/cb'],
      scopes: ['contacts:read', 'crm:write'],
    });
    expect(mockClient.put).toHaveBeenCalledWith(
      expect.stringContaining('/v3/app-store/apps/42'),
      {
        name: 'X',
        redirect_uris: ['https://x/cb'],
        scopes: ['contacts:read', 'crm:write'],
      },
    );
  });

  it('omits scopes when undefined (back-compat)', async () => {
    (mockClient.put as jest.Mock).mockResolvedValue(undefined);
    await service.updateApp('42', { name: 'X', redirect_uris: ['https://x/cb'] });
    expect(mockClient.put).toHaveBeenCalledWith(
      expect.stringContaining('/v3/app-store/apps/42'),
      { name: 'X', redirect_uris: ['https://x/cb'] },
    );
  });
});
```

- [ ] **Step 5.2: Run the tests, confirm they fail**

Run: `yarn jest src/__tests__/services/app.test.ts -t "updateApp"`
Expected: TypeScript compile error or test FAIL — the type doesn't allow `scopes`.

- [ ] **Step 5.3: Update the service signature**

In `src/services/app.ts`, change the `updateApp` method (currently lines 140–145) from:

```typescript
    async updateApp(
      appId: string,
      body: { name?: string; redirect_uris: string[] },
    ): Promise<void> {
      await client.put(ENDPOINTS.APP_STORE_APP_UPDATE(appId), body);
    },
```

to:

```typescript
    async updateApp(
      appId: string,
      body: { name?: string; redirect_uris: string[]; scopes?: string[] },
    ): Promise<void> {
      await client.put(ENDPOINTS.APP_STORE_APP_UPDATE(appId), body);
    },
```

The body is already passed straight through to `client.put`; no other code changes are needed for the service to forward `scopes`.

- [ ] **Step 5.4: Run the tests, confirm they pass**

Run: `yarn jest src/__tests__/services/app.test.ts`
Expected: PASS.

- [ ] **Step 5.5: Run the full suite**

Run: `yarn test`
Expected: all green.

- [ ] **Step 5.6: Commit**

```bash
git add src/services/app.ts src/__tests__/services/app.test.ts
git commit -m "$(cat <<'EOF'
feat(scopes): extend updateApp service body to forward scopes (BEX-197)

Optional scopes?: string[] is added to updateApp's body type and
forwarded to PUT /v3/app-store/apps/:id. No existing callers change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Add `--scope` flag to `app update` (append + write-back)

**Files:**
- Modify: `src/commands/app/update.ts` (extend `UpdateOptions`; extend `hasFlags`; add merge + write-back for scopes)
- Modify: `src/commands/definitions.ts` (add `--scope` option to the `update` command; thread through to `updateCommand`)
- Test: `src/__tests__/commands/app/update.test.ts` (extend)

- [ ] **Step 6.1: Write the failing tests**

Append inside the `describe('app/update', ...)` block of `src/__tests__/commands/app/update.test.ts`:

```typescript
describe('--scope flag', () => {
  it('appends new scopes to the app\'s existing scopes, de-duped, preserving order', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(null);
    (appService.fetchApp as jest.Mock).mockResolvedValue({
      app_id: '42',
      name: 'My App',
      redirect_uris: ['https://x/cb'],
      scopes: ['contacts:read', 'crm:read'],
    });

    await updateCommand({
      appId: '42',
      scope: ['crm:read', 'crm:write'], // crm:read already present, crm:write new
      yes: true,
    });

    expect(appService.updateApp).toHaveBeenCalledWith(
      '42',
      expect.objectContaining({
        scopes: ['contacts:read', 'crm:read', 'crm:write'],
      }),
    );
  });

  it('writes merged scopes back to app-config.json when config is the source', async () => {
    const config = {
      appId: '42',
      appName: 'My App',
      auth: {
        type: 'private',
        scopes: ['contacts:read'],
        redirectUrls: ['https://x/cb'],
      },
      distribution: 'private',
    };
    (readProjectConfig as jest.Mock).mockReturnValue(config);

    await updateCommand({ scope: ['crm:write'], yes: true });

    const writeArg = (writeProjectConfig as jest.Mock).mock.calls[0][0];
    expect(writeArg.auth.scopes).toEqual(['contacts:read', 'crm:write']);
  });

  it('coexists with --name and --redirect-uri in a single call', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(null);
    (appService.fetchApp as jest.Mock).mockResolvedValue({
      app_id: '42',
      name: 'Old',
      redirect_uris: ['https://x/old'],
      scopes: ['contacts:read'],
    });

    await updateCommand({
      appId: '42',
      name: 'New',
      redirectUri: ['https://x/new'],
      scope: ['crm:read'],
      yes: true,
    });

    expect(appService.updateApp).toHaveBeenCalledWith('42', {
      name: 'New',
      redirect_uris: ['https://x/old', 'https://x/new'],
      scopes: ['contacts:read', 'crm:read'],
    });
  });

  it('treats --scope as a flag that satisfies hasFlags (no "nothing to update" error)', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(null);
    (appService.fetchApp as jest.Mock).mockResolvedValue({
      app_id: '42',
      name: 'X',
      redirect_uris: ['https://x/cb'],
      scopes: [],
    });

    await expect(
      updateCommand({ appId: '42', scope: ['crm:read'], yes: true }),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 6.2: Run the tests, confirm they fail**

Run: `yarn jest src/__tests__/commands/app/update.test.ts -t "--scope flag"`
Expected: 4 FAILs — option not wired, scopes never sent.

- [ ] **Step 6.3: Extend the `update.ts` handler**

Open `src/commands/app/update.ts`.

**6.3a — Extend `UpdateOptions`** (currently at lines 15–21):

```typescript
interface UpdateOptions {
  appId?: string;
  name?: string;
  redirectUri?: string[];
  scope?: string[];
  yes?: boolean;
  json?: boolean;
}
```

**6.3b — Extend `hasFlags`** (currently at lines 25–28):

```typescript
  const hasFlags = !!(
    options.name !== undefined ||
    (options.redirectUri && options.redirectUri.length > 0) ||
    (options.scope && options.scope.length > 0)
  );
```

**6.3c — Read existing scopes alongside existing redirect URLs.** Locate the block at lines 162–184 that resolves `existingName` / `existingRedirectUrls`. Extend each branch to also resolve `existingScopes`. Replace the whole block:

```typescript
  let existingName: string | undefined;
  let existingRedirectUrls: string[] = [];

  const configRedirectUrls = config?.auth?.redirectUrls;
  const hasUsableConfigRedirectUrls =
    Array.isArray(configRedirectUrls) && configRedirectUrls.length > 0;

  if (config && shouldWriteBack && hasUsableConfigRedirectUrls) {
    existingName = config.appName;
    existingRedirectUrls = configRedirectUrls;
  } else if (config && shouldWriteBack) {
    const app = await fetchExistingApp(appId, options.json);
    existingName = config.appName ?? app.name;
    existingRedirectUrls = app.redirect_uris ?? [];
  } else {
    const app = await fetchExistingApp(appId, options.json);
    existingName = app.name;
    existingRedirectUrls = app.redirect_uris ?? [];
  }
```

with:

```typescript
  let existingName: string | undefined;
  let existingRedirectUrls: string[] = [];
  let existingScopes: string[] = [];

  const configRedirectUrls = config?.auth?.redirectUrls;
  const hasUsableConfigRedirectUrls =
    Array.isArray(configRedirectUrls) && configRedirectUrls.length > 0;

  if (config && shouldWriteBack && hasUsableConfigRedirectUrls) {
    existingName = config.appName;
    existingRedirectUrls = configRedirectUrls;
    existingScopes = config.auth?.scopes ?? [];
  } else if (config && shouldWriteBack) {
    const app = await fetchExistingApp(appId, options.json);
    existingName = config.appName ?? app.name;
    existingRedirectUrls = app.redirect_uris ?? [];
    existingScopes = config.auth?.scopes ?? app.scopes ?? [];
  } else {
    const app = await fetchExistingApp(appId, options.json);
    existingName = app.name;
    existingRedirectUrls = app.redirect_uris ?? [];
    existingScopes = app.scopes ?? [];
  }
```

**6.3d — Merge scopes.** Immediately after the existing `mergedUrls` block (around lines 188–194), add the scopes merge:

```typescript
  const appendedScopes = options.scope ?? [];
  const mergedScopes = [...existingScopes];
  for (const s of appendedScopes) {
    if (!mergedScopes.includes(s)) {
      mergedScopes.push(s);
    }
  }
  const hasScopeFlag = options.scope !== undefined;
```

**6.3e — Send scopes to the API.** Replace the `await appService.updateApp(appId, { name: finalName, redirect_uris: mergedUrls });` call (around line 237) with:

```typescript
  await appService.updateApp(appId, {
    name: finalName,
    redirect_uris: mergedUrls,
    ...(hasScopeFlag ? { scopes: mergedScopes } : {}),
  });
```

The `...(hasScopeFlag ? { scopes: mergedScopes } : {})` shape means we only put a `scopes` key in the body when the user used `--scope`. If they didn't, the body is unchanged from today.

**6.3f — Write merged scopes back to `app-config.json`.** In the existing write-back block (around lines 245–256), extend `updatedConfig.auth` to also persist the merged scopes when `--scope` was used:

```typescript
  if (shouldWriteBack && config) {
    const updatedConfig = { ...config };
    if (options.name) {
      updatedConfig.appName = options.name;
    }
    updatedConfig.auth = {
      ...updatedConfig.auth,
      redirectUrls: mergedUrls,
      ...(hasScopeFlag ? { scopes: mergedScopes } : {}),
    };
    writeProjectConfig(updatedConfig);
  }
```

**6.3g — Print scope summary in text mode.** Right after the existing `logInfo(\`  Redirect URLs: …\`)` line (around line 267), add:

```typescript
  if (hasScopeFlag) {
    logInfo(`  Scopes:        ${mergedScopes.length > 0 ? mergedScopes.join(', ') : '(none)'}`);
  }
```

- [ ] **Step 6.4: Register `--scope` in `definitions.ts`**

In `src/commands/definitions.ts`, find the `update` command (around line 117). Add a new option immediately after the `--redirect-uri` option:

```typescript
        {
          flags: '--scope <scope>',
          description: 'OAuth scope to append (repeatable)',
          parser: (value: string, prev?: string[]) => (prev ? [...prev, value] : [value]),
        },
```

Update the handler call to forward the new option. Change (around line 143):

```typescript
      handler: (opts) =>
        updateCommand({
          appId: opts.appId,
          name: opts.name,
          redirectUri: opts.redirectUri,
          yes: Boolean(opts.yes),
          json: Boolean(opts.json),
        }),
```

to:

```typescript
      handler: (opts) =>
        updateCommand({
          appId: opts.appId,
          name: opts.name,
          redirectUri: opts.redirectUri,
          scope: opts.scope as string[] | undefined,
          yes: Boolean(opts.yes),
          json: Boolean(opts.json),
        }),
```

Add an example line to the `update` command's `examples` array:

```typescript
        'brevo app update --scope crm:write',
        'brevo app update --scope contacts:read --scope crm:write',
```

- [ ] **Step 6.5: Run the tests, confirm they pass**

Run: `yarn jest src/__tests__/commands/app/update.test.ts`
Expected: PASS (new tests green, existing tests still green).

- [ ] **Step 6.6: Run the full suite**

Run: `yarn test`
Expected: all green.

- [ ] **Step 6.7: Commit**

```bash
git add src/commands/app/update.ts src/commands/definitions.ts src/__tests__/commands/app/update.test.ts
git commit -m "$(cat <<'EOF'
feat(scopes): brevo app update --scope appends scopes (BEX-197)

New repeatable --scope flag merges into the app's existing scope set,
de-duped, order-preserving. Mirrors --redirect-uri exactly: resolves
current scopes from app-config.json when it matches the target app,
otherwise from the API; sends scopes in the PUT body only when --scope
is used; writes back to app-config.json when config was the source.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Create `services/oauth-metadata.ts` (`fetchSupportedScopes`)

**Files:**
- Create: `src/services/oauth-metadata.ts`
- Test: `src/__tests__/services/oauth-metadata.test.ts` (new)

- [ ] **Step 7.1: Write the failing tests**

Create `src/__tests__/services/oauth-metadata.test.ts`:

```typescript
import { fetchSupportedScopes } from '../../services/oauth-metadata';
import { OAUTH_WELL_KNOWN_URL } from '../../lib/constants';
import { ApiError, CliError } from '../../lib/errors';

const mockFetch = jest.fn();
globalThis.fetch = mockFetch as unknown as typeof fetch;

describe('fetchSupportedScopes', () => {
  beforeEach(() => mockFetch.mockReset());

  it('returns scopes_supported on a 200 response', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          scopes_supported: ['contacts:read', 'crm:write', 'offline_access'],
        }),
    });

    const scopes = await fetchSupportedScopes();
    expect(mockFetch).toHaveBeenCalledWith(OAUTH_WELL_KNOWN_URL, expect.any(Object));
    expect(scopes).toEqual(['contacts:read', 'crm:write', 'offline_access']);
  });

  it('throws ApiError on non-2xx', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503, json: () => Promise.resolve({}) });
    await expect(fetchSupportedScopes()).rejects.toBeInstanceOf(ApiError);
  });

  it('throws ApiError on network failure', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(fetchSupportedScopes()).rejects.toBeInstanceOf(ApiError);
  });

  it('throws CliError when scopes_supported is missing', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ issuer: 'https://x' }),
    });
    await expect(fetchSupportedScopes()).rejects.toBeInstanceOf(CliError);
  });

  it('throws CliError when scopes_supported is not an array of strings', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ scopes_supported: 'all' }),
    });
    await expect(fetchSupportedScopes()).rejects.toBeInstanceOf(CliError);
  });
});
```

- [ ] **Step 7.2: Run the tests, confirm they fail**

Run: `yarn jest src/__tests__/services/oauth-metadata.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 7.3: Implement `src/services/oauth-metadata.ts`**

```typescript
import { OAUTH_WELL_KNOWN_URL } from '../lib/constants';
import { ApiError, CliError, ErrorCode } from '../lib/errors';
import { messages } from '../lang/en';

export async function fetchSupportedScopes(): Promise<string[]> {
  let response: Response;
  try {
    response = await fetch(OAUTH_WELL_KNOWN_URL, { method: 'GET' });
  } catch {
    // Status 0 maps to EXIT_CODES.NETWORK_ERROR via statusToExitCode in errors.ts.
    throw new ApiError(
      messages.OAUTH_METADATA_FETCH_FAILED(OAUTH_WELL_KNOWN_URL, 0),
      0,
      ErrorCode.NETWORK_ERROR,
    );
  }

  if (!response.ok) {
    throw new ApiError(
      messages.OAUTH_METADATA_FETCH_FAILED(OAUTH_WELL_KNOWN_URL, response.status),
      response.status,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new CliError(messages.OAUTH_METADATA_MISSING_SCOPES);
  }

  if (
    !body ||
    typeof body !== 'object' ||
    !Array.isArray((body as Record<string, unknown>).scopes_supported) ||
    !((body as Record<string, unknown>).scopes_supported as unknown[]).every(
      (s) => typeof s === 'string',
    )
  ) {
    throw new CliError(messages.OAUTH_METADATA_MISSING_SCOPES);
  }

  return (body as { scopes_supported: string[] }).scopes_supported;
}
```

The `ApiError` constructor is `(message: string, statusCode: number, errorCode?: ErrorCode, apiCode?: string)` per `src/lib/errors.ts:41-50`. Status `0` is treated as a network error by `statusToExitCode`, so the network-failure branch passes `0` and `ErrorCode.NETWORK_ERROR`.

- [ ] **Step 7.4: Run the tests, confirm they pass**

Run: `yarn jest src/__tests__/services/oauth-metadata.test.ts`
Expected: PASS.

- [ ] **Step 7.5: Run the full suite**

Run: `yarn test`
Expected: all green.

- [ ] **Step 7.6: Commit**

```bash
git add src/services/oauth-metadata.ts src/__tests__/services/oauth-metadata.test.ts
git commit -m "$(cat <<'EOF'
feat(scopes): add fetchSupportedScopes service (BEX-197)

Reads scopes_supported from the IdP well-known endpoint
(oauth.brevo.com/realms/partner/.well-known/oauth-authorization-server).
Throws ApiError on transport/status failures and CliError when the
response is missing or malformed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Create `commands/app/scopes.ts`

**Files:**
- Create: `src/commands/app/scopes.ts`
- Test: `src/__tests__/commands/app/scopes.test.ts` (new)

- [ ] **Step 8.1: Write the failing tests**

Create `src/__tests__/commands/app/scopes.test.ts`:

```typescript
import { scopesCommand } from '../../../commands/app/scopes';

jest.mock('../../../services/oauth-metadata', () => ({
  fetchSupportedScopes: jest.fn(),
}));

import { fetchSupportedScopes } from '../../../services/oauth-metadata';

describe('app/scopes', () => {
  let stdoutSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    jest.clearAllMocks();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it('prints one scope per line in text mode', async () => {
    (fetchSupportedScopes as jest.Mock).mockResolvedValue([
      'contacts:read',
      'crm:write',
      'offline_access',
    ]);

    await scopesCommand({});

    const out = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(out).toContain('contacts:read');
    expect(out).toContain('crm:write');
    expect(out).toContain('offline_access');
    // One per line: at least three newlines for three scopes.
    const lines = out.split('\n').filter((l) => l.trim().length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(3);
  });

  it('emits { scopes: [...] } under --json', async () => {
    (fetchSupportedScopes as jest.Mock).mockResolvedValue(['contacts:read', 'crm:write']);

    await scopesCommand({ json: true });

    const out = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    const lastJsonLine = out.split('\n').reverse().find((l) => l.trim().startsWith('{'));
    expect(lastJsonLine).toBeDefined();
    expect(JSON.parse(lastJsonLine!)).toEqual({
      scopes: ['contacts:read', 'crm:write'],
    });
  });

  it('prints the empty-scopes message in text mode when the registry is empty', async () => {
    (fetchSupportedScopes as jest.Mock).mockResolvedValue([]);

    await scopesCommand({});

    const out = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(out.toLowerCase()).toContain('empty');
  });

  it('surfaces errors thrown by fetchSupportedScopes', async () => {
    (fetchSupportedScopes as jest.Mock).mockRejectedValue(new Error('boom'));
    await expect(scopesCommand({})).rejects.toThrow('boom');
  });
});
```

- [ ] **Step 8.2: Run the tests, confirm they fail**

Run: `yarn jest src/__tests__/commands/app/scopes.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 8.3: Implement `src/commands/app/scopes.ts`**

```typescript
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { logInfo } from '../../lib/logger';
import { messages } from '../../lang/en';
import { fetchSupportedScopes } from '../../services/oauth-metadata';

interface ScopesOptions {
  json?: boolean;
}

export const scopesCommand = withCommandHandler(
  async (options: ScopesOptions): Promise<void> => {
    const scopes = await fetchSupportedScopes();

    if (options.json) {
      jsonOutput({ scopes });
      return;
    }

    if (scopes.length === 0) {
      logInfo(messages.APP_SCOPES_EMPTY);
      return;
    }

    for (const scope of scopes) {
      logInfo(scope);
    }
  },
);
```

- [ ] **Step 8.4: Run the tests, confirm they pass**

Run: `yarn jest src/__tests__/commands/app/scopes.test.ts`
Expected: PASS.

- [ ] **Step 8.5: Run the full suite**

Run: `yarn test`
Expected: all green.

- [ ] **Step 8.6: Commit**

```bash
git add src/commands/app/scopes.ts src/__tests__/commands/app/scopes.test.ts
git commit -m "$(cat <<'EOF'
feat(scopes): add brevo app scopes command (BEX-197)

Prints the IdP's scopes_supported. Text mode: one scope per line.
--json mode: { scopes: string[] }. Empty registry prints a static
notice. Errors from fetchSupportedScopes propagate through
withCommandHandler.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Register `app scopes` in `definitions.ts`

**Files:**
- Modify: `src/commands/definitions.ts` (import the new command, add it to `appCommandGroup.commands`)

- [ ] **Step 9.1: Write a failing test**

Append a new test file `src/__tests__/commands/definitions.test.ts` if it does not already exist:

```bash
test -f src/__tests__/commands/definitions.test.ts && echo EXISTS || echo MISSING
```

If MISSING, create it with:

```typescript
import { appCommandGroup } from '../../commands/definitions';

describe('appCommandGroup', () => {
  it('registers the scopes command', () => {
    const names = appCommandGroup.commands.map((c) => c.name);
    expect(names).toContain('scopes');
  });

  it('scopes command supports --json', () => {
    const cmd = appCommandGroup.commands.find((c) => c.name === 'scopes');
    expect(cmd).toBeDefined();
    const flags = (cmd!.options ?? []).map((o) => o.flags);
    expect(flags).toContain('--json');
  });
});
```

If EXISTS, append the two `it(...)` blocks above to its existing top-level describe.

- [ ] **Step 9.2: Run the test, confirm it fails**

Run: `yarn jest src/__tests__/commands/definitions.test.ts`
Expected: FAIL — `scopes` not in the command list.

- [ ] **Step 9.3: Register the command**

In `src/commands/definitions.ts`, add an import next to the existing app-command imports (around lines 8–14):

```typescript
import { scopesCommand } from './app/scopes';
```

In `appCommandGroup.commands`, add a new entry — place it after `scaffold` and before `start` (around lines 186–187, depending on how the file looks after Task 6's example additions):

```typescript
    {
      name: 'scopes',
      description: 'List OAuth scopes supported by the IdP',
      examples: ['brevo app scopes', 'brevo app scopes --json'],
      options: [{ flags: '--json', description: 'Output as JSON' }],
      handler: (opts) => scopesCommand({ json: Boolean(opts.json) }),
    },
```

- [ ] **Step 9.4: Run the test, confirm it passes**

Run: `yarn jest src/__tests__/commands/definitions.test.ts`
Expected: PASS.

- [ ] **Step 9.5: Smoke-test the wired CLI end-to-end**

Run: `yarn build && node dist/bin/index.js app scopes --help`
Expected: prints commander help text including `--json` and the two example invocations. Exit code 0.

Then, with the IdP reachable on the local network, run: `node dist/bin/index.js app scopes`
Expected: prints `contacts:read`, `contacts:write`, `crm:read`, `crm:write`, `offline_access`, etc. (whatever the live IdP returns). If you have no network/IdP access in this environment, skip this step and note it in the commit body.

- [ ] **Step 9.6: Run the full suite**

Run: `yarn test`
Expected: all green.

- [ ] **Step 9.7: Commit**

```bash
git add src/commands/definitions.ts src/__tests__/commands/definitions.test.ts
git commit -m "$(cat <<'EOF'
feat(scopes): register brevo app scopes command (BEX-197)

Wires src/commands/app/scopes.ts into the app command group so
\`brevo app scopes [--json]\` is discoverable from \`brevo app --help\`.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Update agent docs (`SKILL.md` + `AGENTS.md`)

**Why this is a separate task:** CLAUDE.md treats out-of-sync agent docs as worse than no docs, and the rule is "update in the same PR as user-visible CLI behavior." This task lands them as one focused commit.

**Files:**
- Modify: `agent-context/SKILL.md`
- Modify: `agent-context/AGENTS.md`

- [ ] **Step 10.1: Update `agent-context/SKILL.md` — decision tree entries**

Find lines 43–44 (the "Create an app" and "Update app metadata" entries). Replace them with:

```markdown
- "Create an app" → `brevo app create --name "<name>" --distribution private --redirect-uri <url> --json` (new apps default to scopes `contacts:read`, `contacts:write`, `crm:read`, `crm:write`)
- "Update app metadata" → `brevo app update --app-id <id> --name "<name>"` and/or `--redirect-uri <url>` (repeatable) and/or `--scope <scope>` (repeatable, appends)
```

Immediately after line 48 (the "Delete an app" entry), insert a new entry for `app scopes`:

```markdown
- "List supported OAuth scopes" → `brevo app scopes --json`
```

- [ ] **Step 10.2: Update `agent-context/SKILL.md` — new section on scopes**

After the "Locating the linked app" section (around line 62), insert a new section before "Exit codes":

```markdown
## Scopes

- New apps created via `brevo app create` default to `contacts:read`, `contacts:write`, `crm:read`, `crm:write`. The CLI prints the default set on success and points to `brevo app update --scope` for changes.
- `brevo app update --scope <scope>` is **repeatable and appends** — passing `--scope X --scope Y` adds both to the app's existing scope set, de-duped, order-preserving. To see what's currently set, run `brevo app credentials --app-id <id> --json`. To remove a scope, edit `app-config.json` and run `brevo app update` without `--scope`.
- `brevo app scopes [--json]` lists the OAuth scopes the IdP currently supports. The CLI does **not** validate `--scope` values locally — the server is the source of truth. Use `app scopes` to confirm spelling before passing an unfamiliar scope.

```

- [ ] **Step 10.3: Update `agent-context/AGENTS.md` — Common commands table**

In the table at lines 60–75, modify the `app create` and `app update` rows, and add a new `app scopes` row. Replace lines 67–68:

```markdown
| `brevo app create` | Create an app (`--name`, `--distribution`, `--redirect-uri`, `--json`). Defaults to scopes `contacts:read`, `contacts:write`, `crm:read`, `crm:write`. |
| `brevo app update` | Update name / redirect URLs / scopes (`--app-id`, `--name`, `--redirect-uri`, `--scope` repeatable appends, `--yes`, `--json`) |
```

Immediately after line 72 (the `brevo app start oauth` row), insert:

```markdown
| `brevo app scopes` | List OAuth scopes supported by the IdP (`--json`) |
```

- [ ] **Step 10.4: Update `agent-context/AGENTS.md` — add a Scopes section**

After the "Conventions" section (the last line is the exit-codes bullet at line 85), insert a new section before "Environment variables":

```markdown
## Scopes

- New apps created via `brevo app create` default to `contacts:read`, `contacts:write`, `crm:read`, `crm:write`. The CLI prints these on success.
- `brevo app update --scope <scope>` is repeatable and appends, mirroring `--redirect-uri`. De-duped, order-preserving. Writes back to `app-config.json` when that file describes the target app.
- `brevo app scopes [--json]` prints the IdP's `scopes_supported` catalog. The CLI does **not** validate `--scope` values client-side — server returns 400 on unknown scopes.

```

- [ ] **Step 10.5: Cross-check the two files**

Run: `diff <(grep -E "scope|default" -i agent-context/SKILL.md) <(grep -E "scope|default" -i agent-context/AGENTS.md)`
Expected: differences are limited to formatting (SKILL.md uses prose bullets, AGENTS.md uses a table row) and the AGENTS.md-only mention of non-Claude install. No diff line should imply one file has a feature the other doesn't.

- [ ] **Step 10.6: Run the full suite**

Run: `yarn test`
Expected: all green (no behavior change, but the suite is the contract gate).

- [ ] **Step 10.7: Commit**

```bash
git add agent-context/SKILL.md agent-context/AGENTS.md
git commit -m "$(cat <<'EOF'
docs(agents): document granular scopes in SKILL.md and AGENTS.md (BEX-197)

Mirrors the new CLI surface in both agent-facing references: default
scope set on create, --scope append flag on update, new
\`brevo app scopes\` command.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Add changeset

**Files:**
- Create: `.changeset/granular-oauth-scopes.md`

- [ ] **Step 11.1: Write the changeset file**

```markdown
---
'@getbrevo/cli': minor
---

Granular OAuth scopes (BEX-197):

- `brevo app create` now creates apps with `contacts:read`, `contacts:write`, `crm:read`, `crm:write` instead of the legacy `all`. The CLI prints a one-line notice listing the defaults and how to change them.
- `brevo app update --scope <scope>` (new, repeatable) appends scopes to an app's existing set, de-duped, order-preserving. Writes back to `app-config.json` when applicable.
- `brevo app scopes [--json]` (new) prints the IdP's supported-scopes catalog.
```

- [ ] **Step 11.2: Verify the changeset is well-formed**

Run: `yarn changeset status`
Expected: lists `@getbrevo/cli` with the new minor change.

- [ ] **Step 11.3: Commit**

```bash
git add .changeset/granular-oauth-scopes.md
git commit -m "$(cat <<'EOF'
chore(changeset): minor bump for granular OAuth scopes (BEX-197)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Post-flight (do once, after Task 11)

- [ ] **Step F1: Full test suite green**

Run: `yarn test`
Expected: all green.

- [ ] **Step F2: Lint clean**

Run: `yarn lint && yarn format:check`
Expected: no errors.

- [ ] **Step F3: Build clean**

Run: `yarn build`
Expected: tsc + template copy succeeds, no errors.

- [ ] **Step F4: Manual smoke (only if you have a logged-in CLI and a non-prod org)**

```bash
node dist/bin/index.js app scopes
node dist/bin/index.js app scopes --json
# Create a throwaway app and verify the defaults + notice are emitted.
```

Skip if no test account is available. Note the skip in the PR description.

- [ ] **Step F5: Open PR**

Push the branch and open a PR via `gh pr create`. PR title: `feat(scopes): granular OAuth scopes (BEX-197)`. The PR body should be safe to publish — reference BEX-197 by key only, don't restate private context. List the new surface (defaults, `--scope`, `app scopes`) and the non-goals.

---

## Spec ↔ plan coverage map

| Spec section / decision | Task |
|---|---|
| D1: default scopes are the locked four-scope set | T1 (constant), T3 (create site) |
| D2: no `--scope` flag on `create` | T3 (negative — confirmed by absence) |
| D3: `--scope` repeatable, appends, de-duped | T6 |
| D4: registry source = IdP well-known | T7 |
| D5: exposure = `brevo app scopes` (+ `--json`) | T8, T9 |
| D6: pass-through (no client-side validation) | T6, T8 (neither validates) |
| D7: info line on `create`, suppressed under `--json` | T3 |
| Scaffold fallback no longer `['all']` | T4 |
| `updateApp` service forwards scopes | T5 |
| Agent docs in sync | T10 |
| Changeset | T11 |
