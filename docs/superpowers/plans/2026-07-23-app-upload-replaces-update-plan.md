# BEX-250: `brevo app upload` Replaces `brevo app update` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove `brevo app update` entirely and replace it with `brevo app upload` — a config-only, no-flags command that always fetches the remote app state, renders a local-vs-server diff, and (unless already up to date) pushes the full local `app-config.json` to `POST /v3/app-store/apps/{appId}/upload`, writing the server-confirmed state back on success.

**Architecture:** New `src/commands/app/upload.ts` replaces `src/commands/app/update.ts` (deleted). New `uploadApp()` on the `appService` (in `src/services/app.ts`) POSTs to a new `ENDPOINTS.APP_STORE_APP_UPLOAD` endpoint with a dedicated `UploadAppPayload`/`UploadAppResponse` wire shape (distinct field names from `OAuthApp` — `app_version`, `auth.distribution_type`, `auth.redirect_urls`). `definitions.ts`/`constants.ts` swap the `update` command entry for `upload`. Roughly a dozen existing messages across `en.ts` that told users to run `brevo app update --scope`/`--redirect-uri` get reworded to point at editing `app-config.json` + running `upload` instead, since `upload` has no edit flags.

**Tech Stack:** TypeScript, Jest/ts-jest, inquirer, this repo's existing `ApiClient`/`appService` patterns.

**Spec:** `docs/superpowers/specs/2026-07-23-app-upload-replaces-update-design.md`

---

## Task 1: Types, constants, and `uploadApp()` service method

**Files:**
- Modify: `src/types.ts`
- Modify: `src/lib/constants.ts`
- Modify: `src/services/app.ts`
- Test: `src/__tests__/services/app.test.ts`
- Test: `src/__tests__/lib/constants.test.ts`

- [ ] **Step 1: Add `UploadAppPayload`/`UploadAppResponse` to `src/types.ts`**

Add at the end of the file:

```ts
// Wire shape for POST /v3/app-store/apps/{app_id}/upload — deliberately
// distinct from OAuthApp: distribution_type nests under auth (OAuthApp keeps
// it top-level), the version field is named app_version (not version), and
// redirect URLs are redirect_urls (not redirect_uris like every other
// endpoint). These are confirmed, intentional quirks of this one endpoint —
// do not "fix" them to match OAuthApp's naming.
export interface UploadAppPayload {
  app_id: string;
  name: string;
  logo_uri: string;
  app_version: string;
  auth: {
    distribution_type: 'public' | 'private';
    scopes: string[];
    redirect_urls: string[];
  };
}

export interface UploadAppResponse {
  app_id: string;
  name: string;
  logo_uri?: string;
  app_version?: string;
  auth: {
    distribution_type?: 'public' | 'private';
    scopes?: string[];
    redirect_urls?: string[];
  };
}
```

- [ ] **Step 2: Add the upload endpoint to `src/lib/constants.ts`**

In the `ENDPOINTS` object, right after `APP_STORE_APP`, add:

```ts
  APP_STORE_APP_UPLOAD: (appId: string) => `/v3/app-store/apps/${encodeURIComponent(appId)}/upload`,
```

In the `CLI` object, replace:

```ts
  APP_UPDATE: 'brevo app update',
```

with:

```ts
  APP_UPLOAD: 'brevo app upload',
```

and delete this line entirely (no replacement — `upload` has no `--scope` flag):

```ts
  APP_UPDATE_SCOPE: 'brevo app update --scope',
```

- [ ] **Step 3: Update `src/__tests__/lib/constants.test.ts`**

Change:

```ts
    expect(CLI.APP_UPDATE).toBe('brevo app update');
```

to:

```ts
    expect(CLI.APP_UPLOAD).toBe('brevo app upload');
```

Delete the test `'exposes APP_SCOPES and APP_UPDATE_SCOPE strings'` (around line 191) entirely — no `APP_UPDATE_SCOPE` replacement exists. If that test also asserts `CLI.APP_SCOPES` (check the actual test body), keep an assertion for `CLI.APP_SCOPES` in a separate test (or rename this test to drop only the `APP_UPDATE_SCOPE` assertion) rather than losing `APP_SCOPES` coverage — read the actual test body first to decide precisely.

- [ ] **Step 4: Add `uploadApp()` to `src/services/app.ts`**

Add the import at the top:

```ts
import { OAuthApp, CreateAppResponse, UploadAppPayload, UploadAppResponse } from '../types';
```

(This likely already imports `OAuthApp, CreateAppResponse` — extend that existing import line rather than duplicating it.)

Add the method to the returned object, directly after `updateApp`:

```ts
    async uploadApp(appId: string, payload: UploadAppPayload): Promise<UploadAppResponse> {
      return client.post<UploadAppResponse>(ENDPOINTS.APP_STORE_APP_UPLOAD(appId), {
        ...payload,
        cli_version: CLI_VERSION,
      });
    },
```

- [ ] **Step 5: Add tests for `uploadApp` in `src/__tests__/services/app.test.ts`**

Add a new `describe` block after `describe('updateApp', ...)`:

```ts
  describe('uploadApp', () => {
    it('should POST to the upload endpoint with the full payload plus cli_version', async () => {
      const response = {
        app_id: UUID,
        name: 'Test App',
        logo_uri: '',
        app_version: '0.0.2',
        auth: {
          distribution_type: 'private',
          scopes: ['contacts:read'],
          redirect_urls: ['http://localhost:3010/auth/callback'],
        },
      };
      (mockClient.post as jest.Mock).mockResolvedValue(response);

      const result = await service.uploadApp(UUID, {
        app_id: UUID,
        name: 'Test App',
        logo_uri: '',
        app_version: '0.0.2',
        auth: {
          distribution_type: 'private',
          scopes: ['contacts:read'],
          redirect_urls: ['http://localhost:3010/auth/callback'],
        },
      });

      expect(mockClient.post).toHaveBeenCalledWith(`/v3/app-store/apps/${UUID}/upload`, {
        app_id: UUID,
        name: 'Test App',
        logo_uri: '',
        app_version: '0.0.2',
        auth: {
          distribution_type: 'private',
          scopes: ['contacts:read'],
          redirect_urls: ['http://localhost:3010/auth/callback'],
        },
        cli_version: CLI_VERSION,
      });
      expect(result).toEqual(response);
    });

    it('should propagate API errors (e.g. app_version_outdated rejections)', async () => {
      (mockClient.post as jest.Mock).mockRejectedValue(new Error('app_version_outdated'));
      await expect(
        service.uploadApp('42', {
          app_id: '42',
          name: 'X',
          logo_uri: '',
          app_version: '0.0.1',
          auth: { distribution_type: 'private', scopes: [], redirect_urls: [] },
        }),
      ).rejects.toThrow('app_version_outdated');
    });
  });
```

- [ ] **Step 6: Run the affected test files**

Run: `yarn test src/__tests__/services/app.test.ts src/__tests__/lib/constants.test.ts`
Expected: PASS.

- [ ] **Step 7: Build**

Run: `yarn build`
Expected: Errors remain elsewhere (`definitions.ts` still imports the now-half-renamed `CLI.APP_UPDATE`, `update.ts` still exists unchanged) — that's expected, later tasks fix those. Confirm no NEW errors originate from `types.ts`/`constants.ts`/`app.ts` themselves.

