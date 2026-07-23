# Decouple Create/Scaffold Directory Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split directory setup (mkdir + `chdir`) out of scaffolding for `brevo app create`, make `create` hard-error (no confirm, no override) when `app-config.json` already exists in cwd, add a "what kind of project?" prompt to scaffolding (one option today: *Test OAuth App*), and make standalone `brevo app scaffold` directory-aware — no linked project (directory setup), same app linked (diff against the server, ask consent only if it differs, full overwrite on consent), different app linked (must pick a new directory or cancel) — instead of today's blanket refusal.

**Architecture:** Two new shared helpers in `scaffold.ts` — `resolveProjectDirectory` (prompt + mkdir + `chdir`, extracted from today's `resolveTargetDir`) and `promptProjectType` (new, single-choice) — used by both `scaffoldCommand` and `create.ts`. A new `resolveScaffoldTarget` branches `scaffoldCommand` on whether/whose `app-config.json` is in cwd, using a new `diffLocalConfig` helper for the same-app case. `create.ts` gains its own `resolveCreateDirectory` (interactive: reuses `resolveProjectDirectory`; non-interactive/`--json`: mirrors today's exists-then-skip logic, just earlier) and calls the shared scaffold pieces directly instead of routing through `scaffoldCommand`. `create.ts`'s existing soft "create anyway?" confirm over a linked directory is replaced with an unconditional throw.

**Tech Stack:** TypeScript, Jest/ts-jest, inquirer, Node `fs`/`path`/`process.chdir`.

**Spec:** `docs/superpowers/specs/2026-07-23-create-scaffold-directory-flow-design.md`

---

## Task 1: New/removed strings in `src/lang/en.ts`

**Files:**
- Modify: `src/lang/en.ts:59-84` (App create section), `src/lang/en.ts:137-148` (App scaffold section)
- Test: `src/__tests__/lang/en.test.ts`

- [ ] **Step 1: Add the new `create` strings**

In `src/lang/en.ts`, in the `// App create` section, right after `APP_CREATE_JSON_SCAFFOLD_DIR_EXISTS` (line 84), add:

```ts
  APP_CREATE_DIR_EXISTS_SKIPPED: (dir: string) =>
    `Skipped scaffolding: directory already exists (${dir}). Run \`${CLI.APP_SCAFFOLD()}\` to choose a different path.`,
  APP_CREATE_ALREADY_LINKED: (name: string) =>
    `App "${name}" is already linked in this directory (app-config.json found). Move to a different directory to create a new app, or run \`${CLI.APP_SCAFFOLD()}\` here to refresh this project against the server.`,
```

- [ ] **Step 2: Replace the App scaffold strings**

In the `// App scaffold` section, replace the existing `APP_SCAFFOLD_ALREADY_IN_PROJECT` line (line 139) with:

```ts
  APP_SCAFFOLD_PROJECT_TYPE_PROMPT: 'What kind of project do you want to scaffold?',
  APP_SCAFFOLD_DIFF_INTRO: (name: string) =>
    `App "${name}" is linked here, but its local config differs from the server:`,
  APP_SCAFFOLD_DIFF_LINE: (field: string, local: string, server: string) =>
    `  ${field}: ${local} → ${server}`,
  APP_SCAFFOLD_DIFF_CONFIRM: 'Update app-config.json and regenerate scaffold files to match the server?',
  APP_SCAFFOLD_DIFFERENT_APP_PROMPT: (name: string) =>
    `This directory is linked to a different app ("${name}"). What would you like to do?`,
  APP_SCAFFOLD_CANCELLED: 'Scaffold cancelled.',
```

