import { createCommand } from '../../../commands/app/create';
import { ApiError, AuthExpiredError, ErrorCode } from '../../../lib/errors';

jest.mock('inquirer', () => ({
  prompt: jest.fn(),
  // The grouped placement prompt puts one separator above each page's placements.
  // Mirrors inquirer 8's own Separator, which carries `type: 'separator'` and the
  // rendered `line` — the tests read both to assert the grouping.
  Separator: class {
    type = 'separator';
    line: string;
    constructor(line: string) {
      this.line = line;
    }
  },
}));

jest.mock('../../../lib/config', () => ({
  getApiKey: jest.fn().mockReturnValue('test-key'),
  saveAppCredentials: jest.fn(),
  saveAppName: jest.fn(),
  hasLocalApp: jest.fn().mockReturnValue(false),
  isAuthenticated: jest.fn().mockReturnValue(true),
  readProjectConfig: jest.fn().mockReturnValue(null),
  isUiAppConfig: (config: { ui_app?: unknown } | null | undefined) => !!config?.ui_app,
}));

// `create` reaches for the login command only to recover a session that died
// mid-flow. Mocked rather than real: the real one opens a browser.
jest.mock('../../../commands/login', () => ({
  loginCommand: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../container', () => ({
  appService: {
    fetchAppsList: jest.fn(),
    fetchApp: jest.fn(),
    fetchSurfacePoints: jest.fn(),
    fetchSurfacePointLocations: jest.fn(),
    pickApp: jest.fn(),
    createApp: jest.fn(),
    updateApp: jest.fn(),
    deleteApp: jest.fn(),
  },
  accountService: {
    validateApiKey: jest.fn(),
    getAccount: jest.fn(),
  },
  client: {},
}));

// The project writer, not the `scaffold` command — that is what `create.ts` depends on.
jest.mock('../../../commands/app/project-writer', () => ({
  computeSlug: jest.fn(
    (name: string | undefined) =>
      (name || 'my-app')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'my-app',
  ),
  fetchAppContext: jest.fn(),
  runBaseScaffold: jest.fn(),
  runFeatureScaffold: jest.fn(),
  resolveProjectDirectory: jest.fn(),
  applyProjectDirectory: jest.fn(),
  reportBaseScaffoldSuccess: jest.fn(),
  reportScaffoldSuccess: jest.fn(),
  computeCdHint: jest.fn(),
}));

// Partial: `promptFeatureType` is stubbed so the feature choice is deterministic, but
// `promptScaffoldFeature` stays REAL — its confirm is answered through the mocked
// inquirer (the `scaffoldRaw` answers below), which is what exercises the default-yes
// and decline paths from `create`'s side.
jest.mock('../../../commands/app/scaffold-prompts', () => ({
  ...jest.requireActual('../../../commands/app/scaffold-prompts'),
  promptFeatureType: jest.fn(),
}));

jest.mock('node:fs');

// Need to import after mocks
import * as fs from 'node:fs';
import inquirer from 'inquirer';
import { appService } from '../../../container';
import {
  saveAppCredentials,
  saveAppName,
  hasLocalApp,
  isAuthenticated,
  readProjectConfig,
} from '../../../lib/config';
import { loginCommand } from '../../../commands/login';
import { messages } from '../../../lang/en';
import {
  fetchAppContext,
  runBaseScaffold,
  runFeatureScaffold,
  resolveProjectDirectory,
  applyProjectDirectory,
  reportBaseScaffoldSuccess,
  reportScaffoldSuccess,
  computeCdHint,
} from '../../../commands/app/project-writer';
import { promptFeatureType } from '../../../commands/app/scaffold-prompts';

const mockPrompt = inquirer.prompt as unknown as jest.Mock;

