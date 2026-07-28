jest.mock('inquirer', () => ({ prompt: jest.fn() }));

jest.mock('../../../container', () => ({
  appService: {
    removeApp: jest.fn(),
    fetchAppsList: jest.fn(),
  },
}));

jest.mock('../../../lib/config', () => ({
  readProjectConfig: jest.fn(),
}));

import inquirer from 'inquirer';
import { removeCommand } from '../../../commands/app/remove';
import { appService } from '../../../container';
import { readProjectConfig } from '../../../lib/config';
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

describe('app/remove', () => {
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
    (appService.removeApp as jest.Mock).mockResolvedValue(undefined);
    (readProjectConfig as jest.Mock).mockReturnValue(LINKED_CONFIG);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    if (originalIsTTYDescriptor) {
      Object.defineProperty(process.stdin, 'isTTY', originalIsTTYDescriptor);
    } else {
      Reflect.deleteProperty(process.stdin, 'isTTY');
    }
  });

  it('removes the linked app from the given account', async () => {
    await removeCommand({ accountId: '99999', force: true });

    expect(appService.removeApp).toHaveBeenCalledWith('42', '99999');
  });

  it('errors when the account ID is missing', async () => {
    await expect(removeCommand({ force: true })).rejects.toThrow(/Missing account ID/i);
    expect(appService.removeApp).not.toHaveBeenCalled();
  });

  // Unlike deploy, remove has no upload gate — an app deployed by an older CLI
  // version must still be removable.
  it('does not require the app to have been uploaded', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue({ ...LINKED_CONFIG, version: '' });

    await removeCommand({ accountId: '99999', force: true });

    expect(appService.removeApp).toHaveBeenCalledWith('42', '99999');
  });

  it('treats "not deployed" (422) as informational, not a failure', async () => {
    (appService.removeApp as jest.Mock).mockRejectedValue(
      new ApiError('Unprocessable', 422, undefined),
    );

    await expect(removeCommand({ accountId: '99999', force: true })).resolves.toBeUndefined();
    expect(stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('')).toMatch(/is not deployed/i);
  });

  it('reports NOT_DEPLOYED in JSON mode without failing', async () => {
    (appService.removeApp as jest.Mock).mockRejectedValue(
      new ApiError('Unprocessable', 422, undefined),
    );

    await removeCommand({ accountId: '99999', json: true });

    const parsed = JSON.parse(stdoutSpy.mock.calls.map((c: [string]) => c[0]).join(''));
    expect(parsed).toMatchObject({ removed: false, reason: 'NOT_DEPLOYED', accountId: '99999' });
  });

  it('propagates errors other than 422', async () => {
    (appService.removeApp as jest.Mock).mockRejectedValue(
      new ApiError('Server error', 500, undefined),
    );

    await expect(removeCommand({ accountId: '99999', force: true })).rejects.toThrow(
      /Server error/,
    );
  });

  it('does nothing when the confirmation is declined', async () => {
    mockPrompt.mockResolvedValueOnce({ confirmed: false });

    await removeCommand({ accountId: '99999' });

    expect(appService.removeApp).not.toHaveBeenCalled();
    expect(stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('')).toMatch(/Remove cancelled/i);
  });

  it('emits JSON on success', async () => {
    await removeCommand({ accountId: '99999', json: true });

    const parsed = JSON.parse(stdoutSpy.mock.calls.map((c: [string]) => c[0]).join(''));
    expect(parsed).toEqual({ removed: true, appId: '42', accountId: '99999' });
  });
});
