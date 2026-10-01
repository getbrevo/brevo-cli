import { tokenCommand } from '../../../commands/app/token';
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

jest.mock('../../../container', () => ({
  appService: {
    fetchAppsList: jest.fn(),
    fetchApp: jest.fn(),
    mintAppToken: jest.fn(),
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
const mockFetchApp = appService.fetchApp as jest.Mock;
const mockMintAppToken = appService.mintAppToken as jest.Mock;
const mockFetchAppsList = appService.fetchAppsList as jest.Mock;

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

const TOKEN = {
  accessToken: 'token-abc',
  tokenType: 'Bearer',
  expiresIn: 3600,
};

describe('app/token', () => {
  let stdoutSpy: jest.SpyInstance;
  const originalIsTTY = process.stdin.isTTY;

  function withTTY(value: boolean): void {
    Object.defineProperty(process.stdin, 'isTTY', { value, configurable: true });
  }

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    jest.clearAllMocks();
    mockFetchApp.mockResolvedValue(M2M_APP);
    mockMintAppToken.mockResolvedValue(TOKEN);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
  });

  it('mints a token for the app given via --app-id, human output', async () => {
    await tokenCommand({ appId: 'app-1' });

    expect(mockMintAppToken).toHaveBeenCalledWith('app-1', undefined);
    const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toContain('token-abc');
    expect(output).toContain('Bearer');
  });

  it('outputs a single parseable JSON document on success', async () => {
    await tokenCommand({ appId: 'app-1', json: true });

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(String(stdoutSpy.mock.calls[0][0]));
    expect(parsed.accessToken).toBe('token-abc');
    expect(parsed.expiresIn).toBe(3600);
    expect(parsed.appId).toBe('app-1');
  });

  it('passes a parsed --scope list through to the service', async () => {
    await tokenCommand({ appId: 'app-1', scope: 'contacts:read,crm:read' });

    expect(mockMintAppToken).toHaveBeenCalledWith('app-1', ['contacts:read', 'crm:read']);
  });

  it('rejects an invalid --scope list before calling the service', async () => {
    await expect(tokenCommand({ appId: 'app-1', scope: '' })).rejects.toThrow();

    expect(mockMintAppToken).not.toHaveBeenCalled();
  });

  it('refuses the app picker under --json', async () => {
    withTTY(true);

    await expect(tokenCommand({ json: true })).rejects.toThrow(/--app-id/);

    expect(mockFetchAppsList).not.toHaveBeenCalled();
  });

  it('prompts the app picker, filtered to M2M apps only, when --app-id is omitted', async () => {
    withTTY(true);
    mockFetchAppsList.mockResolvedValue([OAUTH_APP, M2M_APP]);
    mockPrompt.mockResolvedValueOnce({ selectedApp: 'app-1' });

    await tokenCommand({});

    expect(mockFetchAppsList).toHaveBeenCalled();
    expect(mockMintAppToken).toHaveBeenCalledWith('app-1', undefined);
  });

  it('refuses a non-M2M target app before minting', async () => {
    mockFetchApp.mockResolvedValue(OAUTH_APP);

    await expect(tokenCommand({ appId: 'app-2' })).rejects.toThrow(
      messages.APP_TOKEN_NOT_M2M('app-2'),
    );

    expect(mockMintAppToken).not.toHaveBeenCalled();
  });

  it('propagates a not-found error from the app read', async () => {
    mockFetchApp.mockRejectedValue(new Error('App app-1 not found.'));

    await expect(tokenCommand({ appId: 'app-1' })).rejects.toThrow('App app-1 not found.');

    expect(mockMintAppToken).not.toHaveBeenCalled();
  });

  it('maps a scope_not_granted apiCode to a friendlier error', async () => {
    mockMintAppToken.mockRejectedValue(
      new ApiError('forbidden', 403, undefined, 'scope_not_granted'),
    );

    await expect(tokenCommand({ appId: 'app-1', scope: 'crm:write' })).rejects.toThrow(
      messages.APP_TOKEN_SCOPE_NOT_GRANTED('app-1'),
    );
  });

  it('maps a plain 401 to an unauthorized error', async () => {
    mockMintAppToken.mockRejectedValue(new ApiError('unauthorized', 401));

    await expect(tokenCommand({ appId: 'app-1' })).rejects.toThrow(
      messages.APP_TOKEN_UNAUTHORIZED('app-1'),
    );
  });

  it('propagates an unmatched ApiError unchanged', async () => {
    mockMintAppToken.mockRejectedValue(new ApiError('server exploded', 500));

    await expect(tokenCommand({ appId: 'app-1' })).rejects.toThrow('server exploded');
  });
});
