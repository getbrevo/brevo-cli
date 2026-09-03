# Non-interactive UI app creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `brevo app create` create an `actionLink` UI app non-interactively, via `--ui-config <file>` or a flag set (`--ui-app --record-page --placement --label --url [--more-info]`), instead of always falling back to an OAuth app when the run isn't an interactive TTY.

**Architecture:** A new `resolveUiAppNonInteractive()` in `src/app-types/ui/authoring.ts` sits next to the existing interactive `resolveUiApp()` and reuses the same registry reads (`fetchRecordPageLocations`, `fetchSurfacePointsForPages`), the same entry builder (`buildSurfacePointList`, exported for the first time), and the same `validateUiApp()`. `src/commands/app/create.ts` gets one new interception point, ahead of `resolveAppType()`, so a `--ui-config`/`--ui-app` invocation is UI-typed unconditionally instead of falling through the `!interactive → 'oauth'` default.

**Tech Stack:** TypeScript, Jest/ts-jest, Commander (via `src/lib/command-registry.ts`), `inquirer` (untouched by this change).

---

## File map

- Modify `src/app-types/ui/authoring.ts` — export `buildSurfacePointList`, add `resolveUiAppNonInteractive()`.
- Modify `src/lib/validators.ts` — no new exported validators needed (all reused); add nothing here.
- Modify `src/commands/app/create.ts` — parse/merge the two new input modes, intercept before `resolveAppType`.
- Modify `src/commands/definitions.ts` — new options, updated comment, updated examples.
- Modify `src/lib/help.ts` — no change needed (root help line stays generic; command's own `--help` shows the new options via Commander automatically).
- Modify `src/lang/en.ts` — new message constants for the new error paths.
- Create `src/__tests__/app-types/ui/authoring.test.ts` — unit tests for `resolveUiAppNonInteractive` and `buildSurfacePointList`.
- Modify `src/__tests__/commands/app/create.test.ts` — integration tests for both new input modes through `createCommand`.
- Modify `agent-context/SKILL.md` and `agent-context/AGENTS.md` — replace the "interactive terminal only" claim.
- Run `yarn changeset` — new user-visible flags.

---

### Task 1: Export `buildSurfacePointList` and add unit tests for it

**Files:**
- Modify: `src/app-types/ui/authoring.ts:469` (remove the file-local visibility, add `export`)
- Test: `src/__tests__/app-types/ui/authoring.test.ts` (new file)

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/app-types/ui/authoring.test.ts
import { buildSurfacePointList } from '../../../app-types/ui/authoring';

describe('buildSurfacePointList', () => {
  const row = {
    extension_point_name: 'contactDetails.headerMenu.action',
    surface_point_name: 'contactDetails.header.menu',
    location_name: 'contactDetails',
    section_name: 'Header',
    component_type: 'menu',
  };

  it('builds one entry per row with the CTA fields attached', () => {
    const entries = buildSurfacePointList([row as never], {
      contextFor: () => [],
      sizeFor: () => undefined,
      label: 'Open in Acme',
      more_info: '',
      redirect_link: 'https://example.com/open',
    });

    expect(entries).toEqual([
      {
        surface_point_name: 'contactDetails.header.menu',
        label: 'Open in Acme',
        redirect_link: 'https://example.com/open',
      },
    ]);
  });

  it('dedupes rows by surface_point_name', () => {
    const entries = buildSurfacePointList([row as never, row as never], {
      contextFor: () => [],
      sizeFor: () => undefined,
      label: 'Open in Acme',
      more_info: '',
      redirect_link: 'https://example.com/open',
    });

    expect(entries).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn jest src/__tests__/app-types/ui/authoring.test.ts`
Expected: FAIL — `buildSurfacePointList` is not exported from `../../../app-types/ui/authoring` (TypeScript/module error, since the function is currently declared without `export`).

- [ ] **Step 3: Export the function**

In `src/app-types/ui/authoring.ts`, change:

```typescript
function buildSurfacePointList(
```

to:

```typescript
export function buildSurfacePointList(
```

Also update the module doc comment at the top of the file (lines 10–13), which currently reads:

```typescript
 * Only `resolveUiApp` and `renderCreatedUiApp` are public. Everything else is an
 * implementation detail of the prompt flow and is deliberately not exported — the
 * registry-shaped helpers in particular (`toUsableRows`, `rowSupportsExtensionType`) are
 * only correct in the order this flow calls them.
```

to:

```typescript
 * `resolveUiApp`, `resolveUiAppNonInteractive`, `renderCreatedUiApp` and
 * `buildSurfacePointList` are public. Everything else is an implementation detail of
 * the prompt flow and is deliberately not exported — the registry-shaped helpers in
 * particular (`toUsableRows`, `rowSupportsExtensionType`) are only correct in the
 * order this flow calls them.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn jest src/__tests__/app-types/ui/authoring.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/app-types/ui/authoring.ts src/__tests__/app-types/ui/authoring.test.ts
git commit -m "refactor: export buildSurfacePointList for reuse by non-interactive create"
```

---

### Task 2: Add error messages for the new non-interactive paths

**Files:**
- Modify: `src/lang/en.ts` (add near the existing `APP_CREATE_UI_*` block, after `APP_CREATE_UI_POINTS_NONE_FOR_TYPE`)

- [ ] **Step 1: Write the failing test**

```typescript
// Add to src/__tests__/lang/en.test.ts, inside the existing describe block
// (mirrors how other message functions are already asserted there)
it('APP_CREATE_UI_NONINTERACTIVE_EXTENSION_TYPE names the unsupported type', () => {
  expect(messages.APP_CREATE_UI_NONINTERACTIVE_EXTENSION_TYPE('iframeExtension')).toContain(
    'iframeExtension',
  );
});

it('APP_CREATE_UI_NONINTERACTIVE_BOTH_INPUTS rejects both --ui-config and --ui-app', () => {
  expect(messages.APP_CREATE_UI_NONINTERACTIVE_BOTH_INPUTS).toContain('--ui-config');
  expect(messages.APP_CREATE_UI_NONINTERACTIVE_BOTH_INPUTS).toContain('--ui-app');
});

it('APP_CREATE_UI_NONINTERACTIVE_MISSING_FLAGS names the missing flags', () => {
  expect(messages.APP_CREATE_UI_NONINTERACTIVE_MISSING_FLAGS(['--record-page', '--url'])).toBe(
    'Missing required flag(s) for --ui-app: --record-page, --url.',
  );
});

it('APP_CREATE_UI_NONINTERACTIVE_OAUTH_FLAG rejects OAuth-only flags on a UI app', () => {
  expect(messages.APP_CREATE_UI_NONINTERACTIVE_OAUTH_FLAG('--redirect-uri')).toContain(
    '--redirect-uri',
  );
});

it('APP_CREATE_UI_NONINTERACTIVE_CONFIG_INVALID wraps the parse error', () => {
  expect(messages.APP_CREATE_UI_NONINTERACTIVE_CONFIG_INVALID('cfg.json', 'Unexpected token')).toBe(
    'Could not read --ui-config "cfg.json": Unexpected token',
  );
});

it('APP_CREATE_UI_NONINTERACTIVE_UNKNOWN_RECORD_PAGE lists the valid pages', () => {
  expect(
    messages.APP_CREATE_UI_NONINTERACTIVE_UNKNOWN_RECORD_PAGE('bogus', ['contactDetails', 'deal']),
  ).toBe('Unknown --record-page "bogus". Valid record pages: contactDetails, deal.');
});

it('APP_CREATE_UI_NONINTERACTIVE_UNKNOWN_PLACEMENT lists the valid placements', () => {
  expect(
    messages.APP_CREATE_UI_NONINTERACTIVE_UNKNOWN_PLACEMENT('bogus', 'contactDetails', [
      'contactDetails.header.menu',
    ]),
  ).toBe(
    'Unknown --placement "bogus" for record page "contactDetails". Valid placements: contactDetails.header.menu.',
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn jest src/__tests__/lang/en.test.ts`
Expected: FAIL — `messages.APP_CREATE_UI_NONINTERACTIVE_*` is undefined.

- [ ] **Step 3: Add the messages**

In `src/lang/en.ts`, immediately after the existing entry:

```typescript
  APP_CREATE_UI_POINTS_NONE_FOR_TYPE: (extensionType: string) =>
    `None of the available placements can host a "${extensionType}" extension. This environment's extension-point registry may predate it — try again later.`,
```

add:

```typescript
  // Non-interactive UI app creation (--ui-config / --ui-app). This iteration only
  // supports actionLink — iframeExtension/legacyComponent are refused here, before
  // the shared validateUiApp() runs, so the message is specific to this entry point
  // rather than the generic "unsupported extension_type" one validateUiApp raises
  // for a hand-edited app-config.json.
  APP_CREATE_UI_NONINTERACTIVE_EXTENSION_TYPE: (extensionType: string) =>
    `Non-interactive UI app creation only supports "actionLink" today (got "${extensionType}"). Create the app interactively instead, or edit app-config.json and use \`brevo app upload\` for other extension types.`,
  APP_CREATE_UI_NONINTERACTIVE_BOTH_INPUTS:
    '--ui-config and --ui-app cannot be used together. Choose one.',
  APP_CREATE_UI_NONINTERACTIVE_MISSING_FLAGS: (flags: string[]) =>
    `Missing required flag(s) for --ui-app: ${flags.join(', ')}.`,
  APP_CREATE_UI_NONINTERACTIVE_OAUTH_FLAG: (flag: string) =>
    `${flag} is for OAuth apps only and cannot be combined with --ui-config or --ui-app.`,
  APP_CREATE_UI_NONINTERACTIVE_CONFIG_INVALID: (file: string, reason: string) =>
    `Could not read --ui-config "${file}": ${reason}`,
  APP_CREATE_UI_NONINTERACTIVE_UNKNOWN_RECORD_PAGE: (page: string, valid: string[]) =>
    `Unknown --record-page "${page}". Valid record pages: ${valid.join(', ')}.`,
  APP_CREATE_UI_NONINTERACTIVE_UNKNOWN_PLACEMENT: (
    placement: string,
    page: string,
    valid: string[],
  ) =>
    `Unknown --placement "${placement}" for record page "${page}". Valid placements: ${valid.join(', ')}.`,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn jest src/__tests__/lang/en.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lang/en.ts src/__tests__/lang/en.test.ts
git commit -m "feat(lang): add messages for non-interactive UI app creation"
```

---

### Task 3: `resolveUiAppNonInteractive()` in `authoring.ts`

**Files:**
- Modify: `src/app-types/ui/authoring.ts`
- Test: `src/__tests__/app-types/ui/authoring.test.ts`

This is the core function. It accepts the already-merged input (from either `--ui-config` or the flag set — merging happens in `create.ts`, Task 4), does the registry lookups, builds the entry, validates it, and returns a `UiApp`.

- [ ] **Step 1: Write the failing tests**

Add to `src/__tests__/app-types/ui/authoring.test.ts` (mock `appService` the same way `create.test.ts` does — check that file for the exact mock shape before writing this, since `resolveUiAppNonInteractive` calls `appService.fetchSurfacePointLocations` and `appService.fetchSurfacePoints` via the two existing private helpers):

```typescript
import { resolveUiAppNonInteractive } from '../../../app-types/ui/authoring';
import { appService } from '../../../container';
import { CliError } from '../../../lib/errors';

jest.mock('../../../container', () => ({
  appService: {
    fetchSurfacePointLocations: jest.fn(),
    fetchSurfacePoints: jest.fn(),
  },
}));

describe('resolveUiAppNonInteractive', () => {
  const mockedAppService = appService as jest.Mocked<typeof appService>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const row = {
    extension_point_name: 'contactDetails.headerMenu.action',
    surface_point_name: 'contactDetails.header.menu',
    location_name: 'contactDetails',
    section_name: 'Header',
    component_type: 'menu',
  };

  it('builds a valid UiApp from flag input', async () => {
    mockedAppService.fetchSurfacePointLocations.mockResolvedValue(['contactDetails']);
    mockedAppService.fetchSurfacePoints.mockResolvedValue([row as never]);

    const uiApp = await resolveUiAppNonInteractive({
      extensionType: 'actionLink',
      recordPage: 'contactDetails',
      placement: 'contactDetails.header.menu',
      label: 'Open in Acme',
      moreInfo: '',
      url: 'https://example.com/open',
    });

    expect(uiApp).toEqual({
      extension_type: 'actionLink',
      surface_point_list: [
        {
          surface_point_name: 'contactDetails.header.menu',
          label: 'Open in Acme',
          redirect_link: 'https://example.com/open',
        },
      ],
    });
  });

  it('rejects a non-actionLink extension type before any network call', async () => {
    await expect(
      resolveUiAppNonInteractive({
        extensionType: 'iframeExtension',
        recordPage: 'contactDetails',
        placement: 'contactDetails.header.menu',
        label: 'Open in Acme',
        moreInfo: '',
        url: 'https://example.com/open',
      }),
    ).rejects.toThrow(CliError);
    expect(mockedAppService.fetchSurfacePointLocations).not.toHaveBeenCalled();
  });

  it('rejects an unknown --record-page and lists the valid ones', async () => {
    mockedAppService.fetchSurfacePointLocations.mockResolvedValue(['contactDetails', 'deal']);

    await expect(
      resolveUiAppNonInteractive({
        extensionType: 'actionLink',
        recordPage: 'bogus',
        placement: 'contactDetails.header.menu',
        label: 'Open in Acme',
        moreInfo: '',
        url: 'https://example.com/open',
      }),
    ).rejects.toThrow('Unknown --record-page "bogus". Valid record pages: contactDetails, deal.');
  });

  it('rejects an unknown --placement and lists the valid ones for that page', async () => {
    mockedAppService.fetchSurfacePointLocations.mockResolvedValue(['contactDetails']);
    mockedAppService.fetchSurfacePoints.mockResolvedValue([row as never]);

    await expect(
      resolveUiAppNonInteractive({
        extensionType: 'actionLink',
        recordPage: 'contactDetails',
        placement: 'bogus',
        label: 'Open in Acme',
        moreInfo: '',
        url: 'https://example.com/open',
      }),
    ).rejects.toThrow(
      'Unknown --placement "bogus" for record page "contactDetails". Valid placements: contactDetails.header.menu.',
    );
  });

  it('rejects a label over 48 characters via the shared validateUiApp check', async () => {
    mockedAppService.fetchSurfacePointLocations.mockResolvedValue(['contactDetails']);
    mockedAppService.fetchSurfacePoints.mockResolvedValue([row as never]);

    await expect(
      resolveUiAppNonInteractive({
        extensionType: 'actionLink',
        recordPage: 'contactDetails',
        placement: 'contactDetails.header.menu',
        label: 'x'.repeat(49),
        moreInfo: '',
        url: 'https://example.com/open',
      }),
    ).rejects.toThrow(CliError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn jest src/__tests__/app-types/ui/authoring.test.ts`
Expected: FAIL — `resolveUiAppNonInteractive` is not exported.

- [ ] **Step 3: Implement `resolveUiAppNonInteractive`**

In `src/app-types/ui/authoring.ts`, add this type and function after `resolveUiApp` (after line 438, before the `buildSurfacePointList` JSDoc):

```typescript
/** Already-merged input for non-interactive UI app creation — see `create.ts` for how
 * `--ui-config` and the `--ui-app` flag set both resolve to this same shape before
 * this function ever runs. */
export interface UiAppNonInteractiveInput {
  extensionType: string;
  recordPage: string;
  placement: string;
  label: string;
  moreInfo: string;
  url: string;
}

/**
 * Non-interactive counterpart to `resolveUiApp()` — same registry reads, same entry
 * builder, same `validateUiApp()` call, but driven by already-collected input instead
 * of prompts. Reachable from `--ui-config`/`--ui-app` regardless of TTY/`--json`/piped
 * stdin (see `create.ts`'s interception point ahead of `resolveAppType`).
 *
 * Scoped to `actionLink` only, same as the interactive flow (see the module comment
 * above on why iframe authoring isn't offered) — checked first, before any network
 * call, so an iframe/legacy request fails immediately rather than after two registry
 * round trips.
 */
export async function resolveUiAppNonInteractive(
  input: UiAppNonInteractiveInput,
): Promise<UiApp> {
  if (input.extensionType !== EXTENSION_TYPE_ACTION_LINK) {
    throw new CliError(
      messages.APP_CREATE_UI_NONINTERACTIVE_EXTENSION_TYPE(input.extensionType),
    );
  }

  const locations = await fetchRecordPageLocations(input.extensionType);
  if (!locations.includes(input.recordPage)) {
    throw new CliError(
      messages.APP_CREATE_UI_NONINTERACTIVE_UNKNOWN_RECORD_PAGE(input.recordPage, locations),
    );
  }

  const rows = await fetchSurfacePointsForPages([input.recordPage], input.extensionType);
  const forPage = rows.filter((row) => row.location_name === input.recordPage);
  const matched = forPage.filter((row) => row.surface_point_name === input.placement);
  if (matched.length === 0) {
    throw new CliError(
      messages.APP_CREATE_UI_NONINTERACTIVE_UNKNOWN_PLACEMENT(
        input.placement,
        input.recordPage,
        forPage.map((row) => row.surface_point_name),
      ),
    );
  }

  const uiApp: UiApp = {
    extension_type: input.extensionType as UiApp['extension_type'],
    surface_point_list: buildSurfacePointList(matched, {
      contextFor: (row) => row.default_context_field ?? [],
      sizeFor: (row) => row.default_size ?? undefined,
      label: input.label.trim(),
      more_info: input.moreInfo.trim(),
      redirect_link: input.url.trim(),
    }),
  };

  validateUiApp(uiApp);
  return uiApp;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn jest src/__tests__/app-types/ui/authoring.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Run the full test suite to check for regressions**

Run: `yarn test`
Expected: PASS, all suites (existing `create.test.ts` and `wire.test.ts` in particular, since `authoring.ts` is shared).

- [ ] **Step 6: Commit**

```bash
git add src/app-types/ui/authoring.ts src/__tests__/app-types/ui/authoring.test.ts
git commit -m "feat(app-create): add resolveUiAppNonInteractive for --ui-config/--ui-app"
```

---

### Task 4: Wire `--ui-config` / `--ui-app` flags into `definitions.ts` and `create.ts`

**Files:**
- Modify: `src/commands/definitions.ts:88-121`
- Modify: `src/commands/app/create.ts`
- Test: `src/__tests__/commands/app/create.test.ts`

- [ ] **Step 1: Write the failing integration tests**

First, open `src/__tests__/commands/app/create.test.ts` and find the existing mock setup for `appService`, `inquirer`, and `process.stdin.isTTY` (the file already has UI-app-flow tests for the interactive path — follow that exact mock shape, do not re-derive it). Add these cases to the same `describe('createCommand', ...)` block, using `jest.mock('fs')`/`jest.mock('fs/promises')`-consistent file reads (check how the file currently mocks `fs` if `--ui-config` needs a real temp file — prefer `fs.readFileSync` mocked via `jest.spyOn(fs, 'readFileSync')` matching the codebase's existing pattern, since `create.ts` already imports `node:fs`):

```typescript
describe('non-interactive UI app creation', () => {
  const surfacePointRow = {
    extension_point_name: 'contactDetails.headerMenu.action',
    surface_point_name: 'contactDetails.header.menu',
    location_name: 'contactDetails',
    section_name: 'Header',
    component_type: 'menu',
  };

  beforeEach(() => {
    mockedAppService.fetchSurfacePointLocations.mockResolvedValue(['contactDetails']);
    mockedAppService.fetchSurfacePoints.mockResolvedValue([surfacePointRow as never]);
  });

  it('creates a UI app from --ui-app flags without a TTY', async () => {
    process.stdin.isTTY = false as never;
    mockedAppService.createApp.mockResolvedValue({
      app_id: 'app-1',
      name: 'My App',
      version: '1',
    } as never);

    await createCommand({
      name: 'My App',
      distribution: 'private',
      json: true,
      uiApp: true,
      recordPage: 'contactDetails',
      placement: 'contactDetails.header.menu',
      label: 'Open in Acme',
      url: 'https://example.com/open',
    } as never);

    expect(mockedAppService.createApp).toHaveBeenCalledWith(
      expect.objectContaining({
        ui_app: {
          extension_type: 'actionLink',
          surface_point_list: [
            {
              surface_point_name: 'contactDetails.header.menu',
              label: 'Open in Acme',
              redirect_link: 'https://example.com/open',
            },
          ],
        },
      }),
    );
  });

  it('rejects --ui-app missing required companion flags', async () => {
    process.stdin.isTTY = false as never;

    await expect(
      createCommand({
        name: 'My App',
        distribution: 'private',
        json: true,
        uiApp: true,
        label: 'Open in Acme',
      } as never),
    ).rejects.toThrow(/Missing required flag/);
    expect(mockedAppService.createApp).not.toHaveBeenCalled();
  });

  it('rejects --ui-app combined with --redirect-uri', async () => {
    process.stdin.isTTY = false as never;

    await expect(
      createCommand({
        name: 'My App',
        distribution: 'private',
        json: true,
        uiApp: true,
        recordPage: 'contactDetails',
        placement: 'contactDetails.header.menu',
        label: 'Open in Acme',
        url: 'https://example.com/open',
        redirectUri: ['http://localhost:3000/callback'],
      } as never),
    ).rejects.toThrow(/--redirect-uri/);
    expect(mockedAppService.createApp).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn jest src/__tests__/commands/app/create.test.ts -t "non-interactive UI app creation"`
Expected: FAIL — `createCommand` doesn't recognize `uiApp`/`recordPage`/`placement`/`url` options yet, so it falls through to the OAuth path and `createApp` is called with `auth`, not `ui_app`.

- [ ] **Step 3: Add the flags to `definitions.ts`**

Replace the comment and options block at `src/commands/definitions.ts:88-121`:

```typescript
      // A UI app is authored either through the interactive prompts (BEX-290), or
      // non-interactively via --ui-config or the --ui-app flag set — both build an
      // actionLink placement the same way the wizard does (see
      // resolveUiAppNonInteractive in app-types/ui/authoring.ts). Every other flag
      // below applies to an OAuth app.
      options: [
        { flags: '--name <name>', description: 'App name' },
        {
          flags: '--distribution <type>',
          description: `Distribution type (${distributionValues()})`,
        },
        {
          flags: '--redirect-uri <url>',
          description: 'Redirect URI (repeatable, OAuth apps only)',
          parser: collectUrls,
        },
        {
          flags: '--logo-uri <url>',
          description: 'App logo URL (http or https)',
          parser: (v: string) => {
            validateUrl(v, 'logo URL');
            return v;
          },
        },
        {
          flags: '--ui-config <file>',
          description:
            'Create an actionLink UI app from a JSON file (non-interactive; see --help)',
        },
        { flags: '--ui-app', description: 'Create an actionLink UI app from flags below' },
        { flags: '--record-page <slug>', description: 'UI app record page (with --ui-app)' },
        {
          flags: '--placement <surface_point_name>',
          description: 'UI app placement slot (with --ui-app)',
        },
        { flags: '--label <text>', description: 'UI app menu/card label, max 48 chars (with --ui-app)' },
        {
          flags: '--more-info <text>',
          description: 'UI app supporting text, max 255 chars, optional (with --ui-app)',
        },
        { flags: '--url <url>', description: 'UI app destination URL (with --ui-app)' },
        { flags: '--json', description: 'Output as JSON' },
      ],
      handler: (opts) =>
        createCommand({
          name: opts.name as string | undefined,
          distribution: opts.distribution as string | undefined,
          redirectUri: opts.redirectUri as string[] | undefined,
          logoUri: opts.logoUri as string | undefined,
          uiConfig: opts.uiConfig as string | undefined,
          uiApp: Boolean(opts.uiApp),
          recordPage: opts.recordPage as string | undefined,
          placement: opts.placement as string | undefined,
          label: opts.label as string | undefined,
          moreInfo: opts.moreInfo as string | undefined,
          url: opts.url as string | undefined,
          json: Boolean(opts.json),
        }),
```

Also extend the `examples` array (right above `options`) with two new lines, right after the existing logo example:

```typescript
        'brevo app create --name "My App" --distribution private --logo-uri https://example.com/logo.png',
        'brevo app create --name "My App" --ui-app --record-page contactDetails --placement contactDetails.header.menu --label "Open in Acme" --url https://example.com/open --json',
        'brevo app create --name "My App" --ui-config ./ui-app.json --json',
```

- [ ] **Step 4: Wire the new inputs through `create.ts`**

In `src/commands/app/create.ts`:

1. Add the import (next to the existing `resolveUiApp, renderCreatedUiApp` import at line 45):

```typescript
import {
  resolveUiApp,
  resolveUiAppNonInteractive,
  renderCreatedUiApp,
  UiAppNonInteractiveInput,
} from '../../app-types/ui/authoring';
```

2. Add `EXTENSION_TYPE_ACTION_LINK` to the existing `constants` import at line 4:

```typescript
import { CLI, DEFAULT_PORT, DEFAULT_REDIRECT_URI, DEFAULT_SCOPES, EXTENSION_TYPE_ACTION_LINK } from '../../lib/constants';
```

3. Add a new function, right before `resolveAppType` (before line 115), that merges `--ui-config`/`--ui-app` into a `UiAppNonInteractiveInput | undefined` and validates the flag combinations:

```typescript
interface CreateOptionsForUiApp {
  uiConfig?: string;
  uiApp?: boolean;
  recordPage?: string;
  placement?: string;
  label?: string;
  moreInfo?: string;
  url?: string;
  redirectUri?: string[];
  logoUri?: string;
}

/**
 * Merge `--ui-config`/`--ui-app` into one input shape, or `undefined` when neither
 * was passed — the signal `create()` uses to decide the app type without going
 * through `resolveAppType`'s TTY check at all. Throws before any network call for
 * every invalid combination (both inputs given, missing required flags, an
 * OAuth-only flag alongside either).
 */
function resolveUiAppNonInteractiveInput(
  opts: CreateOptionsForUiApp,
): UiAppNonInteractiveInput | undefined {
  const hasConfig = !!opts.uiConfig;
  const hasFlags = !!opts.uiApp;
  if (!hasConfig && !hasFlags) return undefined;
  if (hasConfig && hasFlags) {
    throw new CliError(messages.APP_CREATE_UI_NONINTERACTIVE_BOTH_INPUTS);
  }

  if ((opts.redirectUri?.length ?? 0) > 0) {
    throw new CliError(messages.APP_CREATE_UI_NONINTERACTIVE_OAUTH_FLAG('--redirect-uri'));
  }

  if (hasConfig) {
    let raw: string;
    try {
      raw = fs.readFileSync(opts.uiConfig!, 'utf-8');
    } catch (err) {
      throw new CliError(
        messages.APP_CREATE_UI_NONINTERACTIVE_CONFIG_INVALID(
          opts.uiConfig!,
          err instanceof Error ? err.message : String(err),
        ),
      );
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new CliError(
        messages.APP_CREATE_UI_NONINTERACTIVE_CONFIG_INVALID(
          opts.uiConfig!,
          err instanceof Error ? err.message : String(err),
        ),
      );
    }
    return {
      extensionType: String(parsed.extension_type ?? ''),
      recordPage: String(parsed.record_page ?? ''),
      placement: String(parsed.surface_point_name ?? ''),
      label: String(parsed.label ?? ''),
      moreInfo: String(parsed.more_info ?? ''),
      url: String(parsed.redirect_link ?? ''),
    };
  }

  const required: Array<[key: keyof CreateOptionsForUiApp, flag: string]> = [
    ['recordPage', '--record-page'],
    ['placement', '--placement'],
    ['label', '--label'],
    ['url', '--url'],
  ];
  const missing = required.filter(([key]) => !opts[key]).map(([, flag]) => flag);
  if (missing.length > 0) {
    throw new CliError(messages.APP_CREATE_UI_NONINTERACTIVE_MISSING_FLAGS(missing));
  }

  return {
    extensionType: EXTENSION_TYPE_ACTION_LINK,
    recordPage: opts.recordPage!,
    placement: opts.placement!,
    label: opts.label!,
    moreInfo: opts.moreInfo ?? '',
    url: opts.url!,
  };
}
```

4. In the `createCommand` handler, update the options type (line 554-560) to include the new fields:

```typescript
  async (options: {
    name?: string;
    distribution?: string;
    redirectUri?: string[];
    logoUri?: string;
    uiConfig?: string;
    uiApp?: boolean;
    recordPage?: string;
    placement?: string;
    label?: string;
    moreInfo?: string;
    url?: string;
    json?: boolean;
  }): Promise<void> => {
```

5. Right after `guardAgainstLinkedApp(); assertDistributionFlag(options.distribution);` (around line 564-565), resolve the non-interactive UI-app input and use it to short-circuit `resolveAppType`:

```typescript
    guardAgainstLinkedApp();
    assertDistributionFlag(options.distribution);
    const nonInteractiveUiAppInput = resolveUiAppNonInteractiveInput(options);

    const interactive = !jsonMode && !!process.stdin.isTTY;

    const appName = await resolveAppName(options.name);
    const logoUri = await resolveLogoUri(options.logoUri, jsonMode);
    const distribution = await resolveDistribution(options.distribution, interactive);
    const appType: AppType = nonInteractiveUiAppInput
      ? 'ui'
      : await resolveAppType(interactive);

    let redirectUris: string[] = [];
    let uiApp: UiApp | undefined;
    if (appType === 'ui') {
      uiApp = nonInteractiveUiAppInput
        ? await resolveUiAppNonInteractive(nonInteractiveUiAppInput)
        : await resolveUiApp();
    } else {
      redirectUris = await resolveRedirectUrls(options.redirectUri, jsonMode);
    }
```

This replaces the existing four lines:

```typescript
    const appName = await resolveAppName(options.name);
    const logoUri = await resolveLogoUri(options.logoUri, jsonMode);
    const distribution = await resolveDistribution(options.distribution, interactive);
    const appType = await resolveAppType(interactive);

    // The two app types diverge here: OAuth apps collect callback URLs, UI apps
    // collect placement + destination. Neither path runs the other's prompts.
    let redirectUris: string[] = [];
    let uiApp: UiApp | undefined;
    if (appType === 'ui') {
      uiApp = await resolveUiApp();
    } else {
      redirectUris = await resolveRedirectUrls(options.redirectUri, jsonMode);
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn jest src/__tests__/commands/app/create.test.ts`
Expected: PASS, including the three new cases and every pre-existing case in the file (the interactive UI-app path and the plain OAuth non-interactive path must both be unaffected — `nonInteractiveUiAppInput` is `undefined` for both, so `resolveAppType` still runs exactly as before).

- [ ] **Step 6: Run the full suite, lint, and build**

Run: `yarn test && yarn lint && yarn build`
Expected: all three pass with no errors.

- [ ] **Step 7: Commit**

```bash
git add src/commands/definitions.ts src/commands/app/create.ts src/__tests__/commands/app/create.test.ts
git commit -m "feat(app-create): add --ui-config and --ui-app for non-interactive actionLink UI apps"
```

---

### Task 5: Docs sync — `SKILL.md` and `AGENTS.md`

**Files:**
- Modify: `agent-context/SKILL.md`
- Modify: `agent-context/AGENTS.md`

- [ ] **Step 1: Locate the stale claim in each file**

```bash
grep -n "interactive terminal" agent-context/SKILL.md agent-context/AGENTS.md
```

Expected output includes the line CLAUDE.md names: `agent-context/SKILL.md` around line 56 and `agent-context/AGENTS.md` around line 80, each stating "a UI app can only be authored from an interactive terminal... every non-interactive run creates an OAuth app."

- [ ] **Step 2: Read both matched lines in full context**

Use the Read tool on each file around the matched line numbers (±10 lines) to see the exact current wording and any neighboring cross-references (CLAUDE.md notes an "OAuth vs UI app discriminator" section may also reference this).

- [ ] **Step 3: Rewrite the claim in both files**

Replace the "interactive terminal only" sentence in each file with something equivalent to:

```
A UI app is authored interactively (`brevo app create`, choose "UI app"), or
non-interactively with `brevo app create --ui-app --record-page <slug> --placement
<surface_point_name> --label <text> --url <url> [--more-info <text>]`, or
`--ui-config <file>` (a JSON file: `{ extension_type, record_page,
surface_point_name, label, more_info?, redirect_link }`). Only `extension_type:
"actionLink"` is supported non-interactively today. Any non-interactive run that
passes neither `--ui-config` nor `--ui-app` still creates an OAuth app.
```

Adjust wording to match each file's surrounding style (SKILL.md is terser/Claude-focused; AGENTS.md is the broader table-format reference — CLAUDE.md's own guidance on their difference applies).

- [ ] **Step 4: Grep for any other stale cross-reference**

```bash
grep -rn "only be authored from an interactive\|non-interactive run.*creates an OAuth\|there is no.*--type.*flag" agent-context/
```

Fix any additional hits the same way.

- [ ] **Step 5: Commit**

```bash
git add agent-context/SKILL.md agent-context/AGENTS.md
git commit -m "docs: sync agent docs for non-interactive UI app creation"
```

---

### Task 6: Changeset

- [ ] **Step 1: Check for an existing pending changeset**

```bash
ls .changeset/*.md | grep -v README.md
```

If one exists (per `CLAUDE.md`'s "one changeset per branch" rule), append to it instead of creating a new one. This branch is new, so none is expected — proceed to Step 2.

- [ ] **Step 2: Create the changeset**

Run: `yarn changeset`
- Select `minor` (new user-facing flags, backward compatible).
- Summary: `Add --ui-config and --ui-app flags for non-interactive actionLink UI app creation`

- [ ] **Step 3: Commit**

```bash
git add .changeset/
git commit -m "chore: add changeset for non-interactive UI app creation"
```

---

### Task 7: Final verification, spec cleanup, push, and PR

- [ ] **Step 1: Full verification**

```bash
yarn lint && yarn test:ci && yarn build
```
Expected: all green.

- [ ] **Step 2: Manual smoke check of `--help` output**

```bash
node -e "require('./dist/bin/index.js')" -- app create --help 2>&1 | head -40
```
(Or `node dist/bin/index.js app create --help` if that's the built entry — check `package.json`'s `bin` field for the exact path.) Confirm the new flags and both new examples render correctly and no existing option/example was dropped.

- [ ] **Step 3: Remove the design spec per user instruction**

```bash
git rm docs/superpowers/specs/2026-09-02-ui-app-noninteractive-create-design.md
git commit -m "chore: remove design spec now that it's implemented"
```

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin feat/ui-app-noninteractive-create
gh pr create --title "feat(app-create): non-interactive actionLink UI app creation" --body "$(cat <<'EOF'
## Summary
- Adds `--ui-config <file>` and `--ui-app`/`--record-page`/`--placement`/`--label`/`--more-info`/`--url` to `brevo app create`, so a script or agent can create an `actionLink` UI app without a TTY instead of silently getting an OAuth app.
- Reuses the interactive wizard's own registry validation (`fetchRecordPageLocations`/`fetchSurfacePointsForPages`) and `validateUiApp()` — no new validation logic, no local slot-name list.
- Scoped to `actionLink` only for now; `iframeExtension`/`legacyComponent` are rejected with a clear error. Still one placement per `create` call, matching the interactive wizard.
- An invalid `--record-page`/`--placement` lists the valid options pulled from the same registry read, so a caller can retry without a separate lookup command.
- `agent-context/SKILL.md` and `agent-context/AGENTS.md` updated to describe the new flags instead of the old "interactive terminal only" restriction.

## Test plan
- [x] `yarn test:ci` — full suite green, including new `authoring.test.ts` and the new `create.test.ts` cases
- [x] `yarn lint`
- [x] `yarn build`
- [ ] Manual: `brevo app create --ui-app --record-page <slug> --placement <slug> --label "..." --url https://... --json` against a real account
- [ ] Manual: `brevo app create --ui-config ./ui-app.json --json`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Report the PR URL back to the user.**

---

## Self-review notes (already applied above)

- Spec coverage: CLI surface (Task 4), flow interception point (Task 4), registry validation reuse (Task 3), discovery-via-errors (Task 2 + 3), error handling table (Tasks 2–4), actionLink-only scope (Task 3 Step 1 check), docs sync (Task 5), changeset (Task 6), testing (Tasks 1, 3, 4) — all covered.
- No placeholders: every step above has real, complete code — nothing marked TBD.
- Type consistency checked: `UiAppNonInteractiveInput` fields (`extensionType`, `recordPage`, `placement`, `label`, `moreInfo`, `url`) are named identically in Task 3's function signature, Task 4's merge function, and every test in Tasks 3–4.
