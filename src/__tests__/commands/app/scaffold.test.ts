import * as fs from 'node:fs';
import * as path from 'node:path';
import { scaffoldCommand } from '../../../commands/app/scaffold';
import { fetchAppContext } from '../../../commands/app/project-writer';

// fs is fully mocked below, so these paths are never written. We deliberately
// avoid os.tmpdir() to keep tests off any shared, world-writable directory
// (SonarSource S5443) — the strings only flow into mocked fs calls.
const tmpPath = (name: string): string => path.join(__dirname, '__sandbox__', name);

jest.mock('inquirer', () => ({
  prompt: jest.fn(),
}));

jest.mock('../../../container', () => ({
  appService: {
    fetchAppsList: jest.fn(),
    fetchApp: jest.fn(),
    pickApp: jest.fn(),
    createApp: jest.fn(),
    updateApp: jest.fn(),
    deleteApp: jest.fn(),
    resolveAppCredentials: jest.fn(),
    syncAppCredentials: jest.fn(),
  },
  accountService: {
    validateApiKey: jest.fn(),
    getAccount: jest.fn(),
  },
  client: {},
}));

jest.mock('../../../lib/config', () => ({
  getApiKey: jest.fn().mockReturnValue('test-key'),
  getAppCredentials: jest.fn(),
  saveAppCredentials: jest.fn(),
  readProjectConfig: jest.fn().mockReturnValue(null),
  // The config in the directory a *bootstrap* was pointed at, which is a different
  // question from `readProjectConfig`'s (cwd) — a bootstrap only runs because cwd had
  // none. Defaults to null: an empty target directory, the fresh-bootstrap case.
  readProjectConfigAt: jest.fn().mockReturnValue(null),
  findEnclosingProjectDir: jest.fn().mockReturnValue(null),
  isUiAppConfig: (config: { ui_app?: unknown } | null | undefined) => !!config?.ui_app,
}));

jest.mock('../../../templates', () => ({
  loadBaseTemplates: jest.fn((_vars: Record<string, string>) => [
    { name: 'app-config.json', content: '{}' },
    { name: '.gitignore', content: 'src/oauth/.env.local' },
    { name: 'AGENTS.md', content: '# Agents' },
    { name: 'CLAUDE.md', content: '# Claude' },
    { name: 'README.md', content: '# README' },
  ]),
  loadFeatureTemplates: jest.fn((_featureType: string, vars: Record<string, string>) => [
    { name: 'src/oauth/server.js', content: '// server' },
    { name: 'src/oauth/handler.js', content: '// handler' },
    { name: 'src/oauth/token-store.js', content: '// token store' },
    { name: 'src/oauth/.env.example', content: `CLIENT_ID=${vars['{{CLIENT_ID}}'] || ''}` },
    { name: 'src/oauth/.env.local', content: `CLIENT_ID=${vars['{{CLIENT_ID}}'] || ''}` },
    { name: 'src/oauth/package.json', content: '{}' },
  ]),
  // The feature registry, mirrored rather than stubbed away: the prompts derive
  // from it — one entry means no "which feature?" picker — so a mock without it
  // would test a shape the real module never has.
  FEATURE_TEMPLATE_MANIFESTS: { oauth: [] },
  FEATURE_LABELS: { oauth: 'Test OAuth App' },
}));

jest.mock('node:fs');
jest.mock('node:path', () => {
  const actual = jest.requireActual('node:path');
  return {
    ...actual,
    resolve: jest.fn((...args: string[]) => actual.resolve(...args)),
    join: jest.fn((...args: string[]) => actual.join(...args)),
    basename: jest.fn((p: string) => actual.basename(p)),
    dirname: jest.fn((p: string) => actual.dirname(p)),
  };
});

import inquirer from 'inquirer';
import { appService } from '../../../container';
import {
  readProjectConfig,
  readProjectConfigAt,
  findEnclosingProjectDir,
} from '../../../lib/config';

const mockPrompt = inquirer.prompt as unknown as jest.Mock;

// A server app + a local config that exactly matches it (no drift). Individual
// tests override fields on either side to introduce a diff.
const serverApp = {
  app_id: '1',
  name: 'Test App',
  client_id: 'cli-123',
  client_secret: 'secret-456',
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
  auth: { scopes: ['contacts:read'], redirectUris: ['http://localhost:3009/auth/callback'] },
};

