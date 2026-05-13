import { loginCommand } from '../../commands/login';
import { ApiError } from '../../lib/errors';

jest.mock('inquirer', () => ({
  prompt: jest.fn(),
}));

jest.mock('../../lib/config', () => ({
  getApiKey: jest.fn().mockReturnValue('test-key'),
  saveCredentials: jest.fn(),
  saveOauthCredentials: jest.fn(),
  clearCredentials: jest.fn(),
  getCredentialsPath: jest.fn().mockReturnValue('/home/user/.brevo/credentials.json'),
  getOrganizationId: jest.fn().mockReturnValue(undefined),
  clearAppsCache: jest.fn(),
}));

jest.mock('../../services/browser-auth', () => ({
  runBrowserLoginFlow: jest.fn(),
}));

jest.mock('../../container', () => ({
  accountService: {
    validateApiKey: jest.fn(),
    getAccount: jest.fn(),
  },
  appService: {
    fetchAppsList: jest.fn().mockResolvedValue([]),
    fetchApp: jest.fn(),
    pickApp: jest.fn(),
    createApp: jest.fn(),
    updateApp: jest.fn(),
    deleteApp: jest.fn(),
  },
  client: {
    getWithBearer: jest.fn(),
  },
}));

jest.mock('../../commands/app/create', () => ({
  createCommand: jest.fn(),
}));

jest.mock('../../lib/skill-notifier', () => ({
  offerSkillInstall: jest.fn().mockResolvedValue(undefined),
}));

import inquirer from 'inquirer';
import { saveCredentials } from '../../lib/config';
import { accountService, appService } from '../../container';

const mockPrompt = inquirer.prompt as unknown as jest.Mock;