- [ ] **Step 8: Commit**

```bash
git add src/types.ts src/lib/constants.ts src/services/app.ts src/__tests__/services/app.test.ts src/__tests__/lib/constants.test.ts
git commit -m "feat: add uploadApp service method and upload endpoint constants"
```

---

## Task 2: `en.ts` — new upload messages, removed update messages, reworded ripple messages

**Files:**
- Modify: `src/lang/en.ts`
- Modify: `src/__tests__/lang/en.test.ts`

- [ ] **Step 1: Remove the `// App update` message block**

Delete these keys entirely (all currently under the `// App update` comment):

```
APP_UPDATE_INVALID_JSON
APP_UPDATE_MISSING_APP_ID
APP_UPDATE_NO_REDIRECT_URLS
APP_UPDATE_INVALID_APP_ID
APP_UPDATE_INVALID_REDIRECT_URL
APP_UPDATE_INVALID_REDIRECT_PROTOCOL
APP_UPDATE_SUMMARY
APP_UPDATE_CONFIRM
APP_UPDATE_CANCELLED
APP_UPDATE_SUCCESS
APP_UPDATE_NOTHING_TO_UPDATE
APP_UPDATE_NO_APP_RESOLVED
APP_UPDATE_APP_ID_MISMATCH
APP_UPDATE_SCOPES_APPENDED
```

- [ ] **Step 2: Add the `// App upload` message block**

In its place, add:

```ts
  // App upload
  APP_UPLOAD_NO_CONFIG: `No app-config.json found in this directory. Run \`${CLI.APP_UPLOAD}\` from the project directory that has your app's app-config.json, or run \`${CLI.APP_CREATE}\` / \`${CLI.APP_SCAFFOLD()}\` to set one up.`,
  APP_UPLOAD_INVALID_JSON: `app-config.json contains invalid JSON. Fix the file, or run \`${CLI.APP_SCAFFOLD()}\` to regenerate it.`,
  APP_UPLOAD_MISSING_APP_ID: `app-config.json is missing "appId". Fix the file, or run \`${CLI.APP_SCAFFOLD()}\` to regenerate it.`,
  APP_UPLOAD_NO_REDIRECT_URLS: 'app-config.json has no redirect URLs configured.',
  APP_UPLOAD_INVALID_REDIRECT_URL: (url: string) =>
    `Invalid redirect URL "${url}". Must be a valid http:// or https:// URL.`,
  APP_UPLOAD_INVALID_REDIRECT_PROTOCOL: (url: string) =>
    `Invalid redirect URL "${url}". Must use http:// or https://.`,
  APP_UPLOAD_SUMMARY: 'Upload summary:',
  APP_UPLOAD_CONFIRM: 'Proceed with upload?',
  APP_UPLOAD_CANCELLED: 'Upload cancelled.',
  APP_UPLOAD_SUCCESS: 'App uploaded.',
  APP_UPLOAD_UP_TO_DATE: (version: string) => `Already up to date at version ${version}.`,
```

- [ ] **Step 3: Reword the 11 ripple messages**

None of these are deleted — only their text changes, since `upload` has no flags to reference. Find each by its current key and replace the flag-based instruction with an edit-`app-config.json`-and-run-`upload` instruction:

`APP_CREATE_BOX_SCOPE_HINT` — change:
```ts
  APP_CREATE_BOX_SCOPE_HINT: `You can add more scopes later with: ${CLI.APP_UPDATE_SCOPE} <scope>`,
```
to:
```ts
  APP_CREATE_BOX_SCOPE_HINT: `You can add more scopes later by editing \`auth.scopes\` in app-config.json and running \`${CLI.APP_UPLOAD}\`.`,
```

`LEGACY_ALL_SCOPE_DEPRECATED_BLOCK` — change:
```ts
  LEGACY_ALL_SCOPE_DEPRECATED_BLOCK: `This app currently has the legacy 'all' OAuth scope, which is being deprecated.\n  Replace 'all' with the specific scopes your integration uses (if you keep an app-config.json, edit auth.scopes there too).\n  Run \`${CLI.APP_SCOPES}\` to see the catalog, then re-run \`${CLI.APP_UPDATE_SCOPE} <scope>\` (repeatable) to migrate.`,
```
to:
```ts
  LEGACY_ALL_SCOPE_DEPRECATED_BLOCK: `This app currently has the legacy 'all' OAuth scope, which is being deprecated.\n  Replace 'all' with the specific scopes your integration uses in app-config.json's \`auth.scopes\`.\n  Run \`${CLI.APP_SCOPES}\` to see the catalog, then run \`${CLI.APP_UPLOAD}\` to migrate.`,
```

`LEGACY_ALL_SCOPE_START_BLOCK` — change:
```ts
  LEGACY_ALL_SCOPE_START_BLOCK: `This app's auth.scopes in app-config.json still contains the legacy 'all' OAuth scope, which is being deprecated.\n  Replace 'all' with the specific scopes your integration uses (run \`${CLI.APP_SCOPES}\` to see the catalog),\n  migrate with \`${CLI.APP_UPDATE_SCOPE} <scope>\` (repeatable), then re-run \`${CLI.APP_START('oauth')}\`.`,
```
to:
```ts
  LEGACY_ALL_SCOPE_START_BLOCK: `This app's auth.scopes in app-config.json still contains the legacy 'all' OAuth scope, which is being deprecated.\n  Replace 'all' with the specific scopes your integration uses (run \`${CLI.APP_SCOPES}\` to see the catalog),\n  migrate by editing \`auth.scopes\` and running \`${CLI.APP_UPLOAD}\`, then re-run \`${CLI.APP_START('oauth')}\`.`,
```

`LEGACY_ALL_SCOPE_SCAFFOLD_SUBSTITUTED` — change:
```ts
  LEGACY_ALL_SCOPE_SCAFFOLD_SUBSTITUTED: (writtenScopes: string): string =>
    `This app still has the legacy 'all' OAuth scope (deprecated). Wrote ${writtenScopes} to app-config.json instead of 'all'. Migrate the app with \`${CLI.APP_UPDATE_SCOPE} <scope>\`.`,
```
to:
```ts
  LEGACY_ALL_SCOPE_SCAFFOLD_SUBSTITUTED: (writtenScopes: string): string =>
    `This app still has the legacy 'all' OAuth scope (deprecated). Wrote ${writtenScopes} to app-config.json instead of 'all'. Migrate the app by editing \`auth.scopes\` and running \`${CLI.APP_UPLOAD}\`.`,
```

`APP_SCAFFOLD_SCOPES_TIP` — change:
```ts
  APP_SCAFFOLD_SCOPES_TIP: `Tip: list available scopes with \`${CLI.APP_SCOPES}\`. Update scopes via \`${CLI.APP_UPDATE_SCOPE} <name>\` (repeatable), or by editing \`auth.scopes\` in app-config.json and running \`${CLI.APP_UPDATE}\`.`,
```
to:
```ts
  APP_SCAFFOLD_SCOPES_TIP: `Tip: list available scopes with \`${CLI.APP_SCOPES}\`. Update scopes by editing \`auth.scopes\` in app-config.json and running \`${CLI.APP_UPLOAD}\`.`,