describe('app/create', () => {
  let stdoutSpy: jest.SpyInstance;
  const originalIsTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  const originalColumnsDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
  let chdirSpy: jest.SpyInstance;

  beforeEach(() => {
    // `printBox` wraps to the terminal, and under jest there is no terminal — it would
    // fall back to 80 columns and break long box lines mid-URL. Pin a wide window so
    // these assertions read box CONTENT; the wrapping itself is covered in
    // `__tests__/lib/ui.test.ts`, which is the only place that should care about width.
    Object.defineProperty(process.stdout, 'columns', {
      configurable: true,
      writable: true,
      value: 200,
    });
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    chdirSpy = jest.spyOn(process, 'chdir').mockImplementation(() => undefined);
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      writable: true,
      value: true,
    });
    jest.clearAllMocks();
    // jest.clearAllMocks() only clears mock.calls/instances/results — it does
    // NOT reset a persistent implementation set via mockReturnValue in an
    // earlier test (that requires mockReset/resetAllMocks, which this repo's
    // jest.config.js doesn't enable). Re-assert the defaults from the
    // `../../../lib/config` mock factory here so tests are isolated from
    // whatever the previous test left behind in these two mocks.
    (hasLocalApp as jest.Mock).mockReturnValue(false);
    (isAuthenticated as jest.Mock).mockReturnValue(true);
    (readProjectConfig as jest.Mock).mockReturnValue(null);
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    (fetchAppContext as jest.Mock).mockResolvedValue({
      appDetails: null,
      clientId: '',
      clientSecret: '',
      redirectUris: [],
      redirectUri: '',
    });
    (runBaseScaffold as jest.Mock).mockReturnValue({
      written: 0,
      legacyAllSubstituted: false,
      scopes: [],
      files: [],
    });
    (runFeatureScaffold as jest.Mock).mockReturnValue({
      written: 0,
      files: [],
    });
    (resolveProjectDirectory as jest.Mock).mockResolvedValue({
      targetDir: '/cwd/test-app',
      mergeOnly: false,
      chooseAgain: false,
    });
    (promptFeatureType as jest.Mock).mockResolvedValue('oauth');
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    chdirSpy.mockRestore();
    if (originalIsTTYDescriptor) {
      Object.defineProperty(process.stdin, 'isTTY', originalIsTTYDescriptor);
    } else {
      Reflect.deleteProperty(process.stdin, 'isTTY');
    }
    if (originalColumnsDescriptor) {
      Object.defineProperty(process.stdout, 'columns', originalColumnsDescriptor);
    } else {
      Reflect.deleteProperty(process.stdout, 'columns');
    }
  });

  it('should create an app, write base files, then scaffold the feature on consent', async () => {
    (appService.createApp as jest.Mock).mockResolvedValue({
      app_id: 1,
      name: 'Test App',
      client_id: 'cli-123',
      client_secret: 'secret-456',
      redirect_uris: ['http://localhost:3009/auth/callback'],
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    });

    mockPrompt
      .mockResolvedValueOnce({ logoUrl: '' }) // logo
      .mockResolvedValueOnce({ appType: 'oauth' }) // app type
      .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' }) // redirect URL
      .mockResolvedValueOnce({ another: false }) // no more URLs
      .mockResolvedValueOnce({ scaffoldRaw: 'y' }); // scaffold a feature?

    await createCommand({ name: 'Test App', distribution: 'private' });

    expect(appService.createApp).toHaveBeenCalledWith({
      name: 'Test App',
      distribution_type: 'private',
      auth: {
        scopes: ['contacts:read', 'contacts:write', 'crm:read', 'crm:write'],
        redirect_uris: ['http://localhost:3009/auth/callback'],
      },
    });
    expect(saveAppCredentials).toHaveBeenCalledWith(1, {
      clientId: 'cli-123',
      clientSecret: 'secret-456',
    });
    expect(runBaseScaffold).toHaveBeenCalledWith(1, expect.anything(), '/cwd/test-app', false);
    expect(runFeatureScaffold).toHaveBeenCalledWith(
      'oauth',
      1,
      expect.anything(),
      '/cwd/test-app',
      false,
    );
  });

  // The create response is handed to `fetchAppContext` as its read-back fallback so
  // a server that can't resolve the ID it just issued (observed on UI apps, BEX-290)
  // can no longer abort a create that already succeeded, leaving an orphan app.
  it('passes the create response to fetchAppContext as the read-back fallback', async () => {
    const created = {
      app_id: 1,
      name: 'Test App',
      client_id: 'cli-123',
      client_secret: 'secret-456',
      redirect_uris: ['http://localhost:3009/auth/callback'],
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    };
    (appService.createApp as jest.Mock).mockResolvedValue(created);

    mockPrompt
      .mockResolvedValueOnce({ logoUrl: '' })
      .mockResolvedValueOnce({ appType: 'oauth' })
      .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' })
      .mockResolvedValueOnce({ another: false })
      .mockResolvedValueOnce({ scaffoldRaw: 'n' });

    await createCommand({ name: 'Test App', distribution: 'private' });

    expect(fetchAppContext).toHaveBeenCalledWith(1, false, undefined, created);
  });

  // The whole opening of the flow, pinned in one place: name, logo and distribution all
  // describe the app record and are asked of every app, then "What type of app are you
  // building?" — the branch point — then whatever that branch asks for.
  //
  // The logo's position is the part that has drifted: it used to sit *behind* the type
  // branch, so an OAuth app answered it after its callback URLs and a UI app after its
  // placements. Answered by question *name*, so the assertion is about the order the
  // prompts fire in and not about the order this test queues its answers.
  it('asks name → logo → distribution → app type, before any type-specific prompt', async () => {
    (appService.createApp as jest.Mock).mockResolvedValue({
      app_id: 2,
      name: 'Order App',
      client_id: 'cli-order',
      client_secret: 'secret-order',
      redirect_uris: ['http://localhost:3009/auth/callback'],
    });
    const answers: Record<string, unknown> = {
      name: 'Order App',
      logoUrl: '',
      appType: 'oauth',
      distribution: 'private',
      redirectUrl: 'http://localhost:3009/auth/callback',
      anotherRaw: 'n',
      scaffoldRaw: 'n',
    };
    const asked: string[] = [];
    mockPrompt.mockImplementation((questions: Array<Record<string, unknown>>) => {
      const name = String(questions[0]?.name ?? '');
      asked.push(name);
      return Promise.resolve(name in answers ? { [name]: answers[name] } : {});
    });

    // No flags at all — every one of these questions has to actually be asked.
    await createCommand({});

    expect(asked.slice(0, 4)).toEqual(['name', 'logoUrl', 'distribution', 'appType']);
    // …and the branch's own prompts come after all four, not interleaved with them.
    expect(asked.indexOf('redirectUrl')).toBeGreaterThan(asked.indexOf('appType'));
  });

  // Both choice lists in ONE full interactive run, which is what the two assertions
  // further down cannot say: they each drive a run that answers only their own question.
  // A regression that narrowed one list depending on how the other was answered would
  // pass both of those and fail here.
  it('offers both choices on both questions in a single interactive run', async () => {
    (appService.createApp as jest.Mock).mockResolvedValue({
      app_id: 3,
      name: 'Both Choices App',
      client_id: 'cli-choices',
      client_secret: 'secret-choices',
      redirect_uris: ['http://localhost:3009/auth/callback'],
    });
    mockPrompt.mockResolvedValue({
      name: 'Both Choices App',
      logoUrl: '',
      distribution: 'private',
      appType: 'oauth',
      redirectUrl: 'http://localhost:3009/auth/callback',
      anotherRaw: 'n',
      scaffoldRaw: 'n',
    });

    await createCommand({});

    const questionNamed = (name: string) =>
      mockPrompt.mock.calls.flatMap((call) => call[0]).find((q) => q?.name === name);
    const valuesOf = (name: string) =>
      questionNamed(name).choices.map((choice: { value: string }) => choice.value);

    expect(valuesOf('distribution')).toEqual(['private', 'public']);
    expect(valuesOf('appType')).toEqual(['oauth', 'ui']);
  });

  describe('feature scaffolding', () => {
    it('prompts to scaffold a feature (default yes) and scaffolds oauth when accepted', async () => {
      (appService.createApp as jest.Mock).mockResolvedValue({
        app_id: 8,
        name: 'Feature App',
        client_id: 'cli-feat',
        client_secret: 'secret-feat',
        redirect_uris: ['http://localhost:3009/auth/callback'],
      });
      mockPrompt
        .mockResolvedValueOnce({ logoUrl: '' })
        .mockResolvedValueOnce({ appType: 'oauth' })
        .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' })
        .mockResolvedValueOnce({ another: false })
        .mockResolvedValueOnce({ scaffoldRaw: 'y' });

      await createCommand({ name: 'Feature App', distribution: 'private' });

      // The scaffold-feature prompt fires (name: 'scaffoldRaw'), then the
      // feature type is chosen and the oauth feature is written.
      expect(mockPrompt).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ name: 'scaffoldRaw' })]),
      );
      expect(promptFeatureType).toHaveBeenCalled();
      expect(runBaseScaffold).toHaveBeenCalledWith(8, expect.anything(), '/cwd/test-app', false);
      expect(runFeatureScaffold).toHaveBeenCalledWith(
        'oauth',
        8,
        expect.anything(),
        '/cwd/test-app',
        false,
      );
      expect(reportScaffoldSuccess).toHaveBeenCalled();
    });

    it('renders the created-app box + base files before prompting to scaffold a feature', async () => {
      (appService.createApp as jest.Mock).mockResolvedValue({
        app_id: 30,
        name: 'Order App',
        client_id: 'cli-order',
        client_secret: 'secret-order',
        redirect_uris: ['http://localhost:3009/auth/callback'],
        version: '0.0.1',
      });
      mockPrompt
        .mockResolvedValueOnce({ logoUrl: '' })
        .mockResolvedValueOnce({ appType: 'oauth' })
        .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' })
        .mockResolvedValueOnce({ another: false })
        .mockResolvedValueOnce({ scaffoldRaw: 'n' });

      await createCommand({ name: 'Order App', distribution: 'private' });

      // The base-files report (which prints right after the created-app box)
      // must run before the "scaffold a feature?" prompt fires.
      expect(reportBaseScaffoldSuccess).toHaveBeenCalled();
      const baseOrder = (reportBaseScaffoldSuccess as jest.Mock).mock.invocationCallOrder[0]!;
      const scaffoldPromptIdx = mockPrompt.mock.calls.findIndex(
        ([q]) => Array.isArray(q) && q[0]?.name === 'scaffoldRaw',
      );
      expect(scaffoldPromptIdx).toBeGreaterThanOrEqual(0);
      const scaffoldPromptOrder = mockPrompt.mock.invocationCallOrder[scaffoldPromptIdx]!;
      expect(baseOrder).toBeLessThan(scaffoldPromptOrder);
    });

    it('writes only base files when the user declines the feature prompt', async () => {
      (appService.createApp as jest.Mock).mockResolvedValue({
        app_id: 8,
        name: 'Base Only App',
        client_id: 'cli-base',
        client_secret: 'secret-base',
        redirect_uris: ['http://localhost:3009/auth/callback'],
      });
      mockPrompt
        .mockResolvedValueOnce({ logoUrl: '' })
        .mockResolvedValueOnce({ appType: 'oauth' })
        .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' })
        .mockResolvedValueOnce({ another: false })
        .mockResolvedValueOnce({ scaffoldRaw: 'n' });

      await createCommand({ name: 'Base Only App', distribution: 'private' });

      expect(runBaseScaffold).toHaveBeenCalledWith(8, expect.anything(), '/cwd/test-app', false);
      expect(runFeatureScaffold).not.toHaveBeenCalled();
      expect(promptFeatureType).not.toHaveBeenCalled();
      expect(reportScaffoldSuccess).not.toHaveBeenCalled();
      // Points the user at `brevo app scaffold` to add a feature later.
      const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
      expect(output).toContain('brevo app scaffold');
    });

    it('writes base files only under --json (no feature) and reports the base count', async () => {
      (appService.createApp as jest.Mock).mockResolvedValue({
        app_id: 9,
        name: 'JSON Scaffold App',
        client_id: 'cli-json-scaffold',
        client_secret: 'secret-json-scaffold',
        redirect_uris: ['http://localhost:3009/auth/callback'],
      });
      (runBaseScaffold as jest.Mock).mockReturnValue({
        written: 5,
        legacyAllSubstituted: false,
        scopes: [],
        files: [],
      });

      await createCommand({
        name: 'JSON Scaffold App',
        distribution: 'private',
        redirectUri: ['http://localhost:3009/auth/callback'],
        json: true,
      });

      // --json can't prompt, so it stays base-only — oauth is added later via
      // `brevo app scaffold`.
      expect(mockPrompt).not.toHaveBeenCalled();
      expect(runBaseScaffold).toHaveBeenCalledWith(9, expect.anything(), expect.any(String), false);
      expect(runFeatureScaffold).not.toHaveBeenCalled();
      const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
      const parsed = JSON.parse(output);
      expect(parsed.scaffolded).toBe(5);
      expect(typeof parsed.directory).toBe('string');
      expect(parsed.scaffoldSkipped).toBeUndefined();
    });

    it('writes base files only for a piped (non-TTY) non-json create', async () => {
      Object.defineProperty(process.stdin, 'isTTY', {
        configurable: true,
        writable: true,
        value: false,
      });
      (appService.createApp as jest.Mock).mockResolvedValue({
        app_id: 15,
        name: 'Piped App',
        client_id: 'cli-piped',
        client_secret: 'secret-piped',
        redirect_uris: ['http://localhost:3009/auth/callback'],
      });

      await createCommand({
        name: 'Piped App',
        distribution: 'private',
        redirectUri: ['http://localhost:3009/auth/callback'],
      });

      expect(runBaseScaffold).toHaveBeenCalled();
      expect(runFeatureScaffold).not.toHaveBeenCalled();
    });

    it('skips scaffolding under --json when the default directory already exists', async () => {
      (appService.createApp as jest.Mock).mockResolvedValue({
        app_id: 10,
        name: 'Existing Dir App',
        client_id: 'cli-existing-dir',
        client_secret: 'secret-existing-dir',
        redirect_uris: ['http://localhost:3009/auth/callback'],
      });
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      await createCommand({
        name: 'Existing Dir App',
        distribution: 'private',
        redirectUri: ['http://localhost:3009/auth/callback'],
        json: true,
      });

      expect(runBaseScaffold).not.toHaveBeenCalled();
      expect(runFeatureScaffold).not.toHaveBeenCalled();
      const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
      const parsed = JSON.parse(output);
      expect(parsed.scaffolded).toBeUndefined();
      expect(typeof parsed.scaffoldSkipped).toBe('string');
      expect(parsed.scaffoldSkipped).toContain('already exists');
    });
  });

  describe('linked-directory guard', () => {
    it('throws immediately when app-config.json is already linked in cwd, without calling the API', async () => {
      (hasLocalApp as jest.Mock).mockReturnValue(true);
      (readProjectConfig as jest.Mock).mockReturnValue({ appId: '5', appName: 'Existing App' });

      await expect(createCommand({ name: 'New App', distribution: 'private' })).rejects.toThrow(
        /already linked/i,
      );

      expect(appService.createApp).not.toHaveBeenCalled();
      expect(mockPrompt).not.toHaveBeenCalled();
    });

    it('includes the linked app name in the error message', async () => {
      (hasLocalApp as jest.Mock).mockReturnValue(true);
      (readProjectConfig as jest.Mock).mockReturnValue({ appId: '5', appName: 'Existing App' });

      await expect(createCommand({ name: 'New App', distribution: 'private' })).rejects.toThrow(
        'Existing App',
      );
    });
  });

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
        .mockResolvedValueOnce({ logoUrl: '' })
        .mockResolvedValueOnce({ appType: 'oauth' })
        .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' })
        .mockResolvedValueOnce({ another: false })
        .mockResolvedValueOnce({ scaffoldRaw: 'y' });

      await createCommand({ name: 'Dir App', distribution: 'private' });

      expect(createCallOrder).toEqual(['directory', 'create']);
      expect(runBaseScaffold).toHaveBeenCalledWith(20, expect.anything(), '/cwd/dir-app', false);
      expect(runFeatureScaffold).toHaveBeenCalledWith(
        'oauth',
        20,
        expect.anything(),
        '/cwd/dir-app',
        false,
      );
    });

    // The directory decision (prompts) must stay BEFORE the create so a Ctrl-C at
    // the prompt cannot orphan an app on the server. The directory *mutation* must
    // land AFTER it, so a failed create leaves no stray directory and no moved cwd.
    // The two halves pull in opposite directions, which is why they are separate
    // calls rather than one.
    it('applies the directory only after the create succeeds', async () => {
      const order: string[] = [];
      (resolveProjectDirectory as jest.Mock).mockImplementation(async () => {
        order.push('decide');
        return {
          targetDir: '/cwd/ordered-app',
          mergeOnly: false,
          chooseAgain: false,
          existed: false,
        };
      });
      (appService.createApp as jest.Mock).mockImplementation(async () => {
        order.push('create');
        return {
          app_id: 21,
          name: 'Ordered App',
          client_id: 'cli-ord',
          client_secret: 'secret-ord',
          redirect_uris: ['http://localhost:3009/auth/callback'],
        };
      });
      (applyProjectDirectory as jest.Mock).mockImplementation(() => {
        order.push('apply');
      });
      mockPrompt
        .mockResolvedValueOnce({ logoUrl: '' })
        .mockResolvedValueOnce({ appType: 'oauth' })
        .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' })
        .mockResolvedValueOnce({ another: false })
        .mockResolvedValueOnce({ scaffoldRaw: 'y' });

      await createCommand({ name: 'Ordered App', distribution: 'private' });

      expect(order).toEqual(['decide', 'create', 'apply']);
    });

    it('leaves no directory behind when the create fails', async () => {
      (resolveProjectDirectory as jest.Mock).mockResolvedValue({
        targetDir: '/cwd/doomed-app',
        mergeOnly: false,
        chooseAgain: false,
        existed: false,
      });
      (appService.createApp as jest.Mock).mockRejectedValue(new Error('quota exceeded'));
      mockPrompt
        .mockResolvedValueOnce({ logoUrl: '' })
        .mockResolvedValueOnce({ appType: 'oauth' })
        .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' })
        .mockResolvedValueOnce({ another: false });

      await expect(createCommand({ name: 'Doomed App', distribution: 'private' })).rejects.toThrow(
        /quota exceeded/,
      );

      // The whole point: nothing was created and the process never moved.
      expect(applyProjectDirectory).not.toHaveBeenCalled();
    });

    it('computes the cd hint from the cwd at command start and forwards it to reportScaffoldSuccess', async () => {
      const originalCwd = process.cwd();
      (resolveProjectDirectory as jest.Mock).mockResolvedValue({
        targetDir: '/cwd/cd-hint-app',
        mergeOnly: false,
        chooseAgain: false,
      });
      (computeCdHint as jest.Mock).mockReturnValue('cd-hint-app');
      (appService.createApp as jest.Mock).mockResolvedValue({
        app_id: 23,
        name: 'Cd Hint App',
        client_id: 'cli-cd-hint',
        client_secret: 'secret-cd-hint',
        redirect_uris: ['http://localhost:3009/auth/callback'],
      });
      mockPrompt
        .mockResolvedValueOnce({ logoUrl: '' })
        .mockResolvedValueOnce({ appType: 'oauth' })
        .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' })
        .mockResolvedValueOnce({ another: false })
        .mockResolvedValueOnce({ scaffoldRaw: 'y' });

      await createCommand({ name: 'Cd Hint App', distribution: 'private' });

      expect(computeCdHint).toHaveBeenCalledWith(originalCwd, '/cwd/cd-hint-app');
      expect(reportScaffoldSuccess).toHaveBeenCalledWith(
        expect.objectContaining({ cdDir: 'cd-hint-app' }),
      );
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
      // The non-interactive path skips the prompt but still lands in the directory —
      // asserted on the apply call, since that is what now owns the mkdir/chdir.
      expect(applyProjectDirectory).toHaveBeenCalledWith(
        expect.objectContaining({ existed: false }),
        true,
      );
    });

    it('shows the feature-type prompt after app creation, not before', async () => {
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
      (promptFeatureType as jest.Mock).mockImplementation(async () => {
        order.push('featureType');
        return 'oauth';
      });
      mockPrompt
        .mockResolvedValueOnce({ logoUrl: '' })
        .mockResolvedValueOnce({ appType: 'oauth' })
        .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' })
        .mockResolvedValueOnce({ another: false })
        .mockResolvedValueOnce({ scaffoldRaw: 'y' });

      await createCommand({ name: 'Ordered App', distribution: 'private' });

      expect(order).toEqual(['create', 'featureType']);
    });
  });

  it('should output JSON when --json flag is used', async () => {
    (appService.createApp as jest.Mock).mockResolvedValue({
      app_id: 2,
      name: 'JSON App',
      client_id: 'cli-abc',
      client_secret: 'secret-xyz',
      redirect_uris: ['http://localhost:3009/auth/callback'],
    });

    await createCommand({
      name: 'JSON App',
      distribution: 'private',
      redirectUri: ['http://localhost:3009/auth/callback'],
      json: true,
    });

    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    const parsed = JSON.parse(output);
    expect(parsed.appId).toBe(2);
    expect(parsed.clientId).toBe('cli-abc');
    expect(parsed.clientSecret).toContain('[hidden');
  });

  it('should show the server-assigned version in the created-app box', async () => {
    (appService.createApp as jest.Mock).mockResolvedValue({
      app_id: 3,
      name: 'Versioned App',
      client_id: 'cli-v',
      client_secret: 'secret-v',
      redirect_uris: ['http://localhost:3009/auth/callback'],
      version: '0.0.1',
    });

    mockPrompt
      .mockResolvedValueOnce({ logoUrl: '' })
      .mockResolvedValueOnce({ appType: 'oauth' }) // app type
      .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' })
      .mockResolvedValueOnce({ another: false })
      .mockResolvedValueOnce({ scaffoldRaw: 'y' });

    await createCommand({ name: 'Versioned App', distribution: 'private' });

    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('App version:    0.0.1');
  });

  it('should include version in --json output when the API returns one', async () => {
    (appService.createApp as jest.Mock).mockResolvedValue({
      app_id: 6,
      name: 'JSON Versioned App',
      client_id: 'cli-jv',
      client_secret: 'secret-jv',
      redirect_uris: ['http://localhost:3009/auth/callback'],
      version: '0.0.1',
    });

    await createCommand({
      name: 'JSON Versioned App',
      distribution: 'private',
      redirectUri: ['http://localhost:3009/auth/callback'],
      json: true,
    });

    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    const parsed = JSON.parse(output);
    expect(parsed.version).toBe('0.0.1');
  });

  it('should omit version from output when the API does not return one', async () => {
    (appService.createApp as jest.Mock).mockResolvedValue({
      app_id: 7,
      name: 'No Version App',
      client_id: 'cli-nv',
      client_secret: 'secret-nv',
      redirect_uris: ['http://localhost:3009/auth/callback'],
    });

    await createCommand({
      name: 'No Version App',
      distribution: 'private',
      redirectUri: ['http://localhost:3009/auth/callback'],
      json: true,
    });

    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    const parsed = JSON.parse(output);
    expect(parsed.version).toBeUndefined();
  });

  it('should print the test-flow hint above the redirect prompt in interactive mode', async () => {
    (appService.createApp as jest.Mock).mockResolvedValue({
      app_id: 4,
      name: 'Hint App',
      client_id: 'cli-hint',
      client_secret: 'secret-hint',
      redirect_uris: ['http://localhost:3009/auth/callback'],
    });

    mockPrompt
      .mockResolvedValueOnce({ logoUrl: '' })
      .mockResolvedValueOnce({ appType: 'oauth' }) // app type
      .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' })
      .mockResolvedValueOnce({ another: false })
      .mockResolvedValueOnce({ scaffoldRaw: 'y' });

    await createCommand({ name: 'Hint App', distribution: 'private' });

    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('brevo app start oauth');
    expect(output).toMatch(/local test-server callback url/i);
  });

  it('should suppress the test-flow hint under --json', async () => {
    (appService.createApp as jest.Mock).mockResolvedValue({
      app_id: 5,
      name: 'JSON Hint App',
      client_id: 'cli-jh',
      client_secret: 'secret-jh',
      redirect_uris: ['http://localhost:3009/auth/callback'],
    });

    await createCommand({
      name: 'JSON Hint App',
      distribution: 'private',
      redirectUri: ['http://localhost:3009/auth/callback'],
      json: true,
    });

    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).not.toMatch(/local test-server callback url/i);
    expect(() => JSON.parse(output)).not.toThrow();
  });

  it('should not print the test-flow hint when --redirect-uri is provided', async () => {
    (appService.createApp as jest.Mock).mockResolvedValue({
      app_id: 6,
      name: 'Flag App',
      client_id: 'cli-flag',
      client_secret: 'secret-flag',
      redirect_uris: ['https://example.com/cb'],
    });

    mockPrompt
      .mockResolvedValueOnce({ logoUrl: '' })
      .mockResolvedValueOnce({ appType: 'oauth' })
      .mockResolvedValueOnce({ scaffoldRaw: 'y' });

    await createCommand({
      name: 'Flag App',
      distribution: 'private',
      redirectUri: ['https://example.com/cb'],
    });

    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).not.toMatch(/local test-server callback url/i);
  });

  it('should throw CliError on APP_LIMIT_REACHED', async () => {
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    (appService.createApp as jest.Mock).mockRejectedValue(
      new ApiError('Limit reached', 403, ErrorCode.APP_LIMIT_REACHED, 'APP_LIMIT_REACHED'),
    );

    mockPrompt
      .mockResolvedValueOnce({ logoUrl: '' })
      .mockResolvedValueOnce({ appType: 'oauth' }) // app type
      .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' })
      .mockResolvedValueOnce({ another: false });

    await expect(createCommand({ name: 'Test', distribution: 'private' })).rejects.toThrow(
      'maximum number of OAuth apps',
    );
  });

  describe("the platform's refusal to create a public app from the CLI", () => {
    // The server keys this on the caller it derives from the User-Agent, so the
    // CLI cannot satisfy it by changing the body — it can only explain it. See
    // the comment on this branch in `createAppWithRetry`.
    const rejection = (): ApiError =>
      new ApiError(
        'public apps cannot be created with source "cli"; use distribution_type "private"',
        400,
        undefined,
        'invalid_parameter',
      );

    it('explains the refusal and names the --distribution private fix', async () => {
      jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
      (appService.createApp as jest.Mock).mockRejectedValue(rejection());

      mockPrompt
        .mockResolvedValueOnce({ logoUrl: '' })
        .mockResolvedValueOnce({ appType: 'oauth' })
        .mockResolvedValueOnce({ redirectUrl: 'https://example.com/cb' })
        .mockResolvedValueOnce({ another: false });

      // One invocation, both assertions — a second call would exhaust the
      // `mockResolvedValueOnce` prompt chain above and fail before the API call.
      const err: Error = await createCommand({ name: 'Test', distribution: 'public' }).then(
        () => {
          throw new Error('expected the create to be refused');
        },
        (e: Error) => e,
      );
      expect(err.message).toMatch(/public apps can't be created from the CLI yet/i);
      expect(err.message).toMatch(/--distribution private/);
    });

    it("quotes the server's own sentence so a different 400 cannot hide behind it", async () => {
      jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
      (appService.createApp as jest.Mock).mockRejectedValue(rejection());

      mockPrompt
        .mockResolvedValueOnce({ logoUrl: '' })
        .mockResolvedValueOnce({ appType: 'oauth' })
        .mockResolvedValueOnce({ redirectUrl: 'https://example.com/cb' })
        .mockResolvedValueOnce({ another: false });

      await expect(createCommand({ name: 'Test', distribution: 'public' })).rejects.toThrow(
        /use distribution_type "private"/,
      );
    });

    // Guard against the CLI growing a local mirror of the platform's rule. This is
    // not a hypothetical: the server lifts the restriction per account (Unleash flag
    // `app-store-bo-be-public-apps`, BEX-333), so an allow-listed account creates a
    // public app successfully today. A local refusal would break that account rather
    // than merely lag the platform — the create must always reach the server.
    it('does not pre-empt the server — a public create is still attempted', async () => {
      (appService.createApp as jest.Mock).mockResolvedValue({
        app_id: 42,
        name: 'Test',
        client_id: 'cli-public',
        client_secret: 'secret-public',
        redirect_uris: ['https://example.com/cb'],
      });

      mockPrompt
        .mockResolvedValueOnce({ logoUrl: '' })
        .mockResolvedValueOnce({ appType: 'oauth' })
        .mockResolvedValueOnce({ redirectUrl: 'https://example.com/cb' })
        .mockResolvedValueOnce({ another: false })
        .mockResolvedValueOnce({ scaffoldRaw: 'n' });

      await createCommand({ name: 'Test', distribution: 'public' });

      expect(appService.createApp).toHaveBeenCalledWith(
        expect.objectContaining({ distribution_type: 'public' }),
      );
    });

    // A 400 that is not the distribution rule keeps the server's text and does
    // not get relabelled as the pre-GA restriction.
    it('leaves an unrelated 400 on a public create alone', async () => {
      jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
      (appService.createApp as jest.Mock).mockRejectedValue(
        new ApiError('logo_uri must be a valid https URL', 400, undefined, 'invalid_parameter'),
      );

      mockPrompt
        .mockResolvedValueOnce({ logoUrl: '' })
        .mockResolvedValueOnce({ appType: 'oauth' })
        .mockResolvedValueOnce({ redirectUrl: 'https://example.com/cb' })
        .mockResolvedValueOnce({ another: false });

      await expect(createCommand({ name: 'Test', distribution: 'public' })).rejects.toThrow(
        'logo_uri must be a valid https URL',
      );
    });
  });

  it('should handle 409 conflict and retry with new name', async () => {
    (appService.createApp as jest.Mock)
      .mockRejectedValueOnce(new ApiError('Conflict', 409))
      .mockResolvedValueOnce({
        app_id: 3,
        name: 'New Name',
        client_id: 'cli-new',
        client_secret: 'secret-new',
        redirect_uris: ['http://localhost:3009/auth/callback'],
      });

    mockPrompt
      .mockResolvedValueOnce({ logoUrl: '' }) // skip logo prompt
      .mockResolvedValueOnce({ appType: 'oauth' }) // app type
      .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' }) // redirect URL
      .mockResolvedValueOnce({ another: false }) // no more URLs
      .mockResolvedValueOnce({ name: 'New Name' }) // retry name prompt
      .mockResolvedValueOnce({ scaffoldRaw: 'y' }); // scaffold a feature?

    await createCommand({ name: 'Taken Name', distribution: 'private' });

    expect(appService.createApp).toHaveBeenCalledTimes(2);
    expect(appService.createApp).toHaveBeenLastCalledWith({
      name: 'New Name',
      distribution_type: 'private',
      auth: {
        scopes: ['contacts:read', 'contacts:write', 'crm:read', 'crm:write'],
        redirect_uris: ['http://localhost:3009/auth/callback'],
      },
    });
    // Cache must use the retried name, not the original (rejected) one
    expect(saveAppName).toHaveBeenCalledWith(3, 'New Name');
    expect(saveAppName).not.toHaveBeenCalledWith(3, 'Taken Name');
  });

  it('should cache and display the retried name after 409 conflict (JSON)', async () => {
    (appService.createApp as jest.Mock)
      .mockRejectedValueOnce(new ApiError('Conflict', 409))
      .mockResolvedValueOnce({
        app_id: 99,
        name: 'Resolved Name',
        client_id: 'cli-99',
        client_secret: 'secret-99',
        redirect_uris: ['http://localhost:3009/auth/callback'],
      });

    mockPrompt.mockResolvedValueOnce({ name: 'Resolved Name' });

    await createCommand({
      name: 'Taken Name',
      distribution: 'private',
      redirectUri: ['http://localhost:3009/auth/callback'],
      json: true,
    });

    expect(saveAppName).toHaveBeenCalledWith(99, 'Resolved Name');
    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    const parsed = JSON.parse(output);
    expect(parsed.appName).toBe('Resolved Name');
  });

  // `app create` touches the network only once every prompt is answered, so a
  // session that dies in between costs the user the whole flow. The answers are
  // already in hand — re-send them rather than exiting.
  describe('a session that expires during the prompts', () => {
    const created = {
      app_id: 7,
      name: 'Test App',
      client_id: 'cli-7',
      client_secret: 'secret-7',
      redirect_uris: ['http://localhost:3009/auth/callback'],
    };

    /** The five answers a plain OAuth create asks for before it calls the API. */
    function answerCreatePrompts(): void {
      mockPrompt
        .mockResolvedValueOnce({ logoUrl: '' })
        .mockResolvedValueOnce({ appType: 'oauth' })
        .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' })
        .mockResolvedValueOnce({ another: false });
    }

    it('should log in again and re-send the same answers', async () => {
      (appService.createApp as jest.Mock)
        .mockRejectedValueOnce(new AuthExpiredError())
        .mockResolvedValueOnce(created);
      (isAuthenticated as jest.Mock).mockReturnValue(true);

      answerCreatePrompts();
      mockPrompt
        .mockResolvedValueOnce({ relogin: true }) // log in again?
        .mockResolvedValueOnce({ scaffoldRaw: 'n' });

      await createCommand({ name: 'Test App', distribution: 'private' });

      expect(loginCommand).toHaveBeenCalledWith({ suppressNextSteps: true });
      expect(appService.createApp).toHaveBeenCalledTimes(2);
      // Byte-for-byte the first payload: nothing the user typed was re-asked.
      const [first, second] = (appService.createApp as jest.Mock).mock.calls;
      expect(second[0]).toEqual(first[0]);
      expect(saveAppName).toHaveBeenCalledWith(7, 'Test App');
    });

    it('should surface the expiry unchanged when the user declines', async () => {
      (appService.createApp as jest.Mock).mockRejectedValue(new AuthExpiredError());

      answerCreatePrompts();
      mockPrompt.mockResolvedValueOnce({ relogin: false });

      await expect(
        createCommand({ name: 'Test App', distribution: 'private' }),
      ).rejects.toBeInstanceOf(AuthExpiredError);
      expect(loginCommand).not.toHaveBeenCalled();
      expect(appService.createApp).toHaveBeenCalledTimes(1);
    });

    it('should surface the expiry when the login does not take', async () => {
      (appService.createApp as jest.Mock).mockRejectedValue(new AuthExpiredError());
      (isAuthenticated as jest.Mock).mockReturnValue(false);

      answerCreatePrompts();
      mockPrompt.mockResolvedValueOnce({ relogin: true });

      await expect(
        createCommand({ name: 'Test App', distribution: 'private' }),
      ).rejects.toBeInstanceOf(AuthExpiredError);
      expect(appService.createApp).toHaveBeenCalledTimes(1);
    });

    // Nobody is there to complete a browser login, so scripts keep the exit code
    // they have always had rather than hanging on a confirm.
    it('should not offer a re-login under --json', async () => {
      (appService.createApp as jest.Mock).mockRejectedValue(new AuthExpiredError());

      await expect(
        createCommand({
          name: 'Test App',
          distribution: 'private',
          redirectUri: ['http://localhost:3009/auth/callback'],
          json: true,
        }),
      ).rejects.toBeInstanceOf(AuthExpiredError);
      expect(loginCommand).not.toHaveBeenCalled();
    });
  });

  it('should prompt for name when not provided', async () => {
    mockPrompt
      .mockResolvedValueOnce({ name: 'Prompted App' }) // name prompt
      .mockResolvedValueOnce({ logoUrl: '' }) // logo prompt
      .mockResolvedValueOnce({ distribution: 'private' }) // distribution prompt
      .mockResolvedValueOnce({ appType: 'oauth' }) // app type
      .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' }) // redirect URL
      .mockResolvedValueOnce({ another: false }) // no more URLs
      .mockResolvedValueOnce({ scaffoldRaw: 'y' });

    (appService.createApp as jest.Mock).mockResolvedValue({
      app_id: 4,
      name: 'Prompted App',
      client_id: 'cli-prompted',
      client_secret: 'secret',
      redirect_uris: ['http://localhost:3009/auth/callback'],
    });

    await createCommand({});

    expect(appService.createApp).toHaveBeenCalledWith({
      name: 'Prompted App',
      distribution_type: 'private',
      auth: {
        scopes: ['contacts:read', 'contacts:write', 'crm:read', 'crm:write'],
        redirect_uris: ['http://localhost:3009/auth/callback'],
      },
    });
  });

  it('should throw on invalid distribution', async () => {
    // Distribution is resolved (and its flag validated) before the app-type
    // prompt, so no prompt answers are needed — queueing one here would leak
    // an unconsumed value into the next test.
    await expect(createCommand({ name: 'Test', distribution: 'invalid' })).rejects.toThrow(
      'Invalid --distribution',
    );
  });

  it('should create a public app when --distribution public is passed', async () => {
    (appService.createApp as jest.Mock).mockResolvedValue({
      app_id: 7,
      name: 'Public App',
      client_id: 'cli-public',
      client_secret: 'secret-public',
      redirect_uris: ['http://localhost:3009/auth/callback'],
    });

    mockPrompt
      .mockResolvedValueOnce({ logoUrl: '' })
      .mockResolvedValueOnce({ appType: 'oauth' }) // app type
      .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' })
      .mockResolvedValueOnce({ another: false })
      .mockResolvedValueOnce({ scaffoldRaw: 'y' });

    await createCommand({ name: 'Public App', distribution: 'public' });

    expect(appService.createApp).toHaveBeenCalledWith({
      name: 'Public App',
      distribution_type: 'public',
      auth: {
        scopes: ['contacts:read', 'contacts:write', 'crm:read', 'crm:write'],
        redirect_uris: ['http://localhost:3009/auth/callback'],
      },
    });
  });

  it('should reject app name with emojis via --name flag', async () => {
    await expect(createCommand({ name: 'My App 🚀', distribution: 'private' })).rejects.toThrow(
      'can only contain',
    );
  });

  it('should reject app name exceeding 48 characters via --name flag', async () => {
    const longName = 'a'.repeat(49);
    await expect(createCommand({ name: longName, distribution: 'private' })).rejects.toThrow(
      'at most 48 characters',
    );
  });

  it('should reject app name with non-Latin scripts via --name flag', async () => {
    await expect(createCommand({ name: 'アプリ名', distribution: 'private' })).rejects.toThrow(
      'can only contain',
    );
  });

  it('should accept app name with accented characters via --name flag', async () => {
    (appService.createApp as jest.Mock).mockResolvedValue({
      app_id: 5,
      name: 'Café Résumé',
      client_id: 'cli-accent',
      client_secret: 'secret',
      redirect_uris: ['http://localhost:3009/auth/callback'],
    });

    mockPrompt
      .mockResolvedValueOnce({ logoUrl: '' })
      .mockResolvedValueOnce({ appType: 'oauth' }) // app type
      .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' })
      .mockResolvedValueOnce({ another: false })
      .mockResolvedValueOnce({ scaffoldRaw: 'y' });

    await createCommand({ name: 'Café Résumé', distribution: 'private' });

    expect(appService.createApp).toHaveBeenCalledWith({
      name: 'Café Résumé',
      distribution_type: 'private',
      auth: {
        scopes: ['contacts:read', 'contacts:write', 'crm:read', 'crm:write'],
        redirect_uris: ['http://localhost:3009/auth/callback'],
      },
    });
  });

  it('should collect multiple redirect URLs via interactive prompt', async () => {
    (appService.createApp as jest.Mock).mockResolvedValue({
      app_id: 6,
      name: 'Multi URL App',
      client_id: 'cli-multi',
      client_secret: 'secret',
      redirect_uris: ['http://localhost:3009/auth/callback', 'https://myapp.com/callback'],
    });

    mockPrompt
      .mockResolvedValueOnce({ logoUrl: '' })
      .mockResolvedValueOnce({ appType: 'oauth' }) // app type
      .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' }) // first URL
      .mockResolvedValueOnce({ anotherRaw: 'y' }) // add another
      .mockResolvedValueOnce({ nextUrl: 'https://myapp.com/callback' }) // second URL
      .mockResolvedValueOnce({ anotherRaw: 'n' }) // no more
      .mockResolvedValueOnce({ scaffoldRaw: 'y' });

    await createCommand({ name: 'Multi URL App', distribution: 'private' });

    expect(appService.createApp).toHaveBeenCalledWith({
      name: 'Multi URL App',
      distribution_type: 'private',
      auth: {
        scopes: ['contacts:read', 'contacts:write', 'crm:read', 'crm:write'],
        redirect_uris: ['http://localhost:3009/auth/callback', 'https://myapp.com/callback'],
      },
    });
  });

  it('should skip redirect URL prompt when --redirect-uri flag is provided', async () => {
    (appService.createApp as jest.Mock).mockResolvedValue({
      app_id: 7,
      name: 'Flag App',
      client_id: 'cli-flag',
      client_secret: 'secret',
      redirect_uris: ['https://myapp.com/callback'],
    });

    mockPrompt
      .mockResolvedValueOnce({ logoUrl: '' })
      .mockResolvedValueOnce({ appType: 'oauth' })
      .mockResolvedValueOnce({ scaffoldRaw: 'y' });

    await createCommand({
      name: 'Flag App',
      distribution: 'private',
      redirectUri: ['https://myapp.com/callback'],
    });

    expect(appService.createApp).toHaveBeenCalledWith({
      name: 'Flag App',
      distribution_type: 'private',
      auth: {
        scopes: ['contacts:read', 'contacts:write', 'crm:read', 'crm:write'],
        redirect_uris: ['https://myapp.com/callback'],
      },
    });
    // Only the app-type, logo and scaffold-feature prompts — no redirect URL prompts.
    expect(mockPrompt).toHaveBeenCalledTimes(3);
  });

  it('should pass multiple --redirect-uri flags to the API', async () => {
    (appService.createApp as jest.Mock).mockResolvedValue({
      app_id: 8,
      name: 'Multi Flag App',
      client_id: 'cli-multi-flag',
      client_secret: 'secret',
      redirect_uris: ['http://localhost:3000/cb', 'https://prod.example.com/cb'],
    });

    await createCommand({
      name: 'Multi Flag App',
      distribution: 'private',
      redirectUri: ['http://localhost:3000/cb', 'https://prod.example.com/cb'],
      json: true,
    });

    expect(appService.createApp).toHaveBeenCalledWith({
      name: 'Multi Flag App',
      distribution_type: 'private',
      auth: {
        scopes: ['contacts:read', 'contacts:write', 'crm:read', 'crm:write'],
        redirect_uris: ['http://localhost:3000/cb', 'https://prod.example.com/cb'],
      },
    });
    // No prompts at all in JSON mode with all flags provided
    expect(mockPrompt).not.toHaveBeenCalled();
  });

  it('should forward --logo-uri to the create payload', async () => {
    (appService.createApp as jest.Mock).mockResolvedValue({
      app_id: 9,
      name: 'Logo App',
      client_id: 'cli-logo',
      client_secret: 'secret',
      redirect_uris: ['http://localhost:3009/auth/callback'],
      logo_uri: 'https://example.com/logo.png',
    });

    await createCommand({
      name: 'Logo App',
      distribution: 'private',
      redirectUri: ['http://localhost:3009/auth/callback'],
      logoUri: 'https://example.com/logo.png',
      json: true,
    });

    expect(appService.createApp).toHaveBeenCalledWith(
      expect.objectContaining({ logo_uri: 'https://example.com/logo.png' }),
    );
  });

  it('should omit logo_uri from the create payload when --logo-uri is not provided', async () => {
    (appService.createApp as jest.Mock).mockResolvedValue({
      app_id: 10,
      name: 'No Logo App',
      client_id: 'cli-no-logo',
      client_secret: 'secret',
      redirect_uris: ['http://localhost:3009/auth/callback'],
    });

    await createCommand({
      name: 'No Logo App',
      distribution: 'private',
      redirectUri: ['http://localhost:3009/auth/callback'],
      json: true,
    });

    const payload = (appService.createApp as jest.Mock).mock.calls[0][0];
    expect(payload).not.toHaveProperty('logo_uri');
  });

  it('should prompt for a logo URL interactively and forward it to the payload', async () => {
    (appService.createApp as jest.Mock).mockResolvedValue({
      app_id: 12,
      name: 'Prompted Logo App',
      client_id: 'cli-prompt-logo',
      client_secret: 'secret',
      redirect_uris: ['http://localhost:3009/auth/callback'],
      logo_uri: 'https://example.com/prompted.png',
    });

    mockPrompt
      .mockResolvedValueOnce({ logoUrl: 'https://example.com/prompted.png' })
      .mockResolvedValueOnce({ appType: 'oauth' }) // app type
      .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' })
      .mockResolvedValueOnce({ another: false })
      .mockResolvedValueOnce({ scaffoldRaw: 'y' });

    await createCommand({ name: 'Prompted Logo App', distribution: 'private' });

    expect(appService.createApp).toHaveBeenCalledWith(
      expect.objectContaining({ logo_uri: 'https://example.com/prompted.png' }),
    );
  });

  it('should include logoUri in JSON output when --logo-uri is set', async () => {
    (appService.createApp as jest.Mock).mockResolvedValue({
      app_id: 11,
      name: 'Logo JSON App',
      client_id: 'cli-logo-json',
      client_secret: 'secret',
      redirect_uris: ['http://localhost:3009/auth/callback'],
      logo_uri: 'https://example.com/logo.png',
    });

    await createCommand({
      name: 'Logo JSON App',
      distribution: 'private',
      redirectUri: ['http://localhost:3009/auth/callback'],
      logoUri: 'https://example.com/logo.png',
      json: true,
    });

    const jsonCall = stdoutSpy.mock.calls.find(
      ([chunk]) => typeof chunk === 'string' && chunk.includes('"logoUri"'),
    );
    expect(jsonCall).toBeDefined();
    expect(jsonCall![0]).toContain('"logoUri":"https://example.com/logo.png"');
  });

  it('sends DEFAULT_SCOPES on create (not the legacy "all")', async () => {
    (appService.createApp as jest.Mock).mockResolvedValue({
      app_id: 1,
      name: 'Test App',
      client_id: 'cli-123',
      client_secret: 'secret-456',
      redirect_uris: ['http://localhost:3009/auth/callback'],
    });
    mockPrompt
      .mockResolvedValueOnce({ logoUrl: '' })
      .mockResolvedValueOnce({ appType: 'oauth' }) // app type
      .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' })
      .mockResolvedValueOnce({ anotherRaw: 'n' })
      .mockResolvedValueOnce({ scaffoldRaw: 'y' });

    await createCommand({ name: 'Test App', distribution: 'private' });

    expect(appService.createApp).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: expect.objectContaining({
          scopes: ['contacts:read', 'contacts:write', 'crm:read', 'crm:write'],
        }),
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
      .mockResolvedValueOnce({ logoUrl: '' })
      .mockResolvedValueOnce({ appType: 'oauth' }) // app type
      .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' })
      .mockResolvedValueOnce({ anotherRaw: 'n' })
      .mockResolvedValueOnce({ scaffoldRaw: 'y' });

    await createCommand({ name: 'Test App', distribution: 'private' });

    const stdoutCalls = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(stdoutCalls).toContain('Default scopes');
    expect(stdoutCalls).toContain('contacts:read');
    expect(stdoutCalls).toContain('brevo app upload');
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
    expect(stdoutCalls).not.toContain('Default scopes');
  });

  // ──────────────── UI apps (BEX-290) ────────────────
  // A UI app is authored entirely through the prompts — there is no `--type` or
  // per-field flag — so every test here drives inquirer.
  describe('UI apps', () => {
    const CLI_OPTIONS = { name: 'Invoice Manager', distribution: 'private' };

    /** Every question inquirer was asked, in order. */
    let askedQuestions: Array<Record<string, unknown>>;

    /**
     * The location a placement slug belongs to, e.g. `contact-details-header-menu` →
     * `contactDetails`. Every registry location is `<record>Details`, so the first two
     * slug segments are the page — which is all the test harness needs to route a
     * `placements` answer to its per-page question.
     */
    const locationOfSlug = (slug: string) => {
      const [record, details] = slug.split('-');
      return `${record}${(details ?? '').replace(/^./, (c) => c.toUpperCase())}`;
    };

    /** The question name the placement prompt for one page is asked under. */
    const placementQuestion = (location: string) => `placement:${location}`;

    /**
     * Answer the create prompts by question *name* rather than by call order, so
     * that adding or reordering a prompt can't silently shift an answer onto the
     * wrong field.
     *
     * `placement` is a harness convenience, not a question: the placement question is
     * named for its page (`placement:contactDetails`), so the slug given here is routed
     * onto that page's question. Answering a page question directly still works and
     * takes precedence.
     */
    const answerPrompts = (overrides: Record<string, unknown> = {}) => {
      const { placement, ...rest } = overrides as { placement?: string } & Record<string, unknown>;
      // A slug, not a dotted slot name: a placement is authored (and answered) by the
      // row's `surface_point_name`. See REGISTRY_ROW.
      const pickedPlacement = placement ?? 'contact-details-header-menu';
      const answers: Record<string, unknown> = {
        distribution: 'private',
        appType: 'ui',
        // The flow asks the integration type FIRST, then the page, then the placement
        // prompt on that page (single-select throughout — BEX-426).
        integrationType: 'actionLink',
        surface: locationOfSlug(pickedPlacement),
        [placementQuestion(locationOfSlug(pickedPlacement))]: pickedPlacement,
        label: 'View in CRM',
        more_info: '',
        url: 'https://example.com/brevo',
        logoUrl: '',
        // Only reached when a test forces the OAuth path (non-TTY / --json), but
        // kept here so those tests don't need their own mock wiring.
        redirectUrl: 'http://localhost:3009/auth/callback',
        another: false,
        scaffoldRaw: 'n',
        ...rest,
      };
      mockPrompt.mockImplementation((questions: Array<Record<string, unknown>>) => {
        const question = questions[0] ?? {};
        askedQuestions.push(question);
        const name = String(question.name ?? '');
        return Promise.resolve(name in answers ? { [name]: answers[name] } : {});
      });
    };

    const questionNamed = (name: string) => askedQuestions.find((q) => q.name === name);
    /** Every placement prompt asked, in the order the pages were prompted for. */
    const placementQuestions = () =>
      askedQuestions.filter((q) => String(q.name).startsWith('placement:'));

    // The context field names the platform's registry actually allows. Nothing else is a
    // real name, so nothing else appears in a fixture.
    const DEFAULT_CONTEXT = ['recordId', 'recordName', 'accountId', 'locale'];

    /** camelCase → kebab-case, mirroring how the registry's slugs are seeded. */
    const kebab = (value: string) => value.replaceAll(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

    /**
     * One registry row in the BEX-361 wire shape, using the registry's own column names.
     * `default_context_field` is present by default because every seeded production row
     * carries it — it is what each authored entry's `context` is seeded from.
     *
     * The two identities are deliberately DIFFERENT strings, as they are in the seeded
     * registry: `extension_point_name` is the dotted `extension_point_name`
     * (`contactDetails.headerMenu.action`), `surface_point_name` the kebab-case slug
     * (`contact-details-header-menu`). Only the slug is authorable — a fixture that made
     * them equal would pass whichever one the code picked.
     *
     * Note the row's slug column and the authored entry key are now the SAME word
     * (`surface_point_name`), which is the point of that rename — but the row's OTHER
     * field is still called `extension_point_name`, so the two spellings remain live here and
     * an assertion that reads the wrong one still passes for the wrong reason.
     */
    const REGISTRY_ROW = (
      location: string,
      section: string,
      component: string,
      extra: Record<string, unknown> = {},
    ) => ({
      extension_point_name: `${location}.${section}.${component}`,
      location_name: location,
      section_name: section,
      component_type: component,
      surface_point_name: `${kebab(location)}-${kebab(section)}`,
      extension_type_list: ['actionLink', 'iframeExtension'],
      default_context_field: DEFAULT_CONTEXT,
      allowed_context_field: [...DEFAULT_CONTEXT, 'userId'],
      status: 'active',
      ...extra,
    });

    const FULL_REGISTRY = ['contactDetails', 'companyDetails', 'dealDetails'].flatMap(
      (location) => [
        REGISTRY_ROW(location, 'headerMenu', 'action'),
        REGISTRY_ROW(location, 'overviewMain', 'widget'),
        REGISTRY_ROW(location, 'overviewSidebar', 'widget'),
        REGISTRY_ROW(location, 'overviewAttributes', 'widget'),
      ],
    );

    /**
     * Point BOTH registry reads at one set of rows: the record pages come from
     * `surface-points/locations` and the placements from `surface-points?location=<csv>`, so
     * a test that stubbed only the rows would leave the page prompt with nothing to offer.
     *
     * `locations` is passed explicitly only where the rows can't imply it — a row with no
     * `location_name` column (the backfill cases) still belongs to a page the real endpoint
     * would have listed.
     */
    const registryHas = (
      rows: Array<Record<string, unknown>>,
      locations?: readonly string[],
    ): void => {
      (appService.fetchSurfacePoints as jest.Mock).mockResolvedValue(rows);
      (appService.fetchSurfacePointLocations as jest.Mock).mockResolvedValue(
        locations ?? [
          ...new Set(rows.map((row) => String(row.location_name ?? '')).filter(Boolean)),
        ],
      );
    };

    beforeEach(() => {
      askedQuestions = [];
      registryHas(FULL_REGISTRY);
      // No credential fields: a UI app sends no `auth` block on create and the
      // server returns none. The fixture used to carry an OAuth client ID and
      // secret, which made every assertion below run against a response shape the
      // platform never produces for this app type.
      (appService.createApp as jest.Mock).mockResolvedValue({
        app_id: 42,
        name: 'Invoice Manager',
      });
      answerPrompts();
    });

    const collectedUiApp = () => (fetchAppContext as jest.Mock).mock.calls[0][2];
    /** Just the slot names of the collected block, for the placement assertions. */
    const surfacePointNames = () =>
      collectedUiApp().surface_point_list.map(
        (entry: { surface_point_name: string }) => entry.surface_point_name,
      );
    /** Values of a checkbox/list question's choices, skipping inquirer Separators. */
    const choiceValuesOf = (name: string) =>
      ((questionNamed(name)?.choices ?? []) as Array<{ value?: string; type?: string }>)
        .filter((choice) => choice.type !== 'separator' && choice.value !== undefined)
        .map((choice) => choice.value);

    // Labels, not values — `indentChoices` pads them, so callers trim.
    const choiceNamesOf = (name: string) =>
      ((questionNamed(name)?.choices ?? []) as Array<{ name?: string; type?: string }>)
        .filter((choice) => choice.type !== 'separator' && choice.name !== undefined)
        .map((choice) => String(choice.name));

    // A UI app has no OAuth block (`auth: {}` in its config) — the whole
    // auth key is omitted from the wire entirely, not sent empty.
    it('omits the auth block from the create payload', async () => {
      await createCommand(CLI_OPTIONS);

      const payload = (appService.createApp as jest.Mock).mock.calls[0][0];
      expect(payload).not.toHaveProperty('auth');
    });

    // The regression this guards: resolveRedirectUrls falls back to
    // http://localhost:3009/auth/callback, which would silently register an OAuth
    // redirect URL on an app that has no OAuth flow.
    it('never prompts for or defaults a redirect URL', async () => {
      await createCommand(CLI_OPTIONS);

      const payload = (appService.createApp as jest.Mock).mock.calls[0][0];
      expect(JSON.stringify(payload)).not.toContain('localhost:3009');
      expect(questionNamed('redirectUrl')).toBeUndefined();
    });

    // The block travels on create as well as on upload, under the same `ui_app`
    // key. It is what tells the create endpoint the absent `auth` block is
    // deliberate — without it the endpoint reads a UI app as an OAuth app that
    // forgot its callbacks and answers 400 `redirect_uris is required`.
    it('sends the ui_app block to POST /apps, under the ui_app key', async () => {
      await createCommand(CLI_OPTIONS);

      const payload = (appService.createApp as jest.Mock).mock.calls[0][0];
      // Never the earlier `snapshot` spelling — the platform rejected that key.
      expect(payload).not.toHaveProperty('snapshot');
      expect(payload.ui_app).toEqual({
        extension_type: 'actionLink',
        surface_point_list: [
          {
            surface_point_name: 'contact-details-header-menu',
            context: DEFAULT_CONTEXT,
            label: 'View in CRM',
            redirect_link: 'https://example.com/brevo',
          },
        ],
      });
    });

    // The create body and the block written to app-config.json are the same
    // object, so a partner's file can never disagree with what the app was
    // registered as.
    it('sends the same block it collected and writes to app-config.json', async () => {
      await createCommand(CLI_OPTIONS);

      const payload = (appService.createApp as jest.Mock).mock.calls[0][0];
      expect(payload.ui_app).toEqual(collectedUiApp());
    });

    // Field names and casing must match the platform's stored app snapshot exactly — keys
    // are snake_case, `extension_type` VALUES stay camelCase per BEX-350 — and each
    // placement carries its own seeded context AND its own CTA fields (BEX-426): the
    // label and destination live on the entry, not at the block root.
    it('builds the ui_app shape the platform consumes', async () => {
      await createCommand(CLI_OPTIONS);

      expect(collectedUiApp()).toEqual({
        extension_type: 'actionLink',
        surface_point_list: [
          {
            surface_point_name: 'contact-details-header-menu',
            context: DEFAULT_CONTEXT,
            label: 'View in CRM',
            redirect_link: 'https://example.com/brevo',
          },
        ],
      });
    });

    // ──────── Prompt order (the BEX-290 reorder) ────────

    it('asks the integration type first, before any placement prompt', async () => {
      await createCommand(CLI_OPTIONS);

      const order = askedQuestions.map((q) => String(q.name));
      expect(order.indexOf('integrationType')).toBeLessThan(order.indexOf('surface'));
      expect(order.indexOf('surface')).toBeLessThan(order.indexOf('placement:contactDetails'));
      expect(order.indexOf('placement:contactDetails')).toBeLessThan(order.indexOf('label'));
      expect(order.indexOf('label')).toBeLessThan(order.indexOf('more_info'));
      expect(order.indexOf('more_info')).toBeLessThan(order.indexOf('url'));
    });

    // Kind is a property of a slot, not a question — a partner picking "Header menu" has
    // already said they want a menu entry. Asking it up front also made cards and menu
    // entries mutually exclusive within one app, which the platform does not require.
    // Record context is seeded from the registry, so it is not asked either.
    it.each([['kind'], ['places'], ['context']])('no longer asks the %s question', async (name) => {
      await createCommand(CLI_OPTIONS);

      expect(questionNamed(name)).toBeUndefined();
    });

    // Decision 2026-08-19: only actionLink is authorable, and the Iframe choice is
    // GONE from the prompt — it was shown as a disabled "coming soon" entry until
    // iframe authoring stalled, and a roadmap hint that outlives its date misleads.
    // The prompt is still asked with its one choice, so the user is told what they
    // are getting. (The platform still accepts a hand-edited iframeExtension block
    // at upload.)
    it('offers the integration-type prompt with Link as the only choice', async () => {
      await createCommand(CLI_OPTIONS);

      const question = questionNamed('integrationType');
      expect(question).toBeDefined();
      const choices = (question?.choices ?? []) as Array<{ value?: string; disabled?: unknown }>;
      const link = choices.find((c) => c.value === 'actionLink');
      const iframe = choices.find((c) => c.value === 'iframeExtension');
      expect(link).toBeDefined();
      expect(link?.disabled).toBeUndefined();
      expect(iframe).toBeUndefined();
      expect(collectedUiApp().extension_type).toBe('actionLink');
    });

    // ──────── The two registry reads ────────
    // Different questions, not the same call twice: the pages come from the registry's own
    // location list, so no run pulls every row just to learn that three pages exist.

    it('reads the pages from the locations endpoint, then the picked page by location', async () => {
      answerPrompts({ placement: 'deal-details-header-menu' });

      await createCommand(CLI_OPTIONS);

      expect(appService.fetchSurfacePointLocations).toHaveBeenCalledTimes(1);
      // Both reads narrow by the chosen extension type (BEX-422): the pages offered and the
      // rows fetched are only the ones enabled for it.
      expect(appService.fetchSurfacePointLocations).toHaveBeenCalledWith('actionLink');
      expect(appService.fetchSurfacePoints).toHaveBeenCalledTimes(1);
      expect(appService.fetchSurfacePoints).toHaveBeenCalledWith(['dealDetails'], 'actionLink');
    });

    // The page choices are the locations endpoint's answer, not a reduction of the rows:
    // here the row fixture covers three pages and only the two listed ones are offered.
    // They are also offered VERBATIM — no friendly renaming, so what's on screen is what
    // the API said and what the row read is narrowed by.
    it('offers exactly the pages the locations endpoint lists, verbatim', async () => {
      (appService.fetchSurfacePointLocations as jest.Mock).mockResolvedValue([
        'contactDetails',
        'dealDetails',
      ]);

      await createCommand(CLI_OPTIONS);

      expect(choiceValuesOf('surface')).toEqual(['contactDetails', 'dealDetails']);
      expect(choiceNamesOf('surface').map((name) => name.trim())).toEqual([
        'contactDetails',
        'dealDetails',
      ]);
    });

    // Single-select (BEX-426): the flow authors one placement, so the page question is a
    // `list`, not the old checkbox. More placements are hand-authored in app-config.json.
    it('asks for ONE record page, as a single-select list', async () => {
      await createCommand(CLI_OPTIONS);

      const surface = questionNamed('surface');
      expect(surface).toBeDefined();
      expect(surface?.type).toBe('list');
      // No page is pre-selected: the pages are the registry's answer, so the CLI
      // nominating one of them would put a choice on screen that nothing on the
      // platform made.
      expect(surface?.default).toBeUndefined();
    });

    // The narrowed read is now the only row read, so a filter an early build doesn't
    // implement must not be fatal: it is retried unfiltered and narrowed locally. Aborting
    // would throw away the page answer the partner just gave and cannot be re-asked for.
    it('retries unfiltered when the narrowed row read fails', async () => {
      (appService.fetchSurfacePoints as jest.Mock)
        .mockRejectedValueOnce(new ApiError('no location filter here', 400))
        .mockResolvedValueOnce(FULL_REGISTRY);

      await createCommand(CLI_OPTIONS);

      expect(appService.fetchSurfacePoints).toHaveBeenNthCalledWith(
        1,
        ['contactDetails'],
        'actionLink',
      );
      // The retry drops BOTH filters — location and extension_type — so a build that 400s
      // on either parameter is absorbed the same way; the rows are re-narrowed locally.
      expect(appService.fetchSurfacePoints).toHaveBeenNthCalledWith(2, undefined, undefined);
      expect(surfacePointNames()).toEqual(['contact-details-header-menu']);
    });

    it('retries unfiltered when the narrowed row read comes back empty', async () => {
      (appService.fetchSurfacePoints as jest.Mock)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(FULL_REGISTRY);

      await createCommand(CLI_OPTIONS);

      expect(surfacePointNames()).toEqual(['contact-details-header-menu']);
    });

    // A real early-build behaviour: the endpoint mis-handles the `location` filter and
    // answers rows for a different page. The unfiltered retry recovers the picked page,
    // so the partner gets the placement they asked for instead of an error on a page
    // they can see exists.
    it('retries unfiltered when the narrowed read misses the picked page', async () => {
      answerPrompts({ placement: 'deal-details-header-menu' });
      (appService.fetchSurfacePoints as jest.Mock)
        .mockResolvedValueOnce([REGISTRY_ROW('contactDetails', 'headerMenu', 'action')])
        .mockResolvedValueOnce(FULL_REGISTRY);

      await createCommand(CLI_OPTIONS);

      expect(appService.fetchSurfacePoints).toHaveBeenCalledTimes(2);
      expect(surfacePointNames()).toEqual(['deal-details-header-menu']);
    });

    it('aborts when both the narrowed and the unfiltered row read fail', async () => {
      (appService.fetchSurfacePoints as jest.Mock).mockRejectedValue(new ApiError('down', 500));

      await expect(createCommand(CLI_OPTIONS)).rejects.toThrow(
        /could not load the available placements/i,
      );
      expect(appService.createApp).not.toHaveBeenCalled();
    });

    // ──────── The placement prompt on the picked page ────────

    it('asks one placement prompt, listing only the picked page', async () => {
      answerPrompts({ placement: 'deal-details-overview-main' });

      await createCommand(CLI_OPTIONS);

      expect(placementQuestions().map((q) => q.name)).toEqual(['placement:dealDetails']);
      // Four placements on the page, and the prompt offers no other page's rows.
      expect(choiceValuesOf('placement:dealDetails')).toEqual([
        'deal-details-header-menu',
        'deal-details-overview-main',
        'deal-details-overview-sidebar',
        'deal-details-overview-attributes',
      ]);
    });

    // One spot per page is the authoring model, and a single-select prompt is what makes
    // it structural: there is no answer that puts two placements on one page.
    it('offers the page placements as a single-select list', async () => {
      await createCommand(CLI_OPTIONS);

      const question = questionNamed('placement:contactDetails');
      expect(question?.type).toBe('list');
      expect(surfacePointNames()).toEqual(['contact-details-header-menu']);
    });

    // A lone choice is still shown rather than picked silently: it is one keypress either
    // way, and the partner sees where the app lands.
    it('still asks on a page that offers only one placement', async () => {
      registryHas([REGISTRY_ROW('contactDetails', 'headerMenu', 'action')]);

      await createCommand(CLI_OPTIONS);

      expect(choiceValuesOf('placement:contactDetails')).toEqual(['contact-details-header-menu']);
      expect(surfacePointNames()).toEqual(['contact-details-header-menu']);
    });

    // The flow authors exactly one placement (BEX-426): the CTA fields live per entry, so
    // more placements would mean re-asking three questions each. They are hand-authored in
    // app-config.json instead — the created-app box's hint says so.
    it('authors exactly one placement, and the box points at app-config.json for more', async () => {
      await createCommand(CLI_OPTIONS);

      expect(collectedUiApp().surface_point_list).toHaveLength(1);
      const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(output).toMatch(/add more placements as extra `surface_point_list` entries/i);
    });

    // A picked page whose placements cannot host the chosen type dead-ends with the
    // precise error — the locations endpoint carries no extension type to check against,
    // so the page was offerable and the surprise surfaces at the row read. The registry
    // rows exist (an unfiltered retry would find nothing more), so the message must say
    // "wrong type", not "empty registry".
    it('aborts when the picked page has no placement for the chosen type', async () => {
      answerPrompts({ placement: 'deal-details-header-menu' });
      // The deal page is listed and has a placement, but not one an actionLink can use.
      registryHas(
        [
          REGISTRY_ROW('contactDetails', 'headerMenu', 'action'),
          REGISTRY_ROW('dealDetails', 'headerMenu', 'action', {
            extension_type_list: ['legacyComponent'],
          }),
        ],
        ['contactDetails', 'dealDetails'],
      );

      await expect(createCommand(CLI_OPTIONS)).rejects.toThrow(
        /none of the available placements can host a "actionLink"/i,
      );
      expect(appService.createApp).not.toHaveBeenCalled();
    });

    // Labels are the registry's own `section_name` and `component_type`, joined and
    // otherwise untouched — there is no local prettifying map (see the note in
    // `lib/constants.ts`). `surface_point_name` is a kebab-case authoring SLUG
    // (`contactdetails-headermenu` in these fixtures) and is the choice's VALUE, so it
    // must never reach the label.
    it('labels placements section_name — component_type, never from surface_point_name', async () => {
      await createCommand(CLI_OPTIONS);

      const names = (
        (questionNamed('placement:contactDetails')?.choices ?? []) as Array<{
          name?: string;
          value?: string;
        }>
      )
        .filter((choice) => choice.value !== undefined)
        // Trimmed: `indentChoices` pads every label into the CLI's output gutter, which
        // is presentation. This test is about the label's *content*.
        .map((choice) => String(choice.name).trim());
      expect(names).toEqual([
        'headerMenu — action',
        'overviewMain — widget',
        'overviewSidebar — widget',
        'overviewAttributes — widget',
      ]);
      expect(names.join(' ')).not.toContain('contactdetails-headermenu');
    });

    // ──────── Client-side filtering of un-hostable rows ────────
    // The row read carries no extension-type filter, deliberately — a server-side one would
    // hide authorable placements — so the CLI checks each row itself. Without this, a partner
    // authors a slot that cannot serve their type, upload 200s, and the slot renders
    // nothing: exactly the silent failure this flow exists to prevent.

    it('hides rows whose extension_type_list cannot host the chosen type', async () => {
      registryHas([
        REGISTRY_ROW('contactDetails', 'headerMenu', 'action'),
        REGISTRY_ROW('contactDetails', 'overviewMain', 'widget', {
          extension_type_list: ['legacyComponent'],
        }),
      ]);

      await createCommand(CLI_OPTIONS);

      expect(choiceValuesOf('placement:contactDetails')).toEqual(['contact-details-header-menu']);
    });

    it('hides rows that are not active', async () => {
      registryHas([
        REGISTRY_ROW('contactDetails', 'headerMenu', 'action'),
        REGISTRY_ROW('contactDetails', 'overviewMain', 'widget', { status: 'deprecated' }),
      ]);

      await createCommand(CLI_OPTIONS);

      expect(choiceValuesOf('placement:contactDetails')).toEqual(['contact-details-header-menu']);
    });

    // A registry seeded before either column existed must stay usable — treating a missing
    // column as a rejection would empty the prompt against every older environment.
    it('keeps rows that declare neither extension_type_list nor status', async () => {
      registryHas([
        {
          extension_point_name: 'contactDetails.headerMenu.action',
          surface_point_name: 'contact-details-header-menu',
          location_name: 'contactDetails',
          section_name: 'headerMenu',
          component_type: 'action',
        },
      ]);

      await createCommand(CLI_OPTIONS);

      expect(surfacePointNames()).toEqual(['contact-details-header-menu']);
    });

    // Distinct from the empty-registry case: the fix is a different integration type, not
    // waiting for a seed, so the message says so. Raised after the page prompt now — the
    // locations endpoint carries no extension type to check against.
    it('aborts when no placement can host the chosen type', async () => {
      registryHas([
        REGISTRY_ROW('contactDetails', 'headerMenu', 'action', {
          extension_type_list: ['legacyComponent'],
        }),
      ]);

      await expect(createCommand(CLI_OPTIONS)).rejects.toThrow(
        /none of the available placements can host a "actionLink"/i,
      );
      expect(appService.createApp).not.toHaveBeenCalled();
    });

    // ──────── Registry read path ────────

    it('aborts with an actionable error when the locations fetch fails', async () => {
      (appService.fetchSurfacePointLocations as jest.Mock).mockRejectedValue(
        new ApiError('boom', 500),
      );

      await expect(createCommand(CLI_OPTIONS)).rejects.toThrow(
        /could not load the available placements/i,
      );
      // Nothing is asked, and no row read is attempted, once the pages can't be listed.
      expect(questionNamed('surfaces')).toBeUndefined();
      expect(appService.fetchSurfacePoints).not.toHaveBeenCalled();
      expect(appService.createApp).not.toHaveBeenCalled();
    });

    it('aborts when the registry lists no pages', async () => {
      (appService.fetchSurfacePointLocations as jest.Mock).mockResolvedValue([]);

      await expect(createCommand(CLI_OPTIONS)).rejects.toThrow(/no available placements/i);
      expect(questionNamed('surfaces')).toBeUndefined();
      expect(appService.createApp).not.toHaveBeenCalled();
    });

    it('aborts when the registry has no usable rows on the picked pages', async () => {
      registryHas(
        [{ extension_point_name: 'not-a-slot' }], // no decomposed columns, name not 3 segments
        ['contactDetails'],
      );

      await expect(createCommand(CLI_OPTIONS)).rejects.toThrow(/no available placements/i);
      expect(appService.createApp).not.toHaveBeenCalled();
    });

    it('offers a page the CLI has never heard of, unchanged, and accepts it', async () => {
      registryHas([REGISTRY_ROW('orderDetails', 'headerMenu', 'action')]);
      answerPrompts({ placement: 'order-details-header-menu' });

      await createCommand(CLI_OPTIONS);

      // A page the CLI carries no knowledge of at all needs no code change to be
      // authorable — which is the point of showing the registry's token rather than a
      // name of the CLI's own.
      expect(choiceValuesOf('surface')).toEqual(['orderDetails']);
      expect(surfacePointNames()).toEqual(['order-details-header-menu']);
    });

    it('backfills the slot segments from the name when the server omits them', async () => {
      registryHas(
        [
          {
            extension_point_name: 'contactDetails.headerMenu.action',
            surface_point_name: 'contact-details-header-menu',
          },
        ],
        ['contactDetails'],
      );

      await createCommand(CLI_OPTIONS);

      expect(surfacePointNames()).toEqual(['contact-details-header-menu']);
    });

    // The regression this guards, and the reason every fixture keeps the two identities
    // distinct: authoring the row's DOTTED name instead of its slug matches no registry row.
    // The platform resolves an entry by `surface_point_name`, so `app upload` answers
    // "contains unregistered extension point(s)" and the read path drops the slot silently.
    it('authors the surface_point_name slug, never the dotted extension-point name', async () => {
      await createCommand(CLI_OPTIONS);

      const authored = surfacePointNames();
      expect(authored).toEqual(['contact-details-header-menu']);
      expect(authored).not.toContain('contactDetails.headerMenu.action');
    });

    // A nullable column server-side, and the platform's own lookup skips a NULL — so a row
    // without it can only ever produce a placement its upload rejects. Offering it would
    // reintroduce the silent-drop failure the registry read exists to prevent.
    it('drops a row the registry gave no surface_point_name', async () => {
      registryHas(
        [
          {
            extension_point_name: 'contactDetails.headerMenu.action',
            location_name: 'contactDetails',
            section_name: 'headerMenu',
            component_type: 'action',
          },
        ],
        ['contactDetails'],
      );

      await expect(createCommand(CLI_OPTIONS)).rejects.toThrow(/no available placements/i);
      expect(appService.createApp).not.toHaveBeenCalled();
    });

    // ──────── Record context is seeded per placement, not prompted ────────

    it('seeds the entry from that row own default_context_field', async () => {
      registryHas([
        REGISTRY_ROW('dealDetails', 'headerMenu', 'action', {
          default_context_field: ['recordId', 'recordName'],
        }),
      ]);
      answerPrompts({ placement: 'deal-details-header-menu' });

      await createCommand(CLI_OPTIONS);

      expect(collectedUiApp().surface_point_list).toEqual([
        {
          surface_point_name: 'deal-details-header-menu',
          context: ['recordId', 'recordName'],
          label: 'View in CRM',
          redirect_link: 'https://example.com/brevo',
        },
      ]);
    });

    // No context key rather than an empty array: `[]` would read as "narrow to nothing"
    // where absent means "no narrowing".
    it('omits context for a row that declares no default', async () => {
      registryHas([
        REGISTRY_ROW('contactDetails', 'headerMenu', 'action', {
          default_context_field: undefined,
        }),
      ]);

      await createCommand(CLI_OPTIONS);

      expect(collectedUiApp().surface_point_list).toEqual([
        {
          surface_point_name: 'contact-details-header-menu',
          label: 'View in CRM',
          redirect_link: 'https://example.com/brevo',
        },
      ]);
    });

    // ──────── The rest of the block ────────

    it('omits more_info when left blank rather than writing an empty string', async () => {
      await createCommand(CLI_OPTIONS);

      expect(collectedUiApp().surface_point_list[0]).not.toHaveProperty('more_info');
    });

    it('includes more_info on the entry when entered', async () => {
      answerPrompts({ more_info: 'Review invoice history' });

      await createCommand(CLI_OPTIONS);

      expect(collectedUiApp().surface_point_list[0].more_info).toBe('Review invoice history');
    });

    // link_target is neither asked nor authored: `brevo app upload` injects `_blank` onto
    // each entry. The server refuses `_self`, so a field in the file would only invite a
    // partner to edit it into a value that 400s. Checked at BOTH depths since BEX-426 moved
    // the field onto the entry — the root is where it used to live, the entry is where the
    // injection lands, and create writes it in neither place.
    it('never prompts for or writes a link target', async () => {
      await createCommand(CLI_OPTIONS);

      expect(questionNamed('link_target')).toBeUndefined();
      expect(collectedUiApp()).not.toHaveProperty('link_target');
      for (const entry of collectedUiApp().surface_point_list) {
        expect(entry).not.toHaveProperty('link_target');
      }
    });

    // The other half of the OAuth-path assertion up top: the opening questions are the
    // same for both app types, so a UI app answers the logo before it is asked what it
    // is building — and long before it is asked where the thing renders.
    it('asks for the logo before the app type and the placement prompts', async () => {
      await createCommand(CLI_OPTIONS);

      const names = askedQuestions.map((question) => String(question.name));
      const logoIdx = names.indexOf('logoUrl');
      const typeIdx = names.indexOf('appType');
      const placementIdx = names.findIndex((name) => name.startsWith('placement:'));
      expect(logoIdx).toBeGreaterThanOrEqual(0);
      expect(placementIdx).toBeGreaterThanOrEqual(0);
      expect(logoIdx).toBeLessThan(typeIdx);
      expect(typeIdx).toBeLessThan(placementIdx);
    });

    // The per-field flags are gone, so these prompt `validate` callbacks are now
    // the only thing standing between a typo and a silently unrenderable action
    // link. Assert they're still wired up.
    it('validates the label, more_info and URL answers at the prompt', async () => {
      await createCommand(CLI_OPTIONS);

      const label = questionNamed('label');
      expect(typeof label?.validate).toBe('function');
      expect((label?.validate as (v: string) => unknown)('  ')).toMatch(/cannot be empty/i);
      expect((label?.validate as (v: string) => unknown)('x'.repeat(49))).toMatch(/at most 48/);

      const moreInfo = questionNamed('more_info');
      expect((moreInfo?.validate as (v: string) => unknown)('')).toBe(true);
      expect((moreInfo?.validate as (v: string) => unknown)('x'.repeat(256))).toMatch(
        /at most 255/,
      );

      const url = questionNamed('url');
      expect(typeof url?.validate).toBe('function');
      expect((url?.validate as (v: string) => unknown)('http://example.com')).toMatch(
        /must use https/i,
      );
    });

    it('never offers the OAuth feature scaffold', async () => {
      await createCommand(CLI_OPTIONS);

      expect(promptFeatureType).not.toHaveBeenCalled();
      expect(runFeatureScaffold).not.toHaveBeenCalled();
    });

    it('renders the UI-app box with the placement, not redirect URLs', async () => {
      await createCommand(CLI_OPTIONS);

      const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(output).toContain('UI app created');
      expect(output).toContain('contact-details-header-menu');
      expect(output).toContain('https://example.com/brevo');
      expect(output).not.toContain('Redirect URL');
    });

    // A UI app sends no `auth` block and gets none back, so there is no client ID
    // and no secret to show. The box used to render both rows regardless, printing
    // `Client ID: undefined` beside a hidden-secret placeholder for a secret that
    // never existed.
    it('omits the credential rows from the UI-app box', async () => {
      await createCommand(CLI_OPTIONS);

      const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(output).not.toContain('Client ID');
      expect(output).not.toContain('Client secret');
      expect(output).not.toContain('undefined');
    });

    // Same reason: caching `{clientId: undefined, clientSecret: undefined}` under the
    // app's ID writes an entry that can only mislead a later read.
    it('caches no credentials for a UI app', async () => {
      await createCommand(CLI_OPTIONS);

      expect(saveAppCredentials).not.toHaveBeenCalled();
    });

    // `label` labels the menu entry (BEX-290). The one piece of rendered text with no
    // field is a CARD's title, which is the app name — so the box says that instead.
    it('explains where the label renders and that a card title is the app name', async () => {
      await createCommand(CLI_OPTIONS);

      const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(output).toMatch(/the menu entry is labelled "View in CRM"/i);
      expect(output).toMatch(/card's title is the app name \("Invoice Manager"\)/i);
    });

    // Record context reaches the partner's endpoint as query parameters and nothing else —
    // no path templating — so the box prints the exact URL shape to build against.
    it('prints an example URL carrying the seeded context as query parameters', async () => {
      await createCommand(CLI_OPTIONS);

      const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(output).toContain(
        'https://example.com/brevo?recordId=RECORD_ID&recordName=RECORD_NAME&accountId=ACCOUNT_ID&locale=LOCALE',
      );
    });

    // Built with URL semantics rather than string concatenation: redirect_link may
    // already carry a query string and a fragment, and params must merge into the
    // existing `?` and land BEFORE the `#`. A hand-rolled `url + '?' + params` gets
    // both wrong, and a wrong example is worse than none.
    it('merges the example params into an existing query string, before any fragment', async () => {
      registryHas([
        REGISTRY_ROW('contactDetails', 'headerMenu', 'action', {
          default_context_field: ['recordId'],
        }),
      ]);
      answerPrompts({ url: 'https://example.com/brevo?tenant=acme#section' });

      await createCommand(CLI_OPTIONS);

      const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(output).toContain('https://example.com/brevo?tenant=acme&recordId=RECORD_ID#section');
    });

    it('prints no example URL when no placement declares a record context', async () => {
      registryHas([
        REGISTRY_ROW('contactDetails', 'headerMenu', 'action', {
          default_context_field: undefined,
        }),
      ]);

      await createCommand(CLI_OPTIONS);

      const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(output).not.toContain('Brevo will open, for example');
    });

    // ──────── A UI app needs an interactive terminal ────────
    // Both of these keep pre-BEX-290 behaviour for scripted callers: without the
    // app-type prompt there is no way to ask for a UI app, so they get an OAuth
    // app rather than an error.
    it('creates an OAuth app in a non-TTY run, without prompting for the app type', async () => {
      Object.defineProperty(process.stdin, 'isTTY', {
        configurable: true,
        writable: true,
        value: false,
      });

      await createCommand(CLI_OPTIONS);

      expect(questionNamed('appType')).toBeUndefined();
      const payload = (appService.createApp as jest.Mock).mock.calls[0][0];
      expect(payload).toHaveProperty('auth.redirect_uris');
      // The two keys are mutually exclusive: `ui_app` is the discriminator, so an
      // OAuth create carrying it would register the wrong app type.
      expect(payload).not.toHaveProperty('ui_app');
      expect(collectedUiApp()).toBeUndefined();
    });

    it('creates an OAuth app under --json even on a TTY', async () => {
      // This one takes the OAuth branch, so it needs an OAuth-shaped response —
      // the surrounding suite's fixture is a UI app's, which carries no `auth`.
      // `createApp` has already flattened the block by the time the command sees
      // it, so these fields are top-level here whichever shape the wire used.
      (appService.createApp as jest.Mock).mockResolvedValue({
        app_id: 42,
        name: 'Invoice Manager',
        client_id: 'cli-123',
        client_secret: 'secret-456',
        redirect_uris: ['http://localhost:3009/auth/callback'],
      });

      await createCommand({ ...CLI_OPTIONS, json: true });

      expect(questionNamed('appType')).toBeUndefined();
      const parsed = JSON.parse(stdoutSpy.mock.calls.map((c) => String(c[0])).join(''));
      expect(parsed.appType).toBe('oauth');
      // Both were silently dropped when the server started nesting them under
      // `auth` — JSON.stringify omits undefined, so `--json` lost two documented
      // fields with no error anywhere. Assert them, not just their container.
      expect(parsed.clientId).toBe('cli-123');
      expect(parsed.redirectUri).toEqual(['http://localhost:3009/auth/callback']);
      expect(parsed).not.toHaveProperty('uiApp');
    });
  });

  // ──────── The full app-type / distribution surface ────────
  // Neither of these two choices is a command, so neither could ever be reached by a
  // guard in `command-registry`: the *UI app* choice is a prompt option and `public` is a
  // flag VALUE. Both were held back inside this flow while they were unreleased — a
  // prompt choice withheld, a flag value refused — and both have shipped (`ui-app-type`
  // at BEX-290, `public-distribution` at BEX-405). These assert the surface a user gets.
  describe('app type and distribution', () => {
    beforeEach(() => {
      (appService.createApp as jest.Mock).mockResolvedValue({
        app_id: 42,
        name: 'Test App',
        client_id: 'cli-123',
        client_secret: 'secret-456',
        redirect_uris: ['http://localhost:3009/auth/callback'],
      });
    });

    it('accepts --distribution public and sends it on the wire', async () => {
      await createCommand({ name: 'Test App', distribution: 'public', json: true });

      const payload = (appService.createApp as jest.Mock).mock.calls[0][0];
      expect(payload.distribution_type).toBe('public');
    });

    // A bad value must read as a bad value, naming the flag — not as anything the user
    // could mistake for a feature they need to unlock.
    it('rejects an invalid distribution as an invalid value', async () => {
      await expect(
        createCommand({ name: 'Test App', distribution: 'privte', json: true }),
      ).rejects.toThrow(/--distribution/);
    });

    it('asks for the app type, offering OAuth and UI app alike', async () => {
      mockPrompt.mockResolvedValue({ appType: 'oauth', redirectUrl: '', logoUrl: '' });

      await createCommand({ name: 'Test App', distribution: 'private' });

      const appTypeQuestion = mockPrompt.mock.calls
        .flatMap((call) => call[0])
        .find((question) => question?.name === 'appType');
      expect(appTypeQuestion).toBeDefined();
      // Labels are trimmed before comparing — `indentChoices` pads them into the CLI's
      // output gutter.
      const labels = appTypeQuestion.choices.map((choice: { name: string }) => choice.name.trim());
      expect(labels).toEqual([messages.APP_CREATE_APP_TYPE_OAUTH, messages.APP_CREATE_APP_TYPE_UI]);
      expect(appTypeQuestion.choices.map((choice: { value: string }) => choice.value)).toEqual([
        'oauth',
        'ui',
      ]);

      const payload = (appService.createApp as jest.Mock).mock.calls[0][0];
      expect(payload).not.toHaveProperty('ui_app');
    });

    // The ORDER matters and is asserted — `private` stays first so it remains what a bare
    // Enter selects, which is the conservative default a developer should land on and the
    // one every non-interactive run gets.
    it('asks for the distribution, offering both values, and defaults to private', async () => {
      mockPrompt.mockResolvedValue({
        appType: 'oauth',
        distribution: 'private',
        redirectUrl: '',
        logoUrl: '',
      });

      await createCommand({ name: 'Test App' });

      const distributionQuestion = mockPrompt.mock.calls
        .flatMap((call) => call[0])
        .find((question) => question?.name === 'distribution');
      expect(distributionQuestion).toBeDefined();
      expect(distributionQuestion.choices).toHaveLength(2);
      expect(distributionQuestion.choices.map((choice: { value: string }) => choice.value)).toEqual(
        ['private', 'public'],
      );

      const payload = (appService.createApp as jest.Mock).mock.calls[0][0];
      expect(payload.distribution_type).toBe('private');
    });

    // Both prompts are interactive-only: without the non-interactive early returns a
    // `--json` run would block on a question it cannot answer.
    it('asks neither question under --json, and still defaults to private + OAuth', async () => {
      await createCommand({ name: 'Test App', json: true });

      const asked = mockPrompt.mock.calls.flatMap((call) => call[0]).map((q) => q?.name);
      expect(asked).not.toContain('distribution');
      expect(asked).not.toContain('appType');
      const payload = (appService.createApp as jest.Mock).mock.calls[0][0];
      expect(payload.distribution_type).toBe('private');
      expect(payload).not.toHaveProperty('ui_app');
    });
  });
});
