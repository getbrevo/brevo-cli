jest.mock('inquirer', () => ({ prompt: jest.fn() }));

jest.mock('../../../container', () => ({
  appService: {
    uninstallApp: jest.fn(),
    fetchAppsList: jest.fn(),
    fetchApp: jest.fn(),
  },
  accountService: {
    getAccount: jest.fn(),
    fetchSubAccounts: jest.fn(),
  },
}));

jest.mock('../../../lib/config', () => ({
  readProjectConfig: jest.fn(),
  getOrganizationId: jest.fn(),
}));

import inquirer from 'inquirer';
import { appUninstallCommand } from '../../../commands/app/uninstall';
import { appService, accountService } from '../../../container';
import { readProjectConfig, getOrganizationId } from '../../../lib/config';
import { ApiError } from '../../../lib/errors';

const mockPrompt = inquirer.prompt as unknown as jest.Mock;

const LINKED_CONFIG = {
  appId: '42',
  appName: 'Invoice Manager',
  distribution_type: 'private' as const,
  version: '1.0.0',
  auth: { scopes: ['contacts:read'] },
  ui_app: { type: 'link' as const },
};

describe('app/uninstall', () => {
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
    // See the note in install.test.ts — implementations survive clearAllMocks().
    (appService.uninstallApp as jest.Mock).mockResolvedValue(undefined);
    (readProjectConfig as jest.Mock).mockReturnValue(LINKED_CONFIG);
    // Default identity: a plain (non-corporate) account whose own ID is 12345.
    (accountService.getAccount as jest.Mock).mockResolvedValue({ type: 'user' });
    (getOrganizationId as jest.Mock).mockReturnValue('12345');
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    if (originalIsTTYDescriptor) {
      Object.defineProperty(process.stdin, 'isTTY', originalIsTTYDescriptor);
    } else {
      Reflect.deleteProperty(process.stdin, 'isTTY');
    }
  });

  it('rolls back the linked app from the given account', async () => {
    await appUninstallCommand({ accountId: '99999', force: true });

    expect(appService.uninstallApp).toHaveBeenCalledWith('42', '99999', 'Invoice Manager');
  });

  // Account resolution is shared with install (resolveInstallTarget), so the full
  // matrix lives in install.test.ts. These two cover that uninstall inherits it.
  it('defaults to the caller own account when no account ID is given', async () => {
    await appUninstallCommand({ force: true });

    expect(appService.uninstallApp).toHaveBeenCalledWith('42', '12345', 'Invoice Manager');
  });

  it('prompts a corporate account for a sub-account', async () => {
    (accountService.getAccount as jest.Mock).mockResolvedValue({ type: 'corporate' });
    (accountService.fetchSubAccounts as jest.Mock).mockResolvedValue([
      { id: 4043629, companyName: 'Company1', active: true },
    ]);
    mockPrompt.mockResolvedValueOnce({ selectedSubAccount: 4043629 });

    await appUninstallCommand({ force: true });

    expect(appService.uninstallApp).toHaveBeenCalledWith('42', '4043629', 'Invoice Manager');
    // The shared picker takes its wording from the command: this one must not ask
    // which account to "install into".
    expect(mockPrompt.mock.calls[0]![0][0].message).toBe('Select the account to uninstall from:');
  });

  // Unlike install, uninstall has no upload gate — an app installed by an older CLI
  // version must still be uninstallable.
  it('does not require the app to have been uploaded', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue({ ...LINKED_CONFIG, version: '' });

    await appUninstallCommand({ accountId: '99999', force: true });

    expect(appService.uninstallApp).toHaveBeenCalledWith('42', '99999', 'Invoice Manager');
  });

  // The uninstall route resolves the install from the request body, so it answers 404
  // for a missing install as well as an unknown app. Both read as "not installed".
  it('treats "not installed" (404) as informational, not a failure', async () => {
    (appService.uninstallApp as jest.Mock).mockRejectedValue(
      new ApiError('Installation ID does not exist', 404, undefined),
    );

    await expect(appUninstallCommand({ accountId: '99999', force: true })).resolves.toBeUndefined();
    expect(stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('')).toMatch(/is not installed/i);
  });

  // Deliberate: a 404 naming the app takes the same path. The CLI does not match on
  // the server's error copy, and failing an idempotent teardown is the worse outcome.
  it('treats an unknown-app 404 as not installed too', async () => {
    (appService.uninstallApp as jest.Mock).mockRejectedValue(
      new ApiError('App ID does not exist', 404, undefined),
    );

    await expect(appUninstallCommand({ accountId: '99999', force: true })).resolves.toBeUndefined();
    expect(stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('')).toMatch(/is not installed/i);
  });

  it('reports NOT_INSTALLED in JSON mode without failing', async () => {
    (appService.uninstallApp as jest.Mock).mockRejectedValue(
      new ApiError('Installation ID does not exist', 404, undefined),
    );

    await appUninstallCommand({ accountId: '99999', json: true });

    const parsed = JSON.parse(stdoutSpy.mock.calls.map((c: [string]) => c[0]).join(''));
    expect(parsed).toMatchObject({
      uninstalled: false,
      reason: 'NOT_INSTALLED',
      accountId: '99999',
    });
  });

  it('propagates errors other than 404', async () => {
    (appService.uninstallApp as jest.Mock).mockRejectedValue(
      new ApiError('Server error', 500, undefined),
    );

    await expect(appUninstallCommand({ accountId: '99999', force: true })).rejects.toThrow(
      /Server error/,
    );
  });

  it('does nothing when the confirmation is declined', async () => {
    mockPrompt.mockResolvedValueOnce({ confirmed: false });

    await appUninstallCommand({ accountId: '99999' });

    expect(appService.uninstallApp).not.toHaveBeenCalled();
    expect(stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('')).toMatch(
      /Uninstall cancelled/i,
    );
  });

  it('emits JSON on success', async () => {
    await appUninstallCommand({ accountId: '99999', json: true });

    const parsed = JSON.parse(stdoutSpy.mock.calls.map((c: [string]) => c[0]).join(''));
    expect(parsed).toEqual({ uninstalled: true, appId: '42', accountId: '99999' });
  });
  // Gated the same way install is: an OAuth app never had an install to remove. The
  // *upload* gate is still deliberately absent — see the test above.
  describe('the app-type gate', () => {
    it('refuses an OAuth app linked in this directory', async () => {
      const { ui_app: _ui, ...oauthConfig } = LINKED_CONFIG;
      (readProjectConfig as jest.Mock).mockReturnValue(oauthConfig);

      await expect(appUninstallCommand({ accountId: '99999', force: true })).rejects.toThrow(
        /nothing to uninstall/i,
      );
      expect(appService.uninstallApp).not.toHaveBeenCalled();
    });

    it('refuses an --app-id app the server answers with a client_id', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue(null);
      (appService.fetchApp as jest.Mock).mockResolvedValue({
        app_id: 'app-1',
        client_id: 'cli-1',
        redirect_uris: ['https://example.com/callback'],
      });

      await expect(
        appUninstallCommand({ accountId: '99999', appId: 'app-1', force: true }),
      ).rejects.toThrow(/nothing to uninstall/i);
      expect(appService.uninstallApp).not.toHaveBeenCalled();
    });

    // No `version` on the record, and it still uninstalls: the type check applies here,
    // the upload check does not.
    it('uninstalls a never-uploaded UI app outside a linked project', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue(null);
      (appService.fetchApp as jest.Mock).mockResolvedValue({ app_id: 'app-1', version: '' });

      await appUninstallCommand({ accountId: '99999', appId: 'app-1', force: true });
      expect(appService.uninstallApp).toHaveBeenCalled();
    });
  });

  describe('how the target account is named', () => {
    const output = () => stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');

    it('leaves an explicit account ID unnamed', async () => {
      await appUninstallCommand({ accountId: '99999', force: true });

      expect(output()).toMatch(/uninstalled from account 99999\./);
    });

    it('names the caller own account', async () => {
      (accountService.getAccount as jest.Mock).mockResolvedValue({
        type: 'user',
        companyName: 'Acme Retail',
      });

      await appUninstallCommand({ force: true });

      expect(output()).toMatch(/uninstalled from Acme Retail \(your own account, ID 12345\)\./);
    });

    // The not-installed path is informational and exits 0 — it names the account too.
    it('names the account when reporting "not installed"', async () => {
      (accountService.getAccount as jest.Mock).mockResolvedValue({
        type: 'user',
        companyName: 'Acme Retail',
      });
      (appService.uninstallApp as jest.Mock).mockRejectedValue(
        new ApiError('Installation ID does not exist', 404, undefined),
      );

      await appUninstallCommand({ force: true });

      expect(output()).toMatch(/not installed in Acme Retail \(your own account, ID 12345\)\./);
    });

    it('adds accountName to --json', async () => {
      (accountService.getAccount as jest.Mock).mockResolvedValue({
        type: 'user',
        companyName: 'Acme Retail',
      });

      await appUninstallCommand({ json: true });

      const parsed = JSON.parse(stdoutSpy.mock.calls.map((c: [string]) => c[0]).join(''));
      expect(parsed).toEqual({
        uninstalled: true,
        appId: '42',
        accountId: '12345',
        accountName: 'Acme Retail',
      });
    });
  });
});