```

`APP_START_PORT_IN_USE` — change:
```ts
  APP_START_PORT_IN_USE: (port: number) =>
    `Port ${port} is already in use.\n\n  Either stop the process using port ${port}, use a different port with \`--port <port>\`,\n  or update your redirect URL with \`${CLI.APP_UPDATE} --redirect-uri http://localhost:<port>/auth/callback\`.`,
```
to:
```ts
  APP_START_PORT_IN_USE: (port: number) =>
    `Port ${port} is already in use.\n\n  Either stop the process using port ${port}, use a different port with \`--port <port>\`,\n  or update your redirect URL by editing \`auth.redirectUrls\` in app-config.json and running \`${CLI.APP_UPLOAD}\`.`,
```

`APP_START_CUSTOM_PORT_IN_USE` — change:
```ts
  APP_START_CUSTOM_PORT_IN_USE: (port: number) =>
    `Port ${port} is already in use.\n\n  Stop the process using port ${port}, or pick another port with \`--port <port>\`\n  and update your redirect URL with \`${CLI.APP_UPDATE} --redirect-uri http://localhost:<port>/auth/callback\`.`,
```
to:
```ts
  APP_START_CUSTOM_PORT_IN_USE: (port: number) =>
    `Port ${port} is already in use.\n\n  Stop the process using port ${port}, or pick another port with \`--port <port>\`\n  and update your redirect URL by editing \`auth.redirectUrls\` in app-config.json and running \`${CLI.APP_UPLOAD}\`.`,
```

`APP_START_REDIRECT_DECLINED` — change:
```ts
  APP_START_REDIRECT_DECLINED: (url: string) =>
    `Continuing without registering. The OAuth callback at ${url} will fail until you register it. Run \`${CLI.APP_UPDATE} --redirect-uri ${url}\` to register later.`,
```
to:
```ts
  APP_START_REDIRECT_DECLINED: (url: string) =>
    `Continuing without registering. The OAuth callback at ${url} will fail until you register it. Add it to \`auth.redirectUrls\` in app-config.json and run \`${CLI.APP_UPLOAD}\` to register later.`,
```

`APP_START_REDIRECT_NON_INTERACTIVE` — change:
```ts
  APP_START_REDIRECT_NON_INTERACTIVE: (port: number, url: string) =>
    `Port ${port} is not registered as a redirect URL for this app, and we can't prompt in non-interactive mode. Run \`${CLI.APP_UPDATE} --redirect-uri ${url}\` first, or re-run interactively.`,
```
to:
```ts
  APP_START_REDIRECT_NON_INTERACTIVE: (port: number, url: string) =>
    `Port ${port} is not registered as a redirect URL for this app, and we can't prompt in non-interactive mode. Add \`${url}\` to \`auth.redirectUrls\` in app-config.json and run \`${CLI.APP_UPLOAD}\` first, or re-run interactively.`,
```

`APP_SCOPES_USAGE_HINT` — change:
```ts
  APP_SCOPES_USAGE_HINT: `Add a scope to an app with \`${CLI.APP_UPDATE_SCOPE} <scope> --app-id <id>\`.`,
```
to:
```ts
  APP_SCOPES_USAGE_HINT: `Add a scope to an app by editing \`auth.scopes\` in app-config.json and running \`${CLI.APP_UPLOAD}\`.`,
```

`APP_SCOPES_WEB_SELECTED_PLACEHOLDER` — change:
```ts
  APP_SCOPES_WEB_SELECTED_PLACEHOLDER: `Tick scopes to build a comma-separated list for \`${CLI.APP_UPDATE_SCOPE}\` or app-config.json`,
```
to:
```ts
  APP_SCOPES_WEB_SELECTED_PLACEHOLDER: `Tick scopes to build a comma-separated list for app-config.json's \`auth.scopes\``,
```

- [ ] **Step 4: Update `src/__tests__/lang/en.test.ts`**

Remove the assertion `expect(messages.APP_UPDATE_SCOPES_APPENDED(['contacts:read'])).toContain('contacts:read');` (around line 88) — no replacement, this key is gone entirely.

Change:
```ts
    expect(messages.APP_UPDATE_INVALID_REDIRECT_URL('ftp://bad')).toContain('ftp://bad');
    expect(messages.APP_UPDATE_INVALID_REDIRECT_PROTOCOL('ftp://bad')).toContain('ftp://bad');
```
to:
```ts
    expect(messages.APP_UPLOAD_INVALID_REDIRECT_URL('ftp://bad')).toContain('ftp://bad');
    expect(messages.APP_UPLOAD_INVALID_REDIRECT_PROTOCOL('ftp://bad')).toContain('ftp://bad');
```

- [ ] **Step 5: Run tests**

Run: `yarn test src/__tests__/lang/en.test.ts`
Expected: PASS. (Other suites will still fail to compile at this point since `update.ts`/`update.test.ts` reference the now-deleted `APP_UPDATE_*` keys — that's expected, Task 5 removes those files.)

- [ ] **Step 6: Commit**

```bash
git add src/lang/en.ts src/__tests__/lang/en.test.ts
git commit -m "feat: replace update messages with upload messages, reword flag-based hints"
```

---

## Task 3: `src/commands/app/upload.ts`

**Files:**
- Create: `src/commands/app/upload.ts`

- [ ] **Step 1: Write the full command file**

```ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import inquirer from 'inquirer';
import { logSuccess, logInfo } from '../../lib/logger';
import { messages } from '../../lang/en';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { CliError } from '../../lib/errors';
import { appService } from '../../container';
import { createSpinner } from '../../lib/ui';
import { readProjectConfig, writeProjectConfig, saveAppName, ProjectConfig } from '../../lib/config';
import { validateScopes, containsLegacyAllScope } from '../../lib/validators';
import { OAuthApp, UploadAppResponse } from '../../types';

interface UploadOptions {
  yes?: boolean;
  json?: boolean;
}

const NON_INTERACTIVE_CONFIRM_ERROR =
  'Cannot prompt for confirmation in non-interactive mode. Use --yes or --json to skip.';

// Reads + validates app-config.json from cwd. Always hard-errors on any
// problem — upload has no --app-id flag to fall back to, so an unusable
// config is fatal, not a "skip this part" condition like in the old update.ts.
function loadUsableConfig(): NonNullable<ReturnType<typeof readProjectConfig>> {
  const configPath = path.resolve(process.cwd(), 'app-config.json');
  if (!fs.existsSync(configPath)) {
    throw new CliError(messages.APP_UPLOAD_NO_CONFIG);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    throw new CliError(messages.APP_UPLOAD_INVALID_JSON);
  }
  if (
    !raw ||
    typeof raw !== 'object' ||
    !('appId' in raw) ||
    !(raw as Record<string, unknown>).appId
  ) {
    throw new CliError(messages.APP_UPLOAD_MISSING_APP_ID);
  }
  const config = readProjectConfig();
  if (!config) {
    throw new CliError(messages.APP_UPLOAD_MISSING_APP_ID);
  }
  return config;
}

function validateRedirectUrls(urls: string[]): void {
  for (const url of urls) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new CliError(messages.APP_UPLOAD_INVALID_REDIRECT_PROTOCOL(url));
      }
    } catch (err) {
      if (err instanceof CliError) throw err;
      throw new CliError(messages.APP_UPLOAD_INVALID_REDIRECT_URL(url));
    }
  }
}

