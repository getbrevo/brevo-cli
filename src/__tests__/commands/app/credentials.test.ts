import { credentialsCommand } from '../../../commands/app/credentials';

jest.mock('inquirer', () => ({
  prompt: jest.fn(),
}));

jest.mock('../../../lib/config', () => ({
  getApiKey: jest.fn().mockReturnValue('test-key'),
  getAppCredentials: jest.fn(),
  saveAppCredentials: jest.fn(),
  saveAppName: jest.fn(),
  backfillProjectConfigFromServer: jest.fn().mockReturnValue([]),
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
import { backfillProjectConfigFromServer } from '../../../lib/config';

const mockPrompt = inquirer.prompt as unknown as jest.Mock;
const mockBackfill = backfillProjectConfigFromServer as jest.Mock;

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

  function withTTY(value: boolean): void {
    Object.defineProperty(process.stdin, 'isTTY', { value, configurable: true });
  }

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
    // The old key must not appear — credentials JSON has always said redirectUris.
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
    const originalIsTTY = process.stdin.isTTY;
    withTTY(true);
    (appService.pickApp as jest.Mock).mockResolvedValue('5');
    (appService.resolveAppCredentials as jest.Mock).mockResolvedValue(
      mockApp({ app_id: '5', client_id: 'cli-picked' }),
    );

    await credentialsCommand({});

    expect(appService.pickApp).toHaveBeenCalled();
    expect(appService.resolveAppCredentials).toHaveBeenCalledWith('5');
    withTTY(originalIsTTY as boolean);
  });

  // The picker writes its choice list — including app ids and client ids — to
  // stdout, so reaching it under --json corrupts the JSON document, and off a
  // TTY inquirer dies on a raw ERR_USE_AFTER_CLOSE readline stack.
  it('refuses instead of opening the picker under --json', async () => {
    const originalIsTTY = process.stdin.isTTY;
    withTTY(true);

    await expect(credentialsCommand({ json: true })).rejects.toThrow(/--app-id/);

    expect(appService.pickApp).not.toHaveBeenCalled();
    expect(appService.resolveAppCredentials).not.toHaveBeenCalled();
    withTTY(originalIsTTY as boolean);
  });

  it('refuses instead of opening the picker off a TTY', async () => {
    const originalIsTTY = process.stdin.isTTY;
    withTTY(false);

    await expect(credentialsCommand({})).rejects.toThrow(/--app-id/);

    expect(appService.pickApp).not.toHaveBeenCalled();
    expect(appService.resolveAppCredentials).not.toHaveBeenCalled();
    withTTY(originalIsTTY as boolean);
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

  it('backfills a missing version/distribution_type into the local app-config.json', async () => {
    (appService.resolveAppCredentials as jest.Mock).mockResolvedValue(
      mockApp({ version: '1.4.0', distribution_type: 'public' }),
    );
    mockBackfill.mockReturnValueOnce(['version', 'distribution_type']);

    await credentialsCommand({ appId: '1' });

    expect(mockBackfill).toHaveBeenCalledWith('1', {
      version: '1.4.0',
      distribution_type: 'public',
    });
    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('app-config.json');
  });

  it('prints no backfill note when nothing was missing', async () => {
    (appService.resolveAppCredentials as jest.Mock).mockResolvedValue(mockApp());
    mockBackfill.mockReturnValueOnce([]);

    await credentialsCommand({ appId: '1' });

    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).not.toContain('app-config.json');
  });

  it('keeps --json output clean even when a backfill occurs', async () => {
    (appService.resolveAppCredentials as jest.Mock).mockResolvedValue(
      mockApp({ version: '1.4.0', distribution_type: 'public' }),
    );
    mockBackfill.mockReturnValueOnce(['version', 'distribution_type']);

    await credentialsCommand({ appId: '1', json: true });

    // Backfill still runs (writes the file), but the JSON payload is the only
    // thing on stdout and remains parseable.
    expect(mockBackfill).toHaveBeenCalledWith('1', {
      version: '1.4.0',
      distribution_type: 'public',
    });
    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(() => JSON.parse(output)).not.toThrow();
    expect(output).not.toContain('Backfilled');
  });

  // A UI app has no OAuth material, so there are no credentials to show. Without
  // this gate the command printed an empty credential form — blank client ID,
  // "(none)" scopes and URLs — which reads as "your app lost its credentials",
  // and cached the emptiness locally. Routed through the capability matrix
  // ('oauth-flow'), whose header has named `app credentials` as OAuth-only since
  // it was written.
  describe('on a UI app', () => {
    function mockUiApp(overrides = {}) {
      return {
        app: {
          app_id: 'ui-1',
          client_id: '',
          redirect_uris: null,
          distribution_type: 'private',
          ui_app: { extension_type: 'actionLink', surface_point_list: [] },
          ...overrides,
        },
        diffs: [],
      };
    }

    it('refuses instead of printing an empty credential form', async () => {
      (appService.resolveAppCredentials as jest.Mock).mockResolvedValue(mockUiApp());

      await expect(credentialsCommand({ appId: 'ui-1' })).rejects.toThrow(
        /UI apps have no OAuth credentials/i,
      );
      expect(appService.syncAppCredentials).not.toHaveBeenCalled();
      expect(mockBackfill).not.toHaveBeenCalled();
      expect(mockPrompt).not.toHaveBeenCalled();
    });

    it('refuses under --json instead of emitting a blank credential document', async () => {
      (appService.resolveAppCredentials as jest.Mock).mockResolvedValue(mockUiApp());

      await expect(credentialsCommand({ appId: 'ui-1', json: true })).rejects.toThrow(
        /UI apps have no OAuth credentials/i,
      );
      const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
      expect(output).not.toContain('clientId');
    });

    // The record classifier calls a record with no OAuth material a UI app even
    // when the response omits the ui_app block — same bias as install's gate,
    // and right here for the same reason: there is nothing to print either way.
    it('refuses a record with no OAuth material and no ui_app block', async () => {
      (appService.resolveAppCredentials as jest.Mock).mockResolvedValue({
        app: { app_id: 'ui-2', client_id: '', redirect_uris: null },
        diffs: [],
      });

      await expect(credentialsCommand({ appId: 'ui-2' })).rejects.toThrow(
        /UI apps have no OAuth credentials/i,
      );
    });
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
