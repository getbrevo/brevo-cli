import { updateScopesCommand } from '../../../commands/app/scopes-update';
import { messages } from '../../../lang/en';

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
    updateAppScopes: jest.fn(),
  },
  accountService: {
    validateApiKey: jest.fn(),
    getAccount: jest.fn(),
  },
  client: {},
}));

// The M2M scope picker reads the IdP catalog live — only the network call is mocked,
// same as create.test.ts.
jest.mock('../../../services/oauth-metadata', () => ({
  ...jest.requireActual('../../../services/oauth-metadata'),
  fetchSupportedScopes: jest.fn(),
}));

import inquirer from 'inquirer';
import { appService } from '../../../container';
import { fetchSupportedScopes } from '../../../services/oauth-metadata';

const mockPrompt = inquirer.prompt as unknown as jest.Mock;
const mockFetchApp = appService.fetchApp as jest.Mock;
const mockUpdateAppScopes = appService.updateAppScopes as jest.Mock;
const mockFetchAppsList = appService.fetchAppsList as jest.Mock;
const mockFetchSupportedScopes = fetchSupportedScopes as jest.Mock;

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

describe('app/scopes-update', () => {
  let stdoutSpy: jest.SpyInstance;
  const originalIsTTY = process.stdin.isTTY;

  function withTTY(value: boolean): void {
    Object.defineProperty(process.stdin, 'isTTY', { value, configurable: true });
  }

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    jest.clearAllMocks();
    mockFetchApp.mockResolvedValue(M2M_APP);
    mockUpdateAppScopes.mockResolvedValue({ ...M2M_APP, scopes: ['contacts:read', 'crm:write'] });
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
  });

  it('sends the full --scopes list as a plain replace (no mode field)', async () => {
    mockPrompt.mockResolvedValueOnce({ confirmed: true });

    await updateScopesCommand({ appId: 'app-1', scopes: 'contacts:read,crm:write' });

    expect(mockUpdateAppScopes).toHaveBeenCalledWith('app-1', ['contacts:read', 'crm:write']);
    const [, , thirdArg] = mockUpdateAppScopes.mock.calls[0];
    expect(thirdArg).toBeUndefined();
  });

  it('surfaces a scope dropped from --scopes as a removal in the confirmation diff', async () => {
    mockPrompt.mockResolvedValueOnce({ confirmed: true });

    await updateScopesCommand({ appId: 'app-1', scopes: 'contacts:read' });

    expect(mockUpdateAppScopes).toHaveBeenCalledWith('app-1', ['contacts:read']);
    const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toContain('REMOVE');
    expect(output).toContain('crm:read');
  });

  it('--yes skips the confirmation prompt', async () => {
    await updateScopesCommand({ appId: 'app-1', scopes: 'contacts:read,crm:write', yes: true });

    expect(mockPrompt).not.toHaveBeenCalled();
    expect(mockUpdateAppScopes).toHaveBeenCalledWith('app-1', ['contacts:read', 'crm:write']);
  });

  it('is a no-op when the submitted set equals the current set', async () => {
    await updateScopesCommand({ appId: 'app-1', scopes: 'contacts:read,crm:read' });

    expect(mockUpdateAppScopes).not.toHaveBeenCalled();
    const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toContain('No change');
  });

  it('cancels without calling the API when the user declines', async () => {
    mockPrompt.mockResolvedValueOnce({ confirmed: false });

    await updateScopesCommand({ appId: 'app-1', scopes: 'contacts:read,crm:write' });

    expect(mockUpdateAppScopes).not.toHaveBeenCalled();
    const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toContain('Cancelled');
  });

  it('refuses the app picker under --json', async () => {
    withTTY(true);

    await expect(updateScopesCommand({ scopes: 'crm:write', json: true })).rejects.toThrow(
      /--app-id/,
    );

    expect(mockFetchAppsList).not.toHaveBeenCalled();
  });

  it('prompts the app picker, filtered to M2M apps only, when --app-id is omitted', async () => {
    withTTY(true);
    mockFetchAppsList.mockResolvedValue([OAUTH_APP, M2M_APP]);
    mockPrompt
      .mockResolvedValueOnce({ selectedApp: 'app-1' }) // app picker
      .mockResolvedValueOnce({ confirmed: true }); // confirm

    await updateScopesCommand({ scopes: 'contacts:read,crm:write' });

    expect(mockFetchAppsList).toHaveBeenCalled();
    expect(mockUpdateAppScopes).toHaveBeenCalledWith('app-1', ['contacts:read', 'crm:write']);
  });

  it('refuses a non-M2M target app before any scope prompt or network call', async () => {
    mockFetchApp.mockResolvedValue(OAUTH_APP);

    await expect(updateScopesCommand({ appId: 'app-2', scopes: 'crm:write' })).rejects.toThrow(
      messages.APP_SCOPES_UPDATE_NOT_M2M('app-2'),
    );

    expect(mockUpdateAppScopes).not.toHaveBeenCalled();
  });

  it('opens the interactive picker pre-selected with the current scopes when --scopes is omitted', async () => {
    withTTY(true);
    mockFetchSupportedScopes.mockResolvedValue([
      { name: 'contacts:read', category: 'contacts', apiEndpoints: [] },
      { name: 'crm:read', category: 'crm', apiEndpoints: [] },
      { name: 'crm:write', category: 'crm', apiEndpoints: [] },
    ]);
    mockPrompt
      .mockResolvedValueOnce({ scopes: ['contacts:read', 'crm:write'] }) // picker answer
      .mockResolvedValueOnce({ confirmed: true }); // confirm

    await updateScopesCommand({ appId: 'app-1' });

    // Every scope choice for a currently-granted scope is pre-checked.
    const pickerCall = mockPrompt.mock.calls[0][0][0];
    const checkedNames = pickerCall.choices
      .filter((c: { value?: unknown; checked?: boolean }) => typeof c.value === 'string')
      .filter((c: { checked?: boolean }) => c.checked)
      .map((c: { value: string }) => c.value);
    expect(checkedNames.sort()).toEqual(['contacts:read', 'crm:read']);

    expect(mockUpdateAppScopes).toHaveBeenCalledWith('app-1', ['contacts:read', 'crm:write']);
  });

  it('falls back to the typed prompt, pre-filled with current scopes, when the catalog is unreadable', async () => {
    withTTY(true);
    mockFetchSupportedScopes.mockRejectedValue(new Error('network down'));
    mockPrompt
      .mockResolvedValueOnce({ scopesRaw: 'contacts:read,crm:write' }) // typed fallback answer
      .mockResolvedValueOnce({ confirmed: true }); // confirm

    await updateScopesCommand({ appId: 'app-1' });

    const typedCall = mockPrompt.mock.calls[0][0][0];
    expect(typedCall.default).toBe('contacts:read,crm:read');
    expect(mockUpdateAppScopes).toHaveBeenCalledWith('app-1', ['contacts:read', 'crm:write']);
  });

  it('outputs a single parseable JSON document on success', async () => {
    await updateScopesCommand({
      appId: 'app-1',
      scopes: 'contacts:read,crm:write',
      yes: true,
      json: true,
    });

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(String(stdoutSpy.mock.calls[0][0]));
    expect(parsed.changed).toBe(true);
    expect(parsed.mode).toBeUndefined();
  });

  it('outputs JSON for the no-op case too', async () => {
    await updateScopesCommand({ appId: 'app-1', scopes: 'contacts:read,crm:read', json: true });

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(String(stdoutSpy.mock.calls[0][0]));
    expect(parsed.changed).toBe(false);
  });

  it('propagates a not-found error from the app read', async () => {
    mockFetchApp.mockRejectedValue(new Error('App app-1 not found.'));

    await expect(updateScopesCommand({ appId: 'app-1', scopes: 'crm:write' })).rejects.toThrow(
      'App app-1 not found.',
    );

    expect(mockUpdateAppScopes).not.toHaveBeenCalled();
  });
});