async function fetchExistingApp(appId: string, silent: boolean | undefined): Promise<OAuthApp> {
  const spinner = createSpinner('Fetching app...', { silent });
  let app: OAuthApp | null;
  try {
    app = await appService.fetchApp(appId);
  } finally {
    spinner.stop();
  }
  if (!app) {
    throw new CliError(`App ${appId} not found.`);
  }
  return app;
}

// Diff `current` vs `next`: next values keep their order (tagged `(new)` when
// absent from current), values dropped from current trail with `(removed)`.
function diffLines(current: string[], next: string[]): string[] {
  const currentSet = new Set(current);
  const nextSet = new Set(next);
  return [
    ...next.map((v) => (currentSet.has(v) ? v : `${v} (new)`)),
    ...current.filter((v) => !nextSet.has(v)).map((v) => `${v} (removed)`),
  ];
}

function logAligned(label: string, lines: string[]): void {
  lines.forEach((line, i) => {
    logInfo(`${i === 0 ? label : '                 '}${line}`);
  });
}

interface UploadDiff {
  appId: string;
  currentName?: string;
  nextName: string;
  currentUrls: string[];
  nextUrls: string[];
  currentLogoUri?: string;
  nextLogoUri: string;
  currentScopes: string[];
  nextScopes: string[];
  currentDistribution?: 'public' | 'private';
  nextDistribution: 'public' | 'private';
  currentVersion?: string;
  nextVersion: string;
  migratingLegacyScopes: boolean;
}

function buildDiff(config: NonNullable<ProjectConfig>, remote: OAuthApp): UploadDiff {
  const nextScopes = config.auth?.scopes ?? [];
  return {
    appId: config.appId,
    currentName: remote.name,
    nextName: config.appName,
    currentUrls: remote.redirect_uris ?? [],
    nextUrls: config.auth?.redirectUrls ?? [],
    currentLogoUri: remote.logo_uri,
    nextLogoUri: config.logoUri ?? '',
    currentScopes: remote.scopes ?? [],
    nextScopes,
    currentDistribution: remote.distribution_type,
    nextDistribution: config.distribution_type,
    currentVersion: remote.version,
    nextVersion: config.version || remote.version || '',
    migratingLegacyScopes: containsLegacyAllScope(remote.scopes ?? []),
  };
}

function renderUploadDiff(diff: UploadDiff): void {
  logInfo('');
  logInfo(`  ${messages.APP_UPLOAD_SUMMARY}`);
  logInfo(`  App ID:        ${diff.appId}`);
  const renamePrefix =
    diff.currentName && diff.currentName !== diff.nextName ? `${diff.currentName} → ` : '';
  logInfo(`  Name:          ${renamePrefix}${diff.nextName}`);
  if (diff.currentDistribution && diff.currentDistribution !== diff.nextDistribution) {
    logInfo(`  Distribution:  ${diff.currentDistribution} → ${diff.nextDistribution}`);
  } else {
    logInfo(`  Distribution:  ${diff.nextDistribution}`);
  }
  logAligned('  Redirect URLs: ', diffLines(diff.currentUrls, diff.nextUrls));
  if (diff.migratingLegacyScopes) {
    logInfo(`  ${messages.LEGACY_ALL_SCOPE_UPDATE_MIGRATING}`);
  }
  logAligned('  Scopes:        ', diffLines(diff.currentScopes, diff.nextScopes));
  if (diff.currentLogoUri && diff.currentLogoUri !== diff.nextLogoUri) {
    logInfo(`  Logo URL:      ${diff.currentLogoUri} → ${diff.nextLogoUri || '(none)'}`);
  } else if (diff.nextLogoUri) {
    logInfo(`  Logo URL:      ${diff.nextLogoUri}`);
  }
  if (diff.currentVersion && diff.currentVersion !== diff.nextVersion) {
    logInfo(`  Version:       ${diff.currentVersion} → ${diff.nextVersion || '(unknown)'}`);
  } else if (diff.nextVersion) {
    logInfo(`  Version:       ${diff.nextVersion}`);
  }
  logInfo('');
}

function diffToJson(diff: UploadDiff) {
  return {
    current: {
      name: diff.currentName,
      redirect_uris: diff.currentUrls,
      scopes: diff.currentScopes,
      logo_uri: diff.currentLogoUri,
      distribution_type: diff.currentDistribution,
      version: diff.currentVersion,
    },
    next: {
      name: diff.nextName,
      redirect_uris: diff.nextUrls,
      scopes: diff.nextScopes,
      logo_uri: diff.nextLogoUri,
      distribution_type: diff.nextDistribution,
      version: diff.nextVersion,
    },
  };
}

function hasNoChanges(diff: UploadDiff): boolean {
  return (
    diff.currentName === diff.nextName &&
    diff.currentDistribution === diff.nextDistribution &&
    JSON.stringify([...diff.currentUrls].sort()) === JSON.stringify([...diff.nextUrls].sort()) &&
    JSON.stringify([...diff.currentScopes].sort()) === JSON.stringify([...diff.nextScopes].sort()) &&
    (diff.currentLogoUri || '') === (diff.nextLogoUri || '') &&
    (diff.currentVersion || '') === (diff.nextVersion || '')
  );
}

export const uploadCommand = withCommandHandler(async (options: UploadOptions): Promise<void> => {
  const config = loadUsableConfig();

  const redirectUrls = config.auth?.redirectUrls ?? [];
  if (redirectUrls.length === 0) {
    throw new CliError(messages.APP_UPLOAD_NO_REDIRECT_URLS);
  }
  validateRedirectUrls(redirectUrls);

  const scopes = config.auth?.scopes ?? [];
  validateScopes(scopes);
  if (containsLegacyAllScope(scopes)) {
    throw new CliError(messages.LEGACY_ALL_SCOPE_DEPRECATED_BLOCK);
  }

  // Unconditional: --json and --yes both still fetch + diff, per BEX-250.
  const remote = await fetchExistingApp(config.appId, options.json);
  const diff = buildDiff(config, remote);

  if (!options.json) {
    renderUploadDiff(diff);
  }

  if (hasNoChanges(diff)) {
    if (options.json) {
      jsonOutput({ appId: config.appId, upToDate: true, version: diff.nextVersion, ...diffToJson(diff) });
      return;
    }
    logInfo(messages.APP_UPLOAD_UP_TO_DATE(diff.nextVersion || 'unknown'));
    return;
  }

  if (!options.json && !options.yes) {
    if (!process.stdin.isTTY) {
      throw new CliError(NON_INTERACTIVE_CONFIRM_ERROR);
    }
    const { confirmed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmed',
        message: messages.APP_UPLOAD_CONFIRM,
        default: true,
      },
    ]);
    if (!confirmed) {
      logInfo(`\n  ${messages.APP_UPLOAD_CANCELLED}\n`);
      return;
    }
  }

  const spinner = createSpinner('Uploading app...', { silent: options.json });
  let response: UploadAppResponse;
  try {
    response = await appService.uploadApp(config.appId, {
      app_id: config.appId,
      name: config.appName,
      logo_uri: config.logoUri ?? '',
      app_version: diff.nextVersion,
      auth: {
        distribution_type: config.distribution_type,
        scopes,
        redirect_urls: redirectUrls,
      },
    });
  } finally {
    spinner.stop();
  }

  const finalName = response.name ?? config.appName;
  if (finalName) saveAppName(config.appId, finalName);

  writeProjectConfig({
    ...config,
    appName: finalName,
    logoUri: response.logo_uri ?? config.logoUri,
    distribution_type: response.auth?.distribution_type ?? config.distribution_type,
    version: response.app_version ?? diff.nextVersion,
    auth: {
      scopes: response.auth?.scopes ?? scopes,
      redirectUrls: response.auth?.redirect_urls ?? redirectUrls,
    },
  });

  if (options.json) {
    jsonOutput({
      appId: config.appId,
      name: finalName,
      version: response.app_version ?? diff.nextVersion,
      ...diffToJson(diff),
    });
    return;
  }

  logSuccess(messages.APP_UPLOAD_SUCCESS);
  logInfo(`  Version: ${response.app_version ?? diff.nextVersion || '(unknown)'}`);
  process.stdout.write('\n');
});
```

- [ ] **Step 2: Build (isolated check)**

Run: `yarn build`
Expected: `upload.ts` itself compiles cleanly. Other errors (definitions.ts still referencing `update.ts`/`CLI.APP_UPDATE`) are expected until Task 5 — do not fix them here.

- [ ] **Step 3: Commit**

```bash
git add src/commands/app/upload.ts
git commit -m "feat: add brevo app upload command"
```

---

## Task 4: `src/__tests__/commands/app/upload.test.ts`

**Files:**
- Create: `src/__tests__/commands/app/upload.test.ts`

- [ ] **Step 1: Write the test file**

Mirror `update.test.ts`'s mocking patterns (mock `inquirer`, `../../../container`, `../../../lib/config`) but adapted for `upload`'s no-flags, always-diff, config-only shape:

```ts
import { uploadCommand } from '../../../commands/app/upload';
import { CliError } from '../../../lib/errors';

