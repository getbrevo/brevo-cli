import { secretRotateCommand } from '../../../commands/app/secret-rotate';
import { messages } from '../../../lang/en';
import { ApiError } from '../../../lib/errors';

jest.mock('inquirer', () => ({
  prompt: jest.fn(),
  registerPrompt: jest.fn(),
  Separator: class {
    type = 'separator';
    line: string;
    constructor(line: string) {
      this.line = line;
    }
  },
}));

jest.mock('../../../lib/config', () => ({
  saveAppCredentials: jest.fn(),
}));

jest.mock('../../../container', () => ({
  appService: {
    fetchAppsList: jest.fn(),
    fetchApp: jest.fn(),
    rotateAppSecret: jest.fn(),
  },
  accountService: {
    validateApiKey: jest.fn(),
    getAccount: jest.fn(),
  },
  client: {},
}));

import inquirer from 'inquirer';
import { appService } from '../../../container';
import { saveAppCredentials } from '../../../lib/config';

const mockPrompt = inquirer.prompt as unknown as jest.Mock;
const mockFetchApp = appService.fetchApp as jest.Mock;
const mockRotateAppSecret = appService.rotateAppSecret as jest.Mock;
const mockFetchAppsList = appService.fetchAppsList as jest.Mock;
const mockSaveAppCredentials = saveAppCredentials as jest.Mock;

const M2M_APP = {
  app_id: 'app-1',
  name: 'My M2M App',
  client_id: 'client-1',
  redirect_uris: null,
  scopes: ['contacts:read', 'crm:read'],
};

const OAUTH_APP = {
  app_id: 'app-2',
  name: 'My OAuth App',
  client_id: 'client-2',
  redirect_uris: ['https://example.com/callback'],
  scopes: ['contacts:read'],
};

const ROTATED = {
  clientId: 'client-1',
  clientSecret: 'new-secret-abc',
};

describe('app/secret-rotate', () => {
  let stdoutSpy: jest.SpyInstance;
  const originalIsTTY = process.stdin.isTTY;

  function withTTY(value: boolean): void {
    Object.defineProperty(process.stdin, 'isTTY', { value, configurable: true });
  }

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    jest.clearAllMocks();
    mockFetchApp.mockResolvedValue(M2M_APP);
    mockRotateAppSecret.mockResolvedValue(ROTATED);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
  });

  it('rotates the secret for the app given via --app-id, human output, after confirming', async () => {
    mockPrompt.mockResolvedValueOnce({ confirmed: true });

    await secretRotateCommand({ appId: 'app-1' });

    expect(mockRotateAppSecret).toHaveBeenCalledWith('app-1');
    const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toContain('new-secret-abc');
  });

  it('prints the new secret in full — no reveal-gate', async () => {
    mockPrompt.mockResolvedValueOnce({ confirmed: true });

    await secretRotateCommand({ appId: 'app-1' });

    const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).not.toContain('[hidden');
    expect(output).toContain(messages.APP_SECRET_ROTATE_STORE_HINT);
  });

  it('updates the local credentials cache with the new secret', async () => {
    mockPrompt.mockResolvedValueOnce({ confirmed: true });

    await secretRotateCommand({ appId: 'app-1' });

    expect(mockSaveAppCredentials).toHaveBeenCalledWith('app-1', {
      clientId: 'client-1',
      clientSecret: 'new-secret-abc',
    });
  });

  it('--yes skips the confirmation prompt', async () => {
    await secretRotateCommand({ appId: 'app-1', yes: true });

    expect(mockPrompt).not.toHaveBeenCalled();
    expect(mockRotateAppSecret).toHaveBeenCalledWith('app-1');
  });

  it('--json without --yes also skips confirmation, rotating directly', async () => {
    await secretRotateCommand({ appId: 'app-1', json: true });

    expect(mockPrompt).not.toHaveBeenCalled();
    expect(mockRotateAppSecret).toHaveBeenCalledWith('app-1');
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(String(stdoutSpy.mock.calls[0][0]));
    expect(parsed.clientSecret).toBe('new-secret-abc');
    expect(parsed.appId).toBe('app-1');
    expect(parsed.graceUntil).toBeNull();
  });

  it('cancels without calling the API when the user declines', async () => {
    mockPrompt.mockResolvedValueOnce({ confirmed: false });

    await secretRotateCommand({ appId: 'app-1' });

    expect(mockRotateAppSecret).not.toHaveBeenCalled();
    const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toContain('Cancelled');
  });

  it('surfaces a grace window when the backend returns one', async () => {
    mockRotateAppSecret.mockResolvedValue({ ...ROTATED, graceUntil: '2026-09-22T00:00:00Z' });

    await secretRotateCommand({ appId: 'app-1', yes: true });

    const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toContain('2026-09-22T00:00:00Z');
  });

  it('refuses the app picker under --json', async () => {
    withTTY(true);

    await expect(secretRotateCommand({ json: true })).rejects.toThrow(/--app-id/);

    expect(mockFetchAppsList).not.toHaveBeenCalled();
  });

  it('prompts the app picker, filtered to M2M apps only, when --app-id is omitted', async () => {
    withTTY(true);
    mockFetchAppsList.mockResolvedValue([OAUTH_APP, M2M_APP]);
    mockPrompt
      .mockResolvedValueOnce({ selectedApp: 'app-1' }) // app picker
      .mockResolvedValueOnce({ confirmed: true }); // confirm

    await secretRotateCommand({});

    expect(mockFetchAppsList).toHaveBeenCalled();
    expect(mockRotateAppSecret).toHaveBeenCalledWith('app-1');
  });

  it('refuses a non-M2M target app before rotating', async () => {
    mockFetchApp.mockResolvedValue(OAUTH_APP);

    await expect(secretRotateCommand({ appId: 'app-2' })).rejects.toThrow(
      messages.APP_SECRET_ROTATE_NOT_M2M('app-2'),
    );

    expect(mockRotateAppSecret).not.toHaveBeenCalled();
  });

  it('propagates a not-found error from the app read', async () => {
    mockFetchApp.mockRejectedValue(new Error('App app-1 not found.'));

    await expect(secretRotateCommand({ appId: 'app-1' })).rejects.toThrow('App app-1 not found.');

    expect(mockRotateAppSecret).not.toHaveBeenCalled();
  });

  it('maps a plain 401 to an unauthorized error', async () => {
    mockRotateAppSecret.mockRejectedValue(new ApiError('unauthorized', 401));

    await expect(secretRotateCommand({ appId: 'app-1', yes: true })).rejects.toThrow(
      messages.APP_SECRET_ROTATE_UNAUTHORIZED('app-1'),
    );
  });

  it('propagates an unmatched ApiError unchanged', async () => {
    mockRotateAppSecret.mockRejectedValue(new ApiError('server exploded', 500));

    await expect(secretRotateCommand({ appId: 'app-1', yes: true })).rejects.toThrow(
      'server exploded',
    );
  });
});