describe('loginCommand', () => {
  let stdoutSpy: jest.SpyInstance;
  const originalEnvKey = process.env.BREVO_API_KEY;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    jest.clearAllMocks();
    delete process.env.BREVO_API_KEY;
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    if (originalEnvKey === undefined) delete process.env.BREVO_API_KEY;
    else process.env.BREVO_API_KEY = originalEnvKey;
  });

  it('should login with API key from BREVO_API_KEY env var', async () => {
    process.env.BREVO_API_KEY = 'valid-key';
    (accountService.validateApiKey as jest.Mock).mockResolvedValue({
      email: 'test@brevo.com',
      organization_id: 'org-456',
      user_id: 2002,
    });
    (appService.fetchAppsList as jest.Mock).mockResolvedValue([]);

    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    mockPrompt.mockResolvedValueOnce({ shouldCreate: false });

    await loginCommand({});

    expect(accountService.validateApiKey).toHaveBeenCalledWith('valid-key');
    expect(saveCredentials).toHaveBeenCalledWith('valid-key', {
      email: 'test@brevo.com',
      organizationId: 'org-456',
      userId: 2002,
    });

    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
  });

  it('should skip next steps when suppressNextSteps is true', async () => {
    process.env.BREVO_API_KEY = 'valid-key';
    (accountService.validateApiKey as jest.Mock).mockResolvedValue({
      email: 'test@brevo.com',
      organization_id: 'org-456',
      user_id: 2002,
    });

    await loginCommand({ suppressNextSteps: true });

    expect(saveCredentials).toHaveBeenCalled();
    expect(appService.fetchAppsList).not.toHaveBeenCalled();
  });

  it('should handle invalid API key and retry', async () => {
    process.env.BREVO_API_KEY = 'bad-key';
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });

    (accountService.validateApiKey as jest.Mock)
      .mockRejectedValueOnce(new ApiError('Unauthorized', 401))
      .mockResolvedValueOnce({
        email: 'test@brevo.com',
        organization_id: 'org-456',
        user_id: 2002,
      });

    mockPrompt
      .mockResolvedValueOnce({ key: 'new-valid-key' })
      .mockResolvedValueOnce({ shouldCreate: false });

    (appService.fetchAppsList as jest.Mock).mockResolvedValue([]);

    await loginCommand({});

    expect(accountService.validateApiKey).toHaveBeenCalledTimes(2);
    expect(saveCredentials).toHaveBeenCalledWith('new-valid-key', {
      email: 'test@brevo.com',
      organizationId: 'org-456',
      userId: 2002,
    });

    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
  });

  it('shows the same friendly error when retry key is also invalid', async () => {
    process.env.BREVO_API_KEY = 'bad-key';
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });

    // Both attempts return raw 401 from the API ("Key not found").
    (accountService.validateApiKey as jest.Mock)
      .mockRejectedValueOnce(new ApiError('Key not found', 401))
      .mockRejectedValueOnce(new ApiError('Key not found', 401));

    mockPrompt.mockResolvedValueOnce({ key: 'still-bad-key' });

    await expect(loginCommand({ suppressNextSteps: true })).rejects.toThrow(
      'Invalid API key. Please check and try again.',
    );

    expect(accountService.validateApiKey).toHaveBeenCalledTimes(2);
    expect(saveCredentials).not.toHaveBeenCalled();

    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
  });

  it('should throw in non-TTY when no api-key is provided', async () => {
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });

    await expect(loginCommand({})).rejects.toThrow(/interactive terminal/i);

    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
  });

  it('should show "What\'s next?" box when apps already exist', async () => {
    process.env.BREVO_API_KEY = 'valid-key';
    (accountService.validateApiKey as jest.Mock).mockResolvedValue({
      email: 'test@brevo.com',
      organization_id: 'org-456',
      user_id: 2002,
    });
    (appService.fetchAppsList as jest.Mock).mockResolvedValue([
      { app_id: 1, client_id: 'cli-123' },
    ]);

    await loginCommand({});

    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('next');
  });

  it('should throw on non-interactive when invalid key', async () => {
    process.env.BREVO_API_KEY = 'bad-key';
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });

    (accountService.validateApiKey as jest.Mock).mockRejectedValue(
      new ApiError('Unauthorized', 401),
    );

    await expect(loginCommand({})).rejects.toThrow();

    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
  });

  it('runs the browser flow with --browser and persists OAuth creds', async () => {
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });

    const { runBrowserLoginFlow } = require('../../services/browser-auth');
    (runBrowserLoginFlow as jest.Mock).mockResolvedValue({
      accessToken: 'at-1',
      refreshToken: 'rt-1',
      expiresIn: 3600,
      tokenType: 'Bearer',
      scope: 'all',
    });

    const { client } = require('../../container');
    (client.getWithBearer as jest.Mock).mockResolvedValue({
      email: 'oauth@brevo.com',
      organization_id: 'org-O',
      user_id: 3003,
      companyName: 'Acme',
    });

    (appService.fetchAppsList as jest.Mock).mockResolvedValue([]);
    mockPrompt.mockResolvedValueOnce({ shouldCreate: false });

    await loginCommand({ browser: true });

    expect(runBrowserLoginFlow).toHaveBeenCalled();
    const { saveOauthCredentials, clearCredentials } = require('../../lib/config');
    // Tokens persisted before /v3/account validation so transient failures
    // don't force a re-OAuth.
    expect(saveOauthCredentials).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ accessToken: 'at-1', refreshToken: 'rt-1' }),
    );
    // Then account info attached after a successful validation.
    expect(saveOauthCredentials).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ accessToken: 'at-1', refreshToken: 'rt-1' }),
      { email: 'oauth@brevo.com', organizationId: 'org-O', userId: 3003 },
    );
    expect(clearCredentials).not.toHaveBeenCalled();

    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
  });

  it('clears OAuth credentials when /v3/account returns 401 after browser flow', async () => {
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });

    const { runBrowserLoginFlow } = require('../../services/browser-auth');
    (runBrowserLoginFlow as jest.Mock).mockResolvedValue({
      accessToken: 'at-bad',
      refreshToken: 'rt-bad',
      expiresIn: 3600,
      tokenType: 'Bearer',
    });

    const { client } = require('../../container');
    (client.getWithBearer as jest.Mock).mockRejectedValue(new ApiError('Unauthorized', 401));

    await expect(loginCommand({ browser: true })).rejects.toThrow();

    const { saveOauthCredentials, clearCredentials } = require('../../lib/config');
    // Tokens were saved up-front…
    expect(saveOauthCredentials).toHaveBeenCalledTimes(1);
    expect(saveOauthCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'at-bad' }),
    );
    // …and rolled back because 401 means the token itself is bad.
    expect(clearCredentials).toHaveBeenCalledTimes(1);

    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
  });

  it('keeps OAuth tokens when /v3/account returns a non-401 error after browser flow', async () => {
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });

    const { runBrowserLoginFlow } = require('../../services/browser-auth');
    (runBrowserLoginFlow as jest.Mock).mockResolvedValue({
      accessToken: 'at-ok',
      refreshToken: 'rt-ok',
      expiresIn: 3600,
      tokenType: 'Bearer',
    });

    const { client } = require('../../container');
    // 424 missing_plan_data — token is fine, account state is incomplete.
    (client.getWithBearer as jest.Mock).mockRejectedValue(new ApiError('missing_plan_data', 424));

    await expect(loginCommand({ browser: true })).rejects.toThrow();

    const { saveOauthCredentials, clearCredentials } = require('../../lib/config');
    expect(saveOauthCredentials).toHaveBeenCalledTimes(1);
    expect(saveOauthCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'at-ok' }),
    );
    expect(clearCredentials).not.toHaveBeenCalled();

    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
  });

  it('--browser wins over BREVO_API_KEY env var', async () => {
    process.env.BREVO_API_KEY = 'should-be-ignored';
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });

    const { runBrowserLoginFlow } = require('../../services/browser-auth');
    (runBrowserLoginFlow as jest.Mock).mockResolvedValue({
      accessToken: 'at-b',
      refreshToken: 'rt-b',
      expiresIn: 3600,
      tokenType: 'Bearer',
    });

    const { client } = require('../../container');
    (client.getWithBearer as jest.Mock).mockResolvedValue({
      email: 'oauth@brevo.com',
      organization_id: 'org-O',
      user_id: 3003,
      companyName: 'Acme',
    });
    (appService.fetchAppsList as jest.Mock).mockResolvedValue([]);
    mockPrompt.mockResolvedValueOnce({ shouldCreate: false });

    await loginCommand({ browser: true });

    expect(runBrowserLoginFlow).toHaveBeenCalled();
    expect(accountService.validateApiKey).not.toHaveBeenCalled();

    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
  });

  it('--browser in non-TTY rejects fast instead of hanging', async () => {
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });

    const { runBrowserLoginFlow } = require('../../services/browser-auth');
    (runBrowserLoginFlow as jest.Mock).mockClear();

    await expect(loginCommand({ browser: true })).rejects.toThrow(/interactive terminal/i);
    expect(runBrowserLoginFlow).not.toHaveBeenCalled();

    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
  });

  it('--json mode emits only JSON to stdout (api-key path)', async () => {
    process.env.BREVO_API_KEY = 'valid-key';
    (accountService.validateApiKey as jest.Mock).mockResolvedValue({
      email: 'test@brevo.com',
      organization_id: 'org-456',
      user_id: 2002,
      companyName: 'Acme',
    });

    await loginCommand({ json: true, suppressNextSteps: true });

    const stdoutText = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    // The welcome banner, AUTH_HINT, AUTH_SUCCESS, AUTH_SAVED must not appear.
    expect(stdoutText).not.toContain('Welcome to Brevo CLI');
    expect(stdoutText).not.toContain('──────');
    expect(stdoutText).not.toContain('Authenticated as');
    expect(stdoutText).not.toContain('Credentials saved to');
    // The only stdout writes should be the JSON payload.
    const trimmed = stdoutText.trim();
    expect(() => JSON.parse(trimmed)).not.toThrow();
    expect(JSON.parse(trimmed)).toMatchObject({
      authenticated: true,
      email: 'test@brevo.com',
    });
  });

  it('wipes apps cache on api-key login when organization changes', async () => {
    process.env.BREVO_API_KEY = 'new-key';
    const { getOrganizationId, clearAppsCache } = require('../../lib/config');
    (getOrganizationId as jest.Mock).mockReturnValue('org-OLD');
    (accountService.validateApiKey as jest.Mock).mockResolvedValue({
      email: 'new@brevo.com',
      organization_id: 'org-NEW',
      user_id: 999,
    });

    await loginCommand({ suppressNextSteps: true });

    expect(clearAppsCache).toHaveBeenCalledTimes(1);
  });

  it('preserves apps cache on api-key login when organization is unchanged', async () => {
    process.env.BREVO_API_KEY = 'same-key';
    const { getOrganizationId, clearAppsCache } = require('../../lib/config');
    (getOrganizationId as jest.Mock).mockReturnValue('org-SAME');
    (accountService.validateApiKey as jest.Mock).mockResolvedValue({
      email: 'same@brevo.com',
      organization_id: 'org-SAME',
      user_id: 1,
    });

    await loginCommand({ suppressNextSteps: true });

    expect(clearAppsCache).not.toHaveBeenCalled();
  });

  it('preserves apps cache on first-ever login (no previous account)', async () => {
    process.env.BREVO_API_KEY = 'first-key';
    const { getOrganizationId, clearAppsCache } = require('../../lib/config');
    (getOrganizationId as jest.Mock).mockReturnValue(undefined);
    (accountService.validateApiKey as jest.Mock).mockResolvedValue({
      email: 'first@brevo.com',
      organization_id: 'org-FIRST',
      user_id: 1,
    });

    await loginCommand({ suppressNextSteps: true });

    expect(clearAppsCache).not.toHaveBeenCalled();
  });

  it('wipes apps cache on browser login when organization changes', async () => {
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });

    const { runBrowserLoginFlow } = require('../../services/browser-auth');
    (runBrowserLoginFlow as jest.Mock).mockResolvedValue({
      accessToken: 'at-1',
      refreshToken: 'rt-1',
      expiresIn: 3600,
      tokenType: 'Bearer',
    });

    const { client } = require('../../container');
    (client.getWithBearer as jest.Mock).mockResolvedValue({
      email: 'oauth@brevo.com',
      organization_id: 'org-NEW',
      user_id: 3003,
      companyName: 'Acme',
    });

    const { getOrganizationId, clearAppsCache } = require('../../lib/config');
    (getOrganizationId as jest.Mock).mockReturnValue('org-OLD');

    await loginCommand({ browser: true, suppressNextSteps: true });

    expect(clearAppsCache).toHaveBeenCalledTimes(1);

    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
  });

  it('--json mode emits only JSON to stdout (browser path)', async () => {
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });

    const { runBrowserLoginFlow } = require('../../services/browser-auth');
    (runBrowserLoginFlow as jest.Mock).mockImplementation(async (opts: any) => {
      // Simulate the proxy emitting the loopback URL — even this onWaiting
      // callback must stay silent in --json mode.
      opts.onWaiting?.('https://proxy.example.com/login?port=12345');
      return {
        accessToken: 'at-json',
        refreshToken: 'rt-json',
        expiresIn: 3600,
        tokenType: 'Bearer',
      };
    });

    const { client } = require('../../container');
    (client.getWithBearer as jest.Mock).mockResolvedValue({
      email: 'oauth@brevo.com',
      organization_id: 'org-O',
      user_id: 3003,
      companyName: 'Acme',
    });

    await loginCommand({ browser: true, json: true, suppressNextSteps: true });

    const stdoutText = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(stdoutText).not.toContain('Welcome to Brevo CLI');
    expect(stdoutText).not.toContain('Opening your browser');
    expect(stdoutText).not.toContain('Login received');
    expect(stdoutText).not.toContain('Waiting for login');
    expect(stdoutText).not.toContain('proxy.example.com'); // fallback URL must not leak
    const trimmed = stdoutText.trim();
    expect(() => JSON.parse(trimmed)).not.toThrow();
    expect(JSON.parse(trimmed)).toMatchObject({
      authenticated: true,
      email: 'oauth@brevo.com',
    });

    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
  });
});
