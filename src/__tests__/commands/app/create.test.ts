import { createCommand } from '../../../commands/app/create';
import { ApiError, ErrorCode } from '../../../lib/errors';

jest.mock('inquirer', () => ({
  prompt: jest.fn(),
}));

jest.mock('../../../lib/config', () => ({
  getApiKey: jest.fn().mockReturnValue('test-key'),
  saveAppCredentials: jest.fn(),
  saveAppName: jest.fn(),
  hasLocalApp: jest.fn().mockReturnValue(false),
  readProjectConfig: jest.fn().mockReturnValue(null),
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
  scaffoldCommand: jest.fn(),
}));

// Need to import after mocks
import inquirer from 'inquirer';
import { appService } from '../../../container';
import { saveAppCredentials, saveAppName } from '../../../lib/config';

const mockPrompt = inquirer.prompt as unknown as jest.Mock;

describe('app/create', () => {
  let stdoutSpy: jest.SpyInstance;
  const originalIsTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      writable: true,
      value: true,
    });
    jest.clearAllMocks();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    if (originalIsTTYDescriptor) {
      Object.defineProperty(process.stdin, 'isTTY', originalIsTTYDescriptor);
    } else {
      Reflect.deleteProperty(process.stdin, 'isTTY');
    }
  });

  it('should create an app with provided options and decline scaffold', async () => {
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
      .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' }) // redirect URL
      .mockResolvedValueOnce({ another: false }) // no more URLs
      .mockResolvedValueOnce({ logoUrl: '' }) // skip logo prompt
      .mockResolvedValueOnce({ shouldScaffold: false }); // scaffold

    await createCommand({ name: 'Test App', distribution: 'private' });

    expect(appService.createApp).toHaveBeenCalledWith({
      name: 'Test App',
      public: false,
      redirect_uris: ['http://localhost:3009/auth/callback'],
      scopes: ['contacts:read', 'contacts:write', 'crm:read', 'crm:write'],
    });
    expect(saveAppCredentials).toHaveBeenCalledWith(1, {
      clientId: 'cli-123',
      clientSecret: 'secret-456',
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

    mockPrompt
      .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' })
      .mockResolvedValueOnce({ another: false });

    await createCommand({ name: 'JSON App', distribution: 'private', json: true });

    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    const parsed = JSON.parse(output);
    expect(parsed.appId).toBe(2);
    expect(parsed.clientId).toBe('cli-abc');
    expect(parsed.clientSecret).toContain('[hidden');
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
      .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' })
      .mockResolvedValueOnce({ another: false })
      .mockResolvedValueOnce({ logoUrl: '' })
      .mockResolvedValueOnce({ shouldScaffold: false });

    await createCommand({ name: 'Hint App', distribution: 'private' });

    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('brevo app start oauth');
    expect(output).toMatch(/scaffolded example requires the default callback url/i);
  });

  it('should suppress the test-flow hint under --json', async () => {
    (appService.createApp as jest.Mock).mockResolvedValue({
      app_id: 5,
      name: 'JSON Hint App',
      client_id: 'cli-jh',
      client_secret: 'secret-jh',
      redirect_uris: ['http://localhost:3009/auth/callback'],
    });

    mockPrompt
      .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' })
      .mockResolvedValueOnce({ another: false });

    await createCommand({ name: 'JSON Hint App', distribution: 'private', json: true });

    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).not.toMatch(/scaffolded example requires the default callback url/i);
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
      .mockResolvedValueOnce({ shouldScaffold: false });

    await createCommand({
      name: 'Flag App',
      distribution: 'private',
      redirectUri: ['https://example.com/cb'],
    });

    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).not.toMatch(/scaffolded example requires the default callback url/i);
  });

  it('should throw CliError on APP_LIMIT_REACHED', async () => {
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    (appService.createApp as jest.Mock).mockRejectedValue(
      new ApiError('Limit reached', 403, ErrorCode.APP_LIMIT_REACHED, 'APP_LIMIT_REACHED'),
    );

    mockPrompt
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
      .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' }) // redirect URL
      .mockResolvedValueOnce({ another: false }) // no more URLs
      .mockResolvedValueOnce({ logoUrl: '' }) // skip logo prompt
      .mockResolvedValueOnce({ name: 'New Name' }) // retry name prompt
      .mockResolvedValueOnce({ shouldScaffold: false }); // scaffold prompt

    await createCommand({ name: 'Taken Name', distribution: 'private' });

    expect(appService.createApp).toHaveBeenCalledTimes(2);
    expect(appService.createApp).toHaveBeenLastCalledWith({
      name: 'New Name',
      public: false,
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

    mockPrompt
      .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' })
      .mockResolvedValueOnce({ another: false })
      .mockResolvedValueOnce({ name: 'Resolved Name' });

    await createCommand({ name: 'Taken Name', distribution: 'private', json: true });

    expect(saveAppName).toHaveBeenCalledWith(99, 'Resolved Name');
    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    const parsed = JSON.parse(output);
    expect(parsed.appName).toBe('Resolved Name');
  });

  it('should prompt for name when not provided', async () => {
    mockPrompt
      .mockResolvedValueOnce({ name: 'Prompted App' }) // name prompt
      .mockResolvedValueOnce({ distribution: 'private' }) // distribution prompt
      .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' }) // redirect URL
      .mockResolvedValueOnce({ another: false }) // no more URLs
      .mockResolvedValueOnce({ logoUrl: '' }) // skip logo prompt
      .mockResolvedValueOnce({ shouldScaffold: false }); // scaffold prompt

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
      public: false,
      redirect_uris: ['http://localhost:3009/auth/callback'],
      scopes: ['contacts:read', 'contacts:write', 'crm:read', 'crm:write'],
    });
  });

  it('should throw on invalid distribution', async () => {
    await expect(createCommand({ name: 'Test', distribution: 'invalid' })).rejects.toThrow(
      'Invalid --distribution',
    );
  });

  it('should reject --distribution public with coming-soon error before calling API', async () => {
    await expect(createCommand({ name: 'Test', distribution: 'public' })).rejects.toThrow(
      'Public distribution is not yet available',
    );
    expect(appService.createApp).not.toHaveBeenCalled();
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
      .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' })
      .mockResolvedValueOnce({ another: false })
      .mockResolvedValueOnce({ logoUrl: '' })
      .mockResolvedValueOnce({ shouldScaffold: false });

    await createCommand({ name: 'Café Résumé', distribution: 'private' });

    expect(appService.createApp).toHaveBeenCalledWith({
      name: 'Café Résumé',
      public: false,
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
      .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' }) // first URL
      .mockResolvedValueOnce({ anotherRaw: 'y' }) // add another
      .mockResolvedValueOnce({ nextUrl: 'https://myapp.com/callback' }) // second URL
      .mockResolvedValueOnce({ anotherRaw: 'n' }) // no more
      .mockResolvedValueOnce({ logoUrl: '' }) // skip logo prompt
      .mockResolvedValueOnce({ shouldScaffold: false });

    await createCommand({ name: 'Multi URL App', distribution: 'private' });

    expect(appService.createApp).toHaveBeenCalledWith({
      name: 'Multi URL App',
      public: false,
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
      .mockResolvedValueOnce({ logoUrl: '' })
      .mockResolvedValueOnce({ shouldScaffold: false });

    await createCommand({
      name: 'Flag App',
      distribution: 'private',
      redirectUri: ['https://myapp.com/callback'],
    });

    expect(appService.createApp).toHaveBeenCalledWith({
      name: 'Flag App',
      public: false,
      redirect_uris: ['https://myapp.com/callback'],
      scopes: ['contacts:read', 'contacts:write', 'crm:read', 'crm:write'],
    });
    // Only logo prompt + scaffold — no redirect URL prompts
    expect(mockPrompt).toHaveBeenCalledTimes(2);
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
      public: false,
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
      .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' })
      .mockResolvedValueOnce({ another: false })
      .mockResolvedValueOnce({ logoUrl: 'https://example.com/prompted.png' })
      .mockResolvedValueOnce({ shouldScaffold: false });

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
      .mockResolvedValueOnce({ redirectUrl: 'http://localhost:3009/auth/callback' })
      .mockResolvedValueOnce({ anotherRaw: 'n' })
      .mockResolvedValueOnce({ logoUrl: '' })
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
      .mockResolvedValueOnce({ logoUrl: '' })
      .mockResolvedValueOnce({ shouldScaffold: false });

    await createCommand({ name: 'Test App', distribution: 'private' });

    const stdoutCalls = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(stdoutCalls).toContain('Default scopes');
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
    expect(stdoutCalls).not.toContain('Default scopes');
  });
});
