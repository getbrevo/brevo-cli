jest.mock('inquirer', () => ({ prompt: jest.fn() }));

jest.mock('../../../container', () => ({
  appService: {
    rollbackApp: jest.fn(),
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
import { rollbackCommand } from '../../../commands/app/rollback';
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

describe('app/rollback', () => {
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
    // See the note in deploy.test.ts — implementations survive clearAllMocks().
    (appService.rollbackApp as jest.Mock).mockResolvedValue(undefined);
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
    await rollbackCommand({ accountId: '99999', force: true });

    expect(appService.rollbackApp).toHaveBeenCalledWith('42', '99999', 'Invoice Manager');
  });

  // Account resolution is shared with deploy (resolveDeploymentTarget), so the full
  // matrix lives in deploy.test.ts. These two cover that rollback inherits it.
  it('defaults to the caller own account when no account ID is given', async () => {
    await rollbackCommand({ force: true });

    expect(appService.rollbackApp).toHaveBeenCalledWith('42', '12345', 'Invoice Manager');
  });

  it('prompts a corporate account for a sub-account', async () => {
    (accountService.getAccount as jest.Mock).mockResolvedValue({ type: 'corporate' });
    (accountService.fetchSubAccounts as jest.Mock).mockResolvedValue([
      { id: 4043629, companyName: 'Company1', active: true },
    ]);
    mockPrompt.mockResolvedValueOnce({ selectedSubAccount: 4043629 });

    await rollbackCommand({ force: true });

    expect(appService.rollbackApp).toHaveBeenCalledWith('42', '4043629', 'Invoice Manager');
  });

  // Unlike deploy, rollback has no upload gate — an app deployed by an older CLI
  // version must still be rollback-able.
  it('does not require the app to have been uploaded', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue({ ...LINKED_CONFIG, version: '' });

    await rollbackCommand({ accountId: '99999', force: true });

    expect(appService.rollbackApp).toHaveBeenCalledWith('42', '99999', 'Invoice Manager');
  });

  // The uninstall route resolves the install from the request body, so it answers 404
  // for a missing install as well as an unknown app. Both read as "not deployed".
  it('treats "not deployed" (404) as informational, not a failure', async () => {
    (appService.rollbackApp as jest.Mock).mockRejectedValue(
      new ApiError('Installation ID does not exist', 404, undefined),
    );

    await expect(rollbackCommand({ accountId: '99999', force: true })).resolves.toBeUndefined();
    expect(stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('')).toMatch(/is not deployed/i);
  });

  // Deliberate: a 404 naming the app takes the same path. The CLI does not match on
  // the server's error copy, and failing an idempotent teardown is the worse outcome.
  it('treats an unknown-app 404 as not deployed too', async () => {
    (appService.rollbackApp as jest.Mock).mockRejectedValue(
      new ApiError('App ID does not exist', 404, undefined),
    );

    await expect(rollbackCommand({ accountId: '99999', force: true })).resolves.toBeUndefined();
    expect(stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('')).toMatch(/is not deployed/i);
  });

  it('reports NOT_DEPLOYED in JSON mode without failing', async () => {
    (appService.rollbackApp as jest.Mock).mockRejectedValue(
      new ApiError('Installation ID does not exist', 404, undefined),
    );

    await rollbackCommand({ accountId: '99999', json: true });

    const parsed = JSON.parse(stdoutSpy.mock.calls.map((c: [string]) => c[0]).join(''));
    expect(parsed).toMatchObject({
      rolledBack: false,
      reason: 'NOT_DEPLOYED',
      accountId: '99999',
    });
  });

  it('propagates errors other than 404', async () => {
    (appService.rollbackApp as jest.Mock).mockRejectedValue(
      new ApiError('Server error', 500, undefined),
    );

    await expect(rollbackCommand({ accountId: '99999', force: true })).rejects.toThrow(
      /Server error/,
    );
  });

  it('does nothing when the confirmation is declined', async () => {
    mockPrompt.mockResolvedValueOnce({ confirmed: false });

    await rollbackCommand({ accountId: '99999' });

    expect(appService.rollbackApp).not.toHaveBeenCalled();
    expect(stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('')).toMatch(/Rollback cancelled/i);
  });

  it('emits JSON on success', async () => {
    await rollbackCommand({ accountId: '99999', json: true });

    const parsed = JSON.parse(stdoutSpy.mock.calls.map((c: [string]) => c[0]).join(''));
    expect(parsed).toEqual({ rolledBack: true, appId: '42', accountId: '99999' });
  });
});