jest.mock('inquirer', () => ({
  prompt: jest.fn(),
}));

jest.mock('../../../container', () => ({
  appService: {
    fetchApp: jest.fn(),
    uploadApp: jest.fn(),
  },
}));

jest.mock('../../../lib/config', () => ({
  readProjectConfig: jest.fn(),
  writeProjectConfig: jest.fn(),
  saveAppName: jest.fn(),
}));

jest.mock('node:fs');

import * as fs from 'node:fs';
import inquirer from 'inquirer';
import { appService } from '../../../container';
import { readProjectConfig, writeProjectConfig, saveAppName } from '../../../lib/config';

const mockPrompt = inquirer.prompt as unknown as jest.Mock;

const BASE_CONFIG = {
  appId: '1',
  appName: 'Test App',
  distribution_type: 'private' as const,
  logoUri: '',
  version: '1.0.0',
  auth: { scopes: ['contacts:read'], redirectUrls: ['http://localhost:3009/auth/callback'] },
};

const BASE_REMOTE = {
  app_id: '1',
  name: 'Test App',
  client_id: 'cli-123',
  distribution_type: 'private' as const,
  redirect_uris: ['http://localhost:3009/auth/callback'],
  scopes: ['contacts:read'],
  logo_uri: '',
  version: '1.0.0',
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
};

