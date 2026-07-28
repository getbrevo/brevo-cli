import { createCommand } from '../../../commands/app/create';
import { ApiError, ErrorCode } from '../../../lib/errors';

jest.mock('inquirer', () => ({
  prompt: jest.fn(),
  // The UI-app delivery-path prompt renders a separator between the action link
  // and the not-yet-supported choices.
  Separator: class {},
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
      redirectUrls: [],
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
      redirect_uris: ['http://localhost:3009/auth/callback'],
      scopes: ['contacts:read', 'contacts:write', 'crm:read', 'crm:write'],
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
      redirect_uris: ['http://localhost:3009/auth/callback'],
      scopes: ['contacts:read', 'contacts:write', 'crm:read', 'crm:write'],
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
      .mockResolvedValueOnce({ appType: 'oauth' }) // app type
      .mockResolvedValueOnce({ distribution: 'private' }) // distribution prompt
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
      redirect_uris: ['http://localhost:3009/auth/callback'],
      scopes: ['contacts:read', 'contacts:write', 'crm:read', 'crm:write'],
    });
  });

  it('should throw on invalid distribution', async () => {
    // The app-type prompt runs before distribution is validated.
    mockPrompt.mockResolvedValueOnce({ appType: 'oauth' });

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
      redirect_uris: ['http://localhost:3009/auth/callback'],
      scopes: ['contacts:read', 'contacts:write', 'crm:read', 'crm:write'],
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
      redirect_uris: ['http://localhost:3009/auth/callback'],
      scopes: ['contacts:read', 'contacts:write', 'crm:read', 'crm:write'],
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
      redirect_uris: ['http://localhost:3009/auth/callback', 'https://myapp.com/callback'],
      scopes: ['contacts:read', 'contacts:write', 'crm:read', 'crm:write'],
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
      redirect_uris: ['https://myapp.com/callback'],
      scopes: ['contacts:read', 'contacts:write', 'crm:read', 'crm:write'],
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
      redirect_uris: ['http://localhost:3000/cb', 'https://prod.example.com/cb'],
      scopes: ['contacts:read', 'contacts:write', 'crm:read', 'crm:write'],
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
        appType: 'ui',
        extensionType: 'actionLink',
        surfaces: ['contact'],
        heading: 'Invoice Manager',
        subheading: '',
        redirectLink: 'https://example.com/brevo',
        linkTarget: '_blank',
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

    beforeEach(() => {
      askedQuestions = [];
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

    it('omits redirect_uris from the create payload', async () => {
      await createCommand(CLI_OPTIONS);

      const payload = (appService.createApp as jest.Mock).mock.calls[0][0];
      expect(payload).not.toHaveProperty('redirect_uris');
    });

    it('sends the narrower UI-app scope defaults', async () => {
      await createCommand(CLI_OPTIONS);

      const payload = (appService.createApp as jest.Mock).mock.calls[0][0];
      expect(payload.scopes).toEqual(['contacts:read', 'contacts:write']);
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

    it('does not send the snapshot to POST /apps', async () => {
      await createCommand(CLI_OPTIONS);

      const payload = (appService.createApp as jest.Mock).mock.calls[0][0];
      expect(payload).not.toHaveProperty('snapshot');
      expect(payload).not.toHaveProperty('ui_app');
    });

    // Field names and casing must match the platform's stored app snapshot
    // exactly — `extensionType` is camelCase since BEX-350.
    it('builds the snapshot shape the platform consumes', async () => {
      await createCommand(CLI_OPTIONS);

      expect(collectedUiApp()).toEqual({
        extensionType: 'actionLink',
        surfacePointList: ['contactDetails.headerMenu.action'],
        heading: 'Invoice Manager',
        redirectLink: 'https://example.com/brevo',
        linkTarget: '_blank',
      });
    });

    it('maps the picked record pages onto action slot names', async () => {
      answerPrompts({ surfaces: ['deal', 'company'] });

      await createCommand(CLI_OPTIONS);

      expect(collectedUiApp().surfacePointList).toEqual([
        'dealDetails.headerMenu.action',
        'companyDetails.headerMenu.action',
      ]);
    });

    it('deduplicates repeated record pages', async () => {
      answerPrompts({ surfaces: ['contact', 'contact'] });

      await createCommand(CLI_OPTIONS);

      expect(collectedUiApp().surfacePointList).toEqual(['contactDetails.headerMenu.action']);
    });

    it('omits subheading when left blank rather than writing an empty string', async () => {
      await createCommand(CLI_OPTIONS);

      expect(collectedUiApp()).not.toHaveProperty('subheading');
    });

    it('includes subheading when entered', async () => {
      answerPrompts({ subheading: 'Review invoice history' });

      await createCommand(CLI_OPTIONS);

      expect(collectedUiApp().subheading).toBe('Review invoice history');
    });

    it('honours the link-target answer', async () => {
      answerPrompts({ linkTarget: '_self' });

      await createCommand(CLI_OPTIONS);

      expect(collectedUiApp().linkTarget).toBe('_self');
    });

    // The per-field flags are gone, so these prompt `validate` callbacks are now
    // the only thing standing between a typo and a silently unrenderable action
    // link. Assert they're still wired up.
    it('validates the heading and redirect-link answers at the prompt', async () => {
      await createCommand(CLI_OPTIONS);

      const heading = questionNamed('heading');
      expect(typeof heading?.validate).toBe('function');
      expect((heading?.validate as (v: string) => unknown)('  ')).toMatch(/cannot be empty/i);

      const redirectLink = questionNamed('redirectLink');
      expect(typeof redirectLink?.validate).toBe('function');
      expect((redirectLink?.validate as (v: string) => unknown)('http://example.com')).toMatch(
        /must use https/i,
      );
    });

    it('requires at least one record page', async () => {
      await createCommand(CLI_OPTIONS);

      const surfaces = questionNamed('surfaces');
      expect((surfaces?.validate as (v: unknown[]) => unknown)([])).toMatch(/at least one/i);
      expect((surfaces?.validate as (v: unknown[]) => unknown)(['contact'])).toBe(true);
    });

    it('offers only the action link as a selectable delivery path', async () => {
      await createCommand(CLI_OPTIONS);

      const choices = (questionNamed('extensionType')?.choices ?? []) as Array<{
        value?: string;
        disabled?: string;
      }>;
      const selectable = choices.filter((c) => c.value && !c.disabled).map((c) => c.value);
      expect(selectable).toEqual(['actionLink']);
    });

    it('never offers the OAuth feature scaffold', async () => {
      await createCommand(CLI_OPTIONS);

      expect(promptFeatureType).not.toHaveBeenCalled();
      expect(runFeatureScaffold).not.toHaveBeenCalled();
    });

    it('renders the UI-app box with the extension point, not redirect URLs', async () => {
      await createCommand(CLI_OPTIONS);

      const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(output).toContain('UI app created');
      expect(output).toContain('contactDetails.headerMenu.action');
      expect(output).toContain('https://example.com/brevo');
      expect(output).not.toContain('Redirect URL');
    });

    // There is no per-action label on the platform — the menu entry uses the app
    // name — so the box says so explicitly.
    it('explains that the menu label comes from the app name', async () => {
      await createCommand(CLI_OPTIONS);

      const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(output).toMatch(/labelled with the app name/i);
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
      expect(payload).toHaveProperty('redirect_uris');
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
