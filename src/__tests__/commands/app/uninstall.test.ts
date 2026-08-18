jest.mock('inquirer', () => ({ prompt: jest.fn() }));

jest.mock('../../../container', () => ({
  appService: {
    uninstallApp: jest.fn(),
    fetchAppsList: jest.fn(),
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
});
