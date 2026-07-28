jest.mock('inquirer', () => ({ prompt: jest.fn() }));

jest.mock('../../../container', () => ({
  appService: {
    deployApp: jest.fn(),
    fetchAppsList: jest.fn(),
  },
}));

jest.mock('../../../lib/config', () => ({
  readProjectConfig: jest.fn(),
}));

import inquirer from 'inquirer';
import { deployCommand } from '../../../commands/app/deploy';
import { appService } from '../../../container';
import { readProjectConfig } from '../../../lib/config';
import { ApiError } from '../../../lib/errors';

const mockPrompt = inquirer.prompt as unknown as jest.Mock;

// A project that has been through a successful `app upload` — `version` is only
// ever written by one, which is what the deploy gate keys off.
const UPLOADED_CONFIG = {
  appId: '42',
  appName: 'Invoice Manager',
  distribution_type: 'private' as const,
  version: '1.0.0',
  auth: { scopes: ['contacts:read'] },
  ui_app: { type: 'link' as const },
};

describe('app/deploy', () => {
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
    // clearAllMocks() clears calls but NOT implementations set via
    // mockRejectedValue/mockResolvedValue in an earlier test (this repo's jest
    // config doesn't enable resetMocks), so re-assert the happy path here.
    (appService.deployApp as jest.Mock).mockResolvedValue(undefined);
    (readProjectConfig as jest.Mock).mockReturnValue(UPLOADED_CONFIG);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    if (originalIsTTYDescriptor) {
      Object.defineProperty(process.stdin, 'isTTY', originalIsTTYDescriptor);
    } else {
      Reflect.deleteProperty(process.stdin, 'isTTY');
    }
  });

  it('deploys the linked app to the given account', async () => {
    await deployCommand({ accountId: '99999', force: true });

    expect(appService.deployApp).toHaveBeenCalledWith('42', '99999');
  });

  it('prefers an explicit --app-id over the linked config', async () => {
    await deployCommand({ accountId: '99999', appId: '7', force: true });

    expect(appService.deployApp).toHaveBeenCalledWith('7', '99999');
  });

  it('errors when the account ID is missing', async () => {
    await expect(deployCommand({ force: true })).rejects.toThrow(/Missing account ID/i);
    expect(appService.deployApp).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric account ID', async () => {
    await expect(deployCommand({ accountId: 'abc', force: true })).rejects.toThrow(
      /not a numeric Brevo account ID/i,
    );
    expect(appService.deployApp).not.toHaveBeenCalled();
  });

  // The spec's installation flow: deploy must refuse until `app upload` has
  // validated the configuration.
  it('refuses to deploy an app that has never been uploaded', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue({ ...UPLOADED_CONFIG, version: '' });

    await expect(deployCommand({ accountId: '99999', force: true })).rejects.toThrow(
      /brevo app upload/i,
    );
    expect(appService.deployApp).not.toHaveBeenCalled();
  });

  it('maps the server 422 to the same upload-first message', async () => {
    (appService.deployApp as jest.Mock).mockRejectedValue(
      new ApiError('Unprocessable', 422, undefined),
    );

    await expect(deployCommand({ accountId: '99999', force: true })).rejects.toThrow(
      /brevo app upload/i,
    );
  });

  it('asks for confirmation and does nothing when declined', async () => {
    mockPrompt.mockResolvedValueOnce({ confirmed: false });

    await deployCommand({ accountId: '99999' });

    expect(appService.deployApp).not.toHaveBeenCalled();
    expect(stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('')).toMatch(/Deploy cancelled/i);
  });

  it('deploys after an accepted confirmation', async () => {
    mockPrompt.mockResolvedValueOnce({ confirmed: true });

    await deployCommand({ accountId: '99999' });

    expect(appService.deployApp).toHaveBeenCalledWith('42', '99999');
  });

  it('refuses to prompt in a non-TTY run without --force or --json', async () => {
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      writable: true,
      value: false,
    });

    await expect(deployCommand({ accountId: '99999' })).rejects.toThrow(/non-interactive/i);
    expect(appService.deployApp).not.toHaveBeenCalled();
  });

  it('emits JSON and skips the prompt under --json', async () => {
    await deployCommand({ accountId: '99999', json: true });

    expect(mockPrompt).not.toHaveBeenCalled();
    const parsed = JSON.parse(stdoutSpy.mock.calls.map((c: [string]) => c[0]).join(''));
    expect(parsed).toEqual({ deployed: true, appId: '42', accountId: '99999' });
  });

  it('falls back to the app picker outside a project directory', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(null);
    (appService.fetchAppsList as jest.Mock).mockResolvedValue([
      { app_id: '9', name: 'Picked App', client_id: 'cli-9' },
    ]);
    mockPrompt.mockResolvedValueOnce({ selectedApp: '9' });

    await deployCommand({ accountId: '99999', force: true });

    expect(appService.deployApp).toHaveBeenCalledWith('9', '99999');
  });
});
