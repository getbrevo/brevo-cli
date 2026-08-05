import { createCommand } from '../../../commands/app/create';
import { ApiError, ErrorCode } from '../../../lib/errors';

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
  readProjectConfig: jest.fn().mockReturnValue(null),
  isUiAppConfig: (config: { ui_app?: unknown } | null | undefined) => !!config?.ui_app,
}));

jest.mock('../../../container', () => ({
  appService: {
    fetchAppsList: jest.fn(),
    fetchApp: jest.fn(),
    fetchSurfacePoints: jest.fn(),
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

jest.mock('../../../commands/app/scaffold', () => ({
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
  promptFeatureType: jest.fn(),
  reportBaseScaffoldSuccess: jest.fn(),
  reportScaffoldSuccess: jest.fn(),
  computeCdHint: jest.fn(),
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
  readProjectConfig,
} from '../../../lib/config';
import {
  fetchAppContext,
  runBaseScaffold,
  runFeatureScaffold,
  resolveProjectDirectory,
  promptFeatureType,
  reportBaseScaffoldSuccess,
  reportScaffoldSuccess,
  computeCdHint,
} from '../../../commands/app/scaffold';

const mockPrompt = inquirer.prompt as unknown as jest.Mock;

describe('app/create', () => {
  let stdoutSpy: jest.SpyInstance;
  const originalIsTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
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
    // jest.clearAllMocks() only clears mock.calls/instances/results — it does
    // NOT reset a persistent implementation set via mockReturnValue in an
    // earlier test (that requires mockReset/resetAllMocks, which this repo's
    // jest.config.js doesn't enable). Re-assert the defaults from the
    // `../../../lib/config` mock factory here so tests are isolated from
    // whatever the previous test left behind in these two mocks.
    (hasLocalApp as jest.Mock).mockReturnValue(false);
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
      .mockResolvedValueOnce({ appType: 'oauth' }) // app type
      .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' }) // redirect URL
      .mockResolvedValueOnce({ another: false }) // no more URLs
      .mockResolvedValueOnce({ logoUrl: '' }) // logo
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
        .mockResolvedValueOnce({ appType: 'oauth' })
        .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' })
        .mockResolvedValueOnce({ another: false })
        .mockResolvedValueOnce({ logoUrl: '' })
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
        .mockResolvedValueOnce({ appType: 'oauth' })
        .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' })
        .mockResolvedValueOnce({ another: false })
        .mockResolvedValueOnce({ logoUrl: '' })
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
        .mockResolvedValueOnce({ appType: 'oauth' })
        .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' })
        .mockResolvedValueOnce({ another: false })
        .mockResolvedValueOnce({ logoUrl: '' })
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
        .mockResolvedValueOnce({ appType: 'oauth' })
        .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' })
        .mockResolvedValueOnce({ another: false })
        .mockResolvedValueOnce({ logoUrl: '' })
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
        .mockResolvedValueOnce({ appType: 'oauth' })
        .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' })
        .mockResolvedValueOnce({ another: false })
        .mockResolvedValueOnce({ logoUrl: '' })
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
      expect(chdirSpy).toHaveBeenCalled();
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
        .mockResolvedValueOnce({ appType: 'oauth' })
        .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' })
        .mockResolvedValueOnce({ another: false })
        .mockResolvedValueOnce({ logoUrl: '' })
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
      .mockResolvedValueOnce({ appType: 'oauth' }) // app type
      .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' })
      .mockResolvedValueOnce({ another: false })
      .mockResolvedValueOnce({ logoUrl: '' })
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
      .mockResolvedValueOnce({ appType: 'oauth' }) // app type
      .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' })
      .mockResolvedValueOnce({ another: false })
      .mockResolvedValueOnce({ logoUrl: '' })
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
      .mockResolvedValueOnce({ appType: 'oauth' })
      .mockResolvedValueOnce({ logoUrl: '' })
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
      .mockResolvedValueOnce({ appType: 'oauth' }) // app type
      .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' })
      .mockResolvedValueOnce({ another: false })
      .mockResolvedValueOnce({ logoUrl: '' });

    await expect(createCommand({ name: 'Test', distribution: 'private' })).rejects.toThrow(
      'maximum number of OAuth apps',
    );
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
      .mockResolvedValueOnce({ appType: 'oauth' }) // app type
      .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' }) // redirect URL
      .mockResolvedValueOnce({ another: false }) // no more URLs
      .mockResolvedValueOnce({ logoUrl: '' }) // skip logo prompt
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

  it('should prompt for name when not provided', async () => {
    mockPrompt
      .mockResolvedValueOnce({ name: 'Prompted App' }) // name prompt
      .mockResolvedValueOnce({ distribution: 'private' }) // distribution prompt
      .mockResolvedValueOnce({ appType: 'oauth' }) // app type
      .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' }) // redirect URL
      .mockResolvedValueOnce({ another: false }) // no more URLs
      .mockResolvedValueOnce({ logoUrl: '' })
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
      .mockResolvedValueOnce({ appType: 'oauth' }) // app type
      .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' })
      .mockResolvedValueOnce({ another: false })
      .mockResolvedValueOnce({ logoUrl: '' })
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
      .mockResolvedValueOnce({ appType: 'oauth' }) // app type
      .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' })
      .mockResolvedValueOnce({ another: false })
      .mockResolvedValueOnce({ logoUrl: '' })
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
      .mockResolvedValueOnce({ appType: 'oauth' }) // app type
      .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' }) // first URL
      .mockResolvedValueOnce({ anotherRaw: 'y' }) // add another
      .mockResolvedValueOnce({ nextUrl: 'https://myapp.com/callback' }) // second URL
      .mockResolvedValueOnce({ anotherRaw: 'n' }) // no more
      .mockResolvedValueOnce({ logoUrl: '' })
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
      .mockResolvedValueOnce({ appType: 'oauth' })
      .mockResolvedValueOnce({ logoUrl: '' })
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
      .mockResolvedValueOnce({ appType: 'oauth' }) // app type
      .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' })
      .mockResolvedValueOnce({ another: false })
      .mockResolvedValueOnce({ logoUrl: 'https://example.com/prompted.png' })
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
      .mockResolvedValueOnce({ appType: 'oauth' }) // app type
      .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' })
      .mockResolvedValueOnce({ anotherRaw: 'n' })
      .mockResolvedValueOnce({ logoUrl: '' })
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
      .mockResolvedValueOnce({ appType: 'oauth' }) // app type
      .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' })
      .mockResolvedValueOnce({ anotherRaw: 'n' })
      .mockResolvedValueOnce({ logoUrl: '' })
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
     * Answer the create prompts by question *name* rather than by call order, so
     * that adding or reordering a prompt can't silently shift an answer onto the
     * wrong field.
     */
    const answerPrompts = (overrides: Record<string, unknown> = {}) => {
      const answers: Record<string, unknown> = {
        distribution: 'private',
        appType: 'ui',
        // The flow asks the integration type FIRST, then the pages, then ONE grouped
        // placement prompt whose values are real slot names.
        integrationType: 'actionLink',
        surfaces: ['contact'],
        placements: ['contactDetails.headerMenu.action'],
        label: 'View in CRM',
        more_info: '',
        url: 'https://example.com/brevo',
        logoUrl: '',
        // Only reached when a test forces the OAuth path (non-TTY / --json), but
        // kept here so those tests don't need their own mock wiring.
        redirectUrl: 'http://localhost:3009/auth/callback',
        another: false,
        scaffoldRaw: 'n',
        ...overrides,
      };
      mockPrompt.mockImplementation((questions: Array<Record<string, unknown>>) => {
        const question = questions[0] ?? {};
        askedQuestions.push(question);
        const name = String(question.name ?? '');
        return Promise.resolve(name in answers ? { [name]: answers[name] } : {});
      });
    };

    const questionNamed = (name: string) => askedQuestions.find((q) => q.name === name);

    // The context field names the platform's registry actually allows. Nothing else is a
    // real name, so nothing else appears in a fixture.
    const DEFAULT_CONTEXT = ['recordId', 'recordName', 'accountId', 'locale'];

    /**
     * One registry row in the BEX-361 wire shape, using the registry's own column names.
     * `default_context_field` is present by default because every seeded production row
     * carries it — it is what each authored entry's `context` is seeded from.
     */
    const REGISTRY_ROW = (
      location: string,
      section: string,
      component: string,
      extra: Record<string, unknown> = {},
    ) => ({
      surface_point: `${location}.${section}.${component}`,
      location_name: location,
      section_name: section,
      component_type: component,
      surface_point_name: `${location}-${section}`.toLowerCase(),
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

    beforeEach(() => {
      askedQuestions = [];
      (appService.fetchSurfacePoints as jest.Mock).mockResolvedValue(FULL_REGISTRY);
      (appService.createApp as jest.Mock).mockResolvedValue({
        app_id: 42,
        name: 'Invoice Manager',
        client_id: 'cli-123',
        client_secret: 'secret-456',
        redirect_uris: [],
      });
      answerPrompts();
    });

    const collectedUiApp = () => (fetchAppContext as jest.Mock).mock.calls[0][2];
    /** Just the slot names of the collected block, for the placement assertions. */
    const surfacePointNames = () =>
      collectedUiApp().surface_point_list.map(
        (entry: { surface_point: string }) => entry.surface_point,
      );
    /** Values of a checkbox/list question's choices, skipping inquirer Separators. */
    const choiceValuesOf = (name: string) =>
      ((questionNamed(name)?.choices ?? []) as Array<{ value?: string; type?: string }>)
        .filter((choice) => choice.type !== 'separator' && choice.value !== undefined)
        .map((choice) => choice.value);

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

    it('does not send the ui_app block to POST /apps', async () => {
      await createCommand(CLI_OPTIONS);

      const payload = (appService.createApp as jest.Mock).mock.calls[0][0];
      expect(payload).not.toHaveProperty('snapshot');
      expect(payload).not.toHaveProperty('ui_app');
    });

    // Field names and casing must match the platform's stored app snapshot exactly — keys
    // are snake_case, `extension_type` VALUES stay camelCase per BEX-350 — and each
    // placement carries its own seeded context.
    it('builds the ui_app shape the platform consumes', async () => {
      await createCommand(CLI_OPTIONS);

      expect(collectedUiApp()).toEqual({
        extension_type: 'actionLink',
        surface_point_list: [
          { surface_point: 'contactDetails.headerMenu.action', context: DEFAULT_CONTEXT },
        ],
        label: 'View in CRM',
        redirect_link: 'https://example.com/brevo',
      });
    });

    // ──────── Prompt order (the BEX-290 reorder) ────────

    it('asks the integration type first, before any placement prompt', async () => {
      await createCommand(CLI_OPTIONS);

      const order = askedQuestions.map((q) => String(q.name));
      expect(order.indexOf('integrationType')).toBeLessThan(order.indexOf('surfaces'));
      expect(order.indexOf('surfaces')).toBeLessThan(order.indexOf('placements'));
      expect(order.indexOf('placements')).toBeLessThan(order.indexOf('label'));
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

    // Decision 2026-08-03, still current: only actionLink is authorable until the
    // iframe-embed RFC lands, but the prompt exists — Iframe is shown as a DISABLED
    // "coming soon" choice so partners see the roadmap where the decision is being made.
    // (The platform still accepts a hand-edited iframeExtension block at upload.)
    it('offers the integration-type prompt with Iframe disabled', async () => {
      await createCommand(CLI_OPTIONS);

      const question = questionNamed('integrationType');
      expect(question).toBeDefined();
      const choices = (question?.choices ?? []) as Array<{ value?: string; disabled?: unknown }>;
      const link = choices.find((c) => c.value === 'actionLink');
      const iframe = choices.find((c) => c.value === 'iframeExtension');
      expect(link).toBeDefined();
      expect(link?.disabled).toBeUndefined();
      expect(iframe?.disabled).toBe('coming soon');
      expect(collectedUiApp().extension_type).toBe('actionLink');
    });

    // ──────── Two registry loads ────────

    it('loads the whole registry unfiltered, then the picked pages by location', async () => {
      answerPrompts({
        surfaces: ['contact', 'deal'],
        placements: ['contactDetails.headerMenu.action', 'dealDetails.headerMenu.action'],
      });

      await createCommand(CLI_OPTIONS);

      expect(appService.fetchSurfacePoints).toHaveBeenNthCalledWith(1);
      expect(appService.fetchSurfacePoints).toHaveBeenNthCalledWith(2, [
        'contactDetails',
        'dealDetails',
      ]);
    });

    // The narrowed response is a strict subset of the first call's, so nothing is lost by
    // reusing what we already hold — and aborting here would throw away the page answer
    // the partner just gave. Matters while the endpoint is unbuilt: an early build may not
    // implement the location filter at all, and a 400 on it must not be fatal.
    it('falls back to the already-loaded rows when the narrowed load fails', async () => {
      (appService.fetchSurfacePoints as jest.Mock)
        .mockResolvedValueOnce(FULL_REGISTRY)
        .mockRejectedValueOnce(new ApiError('no location filter here', 400));

      await createCommand(CLI_OPTIONS);

      expect(surfacePointNames()).toEqual(['contactDetails.headerMenu.action']);
    });

    it('falls back when the narrowed load comes back empty', async () => {
      (appService.fetchSurfacePoints as jest.Mock)
        .mockResolvedValueOnce(FULL_REGISTRY)
        .mockResolvedValueOnce([]);

      await createCommand(CLI_OPTIONS);

      expect(surfacePointNames()).toEqual(['contactDetails.headerMenu.action']);
    });

    // ──────── The single grouped placement prompt ────────

    it('groups the placement choices by page with a separator per page', async () => {
      answerPrompts({
        surfaces: ['contact', 'deal'],
        placements: ['contactDetails.headerMenu.action', 'dealDetails.overviewMain.widget'],
      });

      await createCommand(CLI_OPTIONS);

      const choices = (questionNamed('placements')?.choices ?? []) as Array<{
        type?: string;
        line?: string;
        value?: string;
      }>;
      const separatorLines = choices
        .filter((choice) => choice.type === 'separator')
        .map((choice) => String(choice.line).trim());
      expect(separatorLines).toEqual(['contact', 'deal']);
      // Eight rows: four placements on each of the two picked pages.
      expect(choices.filter((c) => c.value !== undefined)).toHaveLength(8);
    });

    // The whole point of one grouped prompt: an app can put a menu entry on one page and a
    // card on another. The old kind-then-place pair made that unauthorable.
    it('mixes menu entries and cards across pages in one app', async () => {
      answerPrompts({
        surfaces: ['contact', 'deal'],
        placements: ['contactDetails.headerMenu.action', 'dealDetails.overviewSidebar.widget'],
      });

      await createCommand(CLI_OPTIONS);

      expect(surfacePointNames()).toEqual([
        'contactDetails.headerMenu.action',
        'dealDetails.overviewSidebar.widget',
      ]);
    });

    it('offers only the placements on the picked pages', async () => {
      await createCommand(CLI_OPTIONS);

      expect(choiceValuesOf('placements')).toEqual([
        'contactDetails.headerMenu.action',
        'contactDetails.overviewMain.widget',
        'contactDetails.overviewSidebar.widget',
        'contactDetails.overviewAttributes.widget',
      ]);
    });

    // Registry order, not tick order, so a re-run that picked the same slots in a
    // different sequence doesn't churn the upload diff.
    it('writes the placements in registry order regardless of tick order', async () => {
      answerPrompts({
        surfaces: ['contact'],
        placements: ['contactDetails.overviewSidebar.widget', 'contactDetails.headerMenu.action'],
      });

      await createCommand(CLI_OPTIONS);

      expect(surfacePointNames()).toEqual([
        'contactDetails.headerMenu.action',
        'contactDetails.overviewSidebar.widget',
      ]);
    });

    it('deduplicates a repeated placement', async () => {
      answerPrompts({
        placements: ['contactDetails.headerMenu.action', 'contactDetails.headerMenu.action'],
      });

      await createCommand(CLI_OPTIONS);

      expect(surfacePointNames()).toEqual(['contactDetails.headerMenu.action']);
    });

    it('pre-selects a page that offers only one placement', async () => {
      (appService.fetchSurfacePoints as jest.Mock).mockResolvedValue([
        REGISTRY_ROW('contactDetails', 'headerMenu', 'action'),
      ]);

      await createCommand(CLI_OPTIONS);

      expect(questionNamed('placements')?.default).toEqual(['contactDetails.headerMenu.action']);
    });

    it('pre-selects nothing on a page that offers several placements', async () => {
      await createCommand(CLI_OPTIONS);

      expect(questionNamed('placements')?.default).toEqual([]);
    });

    it('requires at least one placement', async () => {
      await createCommand(CLI_OPTIONS);

      const validate = questionNamed('placements')?.validate as (v: unknown[]) => unknown;
      expect(validate([])).toMatch(/at least one spot/i);
      expect(validate(['contactDetails.headerMenu.action'])).toBe(true);
    });

    // The quiet failure of one grouped prompt: pick three pages, tick spots on one, and
    // the other two page choices silently do nothing.
    it('requires at least one placement on every page that was picked', async () => {
      answerPrompts({
        surfaces: ['contact', 'deal'],
        placements: ['contactDetails.headerMenu.action', 'dealDetails.headerMenu.action'],
      });

      await createCommand(CLI_OPTIONS);

      const validate = questionNamed('placements')?.validate as (v: unknown[]) => unknown;
      expect(validate(['contactDetails.headerMenu.action'])).toMatch(/nothing selected for: deal/i);
      expect(validate(['contactDetails.headerMenu.action', 'dealDetails.headerMenu.action'])).toBe(
        true,
      );
    });

    // The regression these two guard: the per-page rule used to be measured against the
    // pages that were PICKED rather than the pages that produced a group, so when the
    // narrowed read covered only some picked pages no answer satisfied the prompt —
    // ticking the offered spot reported "nothing selected for: deal", ticking nothing
    // reported "Pick at least one spot" — and Ctrl-C was the only way out, discarding the
    // name, distribution and type answers already given.
    describe('a picked page the narrowed registry read returns nothing for', () => {
      // A real early-build behaviour: the endpoint honours only the first CSV value.
      const onlyFirstLocation = () =>
        (appService.fetchSurfacePoints as jest.Mock)
          .mockResolvedValueOnce(FULL_REGISTRY)
          .mockResolvedValueOnce([REGISTRY_ROW('contactDetails', 'headerMenu', 'action')]);

      beforeEach(() => {
        answerPrompts({
          surfaces: ['contact', 'deal'],
          placements: ['contactDetails.headerMenu.action'],
        });
        onlyFirstLocation();
      });

      it('warns about a picked page the registry offers no placements on', async () => {
        await createCommand(CLI_OPTIONS);

        const stdout = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
        expect(stdout).toMatch(/No placements are available on: deal/);
      });

      it('does not require a placement on a page that offered none', async () => {
        await createCommand(CLI_OPTIONS);

        const validate = questionNamed('placements')?.validate as (v: unknown[]) => unknown;
        // The one answer the prompt actually offers must be accepted.
        expect(validate(['contactDetails.headerMenu.action'])).toBe(true);
        // And the prompt still refuses an empty answer, so it is not simply toothless.
        expect(validate([])).toMatch(/at least one spot/i);
        expect(surfacePointNames()).toEqual(['contactDetails.headerMenu.action']);
      });
    });

    // Labels are CLI-owned. `surface_point_name` on the registry is a kebab-case SLUG
    // (`contactdetails-headermenu` in these fixtures), not display text, so it must never
    // reach a partner.
    it('labels placements from the local label map, never from surface_point_name', async () => {
      await createCommand(CLI_OPTIONS);

      const names = (
        (questionNamed('placements')?.choices ?? []) as Array<{ name?: string; value?: string }>
      )
        .filter((choice) => choice.value !== undefined)
        .map((choice) => String(choice.name));
      expect(names).toEqual([
        'Header "More" (•••) menu — menu entry',
        'Main column — card',
        'Sidebar — card',
        'Attributes panel — card',
      ]);
      expect(names.join(' ')).not.toContain('contactdetails-headermenu');
    });

    // ──────── Client-side filtering of un-hostable rows ────────
    // The unfiltered fetch is deliberate — a server-side extension-type filter would hide
    // authorable placements — so the CLI checks each row itself. Without this, a partner
    // authors a slot that cannot serve their type, upload 200s, and the slot renders
    // nothing: exactly the silent failure this flow exists to prevent.

    it('hides rows whose extension_type_list cannot host the chosen type', async () => {
      (appService.fetchSurfacePoints as jest.Mock).mockResolvedValue([
        REGISTRY_ROW('contactDetails', 'headerMenu', 'action'),
        REGISTRY_ROW('contactDetails', 'overviewMain', 'widget', {
          extension_type_list: ['legacyComponent'],
        }),
      ]);

      await createCommand(CLI_OPTIONS);

      expect(choiceValuesOf('placements')).toEqual(['contactDetails.headerMenu.action']);
    });

    it('hides rows that are not active', async () => {
      (appService.fetchSurfacePoints as jest.Mock).mockResolvedValue([
        REGISTRY_ROW('contactDetails', 'headerMenu', 'action'),
        REGISTRY_ROW('contactDetails', 'overviewMain', 'widget', { status: 'deprecated' }),
      ]);

      await createCommand(CLI_OPTIONS);

      expect(choiceValuesOf('placements')).toEqual(['contactDetails.headerMenu.action']);
    });

    // A registry seeded before either column existed must stay usable — treating a missing
    // column as a rejection would empty the prompt against every older environment.
    it('keeps rows that declare neither extension_type_list nor status', async () => {
      (appService.fetchSurfacePoints as jest.Mock).mockResolvedValue([
        {
          surface_point: 'contactDetails.headerMenu.action',
          location_name: 'contactDetails',
          section_name: 'headerMenu',
          component_type: 'action',
        },
      ]);

      await createCommand(CLI_OPTIONS);

      expect(surfacePointNames()).toEqual(['contactDetails.headerMenu.action']);
    });

    // Distinct from the empty-registry case: the fix is a different integration type, not
    // waiting for a seed, so the message says so.
    it('aborts when no placement can host the chosen type', async () => {
      (appService.fetchSurfacePoints as jest.Mock).mockResolvedValue([
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

    it('aborts with an actionable error when the registry fetch fails', async () => {
      (appService.fetchSurfacePoints as jest.Mock).mockRejectedValue(new ApiError('boom', 500));

      await expect(createCommand(CLI_OPTIONS)).rejects.toThrow(
        /could not load the available placements/i,
      );
      expect(questionNamed('surfaces')).toBeUndefined();
      expect(appService.createApp).not.toHaveBeenCalled();
    });

    it('aborts when the registry has no usable rows', async () => {
      (appService.fetchSurfacePoints as jest.Mock).mockResolvedValue([
        { surface_point: 'not-a-slot' }, // no decomposed columns, name not 3 segments
      ]);

      await expect(createCommand(CLI_OPTIONS)).rejects.toThrow(/no available placements/i);
      expect(appService.createApp).not.toHaveBeenCalled();
    });

    it('offers only the pages the registry actually has', async () => {
      (appService.fetchSurfacePoints as jest.Mock).mockResolvedValue(
        FULL_REGISTRY.filter((row) => row.location_name === 'contactDetails'),
      );

      await createCommand(CLI_OPTIONS);

      expect(choiceValuesOf('surfaces')).toEqual(['contact']);
    });

    it('offers an unknown location under a derived name and accepts it', async () => {
      (appService.fetchSurfacePoints as jest.Mock).mockResolvedValue([
        REGISTRY_ROW('orderDetails', 'headerMenu', 'action'),
      ]);
      answerPrompts({ surfaces: ['order'], placements: ['orderDetails.headerMenu.action'] });

      await createCommand(CLI_OPTIONS);

      // The point is registry-only (not in the local mirror), so this also
      // proves validateUiApp ran against the fetched list, not the mirror.
      expect(surfacePointNames()).toEqual(['orderDetails.headerMenu.action']);
    });

    it('backfills the slot segments from the name when the server omits them', async () => {
      (appService.fetchSurfacePoints as jest.Mock).mockResolvedValue([
        { surface_point: 'contactDetails.headerMenu.action' },
      ]);

      await createCommand(CLI_OPTIONS);

      expect(surfacePointNames()).toEqual(['contactDetails.headerMenu.action']);
    });

    // ──────── Record context is seeded per placement, not prompted ────────

    it('seeds each entry from that row own default_context_field', async () => {
      (appService.fetchSurfacePoints as jest.Mock).mockResolvedValue([
        REGISTRY_ROW('contactDetails', 'headerMenu', 'action', {
          default_context_field: ['recordId'],
        }),
        REGISTRY_ROW('dealDetails', 'headerMenu', 'action', {
          default_context_field: ['recordId', 'recordName'],
        }),
      ]);
      answerPrompts({
        surfaces: ['contact', 'deal'],
        placements: ['contactDetails.headerMenu.action', 'dealDetails.headerMenu.action'],
      });

      await createCommand(CLI_OPTIONS);

      expect(collectedUiApp().surface_point_list).toEqual([
        { surface_point: 'contactDetails.headerMenu.action', context: ['recordId'] },
        { surface_point: 'dealDetails.headerMenu.action', context: ['recordId', 'recordName'] },
      ]);
    });

    // No context key rather than an empty array: `[]` would read as "narrow to nothing"
    // where absent means "no narrowing".
    it('omits context for a row that declares no default', async () => {
      (appService.fetchSurfacePoints as jest.Mock).mockResolvedValue([
        REGISTRY_ROW('contactDetails', 'headerMenu', 'action', {
          default_context_field: undefined,
        }),
      ]);

      await createCommand(CLI_OPTIONS);

      expect(collectedUiApp().surface_point_list).toEqual([
        { surface_point: 'contactDetails.headerMenu.action' },
      ]);
    });

    // ──────── The rest of the block ────────

    it('omits more_info when left blank rather than writing an empty string', async () => {
      await createCommand(CLI_OPTIONS);

      expect(collectedUiApp()).not.toHaveProperty('more_info');
    });

    it('includes more_info when entered', async () => {
      answerPrompts({ more_info: 'Review invoice history' });

      await createCommand(CLI_OPTIONS);

      expect(collectedUiApp().more_info).toBe('Review invoice history');
    });

    // link_target is neither asked nor authored: `brevo app upload` injects `_blank`.
    // The server refuses `_self`, so a field in the file would only invite a partner to
    // edit it into a value that 400s.
    it('never prompts for or writes a link target', async () => {
      await createCommand(CLI_OPTIONS);

      expect(questionNamed('link_target')).toBeUndefined();
      expect(collectedUiApp()).not.toHaveProperty('link_target');
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

    it('requires at least one record page', async () => {
      await createCommand(CLI_OPTIONS);

      const surfaces = questionNamed('surfaces');
      expect((surfaces?.validate as (v: unknown[]) => unknown)([])).toMatch(/at least one/i);
      expect((surfaces?.validate as (v: unknown[]) => unknown)(['contact'])).toBe(true);
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
      expect(output).toContain('contactDetails.headerMenu.action');
      expect(output).toContain('https://example.com/brevo');
      expect(output).not.toContain('Redirect URL');
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
      (appService.fetchSurfacePoints as jest.Mock).mockResolvedValue([
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
      (appService.fetchSurfacePoints as jest.Mock).mockResolvedValue([
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
      expect(collectedUiApp()).toBeUndefined();
    });

    it('creates an OAuth app under --json even on a TTY', async () => {
      await createCommand({ ...CLI_OPTIONS, json: true });

      expect(questionNamed('appType')).toBeUndefined();
      const parsed = JSON.parse(stdoutSpy.mock.calls.map((c) => String(c[0])).join(''));
      expect(parsed.appType).toBe('oauth');
      expect(parsed).toHaveProperty('redirectUri');
      expect(parsed).not.toHaveProperty('uiApp');
    });
  });
});