(Confirmed via grep in the spec that `APP_SCAFFOLD_ALREADY_IN_PROJECT`'s only other references are the `scaffold.ts` throw site being replaced in Task 3, and one `scaffold.test.ts` assertion being replaced in Task 3.)

- [ ] **Step 3: Verify the file still compiles**

Run: `yarn build`
Expected: TypeScript errors pointing at `scaffold.ts:228` (`APP_SCAFFOLD_ALREADY_IN_PROJECT` no longer exists) and `create.ts` (still calling the old `confirmCreateOverLinkedApp`, unaffected by this task but co-existing fine) — these dangling references are expected until Task 3 and Task 4 land; do not fix them here.

- [ ] **Step 4: Commit**

```bash
git add src/lang/en.ts
git commit -m "feat: add strings for create/scaffold directory flow"
```

---

## Task 2: `resolveProjectDirectory`, `promptProjectType`, `diffLocalConfig`, `reportScaffoldSuccess`, and the three-case `scaffoldCommand` rewrite

**Files:**
- Modify: `src/commands/app/scaffold.ts` (imports; replace `resolveTargetDir`; add new helpers; rewrite `scaffoldCommand`)
- Test: `src/__tests__/commands/app/scaffold.test.ts`

- [ ] **Step 1: Update imports**

At the top of `src/commands/app/scaffold.ts`, remove `import { CliError } from '../../lib/errors';` (no longer used once the hard refusal is gone) and add:

```ts
import { readProjectConfig, ProjectConfig } from '../../lib/config';
```

- [ ] **Step 2: Replace `resolveTargetDir` with `resolveProjectDirectory` (exported, now `chdir`s)**

Replace the entire `resolveTargetDir` function (lines 111-145) with:

```ts
export async function resolveProjectDirectory(
  defaultDir: string,
): Promise<{ targetDir: string; mergeOnly: boolean; chooseAgain: boolean }> {
  const { outputDir } = await inquirer.prompt([
    {
      type: 'input',
      name: 'outputDir',
      message: messages.APP_SCAFFOLD_DIR_PROMPT,
      default: defaultDir,
    },
  ]);
  const targetDir = path.resolve(outputDir);

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
    process.chdir(targetDir);
    return { targetDir, mergeOnly: false, chooseAgain: false };
  }

  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: messages.APP_SCAFFOLD_DIR_EXISTS,
      choices: [
        { name: 'Overwrite existing files', value: 'overwrite' },
        { name: 'Merge (keep existing, add missing)', value: 'merge' },
        { name: 'Choose a different path', value: 'new' },
      ],
    },
  ]);
  if (action === 'new') {
    return { targetDir, mergeOnly: false, chooseAgain: true };
  }
  process.chdir(targetDir);
  return { targetDir, mergeOnly: action === 'merge', chooseAgain: false };
}
```

This is the same logic as before, plus two new `process.chdir(targetDir)` calls — the process now actually moves into the resolved directory instead of just writing to a resolved path.

- [ ] **Step 3: Add `promptProjectType`**

Directly below `resolveProjectDirectory`, add:

```ts
export async function promptProjectType(interactive: boolean): Promise<'oauth'> {
  if (!interactive) return 'oauth';
  const { projectType } = await inquirer.prompt([
    {
      type: 'list',
      name: 'projectType',
      message: messages.APP_SCAFFOLD_PROJECT_TYPE_PROMPT,
      choices: [{ name: 'Test OAuth App', value: 'oauth' }],
    },
  ]);
  return projectType;
}
```

- [ ] **Step 4: Add `diffLocalConfig`**

Directly below `promptProjectType`, add:

```ts
interface ConfigDiff {
  field: string;
  local: string;
  server: string;
}

function diffLocalConfig(localConfig: ProjectConfig, ctx: AppContext): ConfigDiff[] {
  const diffs: ConfigDiff[] = [];

  const serverName = ctx.appDetails?.name;
  if (serverName && localConfig.appName !== serverName) {
    diffs.push({ field: 'appName', local: localConfig.appName, server: serverName });
  }

  const serverDistribution = ctx.appDetails?.distribution_type ?? 'private';
  if (localConfig.distribution_type !== serverDistribution) {
    diffs.push({
      field: 'distribution_type',
      local: localConfig.distribution_type,
      server: serverDistribution,
    });
  }

  const localRedirects = [...(localConfig.auth?.redirectUrls ?? [])].sort();
  const serverRedirects = [...ctx.redirectUrls].sort();
  if (JSON.stringify(localRedirects) !== JSON.stringify(serverRedirects)) {
    diffs.push({
      field: 'redirectUrls',
      local: localRedirects.join(', ') || '(none)',
      server: serverRedirects.join(', ') || '(none)',
    });
  }

  const localScopes = [...(localConfig.auth?.scopes ?? [])].sort();
  const serverScopes = [...(ctx.appDetails?.scopes ?? [])]
    .filter((s) => s !== LEGACY_ALL_SCOPE)
    .sort();
  if (JSON.stringify(localScopes) !== JSON.stringify(serverScopes)) {
    diffs.push({
      field: 'scopes',
      local: localScopes.join(', ') || '(none)',
      server: serverScopes.join(', ') || '(none)',
    });
  }

  const localLogo = localConfig.logoUri ?? '';
  const serverLogo = ctx.appDetails?.logo_uri ?? '';
  if (localLogo !== serverLogo) {
    diffs.push({ field: 'logoUri', local: localLogo || '(none)', server: serverLogo || '(none)' });
  }

  const localVersion = localConfig.version ?? '';
  const serverVersion = ctx.appDetails?.version ?? '';
  if (localVersion !== serverVersion) {
    diffs.push({
      field: 'version',
      local: localVersion || '(none)',
      server: serverVersion || '(none)',
    });
  }

  return diffs;
}
```

`LEGACY_ALL_SCOPE` is already imported at the top of `scaffold.ts` (used by `runScaffold`) — no new import needed.

- [ ] **Step 5: Add `reportScaffoldSuccess` and `resolveScaffoldTarget`, rewrite `scaffoldCommand`**

Replace the entire `export const scaffoldCommand = withCommandHandler(...)` block with:

```ts
export function reportScaffoldSuccess(result: {
  written: number;
  legacyAllSubstituted: boolean;
  scopes: string[];
  files: Array<{ name: string; content: string }>;
  targetDir: string;
}): void {
  logSuccess(messages.APP_SCAFFOLD_SUCCESS(result.written));
  if (result.legacyAllSubstituted) {
    logWarn(messages.LEGACY_ALL_SCOPE_SCAFFOLD_SUBSTITUTED(result.scopes.join(', ')));
  }
  logInfo(formatFileTree(result.files.map((f) => f.name)));

  const relativeDir = path.relative(process.cwd(), result.targetDir) || '.';
  printBox(
    messages.APP_SCAFFOLD_NEXT_STEPS_TITLE,
    messages.APP_SCAFFOLD_NEXT_STEPS_LINES(relativeDir),
  );
  logInfo(messages.APP_SCAFFOLD_SCOPES_TIP);
}

async function resolveScaffoldTarget(
  appId: string,
  slug: string,
  ctx: AppContext,
): Promise<{ targetDir: string; mergeOnly: boolean } | null> {
  const cwdConfigPath = path.join(process.cwd(), 'app-config.json');

  if (!fs.existsSync(cwdConfigPath)) {
    let dir = await resolveProjectDirectory(`./${slug}`);
    while (dir.chooseAgain) {
      dir = await resolveProjectDirectory(`./${slug}`);
    }
    return { targetDir: dir.targetDir, mergeOnly: dir.mergeOnly };
  }

  const localConfig = readProjectConfig();
  if (localConfig?.appId === appId) {
    const diffs = diffLocalConfig(localConfig, ctx);
    if (diffs.length === 0) {
      return { targetDir: process.cwd(), mergeOnly: true };
    }

    logInfo(messages.APP_SCAFFOLD_DIFF_INTRO(localConfig.appName || appId));
    for (const diff of diffs) {
      logInfo(messages.APP_SCAFFOLD_DIFF_LINE(diff.field, diff.local, diff.server));
    }
    const { confirmed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmed',
        message: messages.APP_SCAFFOLD_DIFF_CONFIRM,
        default: true,
      },
    ]);
    if (!confirmed) return null;
    return { targetDir: process.cwd(), mergeOnly: false };
  }

  const { choice } = await inquirer.prompt([
    {
      type: 'list',
      name: 'choice',
      message: messages.APP_SCAFFOLD_DIFFERENT_APP_PROMPT(localConfig?.appName || 'a different app'),
      choices: [
        { name: 'Choose a different directory', value: 'choose' },
        { name: 'Cancel', value: 'cancel' },
      ],
    },
  ]);
  if (choice === 'cancel') return null;

  let dir = await resolveProjectDirectory(`./${slug}`);
  while (dir.chooseAgain) {
    dir = await resolveProjectDirectory(`./${slug}`);
  }
  return { targetDir: dir.targetDir, mergeOnly: dir.mergeOnly };
}

export const scaffoldCommand = withCommandHandler(
  async (options: { appId?: string; json?: boolean }): Promise<void> => {
    const appId = options.appId ?? (await appService.pickApp('Select an app:'));
    const ctx = await fetchAppContext(appId, options.json);
    const slug = computeSlug(ctx.appDetails?.name);

    const target = await resolveScaffoldTarget(appId, slug, ctx);
    if (!target) {
      if (options.json) {
        jsonOutput({ cancelled: true });
        return;
      }
      logInfo(messages.APP_SCAFFOLD_CANCELLED);
      return;
    }

    await promptProjectType(!options.json);

    const { written, legacyAllSubstituted, scopes, files } = runScaffold(
      appId,
      ctx,
      target.targetDir,
      target.mergeOnly,
    );

    if (options.json) {
      jsonOutput({ scaffolded: written, directory: target.targetDir });
      return;
    }

    reportScaffoldSuccess({
      written,
      legacyAllSubstituted,
      scopes,
      files,
      targetDir: target.targetDir,
    });
  },
);
```

This removes the old top-of-function guard (`if (fs.existsSync(path.join(process.cwd(), 'app-config.json'))) throw new CliError(messages.APP_SCAFFOLD_ALREADY_IN_PROJECT)`) and the old recursive `chooseAgain` handling inlined in `scaffoldCommand` (now inside `resolveScaffoldTarget`).

- [ ] **Step 6: Update `scaffold.test.ts` — `process.chdir` spy, `readProjectConfig` mock**

Update the `jest.mock('../../../lib/config', ...)` block (around line 32) to:

```ts
jest.mock('../../../lib/config', () => ({
  getApiKey: jest.fn().mockReturnValue('test-key'),
  getAppCredentials: jest.fn(),
  saveAppCredentials: jest.fn(),
  readProjectConfig: jest.fn().mockReturnValue(null),
}));
```

Add the import alongside `import { appService } from '../../../container';`:

```ts
import { readProjectConfig } from '../../../lib/config';
```

Update `beforeEach`/`afterEach` (around lines 74-85):

```ts
  let chdirSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    chdirSpy = jest.spyOn(process, 'chdir').mockImplementation(() => undefined);
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    (fs.mkdirSync as jest.Mock).mockReturnValue(undefined);
    (fs.writeFileSync as jest.Mock).mockReturnValue(undefined);
    (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify({ version: '9.9.9' }));
    (readProjectConfig as jest.Mock).mockReturnValue(null);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    chdirSpy.mockRestore();
  });
```

- [ ] **Step 7: Add a second prompt answer (project type) to every existing `scaffoldCommand` call that resolves a directory interactively**

Append `.mockResolvedValueOnce({ projectType: 'oauth' })` to the end of the `mockPrompt` chain in each of these (FIFO order — `promptProjectType` is always called last, after directory resolution):

- `'should scaffold files for a given app ID'` (was line 99)
- `'should use API credentials for templates'` (was line 148)
- `'should pass cliVersion and DEFAULT_SCOPES into template vars'` (was line 169)
- `'should prefer localhost redirect URI over production URLs'` (was line 196)
- `'should fall back to DEFAULT_REDIRECT_URI when only production URLs exist'` (was line 217)
- `'should prompt app picker when no appId provided'` (was line 239)
- `'should handle existing directory with overwrite'` (was lines 261-263) — chain becomes `outputDir` → `action: 'overwrite'` → `projectType: 'oauth'`
- `'should skip existing files in merge mode'` (was lines 284-286) — chain becomes `outputDir` → `action: 'merge'` → `projectType: 'oauth'`
- Helper `scaffoldWithScopes` (was line 325, used by all 4 `"legacy 'all' scope substitution"` tests) — chain becomes `outputDir` → `projectType: 'oauth'` (harmless if unconsumed when `json: true` is passed)
- `it.each` `'should pass {{LOGO_URI}} into template vars...'` (was line 385)
- `it.each` `'should pass {{APP_VERSION}} into template vars...'` (was line 410)

`'should output JSON when --json flag is used'` (was line 126) needs **no change** — `promptProjectType(false)` never prompts.

- [ ] **Step 8: Replace the old refusal test with Case B (diff-driven) and Case C tests**

Delete the test `'should refuse to scaffold when app-config.json exists in cwd'` (was lines 295-303) and replace it with:

```ts
  describe('directory already linked to an app', () => {
    const cwdAppConfig = path.join(process.cwd(), 'app-config.json');
    const serverApp = {
      app_id: '1',
      name: 'Test App',
      client_id: 'cli-123',
      client_secret: 'secret',
      redirect_uris: ['http://localhost:3009/auth/callback'],
      scopes: ['contacts:read'],
      distribution_type: 'private' as const,
      logo_uri: '',
      version: '1.0.0',
    };
    const matchingLocalConfig = {
      appId: '1',
      appName: 'Test App',
      distribution_type: 'private' as const,
      logoUri: '',
      version: '1.0.0',
      auth: { scopes: ['contacts:read'], redirectUrls: ['http://localhost:3009/auth/callback'] },
    };

    beforeEach(() => {
      (fs.existsSync as jest.Mock).mockImplementation((p: string) => p === cwdAppConfig);
      (appService.resolveAppCredentials as jest.Mock).mockResolvedValue({
        diffs: [],
        app: serverApp,
      });
    });

    it('proceeds merge-only with no prompt when the linked config already matches the server', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue(matchingLocalConfig);
      mockPrompt.mockResolvedValueOnce({ projectType: 'oauth' });

      await scaffoldCommand({ appId: '1' });

      expect(mockPrompt).not.toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ name: 'confirmed' })]),
      );
      expect(fs.writeFileSync).toHaveBeenCalled();
      expect(chdirSpy).not.toHaveBeenCalled();
    });

    it('shows the diff and does a full overwrite on consent when the config differs', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue({
        ...matchingLocalConfig,
        auth: { scopes: ['contacts:read'], redirectUrls: ['http://old-host/cb'] },
      });
      mockPrompt
        .mockResolvedValueOnce({ confirmed: true })
        .mockResolvedValueOnce({ projectType: 'oauth' });

      await scaffoldCommand({ appId: '1' });

      const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
      expect(output).toContain('redirectUrls');
      expect(output).toContain('differs from the server');
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('cancels without writing when the config differs and the user declines', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue({
        ...matchingLocalConfig,
        auth: { scopes: ['contacts:read'], redirectUrls: ['http://old-host/cb'] },
      });
      mockPrompt.mockResolvedValueOnce({ confirmed: false });

      await scaffoldCommand({ appId: '1' });

      expect(fs.writeFileSync).not.toHaveBeenCalled();
      const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
      expect(output).toMatch(/cancelled/i);
    });

    it('offers a different directory when the linked app does not match', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue({ appId: '999', appName: 'Other App' });
      mockPrompt
        .mockResolvedValueOnce({ choice: 'choose' })
        .mockResolvedValueOnce({ outputDir: tmpPath('different-app-dir') })
        .mockResolvedValueOnce({ projectType: 'oauth' });
      (fs.existsSync as jest.Mock).mockImplementation(
        (p: string) => p === cwdAppConfig && p !== tmpPath('different-app-dir'),
      );

      await scaffoldCommand({ appId: '1' });

      expect(fs.writeFileSync).toHaveBeenCalled();
      expect(chdirSpy).toHaveBeenCalledWith(tmpPath('different-app-dir'));
    });

    it('cancels without writing when the linked app does not match and the user cancels', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue({ appId: '999', appName: 'Other App' });
      mockPrompt.mockResolvedValueOnce({ choice: 'cancel' });

      await scaffoldCommand({ appId: '1' });

      expect(fs.writeFileSync).not.toHaveBeenCalled();
      const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
      expect(output).toMatch(/cancelled/i);
    });
  });
```

- [ ] **Step 9: Add tests for `resolveProjectDirectory`, `promptProjectType`, `diffLocalConfig`**

Add a new top-level `describe` block (alongside `describe('runScaffold (core, no prompting/output)', ...)`):

```ts
  describe('resolveProjectDirectory', () => {
    it('creates and chdirs into a fresh directory', async () => {
      const { resolveProjectDirectory } = require('../../../commands/app/scaffold');
      mockPrompt.mockResolvedValueOnce({ outputDir: tmpPath('fresh-dir') });

      const result = await resolveProjectDirectory('./default-slug');

      expect(fs.mkdirSync).toHaveBeenCalledWith(tmpPath('fresh-dir'), { recursive: true });
      expect(chdirSpy).toHaveBeenCalledWith(tmpPath('fresh-dir'));
      expect(result).toEqual({ targetDir: tmpPath('fresh-dir'), mergeOnly: false, chooseAgain: false });
    });

    it('chdirs (without re-mkdir) when overwriting an existing directory', async () => {
      const { resolveProjectDirectory } = require('../../../commands/app/scaffold');
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      mockPrompt
        .mockResolvedValueOnce({ outputDir: tmpPath('existing-dir') })
        .mockResolvedValueOnce({ action: 'overwrite' });

      const result = await resolveProjectDirectory('./default-slug');

      expect(chdirSpy).toHaveBeenCalledWith(tmpPath('existing-dir'));
      expect(result.chooseAgain).toBe(false);
    });

    it('does not chdir when the user chooses a different path', async () => {
      const { resolveProjectDirectory } = require('../../../commands/app/scaffold');
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      mockPrompt
        .mockResolvedValueOnce({ outputDir: tmpPath('existing-dir') })
        .mockResolvedValueOnce({ action: 'new' });

      const result = await resolveProjectDirectory('./default-slug');

      expect(chdirSpy).not.toHaveBeenCalled();
      expect(result.chooseAgain).toBe(true);
    });
  });

  describe('promptProjectType', () => {
    it('prompts and returns the selected type when interactive', async () => {
      const { promptProjectType } = require('../../../commands/app/scaffold');
      mockPrompt.mockResolvedValueOnce({ projectType: 'oauth' });

      const result = await promptProjectType(true);

      expect(mockPrompt).toHaveBeenCalledWith([
        expect.objectContaining({ name: 'projectType' }),
      ]);
      expect(result).toBe('oauth');
    });

    it('returns oauth without prompting when not interactive', async () => {
      const { promptProjectType } = require('../../../commands/app/scaffold');

      const result = await promptProjectType(false);

      expect(mockPrompt).not.toHaveBeenCalled();
      expect(result).toBe('oauth');
    });
  });
```

- [ ] **Step 10: Run the full scaffold test suite**

Run: `yarn test scaffold.test.ts`
Expected: PASS, all tests including the new ones.

- [ ] **Step 11: Lint, build**

Run: `yarn lint && yarn build`
Expected: no errors from `scaffold.ts` or its test file (`create.ts` will still fail to build — that's Task 4's job; if `yarn build` fails ONLY on `create.ts` referencing `scaffoldCommand`'s old shape or `confirmCreateOverLinkedApp`, that's expected here).

- [ ] **Step 12: Commit**

```bash
git add src/commands/app/scaffold.ts src/__tests__/commands/app/scaffold.test.ts
git commit -m "feat: directory-aware brevo app scaffold with diff-driven re-scaffold and project-type prompt"
```

---

## Task 3: `create.ts` — hard-error on a linked directory, directory setup before the API call

**Files:**
- Modify: `src/commands/app/create.ts`

- [ ] **Step 1: Update imports**

Change the import from `./scaffold`:

```ts
import { scaffoldCommand, computeSlug, fetchAppContext, runScaffold } from './scaffold';
```

to:

```ts
import {
  computeSlug,
  fetchAppContext,
  runScaffold,
  resolveProjectDirectory,
  promptProjectType,
  reportScaffoldSuccess,
} from './scaffold';
```

(`scaffoldCommand` is no longer used anywhere in this file.)

- [ ] **Step 2: Replace `confirmCreateOverLinkedApp` with an unconditional throw**

Replace the entire `confirmCreateOverLinkedApp` function (the one starting with the `// 0. Check for existing app-config.json...` comment) with:

```ts
// 0. Refuse outright if an app is already linked in this directory — no
//    confirm, no override. The user must leave the directory or run
//    `brevo app scaffold` here instead (which knows how to refresh a linked
//    project against the server).
function guardAgainstLinkedApp(): void {
  if (!hasLocalApp()) return;
  const projectConfig = readProjectConfig();
  const linkedName = projectConfig?.appName || String(projectConfig?.appId ?? '');
  throw new CliError(messages.APP_CREATE_ALREADY_LINKED(linkedName));
}
```

- [ ] **Step 3: Add `resolveCreateDirectory`**

Add this new function directly above `interface CreateAppInputs` (after `resolveLogoUri`):

```ts
type CreateDirectoryResult =
  | { targetDir: string; mergeOnly: boolean; skipped: false }
  | { targetDir: string; skipped: true };

async function resolveCreateDirectory(
  appName: string,
  interactive: boolean,
): Promise<CreateDirectoryResult> {
  const slug = computeSlug(appName);

  if (!interactive) {
    const targetDir = path.resolve(`./${slug}`);
    if (fs.existsSync(targetDir)) {
      return { targetDir, skipped: true };
    }
    fs.mkdirSync(targetDir, { recursive: true });
    process.chdir(targetDir);
    return { targetDir, mergeOnly: false, skipped: false };
  }

  let dir = await resolveProjectDirectory(`./${slug}`);
  while (dir.chooseAgain) {
    dir = await resolveProjectDirectory(`./${slug}`);
  }
  return { targetDir: dir.targetDir, mergeOnly: dir.mergeOnly, skipped: false };
}
```

- [ ] **Step 4: Remove the old scaffold-handoff functions**

Delete `scaffoldAfterCreate` and `scaffoldForJsonCreate` in their entirety.

- [ ] **Step 5: Rewrite `createCommand`**

Replace the full body of `export const createCommand = withCommandHandler(...)` with:

```ts
export const createCommand = withCommandHandler(
  async (options: {
    name?: string;
    distribution?: string;
    redirectUri?: string[];
    logoUri?: string;
    json?: boolean;
  }): Promise<void> => {
    const jsonMode = !!options.json;

    guardAgainstLinkedApp();

    const appName = await resolveAppName(options.name);
    const distribution = await resolveDistribution(options.distribution);
    const redirectUrls = await resolveRedirectUrls(options.redirectUri, jsonMode);
    const logoUri = await resolveLogoUri(options.logoUri, jsonMode);

    const interactive = !jsonMode && !!process.stdin.isTTY;
    const dir = await resolveCreateDirectory(appName, interactive);

    const inputs: CreateAppInputs = { appName, distribution, redirectUrls, logoUri };
    const { result, appName: finalAppName } = await createAppWithRetry(inputs, jsonMode);

    // Store app credentials locally — client_secret may not be retrievable again
    saveAppCredentials(result.app_id, {
      clientId: result.client_id,
      clientSecret: result.client_secret,
    });
    if (finalAppName) saveAppName(result.app_id, finalAppName);

    if (dir.skipped) {
      if (jsonMode) {
        jsonOutput({
          appId: result.app_id,
          appName: finalAppName,
          clientId: result.client_id,
          clientSecret: messages.CLIENT_SECRET_HIDDEN_JSON,
          redirectUri: result.redirect_uris,
          ...(logoUri ? { logoUri } : {}),
          ...(result.version ? { version: result.version } : {}),
          directory: dir.targetDir,
          scaffoldSkipped: messages.APP_CREATE_JSON_SCAFFOLD_DIR_EXISTS(
            dir.targetDir,
            result.app_id,
          ),
        });
        return;
      }
      renderCreatedApp(result, finalAppName, logoUri);
      logInfo(messages.APP_CREATE_DIR_EXISTS_SKIPPED(dir.targetDir));
      return;
    }

    const ctx = await fetchAppContext(result.app_id, jsonMode);
    await promptProjectType(interactive);
    const { written, legacyAllSubstituted, scopes, files } = runScaffold(
      result.app_id,
      ctx,
      dir.targetDir,
      dir.mergeOnly,
    );

    if (jsonMode) {
      jsonOutput({
        appId: result.app_id,
        appName: finalAppName,
        clientId: result.client_id,
        clientSecret: messages.CLIENT_SECRET_HIDDEN_JSON,
        redirectUri: result.redirect_uris,
        ...(logoUri ? { logoUri } : {}),
        ...(result.version ? { version: result.version } : {}),
        directory: dir.targetDir,
        scaffolded: written,
      });
      return;
    }

    renderCreatedApp(result, finalAppName, logoUri);
    reportScaffoldSuccess({
      written,
      legacyAllSubstituted,
      scopes,
      files,
      targetDir: dir.targetDir,
    });
  },
);
```

`dir.skipped` narrows `CreateDirectoryResult` — inside `if (dir.skipped)` only `targetDir` is accessible (correct); after that block returns, `dir` narrows to the `skipped: false` branch for the rest of the function, so `dir.mergeOnly` is valid there.

- [ ] **Step 6: Run build**

Run: `yarn build`
Expected: no TypeScript errors, no unused-symbol warnings (`inquirer` is still used by the other prompt functions in this file, so its import stays).

- [ ] **Step 7: Commit**

```bash
git add src/commands/app/create.ts
git commit -m "feat: brevo app create hard-errors on a linked directory and resolves its own directory before creating the app"
```

---

## Task 4: Update `create.test.ts` for the new flow

**Files:**
- Modify: `src/__tests__/commands/app/create.test.ts`

- [ ] **Step 1: Expand the `./scaffold` mock**

Replace the `jest.mock('../../../commands/app/scaffold', ...)` block (around lines 32-43) with:

```ts
jest.mock('../../../commands/app/scaffold', () => ({
  computeSlug: jest.fn(
    (name: string | undefined) =>
      (name || 'my-app')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'my-app',
  ),
  fetchAppContext: jest.fn(),
  runScaffold: jest.fn(),
  resolveProjectDirectory: jest.fn(),
  promptProjectType: jest.fn(),
  reportScaffoldSuccess: jest.fn(),
}));
```

Update the import below it (was line 52):

```ts
import {
  computeSlug,
  fetchAppContext,
  runScaffold,
  resolveProjectDirectory,
  promptProjectType,
  reportScaffoldSuccess,
} from '../../../commands/app/scaffold';
```

- [ ] **Step 2: Update `beforeEach`/`afterEach` — default directory/project-type mocks + `process.chdir` spy**

Replace the existing `beforeEach`/`afterEach` pair (around lines 60-92) with:

```ts
  let chdirSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    chdirSpy = jest.spyOn(process, 'chdir').mockImplementation(() => undefined);
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      writable: true,
      value: true,
    });
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    (fetchAppContext as jest.Mock).mockResolvedValue({
      appDetails: null,
      clientId: '',
      clientSecret: '',
      redirectUrls: [],
      redirectUri: '',
    });
    (runScaffold as jest.Mock).mockReturnValue({
      written: 0,
      targetDir: '',
      legacyAllSubstituted: false,
      scopes: [],
      files: [],
    });
    (resolveProjectDirectory as jest.Mock).mockResolvedValue({
      targetDir: '/cwd/test-app',
      mergeOnly: false,
      chooseAgain: false,
    });
    (promptProjectType as jest.Mock).mockResolvedValue('oauth');
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    chdirSpy.mockRestore();
    if (originalIsTTYDescriptor) {
      Object.defineProperty(process.stdin, 'isTTY', originalIsTTYDescriptor);
    } else {
      Reflect.deleteProperty(process.stdin, 'isTTY');
    }
  });
```

With this default, `resolveCreateDirectory`'s interactive branch calls the mocked `resolveProjectDirectory` (no real `inquirer.prompt` call) and immediately returns `{ targetDir: '/cwd/test-app', mergeOnly: false }` — every test that doesn't care about directory behavior keeps working unchanged.

- [ ] **Step 3: Rewrite the tests that asserted `scaffoldCommand` was called**

Test `'should create an app with provided options and scaffold by default'` (was lines 94-123): keep the body, change the final assertion to:

```ts
    expect(runScaffold).toHaveBeenCalledWith(1, expect.anything(), '/cwd/test-app', false);
```

`'never prompts to confirm scaffolding — it always runs'` (was lines 126-145): change the final assertion to `expect(runScaffold).toHaveBeenCalledWith(8, expect.anything(), '/cwd/test-app', false);`. Keep the existing `expect(mockPrompt).not.toHaveBeenCalledWith(...)` assertion as-is.

`'scaffolds into the default directory under --json and reports it'` (was lines 147-176) and `'skips scaffolding under --json when the default directory already exists'` (was lines 178-201): no assertion changes needed — both already assert against `runScaffold`/JSON output, unaffected by this task.

- [ ] **Step 4: Add tests for `guardAgainstLinkedApp`**

Add a new `describe` block:

```ts
  describe('linked-directory guard', () => {
    it('throws immediately when app-config.json is already linked in cwd, without calling the API', async () => {
      const { hasLocalApp, readProjectConfig } = require('../../../lib/config');
      (hasLocalApp as jest.Mock).mockReturnValue(true);
      (readProjectConfig as jest.Mock).mockReturnValue({ appId: '5', appName: 'Existing App' });

      await expect(createCommand({ name: 'New App', distribution: 'private' })).rejects.toThrow(
        /already linked/i,
      );

      expect(appService.createApp).not.toHaveBeenCalled();
      expect(mockPrompt).not.toHaveBeenCalled();
    });

    it('includes the linked app name in the error message', async () => {
      const { hasLocalApp, readProjectConfig } = require('../../../lib/config');
      (hasLocalApp as jest.Mock).mockReturnValue(true);
      (readProjectConfig as jest.Mock).mockReturnValue({ appId: '5', appName: 'Existing App' });

      await expect(createCommand({ name: 'New App', distribution: 'private' })).rejects.toThrow(
        'Existing App',
      );
    });
  });
```

- [ ] **Step 5: Add new tests for the directory-setup behavior itself**

Add a new `describe` block after `describe('scaffold-by-default', ...)`:

```ts
  describe('directory setup', () => {
    it('resolves the directory before the create API call, interactively', async () => {
      const createCallOrder: string[] = [];
      (resolveProjectDirectory as jest.Mock).mockImplementation(async () => {
        createCallOrder.push('directory');
        return { targetDir: '/cwd/dir-app', mergeOnly: false, chooseAgain: false };
      });
      (appService.createApp as jest.Mock).mockImplementation(async () => {
        createCallOrder.push('create');
        return {
          app_id: 20,
          name: 'Dir App',
          client_id: 'cli-dir',
          client_secret: 'secret-dir',
          redirect_uris: ['http://localhost:3009/auth/callback'],
        };
      });
      mockPrompt
        .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' })
        .mockResolvedValueOnce({ another: false })
        .mockResolvedValueOnce({ logoUrl: '' });

      await createCommand({ name: 'Dir App', distribution: 'private' });

      expect(createCallOrder).toEqual(['directory', 'create']);
      expect(runScaffold).toHaveBeenCalledWith(20, expect.anything(), '/cwd/dir-app', false);
    });

    it('does not prompt for a directory under --json (non-interactive resolution)', async () => {
      (appService.createApp as jest.Mock).mockResolvedValue({
        app_id: 21,
        name: 'JSON Dir App',
        client_id: 'cli-json-dir',
        client_secret: 'secret-json-dir',
        redirect_uris: ['http://localhost:3009/auth/callback'],
      });

      await createCommand({
        name: 'JSON Dir App',
        distribution: 'private',
        redirectUri: ['http://localhost:3009/auth/callback'],
        json: true,
      });

      expect(resolveProjectDirectory).not.toHaveBeenCalled();
      expect(chdirSpy).toHaveBeenCalled();
    });

    it('shows the project-type prompt after app creation, not before', async () => {
      const order: string[] = [];
      (appService.createApp as jest.Mock).mockImplementation(async () => {
        order.push('create');
        return {
          app_id: 22,
          name: 'Ordered App',
          client_id: 'cli-ordered',
          client_secret: 'secret-ordered',
          redirect_uris: ['http://localhost:3009/auth/callback'],
        };
      });
      (promptProjectType as jest.Mock).mockImplementation(async () => {
        order.push('projectType');
        return 'oauth';
      });
      mockPrompt
        .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' })
        .mockResolvedValueOnce({ another: false })
        .mockResolvedValueOnce({ logoUrl: '' });

      await createCommand({ name: 'Ordered App', distribution: 'private' });

      expect(order).toEqual(['create', 'projectType']);
    });
  });
```

- [ ] **Step 6: Run the full create test suite**

Run: `yarn test create.test.ts`
Expected: PASS, all tests including the new ones.

- [ ] **Step 7: Run the entire suite, lint, build**

Run: `yarn test && yarn lint && yarn build`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add src/__tests__/commands/app/create.test.ts
git commit -m "test: cover brevo app create's hard-error guard and directory-first scaffold flow"
```

---

## Task 5: Docs — `AGENTS.md` and `SKILL.md`

**Files:**
- Modify: `agent-context/AGENTS.md`
- Modify: `agent-context/SKILL.md`

- [ ] **Step 1: `AGENTS.md` — `brevo app create` row (line 67)**

Change:

```
| `brevo app create` | Create an app (`--name`, `--distribution <private\|public>`, `--redirect-uri`, `--logo-uri`, `--json`). `private` = used exclusively by your organisation; `public` = distributed to end users or marketplace listings — default to `private` when unspecified. Defaults to scopes `contacts:read`, `contacts:write`, `crm:read`, `crm:write`. Always scaffolds starter OAuth code afterward — no confirmation prompt. |
```

to:

```
| `brevo app create` | Create an app (`--name`, `--distribution <private\|public>`, `--redirect-uri`, `--logo-uri`, `--json`). `private` = used exclusively by your organisation; `public` = distributed to end users or marketplace listings — default to `private` when unspecified. Defaults to scopes `contacts:read`, `contacts:write`, `crm:read`, `crm:write`. **Errors immediately if `app-config.json` already exists in the working directory** — move elsewhere or use `brevo app scaffold` there instead. Otherwise prompts for (and creates/`cd`s into) a target directory right before creating the app, then always scaffolds starter OAuth code afterward — no confirmation prompt for either step. |
```

- [ ] **Step 2: `AGENTS.md` — `brevo app scaffold` row (line 71)**

Change:

```
| `brevo app scaffold` | Generate starter OAuth code (`--app-id`, `--json`) |
```

to:

```
| `brevo app scaffold` | Generate starter OAuth code (`--app-id`, `--json`). Directory-aware: creates a fresh directory when none is linked in cwd; when cwd is linked to the *same* app, diffs the local config against the server and only asks to update+regenerate if they differ; when cwd is linked to a *different* app, requires picking a different directory (or cancelling). |
```

- [ ] **Step 3: `AGENTS.md` — conventions bullets (line 82)**

Change:

```
- **`brevo app create` always scaffolds afterward** — no "generate starter code now?" confirmation, in interactive mode or `--json`. Interactive mode still prompts for the target directory (default `./<slugified-app-name>`) and how to handle an existing one (overwrite / merge / choose a different path). Under `--json` there's no such prompt: the same default directory is used; if it already exists, the scaffold step is skipped rather than overwritten. The JSON response always includes `directory` (absolute path) alongside the app fields, plus either `scaffolded` (file count, on success) or `scaffoldSkipped` (a message, when the directory already existed).
```

to:

```
- **`brevo app create` refuses to run inside an already-linked directory.** If `app-config.json` exists in cwd, it throws immediately (no confirm, no override) — the error points at moving elsewhere or running `brevo app scaffold` there.
- **`brevo app create` resolves its target directory before creating the app**, then always scaffolds afterward — no confirmation prompt for either step, in interactive mode or `--json`. Interactive mode prompts for the target directory (default `./<slugified-app-name>`, `cd`s into it) before the API call, how to handle an existing one (overwrite / merge / choose a different path), and — after the app is created — which kind of project to scaffold (today, a single choice: *Test OAuth App*). Under `--json` there's no prompting: the same default directory is used, `cd`d into if it doesn't already exist; if it already exists, both directory setup and scaffolding are skipped (the app is still created). The JSON response always includes `directory` (absolute path) alongside the app fields, plus either `scaffolded` (file count, on success) or `scaffoldSkipped` (a message, when the directory already existed).
- **`brevo app scaffold` is directory-aware.** No `app-config.json` in cwd → same directory prompt as `create`. `app-config.json` in cwd for the *same* app → diffs the local config against the server; if they match, it re-scaffolds merge-only with no prompt; if they differ, it shows the differing fields and asks consent to fully regenerate every template file (not just `app-config.json`) — declining cancels with nothing written. `app-config.json` in cwd for a *different* app → must choose a different directory or cancel; it will never write one app's files into a directory linked to another app.
```

- [ ] **Step 4: `SKILL.md` — "Create an app" bullet (line 43)**

Change:

```
- "Create an app" → `brevo app create --name "<name>" --distribution <private|public> --redirect-uri <url> --json` (add `--logo-uri <https://…>` to set the app logo at creation time; new apps default to scopes `contacts:read`, `contacts:write`, `crm:read`, `crm:write`). Use `private` for apps used exclusively by the user's own organisation, `public` for apps distributed to end users or marketplace listings; default to `private` when the user hasn't said which. **This always scaffolds starter OAuth code too** — no separate `app scaffold` call needed. Under `--json`, the response's `directory` field is where it landed; check for `scaffoldSkipped` instead of `scaffolded` if that directory already existed.
```

to:

```
- "Create an app" → `brevo app create --name "<name>" --distribution <private|public> --redirect-uri <url> --json` (add `--logo-uri <https://…>` to set the app logo at creation time; new apps default to scopes `contacts:read`, `contacts:write`, `crm:read`, `crm:write`). Use `private` for apps used exclusively by the user's own organisation, `public` for apps distributed to end users or marketplace listings; default to `private` when the user hasn't said which. **Fails immediately if run from a directory that already has `app-config.json`** — `cd` elsewhere first, or use `brevo app scaffold` in that directory instead. Otherwise resolves (creates/`cd`s into) its target directory before creating the app, **then always scaffolds starter OAuth code too** — no separate `app scaffold` call needed. Under `--json`, the response's `directory` field is where it landed; check for `scaffoldSkipped` instead of `scaffolded` if that directory already existed (both directory setup and scaffolding are skipped together in that case, but the app is still created).
```

- [ ] **Step 5: `SKILL.md` — hard rule #4 (line 57)**

Change:

```
4. **Don't run `brevo app scaffold` inside an existing scaffolded project** — it refuses if `app-config.json` exists in cwd. Use `brevo app update` to push config changes.
```

to:

```
4. **`brevo app create` refuses to run inside an already-linked directory** (`app-config.json` present) — `cd` elsewhere or use `brevo app scaffold` there instead. `brevo app scaffold` itself is directory-aware, not a hard refusal: same app linked → diffs local config against the server and only prompts if they differ (consent → full regenerate; decline → cancels); different app linked → requires choosing a different directory or cancelling.
```

- [ ] **Step 6: Grep to confirm no stale references remain**

Run: `grep -rn "refuses if .app-config.json. exists\|Generate starter code now\|Create a new app anyway" agent-context/ src/lang/en.ts src/commands/app/`
Expected: no matches.

- [ ] **Step 7: Commit**

```bash
git add agent-context/AGENTS.md agent-context/SKILL.md
git commit -m "docs: sync AGENTS.md/SKILL.md with the new create/scaffold directory flow"
```

---

## Task 6: `TESTING.md` entry, changeset

**Files:**
- Modify: `TESTING.md`
- Modify: `.changeset/` (append to existing pending changeset, or create one)

- [ ] **Step 1: Add a `TESTING.md` entry**

At the top of the `## Entries` section in `TESTING.md`, add:

```md
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

- [ ] `brevo app create` throws immediately (no API call, no prompts) when
  `app-config.json` exists in cwd, naming the linked app in the error — (Automated: `create.test.ts`)
- [ ] `resolveProjectDirectory` (scaffold.ts) creates + `chdir`s into a fresh
  directory; `chdir`s (no re-`mkdir`) when overwriting/merging an existing one;
  does not `chdir` when the user picks a different path — (Automated: `scaffold.test.ts`)
- [ ] `promptProjectType` shows a single-choice ("Test OAuth App") list prompt
  when interactive, returns `'oauth'` without prompting otherwise — (Automated: `scaffold.test.ts`)
- [ ] `diffLocalConfig` reports differences across `appName`, `distribution_type`,
  redirect URLs, scopes (legacy `'all'` excluded), `logoUri`, `version` — (Automated: `scaffold.test.ts`)
- [ ] `brevo app scaffold` with no `app-config.json` in cwd: same directory-setup
  flow as before, now via `resolveProjectDirectory` — (Automated: `scaffold.test.ts`)
- [ ] `brevo app scaffold` with `app-config.json` in cwd for the **same** app and
  **no** diff: proceeds merge-only with no confirmation prompt — (Automated: `scaffold.test.ts`)
- [ ] `brevo app scaffold` with `app-config.json` in cwd for the **same** app and a
  diff: shows the differing fields, consent → full overwrite of every template
  file; decline → cancels, nothing written — (Automated: `scaffold.test.ts`)
- [ ] `brevo app scaffold` with `app-config.json` in cwd for a **different** app:
  offers "choose a different directory" (loops into directory setup) or "cancel";
  never writes into the mismatched directory — (Automated: `scaffold.test.ts`)
- [ ] `brevo app create` (interactive): directory prompt appears after
  name/distribution/redirect/logo, before the create API call; `process.chdir`
  is called with the resolved directory; project-type prompt appears **after**
  the app is created, before scaffolding — (Automated: `create.test.ts`)
- [ ] `brevo app create --json`: directory resolved and `chdir`'d into
  non-interactively with no prompts; if the default directory already exists,
  both directory setup and scaffolding are skipped (app creation still
  succeeds), reported via `scaffoldSkipped` — (Automated: `create.test.ts`)
- [ ] `AGENTS.md` + `SKILL.md` describe the new hard-error guard, the
  directory-first `create` flow, and `scaffold`'s diff-driven same-app behavior
  (no more blanket refusal wording) — (Manual)

Run before ticking automated items: `yarn test` · `yarn lint` · `yarn build`.
```

- [ ] **Step 2: Check for an existing pending changeset**

Run: `ls .changeset/*.md 2>/dev/null | grep -v README.md`
Expected: this repo's convention is one changeset per branch — if a file is listed, append to its summary body and bump its level (`patch` → `minor`) if warranted, rather than creating a new one. If none is listed, run `yarn changeset` interactively and describe: "brevo app create now hard-errors when app-config.json already exists in the working directory (no confirm, no override) and resolves its target directory before creating the app. brevo app scaffold gained a project-type prompt and is directory-aware: diffs the local config against the server when the same app is already linked (prompting only if they differ, with full regeneration on consent), and requires picking a new directory when a different app is linked." Bump level: `minor` (new prompts, new hard-error behavior replacing a softer confirm — not a bug fix, not a breaking API change to any documented flag).

- [ ] **Step 3: Commit**

```bash
git add TESTING.md .changeset/
git commit -m "chore: add testing checklist + changeset for create/scaffold directory flow"
```

---

## Task 7: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `yarn test:ci`
Expected: all suites pass, coverage report generated, no failures.

- [ ] **Step 2: Lint + format check**

Run: `yarn lint && yarn format:check`
Expected: no errors. If `format:check` fails, run `yarn format` and re-commit.

- [ ] **Step 3: Build**

Run: `yarn build`
Expected: clean TypeScript compile, `dist/` updated.

- [ ] **Step 4: Manual smoke test — hard error on a linked directory**

Run (inside a directory containing a scaffolded `app-config.json`, e.g. one produced by a previous smoke test):
```bash
node dist/bin/index.js app create
```
Expected: immediate error naming the linked app, no prompts, process exits non-zero. Confirm `brevo app scaffold --app-id <that app's id>` in the same directory does NOT error the same way (proceeds through the diff-check instead).

- [ ] **Step 5: Manual smoke test — interactive create in a clean directory**

Run (in a scratch directory with no `app-config.json`, e.g. the scratchpad):
```bash
node dist/bin/index.js app create
```
Expected: prompts in order — app name, distribution, redirect URL, logo URL, **directory** (new, defaulting to `./<slug>`) — then "Creating app...", then the created-app box, then the **project-type prompt** ("What kind of project do you want to scaffold?" with one choice), then scaffold output (file tree, next-steps box). Confirm the process actually `cd`'d (`pwd` afterward differs from where you ran it).

- [ ] **Step 6: Manual smoke test — `brevo app scaffold` directory cases**

From a directory with no `app-config.json`: run `node dist/bin/index.js app scaffold --app-id <id>` — expect the directory prompt (Case A).
From inside that just-scaffolded directory, re-run the same command for the same app: expect either silent merge-only re-scaffold (if nothing changed) or the diff display + consent prompt (if you edit `app-config.json`'s `auth.redirectUrls` by hand first, to force a difference) (Case B).
From that same directory, run it again with a *different* `--app-id`: expect the "linked to a different app" choice prompt (Case C).

- [ ] **Step 7: Confirm `TESTING.md`/`TODO.md` are not left for `main`**

Not applicable yet — those files are deleted only right before merging this branch into `main`, per `CLAUDE.md`. Leave them in place for now; this is a reminder for whoever runs `superpowers:finishing-a-development-branch` later, not a step to execute now.

---

## Self-Review Notes (completed during planning, not a task to execute)

- **Spec coverage:** every section of `docs/superpowers/specs/2026-07-23-create-scaffold-directory-flow-design.md` maps to a task — shared helpers + diff logic + scaffold's three-case branch (Task 2), create's hard-error guard + directory step (Task 3), test coverage for both (Task 4), docs (Task 5), testing/changeset (Task 6).
- **Type consistency:** `resolveProjectDirectory` returns `{ targetDir, mergeOnly, chooseAgain }` consistently everywhere it's called (Task 2, Task 3). `promptProjectType(interactive: boolean): Promise<'oauth'>` signature matches every call site. `diffLocalConfig(localConfig: ProjectConfig, ctx: AppContext): ConfigDiff[]` matches its one call site in `resolveScaffoldTarget`. `CreateDirectoryResult`'s discriminated union (`skipped: true | false`) is used consistently in Task 3/4.
- **No placeholders:** every step shows complete code, exact file line references (from the versions read during planning), and exact commands/expected output.