describe('app/scaffold', () => {
  let stdoutSpy: jest.SpyInstance;
  let chdirSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    chdirSpy = jest.spyOn(process, 'chdir').mockImplementation(() => undefined);
    jest.clearAllMocks();
    // clearAllMocks clears calls but NOT a queued mockResolvedValueOnce chain, so a
    // test whose command threw before consuming its queued prompts would otherwise
    // hand them to the next test. Reset the queue outright to keep tests independent
    // of execution order.
    mockPrompt.mockReset();
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    (fs.mkdirSync as jest.Mock).mockReturnValue(undefined);
    (fs.writeFileSync as jest.Mock).mockReturnValue(undefined);
    (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify({ version: '9.9.9' }));
    (readProjectConfig as jest.Mock).mockReturnValue(null);
    // jest.clearAllMocks() does not reset a persistent mockReturnValue, so re-assert
    // the mock factory's default here — a test that stubs an enclosing project must
    // not leak that into the next one.
    (findEnclosingProjectDir as jest.Mock).mockReturnValue(null);
    (readProjectConfigAt as jest.Mock).mockReturnValue(null);
    (appService.resolveAppCredentials as jest.Mock).mockResolvedValue({
      diffs: [],
      app: serverApp,
    });
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    chdirSpy.mockRestore();
  });

  describe('scaffoldCommand', () => {
    it('errors (without fetching the app) when no app-config.json exists in cwd', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue(null);

      await expect(scaffoldCommand({})).rejects.toThrow(/app-config\.json/i);

      expect(appService.resolveAppCredentials).not.toHaveBeenCalled();
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    // `--app-id` bootstraps a project directory for an app that already exists on
    // the platform (BEX-250 follow-up). It is the only migration path off
    // `brevo app update --app-id <id>`, which could target any app without a local
    // project — `app upload` reads the linked project only, so without this a user
    // holding an app ID and an empty directory has nowhere to go.
    //
    // An interactive run with no `--app-id` reaches the same bootstrap through the
    // app picker instead (see `bootstrap via the app picker` below); the flag stays
    // the non-interactive entry point, because a picker cannot prompt under --json.
    describe('--app-id bootstrap', () => {
      it('names --app-id in the no-config error so the migration path is discoverable', async () => {
        (readProjectConfig as jest.Mock).mockReturnValue(null);

        await expect(scaffoldCommand({ json: true })).rejects.toThrow(/--app-id/);
      });

      // An empty directory is the one case where the user may not know the ID —
      // and it is also the case where the CLI can just ask. `--app-id` stays the
      // scriptable form; this is the same thing for someone at a terminal.
      describe('interactive fallback when neither a config nor --app-id is present', () => {
        // Jest runs with no TTY, so the prompt path is unreachable unless it is
        // faked — the two tests that assert the *non*-interactive behaviour set it
        // back to falsy themselves.
        let originalIsTTY: boolean | undefined;
        beforeEach(() => {
          const stdin = process.stdin as unknown as { isTTY?: boolean };
          originalIsTTY = stdin.isTTY;
          stdin.isTTY = true;
        });
        afterEach(() => {
          (process.stdin as unknown as { isTTY?: boolean }).isTTY = originalIsTTY;
        });

        it('offers to set the directory up for an existing app, then bootstraps the picked one', async () => {
          (readProjectConfig as jest.Mock).mockReturnValue(null);
          (appService.fetchAppsList as jest.Mock).mockResolvedValue([
            { app_id: '1', name: 'Test App', client_id: 'cli-123' },
            { app_id: '2', name: 'Other App', client_id: 'cli-456' },
          ]);
          mockPrompt
            .mockResolvedValueOnce({ useExisting: true })
            .mockResolvedValueOnce({ selectedApp: '1' })
            .mockResolvedValueOnce({ outputDir: tmpPath('picked-app') })
            .mockResolvedValueOnce({ scaffoldRaw: 'y' });

          await scaffoldCommand({});

          expect(appService.fetchAppsList).toHaveBeenCalled();
          expect(appService.resolveAppCredentials).toHaveBeenCalledWith('1', {
            tolerateMissing: false,
          });
          const written = (fs.writeFileSync as jest.Mock).mock.calls.map((c: [string]) => c[0]);
          expect(written.some((p: string) => p.endsWith('app-config.json'))).toBe(true);
        });

        // The picker is reachable from any directory, and the likeliest one is the
        // folder the user keeps their app folders *in*. Emptying eleven files into
        // it is silent and tedious to undo, so a bootstrap asks the question
        // `app create` asks, with the same default: the app's name as a slug.
        it('offers a directory named after the app and creates it', async () => {
          (readProjectConfig as jest.Mock).mockReturnValue(null);
          (appService.fetchAppsList as jest.Mock).mockResolvedValue([
            { app_id: '1', name: 'Test App', client_id: 'cli-123' },
          ]);
          mockPrompt
            .mockResolvedValueOnce({ useExisting: true })
            .mockResolvedValueOnce({ selectedApp: '1' })
            .mockResolvedValueOnce({ outputDir: './test-app' })
            .mockResolvedValueOnce({ scaffoldRaw: 'y' });

          await scaffoldCommand({});

          expect(mockPrompt).toHaveBeenCalledWith([
            expect.objectContaining({ name: 'outputDir', default: './test-app' }),
          ]);
          const target = path.resolve('./test-app');
          expect(fs.mkdirSync).toHaveBeenCalledWith(target, { recursive: true });
          expect(chdirSpy).toHaveBeenCalledWith(target);
          // Everything lands under the new directory, not the one the user is in.
          const written = (fs.writeFileSync as jest.Mock).mock.calls.map((c: [string]) => c[0]);
          expect(written.every((p: string) => p.startsWith(target))).toBe(true);
          // process.chdir() moves the CLI, never the user's shell — so the step
          // that gets them there has to be on screen.
          const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
          expect(output).toContain('cd test-app');
        });

        // `.` is the escape hatch for someone who already made the folder. The
        // `cd` step must not appear then: it would send them somewhere else.
        it('stays in the current directory when the user answers `.`, with no cd step', async () => {
          (readProjectConfig as jest.Mock).mockReturnValue(null);
          (appService.fetchAppsList as jest.Mock).mockResolvedValue([
            { app_id: '1', name: 'Test App', client_id: 'cli-123' },
          ]);
          // Only cwd exists: the directory prompt hits its overwrite/merge branch
          // (as it always does for `.`), while the feature files still look fresh.
          (fs.existsSync as jest.Mock).mockImplementation((p: string) => p === process.cwd());
          mockPrompt
            .mockResolvedValueOnce({ useExisting: true })
            .mockResolvedValueOnce({ selectedApp: '1' })
            .mockResolvedValueOnce({ outputDir: '.' })
            .mockResolvedValueOnce({ action: 'merge' })
            .mockResolvedValueOnce({ scaffoldRaw: 'y' });

          await scaffoldCommand({});

          const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
          expect(output).toContain('Scaffolding into the current directory.');
          expect(output).not.toContain('cd .');
          expect(output).toContain('1. yarn --cwd src/oauth');
        });

        // A bootstrap pointed at a directory that already holds a project is a
        // refresh, and gets the drift question the feature-add path asks — not the
        // directory prompt's merge answer.
        //
        // The two answer different things. "Merge (keep existing, add missing)" is
        // about not clobbering the user's own files, and it is implemented by skipping
        // any path that exists — which app-config.json always does here. So merging
        // skipped the one file the bootstrap exists to write: the command fetched the
        // app, discarded every field, wrote nothing, and printed its success box.
        describe('when the target directory already holds a project', () => {
          // Drifted the way a real re-run drifts: a config written by an older CLI,
          // still carrying the deprecated `all` scope and no `version` at all.
          const staleConfig = {
            ...matchingLocalConfig,
            version: '',
            auth: { scopes: ['all'], redirectUris: ['http://localhost:3009/auth/callback'] },
          };

          beforeEach(() => {
            (appService.fetchAppsList as jest.Mock).mockResolvedValue([
              { app_id: '1', name: 'Test App', client_id: 'cli-123' },
            ]);
            // The directory and every file a previous scaffold left in it are present.
            (fs.existsSync as jest.Mock).mockReturnValue(true);
          });

          it('shows the drift and rewrites app-config.json once confirmed', async () => {
            (readProjectConfigAt as jest.Mock).mockReturnValue(staleConfig);
            const target = tmpPath('already-a-project');
            mockPrompt
              .mockResolvedValueOnce({ useExisting: true })
              .mockResolvedValueOnce({ selectedApp: '1' })
              .mockResolvedValueOnce({ outputDir: target })
              .mockResolvedValueOnce({ action: 'merge' })
              .mockResolvedValueOnce({ confirmed: true })
              .mockResolvedValueOnce({ scaffoldRaw: 'y' })
              .mockResolvedValueOnce({ action: 'merge' });

            await scaffoldCommand({});

            // The *target* directory, not cwd. cwd is where the command ran, and its
            // having no config is what selected the bootstrap branch — reading it again
            // would find nothing and skip the refresh every time.
            expect(readProjectConfigAt).toHaveBeenCalledWith(path.resolve(target));
            const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
            expect(output).toContain('differs from the server');
            expect(output).toContain('scopes: all → contacts:read');
            const written = (fs.writeFileSync as jest.Mock).mock.calls.map((c: [string]) => c[0]);
            expect(written.some((p: string) => p.endsWith('app-config.json'))).toBe(true);
          });

          // Declining leaves the directory exactly as it was — the same outcome the
          // feature-add path gives, rather than the base half of a refresh.
          it('writes nothing when the refresh is declined', async () => {
            (readProjectConfigAt as jest.Mock).mockReturnValue(staleConfig);
            mockPrompt
              .mockResolvedValueOnce({ useExisting: true })
              .mockResolvedValueOnce({ selectedApp: '1' })
              .mockResolvedValueOnce({ outputDir: tmpPath('declined') })
              .mockResolvedValueOnce({ action: 'merge' })
              .mockResolvedValueOnce({ confirmed: false });

            await scaffoldCommand({});

            expect(fs.writeFileSync).not.toHaveBeenCalled();
            const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
            expect(output).toContain('Scaffold cancelled.');
          });

          // No drift means the file already matches the server, so there is nothing to
          // rewrite — the feature is still added. This is the one case where writing no
          // base file is the correct answer, and it must not be confused with the bug.
          it('leaves app-config.json alone when it already matches the server', async () => {
            (readProjectConfigAt as jest.Mock).mockReturnValue(matchingLocalConfig);
            mockPrompt
              .mockResolvedValueOnce({ useExisting: true })
              .mockResolvedValueOnce({ selectedApp: '1' })
              .mockResolvedValueOnce({ outputDir: tmpPath('in-sync') })
              .mockResolvedValueOnce({ action: 'merge' })
              .mockResolvedValueOnce({ scaffoldRaw: 'y' })
              .mockResolvedValueOnce({ action: 'overwrite' });

            await scaffoldCommand({});

            const written = (fs.writeFileSync as jest.Mock).mock.calls.map((c: [string]) => c[0]);
            expect(written.some((p: string) => p.endsWith('app-config.json'))).toBe(false);
            // The feature still lands, so the run did something.
            expect(written.some((p: string) => p.endsWith('src/oauth/server.js'))).toBe(true);
          });

          // The `--app-id` guard compares against cwd, and the target is elsewhere —
          // so without this the run would leave a project whose app-config.json and
          // src/oauth/.env.local name two different apps.
          it('refuses when the target directory belongs to a different app', async () => {
            (readProjectConfigAt as jest.Mock).mockReturnValue({
              ...matchingLocalConfig,
              appId: '99',
            });
            mockPrompt
              .mockResolvedValueOnce({ useExisting: true })
              .mockResolvedValueOnce({ selectedApp: '1' })
              .mockResolvedValueOnce({ outputDir: tmpPath('other-app') })
              .mockResolvedValueOnce({ action: 'merge' });

            await expect(scaffoldCommand({})).rejects.toThrow(
              /already a project for app 99, so it can't be set up for app 1/,
            );

            expect(fs.writeFileSync).not.toHaveBeenCalled();
          });
        });

        // The project is what the command was asked for; the OAuth test server is an
        // extra. So it is written and shown *before* the question, and a "no" still
        // leaves a usable project rather than an empty directory.
        it('writes and reports the project before asking about the feature', async () => {
          (readProjectConfig as jest.Mock).mockReturnValue(null);
          (appService.fetchAppsList as jest.Mock).mockResolvedValue([
            { app_id: '1', name: 'Test App', client_id: 'cli-123' },
          ]);
          mockPrompt
            .mockResolvedValueOnce({ useExisting: true })
            .mockResolvedValueOnce({ selectedApp: '1' })
            .mockResolvedValueOnce({ outputDir: './test-app' })
            .mockResolvedValueOnce({ scaffoldRaw: 'n' });

          await scaffoldCommand({});

          // app-config.json is on disk even though the feature was declined...
          const written = (fs.writeFileSync as jest.Mock).mock.calls.map((c: [string]) => c[0]);
          expect(written.some((p: string) => p.endsWith('app-config.json'))).toBe(true);
          // ...and none of the OAuth server's files are.
          expect(written.some((p: string) => p.includes('src/oauth'))).toBe(false);
          // The confirm names the single feature, since the picker that used to name
          // it is no longer asked.
          expect(mockPrompt).toHaveBeenCalledWith([
            expect.objectContaining({
              name: 'scaffoldRaw',
              message: expect.stringContaining('Test OAuth App'),
            }),
          ]);
          // Declining is a normal outcome: next steps point at adding it later.
          const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
          expect(output).toContain('brevo app scaffold');
        });

        it('cancels without fetching or writing when the offer is declined', async () => {
          (readProjectConfig as jest.Mock).mockReturnValue(null);
          mockPrompt.mockResolvedValueOnce({ useExisting: false });

          await scaffoldCommand({});

          expect(appService.fetchAppsList).not.toHaveBeenCalled();
          expect(appService.resolveAppCredentials).not.toHaveBeenCalled();
          expect(fs.writeFileSync).not.toHaveBeenCalled();
          // Declining is a choice, not a failure — but the user still has nothing
          // here, so the way to get an app must be on screen.
          const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
          expect(output).toContain('brevo app create');
        });

        it('errors instead of prompting under --json', async () => {
          (readProjectConfig as jest.Mock).mockReturnValue(null);

          await expect(scaffoldCommand({ json: true })).rejects.toThrow(/app-config\.json/i);

          expect(mockPrompt).not.toHaveBeenCalled();
          expect(appService.fetchAppsList).not.toHaveBeenCalled();
        });

        it('errors instead of prompting when stdin is not a TTY', async () => {
          (readProjectConfig as jest.Mock).mockReturnValue(null);
          const stdin = process.stdin as unknown as { isTTY?: boolean };
          const original = stdin.isTTY;
          stdin.isTTY = false;
          try {
            await expect(scaffoldCommand({})).rejects.toThrow(/app-config\.json/i);
            expect(mockPrompt).not.toHaveBeenCalled();
          } finally {
            stdin.isTTY = original;
          }
        });

        it('sends a user with no apps to `app create` rather than an empty picker', async () => {
          (readProjectConfig as jest.Mock).mockReturnValue(null);
          (appService.fetchAppsList as jest.Mock).mockResolvedValue([]);
          mockPrompt.mockResolvedValueOnce({ useExisting: true });

          await expect(scaffoldCommand({})).rejects.toThrow(/No apps found/i);

          expect(fs.writeFileSync).not.toHaveBeenCalled();
        });
      });

      it('fetches the app and writes app-config.json when the directory has no config', async () => {
        (readProjectConfig as jest.Mock).mockReturnValue(null);

        await scaffoldCommand({ appId: '1' });

        // A 404 stays fatal: the ID came from the user, not from a read-back.
        expect(appService.resolveAppCredentials).toHaveBeenCalledWith('1', {
          tolerateMissing: false,
        });
        // Base templates carry app-config.json — bootstrapping must write them,
        // unlike the linked-project path which only refreshes them on drift.
        const { loadBaseTemplates } = require('../../../templates');
        expect(loadBaseTemplates).toHaveBeenCalled();
        const written = (fs.writeFileSync as jest.Mock).mock.calls.map((c: [string]) => c[0]);
        expect(written.some((p: string) => p.endsWith('app-config.json'))).toBe(true);
        // Off a TTY (as here) the directory question is never asked and the answer
        // stays cwd: `scaffold --app-id` is the scripted migration path off
        // `app update --app-id`, and a pipeline that already cd'd into its own
        // directory must not start finding app-config.json one level deeper.
        expect(mockPrompt).not.toHaveBeenCalledWith([
          expect.objectContaining({ name: 'outputDir' }),
        ]);
        expect(written.every((p: string) => p.startsWith(process.cwd()))).toBe(true);
      });

      it('refuses to clobber a directory already linked to a different app', async () => {
        (readProjectConfig as jest.Mock).mockReturnValue(matchingLocalConfig); // appId '1'

        await expect(scaffoldCommand({ appId: '2' })).rejects.toThrow(/already linked/i);

        expect(appService.resolveAppCredentials).not.toHaveBeenCalled();
        expect(fs.writeFileSync).not.toHaveBeenCalled();
      });

      it('is a no-op flag when it names the app the directory is already linked to', async () => {
        (readProjectConfig as jest.Mock).mockReturnValue(matchingLocalConfig);

        await scaffoldCommand({ appId: '1' });

        // Same as the bare `scaffold` path: no drift → base config left alone.
        const { loadBaseTemplates } = require('../../../templates');
        expect(loadBaseTemplates).not.toHaveBeenCalled();
      });

      it('bootstraps under --json without prompting', async () => {
        (readProjectConfig as jest.Mock).mockReturnValue(null);

        await scaffoldCommand({ appId: '1', json: true });

        expect(mockPrompt).not.toHaveBeenCalled();
        const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
        expect(JSON.parse(output)).toEqual(
          expect.objectContaining({ scaffolded: expect.any(Number) }),
        );
      });

      it('takes the app type from the server when there is no local config to read it from', async () => {
        (readProjectConfig as jest.Mock).mockReturnValue(null);
        (appService.resolveAppCredentials as jest.Mock).mockResolvedValue({
          diffs: [],
          app: { ...serverApp, ui_app: { surface_point_list: [] } },
        });

        await scaffoldCommand({ appId: '1', json: true });

        // A UI app has no scaffoldable feature — bootstrapping one must still write
        // the config, then say so, rather than offering an OAuth test server.
        const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
        expect(JSON.parse(output)).toEqual(
          expect.objectContaining({ features: [], reason: expect.any(String) }),
        );
      });
    });

    // The picker's own edge case. The happy path, the decline, the --json refusal and
    // the non-TTY refusal all live in `interactive fallback…` above; this covers only
    // what that block does not — accepting the offer when there is nothing to pick.
    describe('bootstrap via the app picker', () => {
      const originalIsTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');

      beforeEach(() => {
        Object.defineProperty(process.stdin, 'isTTY', {
          configurable: true,
          writable: true,
          value: true,
        });
      });

      afterEach(() => {
        if (originalIsTTYDescriptor) {
          Object.defineProperty(process.stdin, 'isTTY', originalIsTTYDescriptor);
        } else {
          Reflect.deleteProperty(process.stdin, 'isTTY');
        }
      });

      // Accepting the offer on an account with no apps must reach the shared
      // empty-list error rather than an empty prompt the user cannot escape.
      it('surfaces the empty-list message when the account has no apps', async () => {
        (readProjectConfig as jest.Mock).mockReturnValue(null);
        (appService.fetchAppsList as jest.Mock).mockResolvedValue([]);
        mockPrompt.mockResolvedValueOnce({ useExisting: true });

        await expect(scaffoldCommand({})).rejects.toThrow();

        expect(fs.writeFileSync).not.toHaveBeenCalled();
      });
    });

    // `readProjectConfig` reads cwd and deliberately does not walk up, so a directory
    // one level inside a project is indistinguishable from an empty one outside it.
    // Without this guard the bootstrap would offer to write a SECOND app-config.json
    // nested in the first, and the next `app upload` from there would push the wrong
    // app with no warning.
    describe('nested-project guard', () => {
      const originalIsTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');

      beforeEach(() => {
        Object.defineProperty(process.stdin, 'isTTY', {
          configurable: true,
          writable: true,
          value: true,
        });
        (readProjectConfig as jest.Mock).mockReturnValue(null);
        (findEnclosingProjectDir as jest.Mock).mockReturnValue('/work/my-app');
      });

      afterEach(() => {
        if (originalIsTTYDescriptor) {
          Object.defineProperty(process.stdin, 'isTTY', originalIsTTYDescriptor);
        } else {
          Reflect.deleteProperty(process.stdin, 'isTTY');
        }
      });

      it('refuses the picker path and names the enclosing project directory', async () => {
        await expect(scaffoldCommand({})).rejects.toThrow(/my-app/);

        expect(appService.fetchAppsList).not.toHaveBeenCalled();
        expect(fs.writeFileSync).not.toHaveBeenCalled();
      });

      it('refuses the --app-id path too', async () => {
        await expect(scaffoldCommand({ appId: '1' })).rejects.toThrow(/my-app/);

        expect(appService.resolveAppCredentials).not.toHaveBeenCalled();
        expect(fs.writeFileSync).not.toHaveBeenCalled();
      });

      it('refuses under --json as well', async () => {
        await expect(scaffoldCommand({ appId: '1', json: true })).rejects.toThrow(/my-app/);

        expect(fs.writeFileSync).not.toHaveBeenCalled();
      });

      // The guard is only about bootstrapping. A normal in-project run has its own
      // config in cwd and must not care what any ancestor holds — a project checked
      // out inside another project is unusual but legal.
      it('does not fire for an ordinary in-project run', async () => {
        (readProjectConfig as jest.Mock).mockReturnValue(matchingLocalConfig);

        await expect(scaffoldCommand({})).resolves.toBeUndefined();
      });
    });

    // A UI app's configuration IS its `ui_app` block, so a record that comes back
    // without one has nothing to bootstrap from.
    //
    // This must refuse rather than write a partial config: `ui_app`'s presence is the
    // app-type discriminator, so a config missing it does not read as an incomplete
    // UI app — it reads as a valid OAuth one, and the next `app upload` would push an
    // `auth` block where `ui_app` belonged.
    //
    // Note this is an EDGE case, not the post-create norm: bo-be's create handler
    // writes an `app_versions` row carrying the block inside the create transaction,
    // and the read endpoint serves it from that snapshot, so a UI app created through
    // this CLI is recoverable with no upload. The fixture below models the case that
    // remains — a record the server returns with no block at all.
    describe('unrecoverable UI app', () => {
      const uiAppWithoutBlock = {
        app_id: '7',
        name: 'Never Uploaded',
        client_id: '',
        client_secret: '',
        redirect_uris: null,
        distribution_type: 'private' as const,
        logo_uri: '',
        version: '',
      };

      it('refuses to bootstrap a UI app whose ui_app block the server has no snapshot of', async () => {
        (readProjectConfig as jest.Mock).mockReturnValue(null);
        (appService.resolveAppCredentials as jest.Mock).mockResolvedValue({
          diffs: [],
          app: uiAppWithoutBlock,
        });

        await expect(scaffoldCommand({ appId: '7', json: true })).rejects.toThrow(
          /no `ui_app` configuration|nothing to set this directory up from/i,
        );

        expect(fs.writeFileSync).not.toHaveBeenCalled();
      });

      // A half-configured OAuth app — client_id issued, callbacks not set yet — must
      // still bootstrap. Only BOTH being empty means "no OAuth material at all".
      it('still bootstraps an OAuth app that has a client_id but no callbacks', async () => {
        (readProjectConfig as jest.Mock).mockReturnValue(null);
        (appService.resolveAppCredentials as jest.Mock).mockResolvedValue({
          diffs: [],
          app: { ...uiAppWithoutBlock, client_id: 'cli-789' },
        });

        await scaffoldCommand({ appId: '7', json: true });

        const written = (fs.writeFileSync as jest.Mock).mock.calls.map((c: [string]) => c[0]);
        expect(written.some((p: string) => p.endsWith('app-config.json'))).toBe(true);
      });
    });

    // The server's `ui_app` echo carries keys the platform owns — it injects
    // `link_target`, manages the snapshot `version`, and stamps the dotted
    // `extension_point_name` onto each entry. None is authored, and writing one into
    // app-config.json puts a value in the file that the very next upload rejects.
    it('strips server-owned keys from the ui_app block it bootstraps into the config', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue(null);
      (appService.resolveAppCredentials as jest.Mock).mockResolvedValue({
        diffs: [],
        app: {
          ...serverApp,
          client_id: '',
          redirect_uris: null,
          ui_app: {
            extension_type: 'actionLink',
            label: 'Open in MyApp',
            link_target: '_blank',
            version: '4',
            surface_point_list: [
              {
                surface_point_name: 'contact-details-header-menu',
                extension_point_name: 'contactDetails.headerMenu.action',
              },
            ],
          },
        },
      });

      await scaffoldCommand({ appId: '1', json: true });

      const { loadBaseTemplates } = require('../../../templates');
      const vars = (loadBaseTemplates as jest.Mock).mock.calls[0][0];
      const uiAppJson = vars['{{UI_APP_JSON}}'] as string;
      expect(uiAppJson).toContain('surface_point_name');
      expect(uiAppJson).toContain('Open in MyApp');
      expect(uiAppJson).not.toContain('link_target');
      expect(uiAppJson).not.toContain('extension_point_name');
      expect(uiAppJson).not.toContain('"version"');
    });

    it('reads the app id from app-config.json (no picker) and scaffolds the feature merge-only', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue(matchingLocalConfig);

      await scaffoldCommand({});

      expect(appService.pickApp).not.toHaveBeenCalled();
      // `tolerateMissing: false` — `app scaffold` reads an ID the user supplied, so
      // a 404 must stay fatal here. Only `app create`'s read-back opts out.
      expect(appService.resolveAppCredentials).toHaveBeenCalledWith('1', {
        tolerateMissing: false,
      });
      // No diff → no confirm prompt.
      expect(mockPrompt).not.toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ name: 'confirmed' })]),
      );
      // Feature files written (existsSync false → nothing to skip).
      expect(fs.writeFileSync).toHaveBeenCalled();

      const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
      expect(output).toContain('scaffolded');
      expect(output).toContain('brevo app start oauth');
      expect(output).toContain('brevo app available-scopes');
    });

    it('does not write the base config when there is no drift (feature-only, merge)', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue(matchingLocalConfig);

      await scaffoldCommand({});

      const { loadBaseTemplates, loadFeatureTemplates } = require('../../../templates');
      expect(loadBaseTemplates).not.toHaveBeenCalled();
      expect(loadFeatureTemplates).toHaveBeenCalledWith('oauth', expect.anything());
    });

    it('prompts on existing feature files and skips them when the user chooses merge', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue(matchingLocalConfig);
      // Every feature file already exists → conflict prompt, then merge skips them all.
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      mockPrompt.mockResolvedValueOnce({ action: 'merge' });

      await scaffoldCommand({});

      expect(mockPrompt).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ name: 'action' })]),
      );
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('overwrites existing feature files when the user chooses overwrite', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue(matchingLocalConfig);
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      mockPrompt.mockResolvedValueOnce({ action: 'overwrite' });

      await scaffoldCommand({});

      // Existing files are rewritten rather than skipped.
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('cancels without writing when the user chooses cancel on the conflict prompt', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue(matchingLocalConfig);
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      mockPrompt.mockResolvedValueOnce({ action: 'cancel' });

      await scaffoldCommand({});

      expect(fs.writeFileSync).not.toHaveBeenCalled();
      const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
      expect(output).toContain('cancelled');
    });

    it('does not prompt for conflicts when no feature files exist', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue(matchingLocalConfig);
      // existsSync defaults to false in beforeEach → no conflict.

      await scaffoldCommand({});

      expect(mockPrompt).not.toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ name: 'action' })]),
      );
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('overwrites existing feature files without prompting when --overwrite is passed', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue(matchingLocalConfig);
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      await scaffoldCommand({ overwrite: true });

      // No conflict prompt — the flag decides.
      expect(mockPrompt).not.toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ name: 'action' })]),
      );
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('shows the diff and refreshes the base config (full overwrite) on consent', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue({
        ...matchingLocalConfig,
        auth: { scopes: ['contacts:read'], redirectUris: ['http://old-host/cb'] },
      });
      mockPrompt.mockResolvedValueOnce({ confirmed: true });

      await scaffoldCommand({});

      const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
      expect(output).toContain('redirectUris');
      expect(output).toContain('differs from the server');

      const { loadBaseTemplates, loadFeatureTemplates } = require('../../../templates');
      expect(loadBaseTemplates).toHaveBeenCalled();
      expect(loadFeatureTemplates).toHaveBeenCalledWith('oauth', expect.anything());
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it.each<[string, Record<string, unknown>, string]>([
      ['appName', { appName: 'Old Name' }, 'appName'],
      ['distribution_type', { distribution_type: 'public' as const }, 'distribution_type'],
      [
        'scopes',
        {
          auth: {
            scopes: ['contacts:write'],
            redirectUris: ['http://localhost:3009/auth/callback'],
          },
        },
        'scopes',
      ],
      ['logoUri', { logoUri: 'https://old.example.com/logo.png' }, 'logoUri'],
      ['version', { version: '0.9.0' }, 'version'],
    ])(
      'shows a diff and asks consent when %s differs from the server',
      async (_label, override, expectedFieldLabel) => {
        (readProjectConfig as jest.Mock).mockReturnValue({ ...matchingLocalConfig, ...override });
        mockPrompt.mockResolvedValueOnce({ confirmed: true });

        await scaffoldCommand({});

        const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
        expect(output).toContain(expectedFieldLabel);
        expect(output).toContain('differs from the server');
        expect(fs.writeFileSync).toHaveBeenCalled();
      },
    );

    it('cancels without writing when the config differs and the user declines', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue({
        ...matchingLocalConfig,
        auth: { scopes: ['contacts:read'], redirectUris: ['http://old-host/cb'] },
      });
      mockPrompt.mockResolvedValueOnce({ confirmed: false });

      await scaffoldCommand({});

      expect(fs.writeFileSync).not.toHaveBeenCalled();
      const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
      expect(output).toMatch(/cancelled/i);
    });

    it('uses API credentials for feature templates', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue(matchingLocalConfig);
      (appService.resolveAppCredentials as jest.Mock).mockResolvedValue({
        diffs: [],
        app: { ...serverApp, client_id: 'api-client', client_secret: 'api-secret' },
      });

      await scaffoldCommand({});

      const { loadFeatureTemplates } = require('../../../templates');
      const vars = (loadFeatureTemplates as jest.Mock).mock.calls[0][1];
      expect(vars['{{CLIENT_ID}}']).toBe('api-client');
    });

    it('never prints a "cd" step (scaffold always runs in the project directory)', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue(matchingLocalConfig);

      await scaffoldCommand({});

      const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
      expect(output).toContain('Next steps');
      expect(output).not.toMatch(/cd /);
      expect(output).toContain('yarn --cwd src/oauth');
    });
  });

  describe('scaffoldCommand --json', () => {
    it('writes the feature and reports { scaffolded, directory } when there is no drift', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue(matchingLocalConfig);

      await scaffoldCommand({ json: true });

      // --json never prompts.
      expect(mockPrompt).not.toHaveBeenCalled();
      const output = stdoutSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.scaffolded).toBeGreaterThan(0);
      expect(parsed.directory).toBeTruthy();
    });

    it('cancels and surfaces the diffs (no prompt) when the config differs', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue({
        ...matchingLocalConfig,
        auth: { scopes: ['contacts:read'], redirectUris: ['http://old-host/cb'] },
      });

      await scaffoldCommand({ json: true });

      expect(mockPrompt).not.toHaveBeenCalled();
      expect(fs.writeFileSync).not.toHaveBeenCalled();
      const output = stdoutSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.cancelled).toBe(true);
      expect(parsed.diffs).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'redirectUris' })]),
      );
    });

    it('merges (skips existing feature files) by default without prompting', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue(matchingLocalConfig);
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      await scaffoldCommand({ json: true });

      expect(mockPrompt).not.toHaveBeenCalled();
      // Every feature file already exists → merge skips them all.
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('overwrites existing feature files when --overwrite is passed', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue(matchingLocalConfig);
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      await scaffoldCommand({ json: true, overwrite: true });

      expect(mockPrompt).not.toHaveBeenCalled();
      expect(fs.writeFileSync).toHaveBeenCalled();
    });
  });

  describe('runBaseScaffold (core, no prompting/output)', () => {
    const ctx = {
      appDetails: {
        app_id: '1',
        name: 'Test App',
        client_id: 'cli-123',
        client_secret: 'secret-456',
        redirect_uris: ['http://localhost:3009/auth/callback'],
        scopes: ['contacts:read'],
      },
      clientId: 'cli-123',
      clientSecret: 'secret-456',
      redirectUris: ['http://localhost:3009/auth/callback'],
      redirectUri: 'http://localhost:3009/auth/callback',
    };

    it('writes base files and returns metadata without prompting or printing', async () => {
      const { runBaseScaffold, computeSlug } = require('../../../commands/app/project-writer');

      const result = runBaseScaffold('1', ctx, tmpPath('run-base-core'), false);

      expect(result.written).toBeGreaterThan(0);
      expect(result.legacyAllSubstituted).toBe(false);
      expect(result.scopes).toEqual(['contacts:read']);
      expect(result.files.length).toBeGreaterThan(0);
      expect(fs.writeFileSync).toHaveBeenCalled();
      expect(mockPrompt).not.toHaveBeenCalled();
      expect(stdoutSpy).not.toHaveBeenCalled();
      expect(computeSlug('Test App')).toBe('test-app');
    });

    it('passes DEFAULT_SCOPES fallback into template vars without a CLI_VERSION var', () => {
      const { runBaseScaffold } = require('../../../commands/app/project-writer');
      runBaseScaffold(
        '1',
        { ...ctx, appDetails: { ...ctx.appDetails, scopes: [] } },
        tmpPath('run-base-vars'),
        false,
      );

      const { loadBaseTemplates } = require('../../../templates');
      const vars = (loadBaseTemplates as jest.Mock).mock.calls[0][0];
      expect(vars).not.toHaveProperty('{{CLI_VERSION}}');
      expect(vars['{{SCOPES_JSON}}']).toBe(
        JSON.stringify(['contacts:read', 'contacts:write', 'crm:read', 'crm:write']),
      );
    });

    it.each<[string, string | undefined, string]>([
      ['present', 'https://example.com/logo.png', 'https://example.com/logo.png'],
      ['absent', undefined, ''],
    ])('maps {{LOGO_URI}} when logo_uri is %s', (_label, logoUri, expected) => {
      const { runBaseScaffold } = require('../../../commands/app/project-writer');
      runBaseScaffold(
        '1',
        {
          ...ctx,
          appDetails: {
            ...ctx.appDetails,
            ...(logoUri === undefined ? {} : { logo_uri: logoUri }),
          },
        },
        tmpPath('run-base-logo'),
        false,
      );
      const { loadBaseTemplates } = require('../../../templates');
      const vars = (loadBaseTemplates as jest.Mock).mock.calls[0][0];
      expect(vars['{{LOGO_URI}}']).toBe(expected);
    });

    it.each<[string, string | undefined, string]>([
      ['present', '0.0.1', '0.0.1'],
      ['absent', undefined, ''],
    ])('maps {{APP_VERSION}} when version is %s', (_label, version, expected) => {
      const { runBaseScaffold } = require('../../../commands/app/project-writer');
      runBaseScaffold(
        '1',
        {
          ...ctx,
          appDetails: { ...ctx.appDetails, ...(version === undefined ? {} : { version }) },
        },
        tmpPath('run-base-version'),
        false,
      );
      const { loadBaseTemplates } = require('../../../templates');
      const vars = (loadBaseTemplates as jest.Mock).mock.calls[0][0];
      expect(vars['{{APP_VERSION}}']).toBe(expected);
    });

    describe("legacy 'all' scope substitution", () => {
      const DEFAULTS = ['contacts:read', 'contacts:write', 'crm:read', 'crm:write'];

      const run = (
        remoteScopes: string[],
      ): { writtenScopes: string; legacyAllSubstituted: boolean } => {
        const { runBaseScaffold } = require('../../../commands/app/project-writer');
        const result = runBaseScaffold(
          '1',
          { ...ctx, appDetails: { ...ctx.appDetails, scopes: remoteScopes } },
          tmpPath('run-base-legacy'),
          false,
        );
        const { loadBaseTemplates } = require('../../../templates');
        const vars = (loadBaseTemplates as jest.Mock).mock.calls[0][0];
        return {
          writtenScopes: vars['{{SCOPES_JSON}}'],
          legacyAllSubstituted: result.legacyAllSubstituted,
        };
      };

      it("writes DEFAULT_SCOPES when 'all' is the only scope", () => {
        const { writtenScopes, legacyAllSubstituted } = run(['all']);
        expect(writtenScopes).toBe(JSON.stringify(DEFAULTS));
        expect(legacyAllSubstituted).toBe(true);
      });

      it("keeps granular scopes and only drops 'all' when scopes are mixed", () => {
        const { writtenScopes, legacyAllSubstituted } = run(['all', 'crm:deals', 'companies:read']);
        expect(writtenScopes).toBe(JSON.stringify(['crm:deals', 'companies:read']));
        expect(legacyAllSubstituted).toBe(true);
      });

      it('propagates granular remote scopes untouched', () => {
        const { writtenScopes, legacyAllSubstituted } = run(['contacts:read', 'crm:write']);
        expect(writtenScopes).toBe(JSON.stringify(['contacts:read', 'crm:write']));
        expect(legacyAllSubstituted).toBe(false);
      });
    });
  });

  describe('runFeatureScaffold (core, no prompting/output)', () => {
    const ctx = {
      appDetails: {
        app_id: '1',
        name: 'Test App',
        client_id: 'cli-123',
        client_secret: 'secret-456',
        redirect_uris: ['http://localhost:3009/auth/callback'],
        scopes: ['contacts:read'],
      },
      clientId: 'cli-123',
      clientSecret: 'secret-456',
      redirectUris: ['http://localhost:3009/auth/callback'],
      redirectUri: 'http://localhost:3009/auth/callback',
    };

    it('writes the oauth feature files and returns the written count', () => {
      const { runFeatureScaffold } = require('../../../commands/app/project-writer');

      const result = runFeatureScaffold('oauth', '1', ctx, tmpPath('run-feature-core'), false);

      expect(result.written).toBeGreaterThan(0);
      expect(result.files.length).toBeGreaterThan(0);
      expect(fs.writeFileSync).toHaveBeenCalled();
      expect(mockPrompt).not.toHaveBeenCalled();
      expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('skips existing files under mergeOnly', () => {
      const { runFeatureScaffold } = require('../../../commands/app/project-writer');
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      const result = runFeatureScaffold('oauth', '1', ctx, tmpPath('run-feature-merge'), true);

      expect(result.written).toBe(0);
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });
  });

  describe('resolveProjectDirectory', () => {
    // Resolve decides; it must not touch the filesystem. `app create` runs it before
    // the app is registered, so a write here is a stray directory whenever the create
    // that follows fails.
    it('decides a fresh directory without creating or entering it', async () => {
      const { resolveProjectDirectory } = require('../../../commands/app/project-writer');
      mockPrompt.mockResolvedValueOnce({ outputDir: tmpPath('fresh-dir') });

      const result = await resolveProjectDirectory('./default-slug');

      expect(fs.mkdirSync).not.toHaveBeenCalled();
      expect(chdirSpy).not.toHaveBeenCalled();
      expect(result).toEqual({
        targetDir: tmpPath('fresh-dir'),
        mergeOnly: false,
        chooseAgain: false,
        existed: false,
      });
    });

    it('records that an existing directory was already there, without entering it', async () => {
      const { resolveProjectDirectory } = require('../../../commands/app/project-writer');
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      mockPrompt
        .mockResolvedValueOnce({ outputDir: tmpPath('existing-dir') })
        .mockResolvedValueOnce({ action: 'overwrite' });

      const result = await resolveProjectDirectory('./default-slug');

      expect(chdirSpy).not.toHaveBeenCalled();
      expect(result.chooseAgain).toBe(false);
      // `existed` is carried rather than re-derived: by the time apply runs, an
      // `existsSync` would answer "yes, because we just made it".
      expect(result.existed).toBe(true);
    });

    it('does not chdir when the user chooses a different path', async () => {
      const { resolveProjectDirectory } = require('../../../commands/app/project-writer');
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      mockPrompt
        .mockResolvedValueOnce({ outputDir: tmpPath('existing-dir') })
        .mockResolvedValueOnce({ action: 'new' });

      const result = await resolveProjectDirectory('./default-slug');

      expect(chdirSpy).not.toHaveBeenCalled();
      expect(result.chooseAgain).toBe(true);
    });

    it('suppresses the directory notice in json mode', async () => {
      const { resolveProjectDirectory } = require('../../../commands/app/project-writer');

      await resolveProjectDirectory('./default-slug', true);

      const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
      expect(output).not.toContain('Creating');
      expect(mockPrompt).not.toHaveBeenCalled();
    });
  });

  describe('applyProjectDirectory', () => {
    it('creates and enters a directory that was not there', () => {
      const { applyProjectDirectory } = require('../../../commands/app/project-writer');

      applyProjectDirectory({
        targetDir: tmpPath('fresh-dir'),
        mergeOnly: false,
        chooseAgain: false,
        existed: false,
      });

      expect(fs.mkdirSync).toHaveBeenCalledWith(tmpPath('fresh-dir'), { recursive: true });
      expect(chdirSpy).toHaveBeenCalledWith(tmpPath('fresh-dir'));
    });

    it('enters an existing directory without re-creating it', () => {
      const { applyProjectDirectory } = require('../../../commands/app/project-writer');

      applyProjectDirectory({
        targetDir: tmpPath('existing-dir'),
        mergeOnly: true,
        chooseAgain: false,
        existed: true,
      });

      expect(fs.mkdirSync).not.toHaveBeenCalled();
      expect(chdirSpy).toHaveBeenCalledWith(tmpPath('existing-dir'));
    });

    // Both describe "no directory to apply": the caller is being asked to loop, or
    // could not resolve one at all under --json.
    it('is a no-op for chooseAgain and for an unresolved decision', () => {
      const { applyProjectDirectory } = require('../../../commands/app/project-writer');

      applyProjectDirectory({
        targetDir: tmpPath('a'),
        mergeOnly: false,
        chooseAgain: true,
        existed: true,
      });
      applyProjectDirectory({ targetDir: tmpPath('b'), unresolved: true });

      expect(fs.mkdirSync).not.toHaveBeenCalled();
      expect(chdirSpy).not.toHaveBeenCalled();
    });

    it('suppresses the directory notice under --json', () => {
      const { applyProjectDirectory } = require('../../../commands/app/project-writer');

      applyProjectDirectory(
        { targetDir: tmpPath('json-dir'), mergeOnly: false, chooseAgain: false, existed: false },
        true,
      );

      const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
      expect(output).not.toContain('Creating');
      expect(chdirSpy).toHaveBeenCalledWith(tmpPath('json-dir'));
    });
  });

  describe('promptFeatureType', () => {
    // A list with one entry is a keystroke that can only produce one answer, put to
    // someone who already chose the app type. With a second feature in the manifest
    // the picker comes back on its own — the choices are derived from it, so this
    // assertion is what keeps a hard-coded one-item list from being reintroduced.
    it('does not ask which feature while the manifest holds only one', async () => {
      const { promptFeatureType } = require('../../../commands/app/scaffold-prompts');

      const result = await promptFeatureType(true);

      expect(mockPrompt).not.toHaveBeenCalled();
      expect(result).toBe('oauth');
    });

    it('asks, and offers every manifest entry, once there is more than one', async () => {
      // Re-required through an isolated registry so the prompt module reads a
      // two-entry manifest instead of the suite-wide one-entry mock.
      const { promptFeatureType } = require('../../../commands/app/scaffold-prompts');
      const { FEATURE_TEMPLATE_MANIFESTS, FEATURE_LABELS } = require('../../../templates');
      // Added to the mocked registry rather than through a re-imported module: the
      // count is read per call (`Object.keys`), which is exactly the property under
      // test — a second feature restores the picker without touching this code.
      FEATURE_TEMPLATE_MANIFESTS.webhook = [];
      FEATURE_LABELS.webhook = 'Webhook receiver';
      mockPrompt.mockResolvedValueOnce({ featureType: 'webhook' });

      try {
        const result = await promptFeatureType(true);

        expect(mockPrompt).toHaveBeenCalledWith([
          expect.objectContaining({ name: 'featureType', choices: expect.any(Array) }),
        ]);
        // Labels are trimmed before comparing: `indentChoices` pads each one into the
        // CLI's output gutter, which is presentation. Asserting the padded string would
        // make every label assertion in the suite a test of the indent instead.
        const question = mockPrompt.mock.calls[0][0][0];
        expect(
          question.choices.map((choice: { name: string; value: string }) => ({
            name: choice.name.trim(),
            value: choice.value,
          })),
        ).toEqual([
          { name: 'Test OAuth App', value: 'oauth' },
          { name: 'Webhook receiver', value: 'webhook' },
        ]);
        expect(result).toBe('webhook');
      } finally {
        delete FEATURE_TEMPLATE_MANIFESTS.webhook;
        delete FEATURE_LABELS.webhook;
      }
    });

    it('returns oauth without prompting when not interactive', async () => {
      const { promptFeatureType } = require('../../../commands/app/scaffold-prompts');

      const result = await promptFeatureType(false);

      expect(mockPrompt).not.toHaveBeenCalled();
      expect(result).toBe('oauth');
    });
  });

  // ──────────────── UI apps (BEX-290) ────────────────
  describe('UI apps', () => {
    const uiApp = {
      extension_type: 'actionLink' as const,
      surface_point_list: [
        { surface_point_name: 'contact-details-header-menu', context: ['recordId'] },
      ],
      label: 'View in CRM',
      // A value the server does not know about — the whole point of the
      // preservation test below.
      more_info: 'Hand-edited more_info',
      redirect_link: 'https://example.com/brevo',
    };

    // Drifts from serverApp on appName so the refresh path (a full overwrite of
    // app-config.json) is exercised.
    const driftedUiConfig = {
      appId: '1',
      appName: 'Renamed Locally',
      distribution_type: 'private' as const,
      logoUri: '',
      version: '1.0.0',
      auth: { scopes: ['contacts:read'] },
      ui_app: uiApp,
    };

    // This is the regression that matters: on detected drift the command
    // rewrites app-config.json wholesale from server values, and the server does
    // not return `ui_app`. Without the local block being carried into the
    // template vars, a partner's hand-edited action-link config is destroyed.
    it('preserves the local ui_app block through a confirmed config refresh', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue(driftedUiConfig);
      mockPrompt.mockResolvedValueOnce({ confirmed: true });

      await scaffoldCommand({});

      const { loadBaseTemplates } = require('../../../templates');
      expect(loadBaseTemplates).toHaveBeenCalled();
      const vars = (loadBaseTemplates as jest.Mock).mock.calls[0][0];
      expect(vars['{{UI_APP_JSON}}']).toContain('Hand-edited more_info');
      expect(JSON.parse(vars['{{UI_APP_JSON}}'].replaceAll('\n  ', '\n'))).toEqual(uiApp);
    });

    it('does not report phantom redirect-URL drift for a UI app', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue({
        ...driftedUiConfig,
        appName: 'Test App', // matches the server, so ONLY redirectUrls could differ
      });

      await scaffoldCommand({ json: true });

      // No drift detected → no cancellation, and the base refresh is skipped.
      const parsed = JSON.parse(stdoutSpy.mock.calls[0][0]);
      expect(parsed.cancelled).toBeUndefined();
    });

    it('offers no features and never scaffolds the OAuth server', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue({
        ...driftedUiConfig,
        appName: 'Test App',
      });

      await scaffoldCommand({});

      const { loadFeatureTemplates } = require('../../../templates');
      expect(loadFeatureTemplates).not.toHaveBeenCalled();
      const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
      expect(output).toMatch(/no features to scaffold/i);
    });

    // The app type is decided locally, never by server data. If the server
    // returned a `ui_app` for an app the local config says is OAuth, honouring it
    // would silently reclassify the project and write a UI config over an OAuth
    // one — so `fetchAppContext` takes the block from the caller only.
    it('ignores a server-returned ui_app block for a project whose local config is OAuth', async () => {
      (appService.resolveAppCredentials as jest.Mock).mockResolvedValue({
        diffs: [],
        app: { ...serverApp, ui_app: uiApp },
      });
      (readProjectConfig as jest.Mock).mockReturnValue({
        ...matchingLocalConfig,
        appName: 'Renamed Locally', // force the base refresh
      });
      mockPrompt.mockResolvedValueOnce({ confirmed: true });

      await scaffoldCommand({});

      const { loadBaseTemplates, loadFeatureTemplates } = require('../../../templates');
      const vars = (loadBaseTemplates as jest.Mock).mock.calls[0][0];
      expect(vars['{{UI_APP_JSON}}']).toBe('');
      // Still treated as an OAuth project: the feature scaffold runs.
      expect(loadFeatureTemplates).toHaveBeenCalled();
    });

    it('reports an empty feature list under --json', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue({
        ...driftedUiConfig,
        appName: 'Test App',
      });

      await scaffoldCommand({ json: true });

      const parsed = JSON.parse(stdoutSpy.mock.calls[0][0]);
      expect(parsed.features).toEqual([]);
    });
  });

  // `fallbackApp` exists for exactly one caller: `app create`'s read-back of the
  // app it just created. The platform can answer `id not found` for an ID it
  // issued moments earlier (BEX-290), and before this the throw took the whole
  // create with it — app on the server, no project on disk.
  describe('fetchAppContext read-back fallback', () => {
    // The create response: no `scopes`, and a name/version distinct from
    // `serverApp` so a test can tell which object the context was built from.
    const createResponse = {
      app_id: '1',
      name: 'Freshly Created',
      client_id: 'cli-new',
      client_secret: 'secret-new',
      redirect_uris: ['http://localhost:4000/callback'],
      distribution_type: 'private' as const,
      logo_uri: 'https://example.com/logo.png',
      version: '0.1.0',
      created_at: '',
      updated_at: '',
    };

    it('reads normally and ignores the fallback when the server answers', async () => {
      const ctx = await fetchAppContext('1', false, undefined, createResponse);

      expect(ctx.appDetails).toEqual(serverApp);
      expect(ctx.clientId).toBe('cli-123');
      const warned = stdoutSpy.mock.calls.some((c) => String(c[0]).includes('could not be read'));
      expect(warned).toBe(false);
    });

    it('builds the context from the fallback when the server returns no app', async () => {
      (appService.resolveAppCredentials as jest.Mock).mockResolvedValue(null);

      const ctx = await fetchAppContext('1', false, undefined, createResponse);

      expect(ctx.appDetails).toEqual(createResponse);
      expect(ctx.clientId).toBe('cli-new');
      expect(ctx.clientSecret).toBe('secret-new');
      expect(ctx.redirectUris).toEqual(['http://localhost:4000/callback']);
    });

    it('asks the service to tolerate a 404 only when a fallback is available', async () => {
      await fetchAppContext('1', false, undefined, createResponse);
      expect(appService.resolveAppCredentials).toHaveBeenLastCalledWith('1', {
        tolerateMissing: true,
      });

      await fetchAppContext('1');
      expect(appService.resolveAppCredentials).toHaveBeenLastCalledWith('1', {
        tolerateMissing: false,
      });
    });

    it('warns on the fallback path so the user knows the config came from create', async () => {
      (appService.resolveAppCredentials as jest.Mock).mockResolvedValue(null);

      await fetchAppContext('1', false, undefined, createResponse);

      const warned = stdoutSpy.mock.calls.some((c) => String(c[0]).includes('could not be read'));
      expect(warned).toBe(true);
    });

    // logWarn writes to stdout, which under --json is the single JSON blob.
    it('stays silent on the fallback path under --json', async () => {
      (appService.resolveAppCredentials as jest.Mock).mockResolvedValue(null);

      await fetchAppContext('1', true, undefined, createResponse);

      expect(stdoutSpy).not.toHaveBeenCalled();
    });

    // No fallback (every caller but create) → not-found still aborts.
    it('propagates the service error when no fallback was supplied', async () => {
      (appService.resolveAppCredentials as jest.Mock).mockRejectedValue(
        new Error('App 1 not found.'),
      );

      await expect(fetchAppContext('1')).rejects.toThrow('App 1 not found.');
    });
  });
});
