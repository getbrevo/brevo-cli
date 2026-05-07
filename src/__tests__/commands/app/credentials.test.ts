import { credentialsCommand } from '../../../commands/app/credentials';

jest.mock('inquirer', () => ({
  prompt: jest.fn(),
}));

jest.mock('../../../lib/config', () => ({
  getApiKey: jest.fn().mockReturnValue('test-key'),
  getAppCredentials: jest.fn(),
  saveAppCredentials: jest.fn(),
  saveAppName: jest.fn(),
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

import inquirer from 'inquirer';
import { appService } from '../../../container';

const mockPrompt = inquirer.prompt as unknown as jest.Mock;

function mockApp(overrides = {}) {
  return {
    app: {
      app_id: '1',
      client_id: 'cli-123',
      client_secret: 'secret-456',
      redirect_uris: ['http://localhost:3000'],
      ...overrides,
    },
    diffs: [],
  };
}

describe('app/credentials', () => {
  let stdoutSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    jest.clearAllMocks();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('should display credentials fetched from API', async () => {
    (appService.resolveAppCredentials as jest.Mock).mockResolvedValue(mockApp());

    await credentialsCommand({ appId: '1' });

    expect(appService.resolveAppCredentials).toHaveBeenCalledWith('1');
    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('cli-123');
    expect(output).toContain('[hidden');
    expect(output).toContain('http://localhost:3000');
  });

  it('should throw when app not found via API', async () => {
    (appService.resolveAppCredentials as jest.Mock).mockResolvedValue(null);

    await expect(credentialsCommand({ appId: '999' })).rejects.toThrow('App 999 not found');
  });

  it('should reveal secret when user confirms', async () => {
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });

    (appService.resolveAppCredentials as jest.Mock).mockResolvedValue(
      mockApp({ client_secret: 'my-real-secret' }),
    );
    mockPrompt.mockResolvedValueOnce({ confirmed: true });

    await credentialsCommand({ appId: '1', revealSecret: true });

    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('my-real-secret');

    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
  });

  it('should not reveal secret in non-interactive mode', async () => {
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });

    (appService.resolveAppCredentials as jest.Mock).mockResolvedValue(
      mockApp({ client_secret: 'my-real-secret' }),
    );

    await credentialsCommand({ appId: '1', revealSecret: true });

    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('non-interactive');
    expect(output).not.toContain('my-real-secret');

    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
  });

  it('should output JSON format', async () => {
    (appService.resolveAppCredentials as jest.Mock).mockResolvedValue(
      mockApp({ redirect_uris: ['http://localhost:3000', 'https://example.com/cb'] }),
    );

    await credentialsCommand({ appId: '1', json: true });

    const output = stdoutSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.appId).toBe('1');
    expect(parsed.clientId).toBe('cli-123');
    expect(parsed.clientSecret).toBe('[hidden]');
    expect(parsed.redirectUris).toEqual(['http://localhost:3000', 'https://example.com/cb']);
    expect(parsed.redirectUrls).toBeUndefined();
  });

  it('should output empty redirectUris array when none exist in JSON mode', async () => {
    (appService.resolveAppCredentials as jest.Mock).mockResolvedValue(
      mockApp({ redirect_uris: [] }),
    );

    await credentialsCommand({ appId: '1', json: true });

    const output = stdoutSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.redirectUris).toEqual([]);
  });

  it('should prompt app picker when no appId provided', async () => {
    (appService.pickApp as jest.Mock).mockResolvedValue('5');
    (appService.resolveAppCredentials as jest.Mock).mockResolvedValue(
      mockApp({ app_id: '5', client_id: 'cli-picked' }),
    );

    await credentialsCommand({});

    expect(appService.pickApp).toHaveBeenCalled();
    expect(appService.resolveAppCredentials).toHaveBeenCalledWith('5');
  });

  it('should accept a UUID app-id', async () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    (appService.resolveAppCredentials as jest.Mock).mockResolvedValue(mockApp({ app_id: uuid }));

    await credentialsCommand({ appId: uuid });

    expect(appService.resolveAppCredentials).toHaveBeenCalledWith(uuid);
  });

  it('should show (none) when no redirect URLs exist', async () => {
    (appService.resolveAppCredentials as jest.Mock).mockResolvedValue(
      mockApp({ redirect_uris: [] }),
    );

    await credentialsCommand({ appId: '1' });

    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('(none)');
  });

  it('should warn and prompt to update when local credentials differ', async () => {
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });

    (appService.resolveAppCredentials as jest.Mock).mockResolvedValue({
      app: {
        app_id: '1',
        client_id: 'cli-123',
        client_secret: 'secret-456',
        redirect_uris: ['http://new-url.com'],
      },
      diffs: ['redirect_uris'],
    });
    mockPrompt.mockResolvedValueOnce({ shouldUpdate: true });

    await credentialsCommand({ appId: '1' });

    const allOutput = [
      ...stdoutSpy.mock.calls.map((c: [string]) => c[0]),
      ...stderrSpy.mock.calls.map((c: [string]) => c[0]),
    ].join('');
    expect(allOutput).toContain('differ from server');
    expect(appService.syncAppCredentials).toHaveBeenCalled();

    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
  });
});