describe('app/upload', () => {
  let stdoutSpy: jest.SpyInstance;
  const originalIsTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, writable: true, value: true });
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify({ appId: '1' }));
    (readProjectConfig as jest.Mock).mockReturnValue(BASE_CONFIG);
    (appService.fetchApp as jest.Mock).mockResolvedValue(BASE_REMOTE);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    if (originalIsTTYDescriptor) {
      Object.defineProperty(process.stdin, 'isTTY', originalIsTTYDescriptor);
    } else {
      Reflect.deleteProperty(process.stdin, 'isTTY');
    }
  });

  it('hard-errors when app-config.json does not exist', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    await expect(uploadCommand({})).rejects.toThrow(/No app-config.json/i);
    expect(appService.fetchApp).not.toHaveBeenCalled();
  });

  it('hard-errors on invalid JSON', async () => {
    (fs.readFileSync as jest.Mock).mockReturnValue('{not json');
    await expect(uploadCommand({})).rejects.toThrow(/invalid JSON/i);
  });

  it('hard-errors when appId is missing from the file', async () => {
    (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify({}));
    await expect(uploadCommand({})).rejects.toThrow(/missing "appId"/i);
  });

  it('always fetches remote state and shows the diff, even under --yes', async () => {
    const changedConfig = {
      ...BASE_CONFIG,
      auth: { ...BASE_CONFIG.auth, redirectUrls: ['http://localhost:9999/auth/callback'] },
    };
    (readProjectConfig as jest.Mock).mockReturnValue(changedConfig);
    (appService.uploadApp as jest.Mock).mockResolvedValue({ ...BASE_REMOTE, auth: { ...BASE_REMOTE, redirect_urls: ['http://localhost:9999/auth/callback'] } });

    await uploadCommand({ yes: true });

    expect(appService.fetchApp).toHaveBeenCalledWith('1');
    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('Upload summary');
    expect(mockPrompt).not.toHaveBeenCalled();
  });

  it('exits 0 with "already up to date" and does not call uploadApp when config matches the server', async () => {
    await uploadCommand({ yes: true });

    expect(appService.uploadApp).not.toHaveBeenCalled();
    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toMatch(/already up to date/i);
  });

  it('prompts for confirmation when something differs and --yes/--json are absent', async () => {
    const changedConfig = { ...BASE_CONFIG, appName: 'Renamed App' };
    (readProjectConfig as jest.Mock).mockReturnValue(changedConfig);
    mockPrompt.mockResolvedValueOnce({ confirmed: true });
    (appService.uploadApp as jest.Mock).mockResolvedValue({ ...BASE_REMOTE, name: 'Renamed App' });

    await uploadCommand({});

    expect(mockPrompt).toHaveBeenCalled();
    expect(appService.uploadApp).toHaveBeenCalled();
  });

  it('cancels without uploading when the user declines the confirmation', async () => {
    const changedConfig = { ...BASE_CONFIG, appName: 'Renamed App' };
    (readProjectConfig as jest.Mock).mockReturnValue(changedConfig);
    mockPrompt.mockResolvedValueOnce({ confirmed: false });

    await uploadCommand({});

    expect(appService.uploadApp).not.toHaveBeenCalled();
  });

  it('throws in non-interactive mode without --yes/--json when something differs', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, writable: true, value: false });
    const changedConfig = { ...BASE_CONFIG, appName: 'Renamed App' };
    (readProjectConfig as jest.Mock).mockReturnValue(changedConfig);

    await expect(uploadCommand({})).rejects.toThrow(/non-interactive/i);
    expect(appService.uploadApp).not.toHaveBeenCalled();
  });

  it('POSTs the correct wire shape — distribution_type nested under auth, app_version, redirect_urls', async () => {
    const changedConfig = { ...BASE_CONFIG, appName: 'Renamed App' };
    (readProjectConfig as jest.Mock).mockReturnValue(changedConfig);
    (appService.uploadApp as jest.Mock).mockResolvedValue({ ...BASE_REMOTE, name: 'Renamed App' });

    await uploadCommand({ yes: true });

    expect(appService.uploadApp).toHaveBeenCalledWith('1', {
      app_id: '1',
      name: 'Renamed App',
      logo_uri: '',
      app_version: '1.0.0',
      auth: {
        distribution_type: 'private',
        scopes: ['contacts:read'],
        redirect_urls: ['http://localhost:3009/auth/callback'],
      },
    });
  });

  it('never sends a ui_app field', async () => {
    const changedConfig = { ...BASE_CONFIG, appName: 'Renamed App' };
    (readProjectConfig as jest.Mock).mockReturnValue(changedConfig);
    (appService.uploadApp as jest.Mock).mockResolvedValue({ ...BASE_REMOTE, name: 'Renamed App' });

    await uploadCommand({ yes: true });

    const payload = (appService.uploadApp as jest.Mock).mock.calls[0][1];
    expect(payload).not.toHaveProperty('ui_app');
  });

  it('writes the server-confirmed state back into app-config.json on success', async () => {
    const changedConfig = { ...BASE_CONFIG, appName: 'Renamed App' };
    (readProjectConfig as jest.Mock).mockReturnValue(changedConfig);
    (appService.uploadApp as jest.Mock).mockResolvedValue({
      app_id: '1',
      name: 'Renamed App',
      logo_uri: '',
      app_version: '2.0.0',
      auth: { distribution_type: 'private', scopes: ['contacts:read'], redirect_urls: ['http://localhost:3009/auth/callback'] },
    });

    await uploadCommand({ yes: true });

    expect(writeProjectConfig).toHaveBeenCalledWith(
      expect.objectContaining({ appName: 'Renamed App', version: '2.0.0' }),
    );
    expect(saveAppName).toHaveBeenCalledWith('1', 'Renamed App');
  });

  it('rejects (propagates the error) when the server returns app_version_outdated', async () => {
    const changedConfig = { ...BASE_CONFIG, version: '0.5.0' };
    (readProjectConfig as jest.Mock).mockReturnValue(changedConfig);
    (appService.uploadApp as jest.Mock).mockRejectedValue(new Error('app_version_outdated'));

    await expect(uploadCommand({ yes: true })).rejects.toThrow('app_version_outdated');
  });

  it('blocks with the legacy all-scope message when local scopes contain "all"', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue({
      ...BASE_CONFIG,
      auth: { ...BASE_CONFIG.auth, scopes: ['all'] },
    });

    await expect(uploadCommand({ yes: true })).rejects.toThrow(/legacy 'all'/i);
    expect(appService.uploadApp).not.toHaveBeenCalled();
  });

  it('throws when app-config.json has no redirect URLs', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue({
      ...BASE_CONFIG,
      auth: { ...BASE_CONFIG.auth, redirectUrls: [] },
    });

    await expect(uploadCommand({ yes: true })).rejects.toThrow(/no redirect URLs/i);
  });

  it('rejects an invalid redirect URL protocol', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue({
      ...BASE_CONFIG,
      auth: { ...BASE_CONFIG.auth, redirectUrls: ['ftp://bad'] },
    });

    await expect(uploadCommand({ yes: true })).rejects.toThrow(/http:\/\/ or https:\/\//);
  });

  it('outputs structured JSON including the diff under --json, with no prompt', async () => {
    const changedConfig = { ...BASE_CONFIG, appName: 'Renamed App' };
    (readProjectConfig as jest.Mock).mockReturnValue(changedConfig);
    (appService.uploadApp as jest.Mock).mockResolvedValue({ ...BASE_REMOTE, name: 'Renamed App' });

    await uploadCommand({ json: true });

    expect(mockPrompt).not.toHaveBeenCalled();
    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    const parsed = JSON.parse(output);
    expect(parsed.name).toBe('Renamed App');
    expect(parsed.current).toBeDefined();
    expect(parsed.next).toBeDefined();
  });

  it('outputs upToDate JSON (no upload call) when nothing differs under --json', async () => {
    await uploadCommand({ json: true });

    expect(appService.uploadApp).not.toHaveBeenCalled();
    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    const parsed = JSON.parse(output);
    expect(parsed.upToDate).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test file**

Run: `yarn test src/__tests__/commands/app/upload.test.ts`
Expected: PASS, all tests. Debug and fix any mismatches against the actual `upload.ts` implementation from Task 3 (e.g. exact error-message wording) — the test file above is written to the messages specified in Task 2, but re-verify against what's actually in `en.ts` after Task 2 landed.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/commands/app/upload.test.ts
git commit -m "test: add coverage for brevo app upload"
```

---

## Task 5: Remove `update`, wire in `upload` — `definitions.ts`, delete `update.ts`/`update.test.ts`

**Files:**
- Modify: `src/commands/definitions.ts`
- Delete: `src/commands/app/update.ts`
- Delete: `src/__tests__/commands/app/update.test.ts`

- [ ] **Step 1: Update imports in `definitions.ts`**

Change:
```ts
import { updateCommand } from './app/update';
```
to:
```ts
import { uploadCommand } from './app/upload';
```

- [ ] **Step 2: Replace the `update` command definition with `upload`**

Replace the entire `update` entry (the object with `name: 'update'`) with:

```ts
    {
      name: 'upload',
      description: 'Push app-config.json to Brevo, validated and synced with the server',
      examples: [
        'brevo app upload',
        'brevo app upload --yes',
        'brevo app upload --json',
      ],
      options: [
        { flags: '--yes', description: 'Skip confirmation prompt' },
        { flags: '--json', description: 'Output as JSON' },
      ],
      handler: (opts) =>
        uploadCommand({
          yes: Boolean(opts.yes),
          json: Boolean(opts.json),
        }),
    },
```

Keep its position in the `commands` array where `update` was (between `credentials` and `delete`).

- [ ] **Step 3: Delete `update.ts` and its test file**

```bash
rm src/commands/app/update.ts src/__tests__/commands/app/update.test.ts
```

- [ ] **Step 4: Grep for any remaining references**

Run: `grep -rn "app/update\|updateCommand\|APP_UPDATE" src agent-context --include='*.ts' --include='*.md' 2>/dev/null || grep -rln "app/update\|updateCommand\|APP_UPDATE" src agent-context`
Expected: no matches (the second form works around this repo's shell quoting `--include` issue seen earlier in this session — use whichever grep invocation actually runs in your shell).

- [ ] **Step 5: Run the full suite, lint, build**

Run: `yarn test && yarn lint && yarn build`
Expected: all green. `init.ts` and its test (`init.test.ts`) still reference `createCommand`/`scaffoldCommand` only, not `update` — confirm this remains true and neither file needs a change (read them if unsure, don't assume).

- [ ] **Step 6: Commit**

```bash
git add src/commands/definitions.ts
git rm src/commands/app/update.ts src/__tests__/commands/app/update.test.ts
git commit -m "feat: remove brevo app update, register brevo app upload"
```

---

## Task 6: Docs — `AGENTS.md` and `SKILL.md`

**Files:**
- Modify: `agent-context/AGENTS.md`
- Modify: `agent-context/SKILL.md`

- [ ] **Step 1: `AGENTS.md` — command table row**

Change:
```
| `brevo app update` | Update name / redirect URLs / scopes / logo (`--app-id`, `--name`, `--redirect-uri`, `--scope` repeatable appends, `--logo-uri`, `--yes`, `--json`) |
```
to:
```
| `brevo app upload` | Push `app-config.json` to Brevo (`--yes`, `--json`). No edit flags — change name/redirect URLs/scopes/logo/version by editing `app-config.json` directly, then run `upload`. Always fetches the remote app first and shows a local-vs-server diff (even under `--yes`/`--json`); exits 0 with no network push if nothing differs. |
```

- [ ] **Step 2: `AGENTS.md` — conventions bullets**

Change:
```
- **`app-config.json`** in the working directory pins the linked app — `brevo app update` and `brevo app start` read from it. The optional top-level `logoUri` string is pushed as `logo_uri` by a flagless `brevo app update`; leave it empty to keep the API value untouched. The top-level `version` string is server-assigned (set at `brevo app create`, shown by `brevo app create`/`brevo app list`/`brevo app update`) — the CLI never sends it and there is no flag to change it; `brevo app update` backfills it into `app-config.json` for projects scaffolded before this field existed.
```
to:
```
- **`app-config.json`** in the working directory pins the linked app — `brevo app upload` and `brevo app start` read from it; `upload` is the *only* command that pushes config changes, and it has no `--app-id` override (it always resolves the app from cwd's `app-config.json`, hard-erroring if that file is missing/invalid/lacks `appId`). The top-level `logoUri` string is pushed as `logo_uri`; leave it empty to keep the API value untouched. The top-level `version` string is round-tripped as `app_version` on the wire — `upload` sends the local value (falling back to the server's current value if locally absent) and writes back whatever the server confirms.
```

Change:
```
- `brevo app update --scope <scope>` is repeatable and appends, mirroring `--redirect-uri`. De-duped, order-preserving. Writes back to `app-config.json` when that file describes the target app. A single flag value may contain multiple comma- or whitespace-separated tokens (`--scope "crm:read, crm:write"` is equivalent to `--scope crm:read --scope crm:write`). Same normalization is applied to `auth.scopes` when read from `app-config.json`.
```
to:
```
- To change scopes, redirect URLs, name, or logo, edit the corresponding field in `app-config.json` directly and run `brevo app upload` — there is no `--scope`/`--redirect-uri`/`--name`/`--logo-uri` flag on `upload`. Same normalization (comma/whitespace-split, de-duped) is applied to `auth.scopes` when read from `app-config.json`.
```

Change (both occurrences of the legacy-scope migration instruction):
```
The legacy catch-all `'all'` OAuth scope is deprecated. The CLI **blocks** `brevo app update` and `brevo app start oauth` when scopes still contain `'all'` (no escape hatch, no silent rewrite); the only mutating path that proceeds is an explicit `--scope` migration. To handle a legacy app:
```
to:
```
The legacy catch-all `'all'` OAuth scope is deprecated. The CLI **blocks** `brevo app upload` and `brevo app start oauth` when scopes still contain `'all'` (no escape hatch, no silent rewrite); the only mutating path that proceeds is editing `auth.scopes` in `app-config.json` and running `upload`. To handle a legacy app:
```
and:
```
3. **Migrate** with `brevo app update --scope <scope> --scope <scope> ...` — passing `--scope` drops `'all'` from the outgoing scope set and applies the new granular scopes (the summary shows a "Migrating from legacy 'all' scope" line and `all (removed)`).
```
to:
```
3. **Migrate** by editing `auth.scopes` in `app-config.json` to replace `'all'` with the granular scopes your integration uses, then run `brevo app upload` (the summary shows a "Migrating from legacy 'all' scope" line and `all (removed)`).
```

- [ ] **Step 3: `SKILL.md` — decision-tree entries**

Change:
```
- "Update app metadata" → `brevo app update --app-id <id> --name "<name>"` and/or `--redirect-uri <url>` (repeatable) and/or `--scope <scope>` (repeatable, appends) and/or `--logo-uri <https://…>`
```
to:
```
- "Update app metadata" → edit the relevant field(s) in `app-config.json` (`appName`, `auth.redirectUrls`, `auth.scopes`, `logoUri`), then run `brevo app upload --json` (no `--app-id`/`--name`/`--redirect-uri`/`--scope`/`--logo-uri` flags exist — `upload` always pushes the whole file, resolved only from cwd's `app-config.json`)
```

Change:
```
If `app-config.json` exists in the working directory, it pins the app — `brevo app update` and `brevo app start` use it automatically. To target a different app, pass `--app-id`.
```
to:
```
If `app-config.json` exists in the working directory, it pins the app — `brevo app upload` and `brevo app start` use it automatically. Unlike most other commands, `upload` has **no** `--app-id` override — it only ever reads cwd's `app-config.json`, hard-erroring if that file is missing, invalid, or lacks `appId`.
```

Change:
```
`app-config.json` also carries a top-level `version` string — server-assigned at `brevo app create` and shown by `brevo app create`/`brevo app list`/`brevo app update`. It's read-only: the CLI never sends it and there's no flag to change it. `brevo app update` backfills it into `app-config.json` for projects scaffolded before this field existed.
```
to:
```
`app-config.json` also carries a top-level `version` string, shown by `brevo app create`/`brevo app list`. `brevo app upload` sends it on the wire as `app_version` (falling back to the server's current value if locally absent) and writes back whatever version the server confirms after a successful upload.
```

Change:
```
- New apps created via `brevo app create` default to `contacts:read`, `contacts:write`, `crm:read`, `crm:write`. The CLI prints the default set on success and points to `brevo app update --scope` for changes.
- `brevo app update --scope <scope>` is **repeatable and appends** — passing `--scope X --scope Y` adds both to the app's existing scope set, de-duped, order-preserving. A single flag value may also contain multiple comma- or whitespace-separated tokens (`--scope "crm:read, crm:write"` ≡ `--scope crm:read --scope crm:write`); the same normalization is applied to `auth.scopes` when read from `app-config.json`, so a malformed entry like `"crm:write, campaigns:read"` is split into two scopes on read. To see what's currently set, run `brevo app credentials --app-id <id> --json`. To remove a scope, edit `app-config.json` and run `brevo app update` without `--scope`.
```
to:
```
- New apps created via `brevo app create` default to `contacts:read`, `contacts:write`, `crm:read`, `crm:write`. The CLI prints the default set on success and points to editing `app-config.json` + `brevo app upload` for changes.
- To add, remove, or change scopes: edit `auth.scopes` in `app-config.json` directly, then run `brevo app upload`. Comma- or whitespace-separated values in a single entry are normalized on read (e.g. `"crm:write, campaigns:read"` becomes two scopes). To see what's currently set, run `brevo app credentials --app-id <id> --json`.
```

Change both occurrences of the legacy-scope block/migration text, mirroring the `AGENTS.md` edits above (find the equivalent `SKILL.md` lines and reword `brevo app update`/`--scope` references to `brevo app upload` + edit-the-file instructions, same as Step 2).

- [ ] **Step 4: Grep for stale references**

Run: `grep -rn "brevo app update\|--scope\b" agent-context/`
Expected: no matches referencing a command that no longer exists. (`--scope` itself should have zero remaining hits since no command has that flag anymore.)

- [ ] **Step 5: Commit**

```bash
git add agent-context/AGENTS.md agent-context/SKILL.md
git commit -m "docs: sync AGENTS.md/SKILL.md with brevo app upload replacing update"
```

---

## Task 7: `TESTING.md`, `TODO.md`, changeset

**Files:**
- Modify: `TESTING.md`
- Modify: `TODO.md`
- Modify: `.changeset/` (new file — this is a distinct feature from the pending `add-app-version-config`/`enable-public-app-distribution` changesets, so create a new one per this repo's "one changeset per branch/PR" rule, since this is a different branch)

- [ ] **Step 1: `TESTING.md` entry**

Add at the top of `## Entries`:

```md
### `brevo app upload` replaces `brevo app update` (BEX-250)
_Added: 2026-07-23_

`brevo app update` is fully removed (no stub, no forwarding shim). `brevo app upload`
takes only `--yes`/`--json` — no `--app-id`, no edit flags. It always fetches the
remote app and renders a local-vs-server diff before pushing (even under `--yes`;
under `--json` the diff is structured data, never a prompt), POSTs to
`/v3/app-store/apps/{id}/upload` with the confirmed wire shape (`app_version`,
`auth.distribution_type`, `auth.redirect_urls`), and writes the server-confirmed
state back into `app-config.json` on success.

- [ ] `brevo app upload` outside a directory with usable `app-config.json` (missing
  file / invalid JSON / missing `appId`) hard-errors, no API call — (Automated: `upload.test.ts`)
- [ ] Diff always fetched and shown/returned regardless of `--yes`/`--json` — (Automated: `upload.test.ts`)
- [ ] No differences → exit 0, "already up to date at version X", no `uploadApp` call — (Automated: `upload.test.ts`)
- [ ] Differences + no `--yes`/`--json` + TTY → confirm prompt; decline cancels with
  no upload — (Automated: `upload.test.ts`)
- [ ] Differences + no `--yes`/`--json` + non-TTY → throws (no way to confirm) — (Automated: `upload.test.ts`)
- [ ] Outgoing payload matches the confirmed contract exactly: `distribution_type`
  nested under `auth`, `app_version` top-level, `redirect_urls` (not `redirect_uris`)
  — (Automated: `upload.test.ts`, `app.test.ts`)
- [ ] `ui_app` is never included in the outgoing payload — (Automated: `upload.test.ts`)
- [ ] Legacy `'all'` scope still blocks the upload (same as `update.ts` did) — (Automated: `upload.test.ts`)
- [ ] Redirect URL protocol validation unchanged from `update.ts` — (Automated: `upload.test.ts`)
- [ ] Server rejection (e.g. `app_version_outdated`) propagates as an error, exit 1 — (Automated: `upload.test.ts`)
- [ ] Success writes server-confirmed name/logo/distribution/version/scopes/redirectUrls
  back into `app-config.json` — (Automated: `upload.test.ts`)
- [ ] `brevo app update` is fully deregistered — running it is an unknown command — (Manual: `brevo app update --help` / grep)
- [ ] All ~11 messages that referenced `brevo app update --scope`/`--redirect-uri`
  now point at editing `app-config.json` + `brevo app upload` instead — (grep, Manual)
- [ ] `AGENTS.md` + `SKILL.md` describe `upload` (no flags beyond `--yes`/`--json`,
  no `--app-id`) and no longer mention `update` — (Manual)

Run before ticking automated items: `yarn test` · `yarn lint` · `yarn build`.
```

- [ ] **Step 2: `TODO.md` entries**

Add under `## Open`:

```md
- [ ] **Wire the Submitted/In-Review lifecycle lock into `brevo app upload`.** BEX-254's
  disposition (superseded by BEX-250) calls for blocking `upload` when the app's
  current state is `Submitted` or `In Review`. Deferred because BEX-252 (status)/
  BEX-253 (withdraw) — the tickets that would introduce a state field/endpoint to
  read — don't exist in this codebase yet. Wire this in once either lands.
  — (relates to `BEX-250-app-upload`; see `TESTING.md`)

- [ ] **Confirm `ui_app` passthrough risk with backend.** `brevo app upload` never
  sends `ui_app` (local config has no field for it). If the upload endpoint treats a
  missing `ui_app` as "clear the existing value" rather than "leave untouched," any
  app that has one set (e.g. via a future dashboard UI) would have it silently wiped
  on the next CLI upload. Confirmed accepted risk for this pass — revisit if/when
  `ui_app` authoring becomes CLI-relevant.
  — (relates to `BEX-250-app-upload`; see `docs/superpowers/specs/2026-07-23-app-upload-replaces-update-design.md`)
```

- [ ] **Step 3: Create the changeset**

Run: `ls .changeset/*.md 2>/dev/null | grep -v README.md` — expect `add-app-version-config.md` and `enable-public-app-distribution.md` to appear (these belong to the *other*, unmerged branch this one was based on — do NOT append to them, they're not this branch's changeset). Since this is a different branch/PR, create a new changeset:

Run `yarn changeset` interactively and describe: "Replaces `brevo app update` with `brevo app upload` (BEX-250). `upload` has no `--app-id`/edit flags — it always pushes the full local `app-config.json`, after fetching the remote app and showing a diff (even under `--yes`/`--json`). Breaking change: `brevo app update` no longer exists." Bump level: **major** (removes a public command entirely — this is a breaking change for any script/CI using `brevo app update`).

- [ ] **Step 4: Commit**

```bash
git add TESTING.md TODO.md .changeset/
git commit -m "chore: add testing checklist, TODOs, and changeset for BEX-250"
```

---

## Task 8: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `yarn test:ci`
Expected: all suites pass. (If a jest worker SIGSEGV flake recurs as seen earlier in this session, re-run — it's transient infra, not a real failure, but confirm by re-running before treating it as a real issue.)

- [ ] **Step 2: Lint, format, build**

Run: `yarn lint && yarn format:check && yarn build`
Expected: all clean.

- [ ] **Step 3: Grep sweep for anything missed**

Run: `grep -rn "brevo app update\|APP_UPDATE\|updateCommand" src agent-context docs/superpowers/specs 2>/dev/null`
Expected: zero matches outside of the design spec doc itself (which legitimately discusses the removed `update` command historically) and `TODO.md`/`TESTING.md` entries that reference it by name for context. If anything in `src/` or `agent-context/` still matches, fix it before considering this done.

- [ ] **Step 4: Manual smoke test**

In a scratch directory with a scaffolded `app-config.json`:
```bash
node dist/bin/index.js app upload
```
Expected: fetches the app, shows the diff, prompts for confirmation if anything differs (or reports "already up to date" if not). Then:
```bash
node dist/bin/index.js app update
```
Expected: "unknown command" error from the CLI framework, not a Brevo-specific error.

---

## Self-Review Notes (completed during planning, not a task to execute)

- **Spec coverage:** every "Resolved" decision in the design doc maps to a task —
  confirmed contract (Task 1/3), `ui_app` never sent (Task 3, tested in Task 4),
  lifecycle gate deferred (Task 7's `TODO.md` entry), no edit flags (Task 3/5),
  ripple-effect message rewording (Task 2/6).
- **Type consistency:** `UploadAppPayload`/`UploadAppResponse` (Task 1) match exactly
  what `upload.ts` (Task 3) sends/reads and what `app.test.ts`/`upload.test.ts`
  (Task 1/4) assert against.
- **No placeholders:** every step shows complete code and exact before/after text for
  every message change, rather than "reword similarly" — the only step lacking a
  full quoted before/after is Task 6 Step 3's legacy-scope block in `SKILL.md`, which
  explicitly says to mirror Step 2's already-fully-specified `AGENTS.md` wording
  rather than repeating the same two paragraphs twice in this plan.
