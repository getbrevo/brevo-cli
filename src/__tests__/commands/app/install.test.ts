jest.mock('inquirer', () => ({ prompt: jest.fn() }));

jest.mock('../../../container', () => ({
  appService: {
    installApp: jest.fn(),
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
import { appInstallCommand } from '../../../commands/app/install';
import { appService, accountService } from '../../../container';
import { readProjectConfig, getOrganizationId } from '../../../lib/config';
import { ApiError } from '../../../lib/errors';

const mockPrompt = inquirer.prompt as unknown as jest.Mock;

// A project that has been through a successful `app upload` — `version` is only
// ever written by one, which is what the install gate keys off.
const UPLOADED_CONFIG = {
  appId: '42',
  appName: 'Invoice Manager',
  distribution_type: 'private' as const,
  version: '1.0.0',
  auth: { scopes: ['contacts:read'] },
  ui_app: { type: 'link' as const },
};

describe('app/install', () => {
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
    (appService.installApp as jest.Mock).mockResolvedValue(undefined);
    (readProjectConfig as jest.Mock).mockReturnValue(UPLOADED_CONFIG);
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

  it('installs the linked app into the given account', async () => {
    await appInstallCommand({ accountId: '99999', force: true });

    expect(appService.installApp).toHaveBeenCalledWith('42', '99999', 'Invoice Manager');
  });

  it('prefers an explicit --app-id over the linked config', async () => {
    await appInstallCommand({ accountId: '99999', appId: '7', force: true });

    expect(appService.installApp).toHaveBeenCalledWith('7', '99999', '7');
  });

  // A plain account has exactly one possible target — itself — so omitting the
  // positional resolves deterministically and never prompts.
  it('defaults to the caller own account when no account ID is given', async () => {
    await appInstallCommand({ force: true });

    expect(appService.installApp).toHaveBeenCalledWith('42', '12345', 'Invoice Manager');
    expect(accountService.fetchSubAccounts).not.toHaveBeenCalled();
  });

  it('still resolves its own account non-interactively', async () => {
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      writable: true,
      value: false,
    });

    await appInstallCommand({ json: true });

    expect(appService.installApp).toHaveBeenCalledWith('42', '12345', 'Invoice Manager');
  });

  // A plain account's own identifier becomes the install target, and it may be a UUID
  // rather than a number — it must survive resolution intact.
  it('defaults to a UUID organization ID unchanged', async () => {
    (getOrganizationId as jest.Mock).mockReturnValue('550e8400-e29b-41d4-a716-446655440001');

    await appInstallCommand({ force: true });

    expect(appService.installApp).toHaveBeenCalledWith(
      '42',
      '550e8400-e29b-41d4-a716-446655440001',
      'Invoice Manager',
    );
  });

  it('surfaces a missing organization ID rather than labelling the target "undefined"', async () => {
    (getOrganizationId as jest.Mock).mockReturnValue(undefined);

    await expect(appInstallCommand({ force: true })).rejects.toThrow(/organization ID/i);
    expect(appService.installApp).not.toHaveBeenCalled();
  });

  describe('corporate account', () => {
    beforeEach(() => {
      (accountService.getAccount as jest.Mock).mockResolvedValue({ type: 'corporate' });
    });

    it('prompts for a sub-account when no account ID is given', async () => {
      (accountService.fetchSubAccounts as jest.Mock).mockResolvedValue([
        { id: 4043629, companyName: 'Company1', active: true },
        { id: 4043630, companyName: 'Company2', active: true },
      ]);
      mockPrompt.mockResolvedValueOnce({ selectedSubAccount: 4043630 });

      await appInstallCommand({ accountId: undefined, force: true });

      expect(appService.installApp).toHaveBeenCalledWith('42', '4043630', 'Invoice Manager');
    });

    it('does not offer deactivated sub-accounts', async () => {
      (accountService.fetchSubAccounts as jest.Mock).mockResolvedValue([
        { id: 4043629, companyName: 'Company1', active: false },
        { id: 4043630, companyName: 'Company2', active: true },
      ]);
      mockPrompt.mockResolvedValueOnce({ selectedSubAccount: 4043630 });

      await appInstallCommand({ force: true });

      const choices = mockPrompt.mock.calls[0]![0][0].choices as { value: number }[];
      expect(choices.map((c) => c.value)).toEqual([4043630]);
    });

    it('errors instead of showing an empty picker', async () => {
      (accountService.fetchSubAccounts as jest.Mock).mockResolvedValue([
        { id: 4043629, companyName: 'Company1', active: false },
      ]);

      await expect(appInstallCommand({ force: true })).rejects.toThrow(/no active sub-accounts/i);
      expect(mockPrompt).not.toHaveBeenCalled();
    });

    // The one branch that genuinely cannot resolve without a terminal — it has a real
    // choice to make. Point at the positional rather than failing opaquely.
    it('demands an explicit account ID in JSON mode', async () => {
      await expect(appInstallCommand({ json: true })).rejects.toThrow(/corporate account/i);
      expect(accountService.fetchSubAccounts).not.toHaveBeenCalled();
    });

    it('uses an explicit account ID without touching the sub-account listing', async () => {
      await appInstallCommand({ accountId: '99999', force: true });

      expect(appService.installApp).toHaveBeenCalledWith('42', '99999', 'Invoice Manager');
      expect(accountService.getAccount).not.toHaveBeenCalled();
      expect(accountService.fetchSubAccounts).not.toHaveBeenCalled();
    });
  });

  it('rejects a non-numeric account ID', async () => {
    await expect(appInstallCommand({ accountId: 'abc', force: true })).rejects.toThrow(
      /not a numeric Brevo account ID/i,
    );
    expect(appService.installApp).not.toHaveBeenCalled();
  });

  // The spec's installation flow: install must refuse until `app upload` has
  // validated the configuration.
  it('refuses to install an app that has never been uploaded', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue({ ...UPLOADED_CONFIG, version: '' });

    await expect(appInstallCommand({ accountId: '99999', force: true })).rejects.toThrow(
      /brevo app upload/i,
    );
    expect(appService.installApp).not.toHaveBeenCalled();
  });

  // The gate used to stop at the linked-project check, on the belief that the
  // server refused an unconfigured app with a 422. It does not — the installs
  // handler has no configured/uploaded check — so `--app-id` and the picker have
  // to be gated on the app's server-side version or nothing gates them at all.
  describe('the upload gate outside a linked project', () => {
    beforeEach(() => {
      (readProjectConfig as jest.Mock).mockReturnValue(null);
    });

    it('refuses an --app-id app the server has no version for', async () => {
      (appService.fetchApp as jest.Mock).mockResolvedValue({ app_id: 'app-1', version: '' });

      await expect(
        appInstallCommand({ accountId: '99999', appId: 'app-1', force: true }),
      ).rejects.toThrow(/brevo app upload/i);
      expect(appService.installApp).not.toHaveBeenCalled();
    });

    it('installs an --app-id app that has been uploaded', async () => {
      (appService.fetchApp as jest.Mock).mockResolvedValue({ app_id: 'app-1', version: '3' });

      await appInstallCommand({ accountId: '99999', appId: 'app-1', force: true });
      expect(appService.installApp).toHaveBeenCalledWith('app-1', '99999', 'app-1');
    });

    // Guarding against a silent no-op must not itself become a new way to fail:
    // an unavailable read leaves the install to proceed.
    it('still installs when the version read fails', async () => {
      (appService.fetchApp as jest.Mock).mockRejectedValue(new ApiError('boom', 500, undefined));

      await appInstallCommand({ accountId: '99999', appId: 'app-1', force: true });
      expect(appService.installApp).toHaveBeenCalled();
    });

    // A linked project is still answered locally — the whole point of keeping the
    // local branch is that the common path costs no round trip.
    it('does not read the app when a linked project answers the question', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue(UPLOADED_CONFIG);

      await appInstallCommand({ accountId: '99999', force: true });
      expect(appService.fetchApp).not.toHaveBeenCalled();
    });
  });

  it('maps the server 422 to the same upload-first message', async () => {
    (appService.installApp as jest.Mock).mockRejectedValue(
      new ApiError('Unprocessable', 422, undefined),
    );

    await expect(appInstallCommand({ accountId: '99999', force: true })).rejects.toThrow(
      /brevo app upload/i,
    );
  });

  it('asks for confirmation and does nothing when declined', async () => {
    mockPrompt.mockResolvedValueOnce({ confirmed: false });

    await appInstallCommand({ accountId: '99999' });

    expect(appService.installApp).not.toHaveBeenCalled();
    expect(stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('')).toMatch(/Install cancelled/i);
  });

  it('installs after an accepted confirmation', async () => {
    mockPrompt.mockResolvedValueOnce({ confirmed: true });

    await appInstallCommand({ accountId: '99999' });

    expect(appService.installApp).toHaveBeenCalledWith('42', '99999', 'Invoice Manager');
  });

  it('refuses to prompt in a non-TTY run without --force or --json', async () => {
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      writable: true,
      value: false,
    });

    await expect(appInstallCommand({ accountId: '99999' })).rejects.toThrow(/non-interactive/i);
    expect(appService.installApp).not.toHaveBeenCalled();
  });

  it('emits JSON and skips the prompt under --json', async () => {
    await appInstallCommand({ accountId: '99999', json: true });

    expect(mockPrompt).not.toHaveBeenCalled();
    const parsed = JSON.parse(stdoutSpy.mock.calls.map((c: [string]) => c[0]).join(''));
    expect(parsed).toEqual({ installed: true, appId: '42', accountId: '99999' });
  });

  it('falls back to the app picker outside a project directory', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(null);
    (appService.fetchAppsList as jest.Mock).mockResolvedValue([
      { app_id: '9', name: 'Picked App', client_id: 'cli-9' },
    ]);
    mockPrompt.mockResolvedValueOnce({ selectedApp: '9' });

    await appInstallCommand({ accountId: '99999', force: true });

    expect(appService.installApp).toHaveBeenCalledWith('9', '99999', 'Picked App');
  });
});
