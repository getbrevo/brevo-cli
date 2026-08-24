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
      // The picker prompt is per command: install asks where to install INTO,
      // uninstall (see uninstall.test.ts) asks where to uninstall FROM.
      expect(mockPrompt.mock.calls[0]![0][0].message).toBe('Select the account to install into:');
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
      { app_id: '9', name: 'Picked App', client_id: '' },
    ]);
    (appService.fetchApp as jest.Mock).mockResolvedValue({ app_id: '9', version: '3' });
    mockPrompt.mockResolvedValueOnce({ selectedApp: '9' });

    await appInstallCommand({ accountId: '99999', force: true });

    expect(appService.installApp).toHaveBeenCalledWith('9', '99999', 'Picked App');
  });

  // The picker is the last resort, reached only when neither `--app-id` nor a linked
  // `app-config.json` named the app. It renders its choice list to stdout, so it has to
  // be refused wherever there is no terminal to draw it on — under `--json` it would
  // break the single-parseable-document contract, and off a TTY inquirer aborts with a
  // raw readline stack. Same guard `app delete` and `app credentials` already carry.
  describe('the app picker is refused when it cannot be drawn', () => {
    beforeEach(() => {
      (readProjectConfig as jest.Mock).mockReturnValue(null);
      (appService.fetchAppsList as jest.Mock).mockResolvedValue([
        { app_id: '9', name: 'Picked App', client_id: '' },
      ]);
    });

    it('refuses under --json, naming the --app-id form', async () => {
      await expect(appInstallCommand({ accountId: '99999', json: true })).rejects.toThrow(
        /brevo app install --app-id <id>/,
      );

      expect(mockPrompt).not.toHaveBeenCalled();
      // Refused before the round trip, so no apps list is fetched and nothing is
      // written to the stdout a caller is parsing.
      expect(appService.fetchAppsList).not.toHaveBeenCalled();
      expect(appService.installApp).not.toHaveBeenCalled();
      expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('refuses off a TTY even without --json', async () => {
      Object.defineProperty(process.stdin, 'isTTY', {
        configurable: true,
        writable: true,
        value: false,
      });

      await expect(appInstallCommand({ accountId: '99999', force: true })).rejects.toThrow(
        /non-interactive/i,
      );

      expect(appService.installApp).not.toHaveBeenCalled();
    });

    // The guard must not reach a run that named its app: those are exactly the
    // non-interactive paths `--json`/CI depends on.
    it('does not fire when --app-id names the app', async () => {
      (appService.fetchApp as jest.Mock).mockResolvedValue({ app_id: '7', version: '3' });

      await appInstallCommand({ accountId: '99999', appId: '7', json: true });

      expect(appService.installApp).toHaveBeenCalledWith('7', '99999', '7');
    });

    it('does not fire when a linked app-config.json names the app', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue(UPLOADED_CONFIG);

      await appInstallCommand({ accountId: '99999', json: true });

      expect(appService.installApp).toHaveBeenCalledWith('42', '99999', 'Invoice Manager');
    });
  });
  // Only a UI app can be installed, so the picker offers only UI apps — an OAuth
  // app in the list would be a choice whose only outcome is the type-gate refusal
  // one step later. The list endpoint echoes no ui_app block, so rows are
  // classified by the same OAuth-material bias the gate itself uses: a row
  // carrying a client_id or callbacks is definitely OAuth and is hidden.
  describe('the app picker offers only UI apps', () => {
    beforeEach(() => {
      (readProjectConfig as jest.Mock).mockReturnValue(null);
      (appService.fetchApp as jest.Mock).mockResolvedValue({ app_id: '9', version: '3' });
    });

    it('hides OAuth apps from the choice list', async () => {
      (appService.fetchAppsList as jest.Mock).mockResolvedValue([
        {
          app_id: '1',
          name: 'OAuth App',
          client_id: 'cli-1',
          redirect_uris: ['https://example.com/callback'],
        },
        { app_id: '9', name: 'UI App', client_id: '' },
      ]);
      mockPrompt.mockResolvedValueOnce({ selectedApp: '9' });

      await appInstallCommand({ accountId: '99999', force: true });

      const choices = mockPrompt.mock.calls[0][0][0].choices;
      expect(choices).toHaveLength(1);
      expect(choices[0].value).toBe('9');
      // A UI app has no client_id, so the row must not render an empty one.
      expect(choices[0].name).not.toContain('Client ID');
    });

    it('refuses when the account has no UI apps rather than offering OAuth ones', async () => {
      (appService.fetchAppsList as jest.Mock).mockResolvedValue([
        {
          app_id: '1',
          name: 'OAuth App',
          client_id: 'cli-1',
          redirect_uris: ['https://example.com/callback'],
        },
      ]);

      await expect(appInstallCommand({ accountId: '99999', force: true })).rejects.toThrow(
        /no UI apps/i,
      );
      expect(mockPrompt).not.toHaveBeenCalled();
      expect(appService.installApp).not.toHaveBeenCalled();
    });
  });
  // Only a UI app is installed into an account — the rule the capability matrix already
  // encoded and nothing on this path enforced, so an OAuth app installed with a 201 and
  // rendered nothing.
  describe('the app-type gate', () => {
    it('refuses an OAuth app linked in this directory', async () => {
      const { ui_app: _ui, ...oauthConfig } = UPLOADED_CONFIG;
      (readProjectConfig as jest.Mock).mockReturnValue(oauthConfig);

      await expect(appInstallCommand({ accountId: '99999', force: true })).rejects.toThrow(
        /only UI apps are installed into an account/i,
      );
      expect(appService.installApp).not.toHaveBeenCalled();
    });

    // The type check runs before the upload check: "this app can't be installed at all"
    // dominates "it hasn't been uploaded yet".
    it('names the app type, not the upload, for an unuploaded OAuth app', async () => {
      const { ui_app: _ui, ...oauthConfig } = UPLOADED_CONFIG;
      (readProjectConfig as jest.Mock).mockReturnValue({ ...oauthConfig, version: '' });

      await expect(appInstallCommand({ accountId: '99999', force: true })).rejects.toThrow(
        /only UI apps are installed into an account/i,
      );
    });

    // The gate reads `app-config.json` only for the app that config describes. An
    // explicit --app-id names a different one, so the config cannot answer for it.
    it('gates --app-id against the named app, not the directory linked one', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue(UPLOADED_CONFIG);
      (appService.fetchApp as jest.Mock).mockResolvedValue({
        app_id: 'app-1',
        version: '3',
        client_id: 'cli-1',
        redirect_uris: ['https://example.com/callback'],
      });

      await expect(
        appInstallCommand({ accountId: '99999', appId: 'app-1', force: true }),
      ).rejects.toThrow(/only UI apps are installed into an account/i);
      expect(appService.fetchApp).toHaveBeenCalledWith('app-1');
      expect(appService.installApp).not.toHaveBeenCalled();
    });

    // The mirror case: the directory's app is an OAuth app, the named one is not, and it
    // is the named one that decides.
    it('does not refuse --app-id because the directory app is an OAuth app', async () => {
      const { ui_app: _ui, ...oauthConfig } = UPLOADED_CONFIG;
      (readProjectConfig as jest.Mock).mockReturnValue(oauthConfig);
      (appService.fetchApp as jest.Mock).mockResolvedValue({ app_id: 'app-1', version: '3' });

      await appInstallCommand({ accountId: '99999', appId: 'app-1', force: true });
      expect(appService.installApp).toHaveBeenCalledWith('app-1', '99999', 'app-1');
    });

    // Same rule for the upload half: the named app's own `version` decides.
    it('gates the upload check on the named app too', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue(UPLOADED_CONFIG);
      (appService.fetchApp as jest.Mock).mockResolvedValue({ app_id: 'app-1', version: '' });

      await expect(
        appInstallCommand({ accountId: '99999', appId: 'app-1', force: true }),
      ).rejects.toThrow(/brevo app upload/i);
    });

    describe('outside a linked project', () => {
      beforeEach(() => {
        (readProjectConfig as jest.Mock).mockReturnValue(null);
      });

      // A record carrying OAuth material is definitely an OAuth app, whatever the list
      // endpoint does or doesn't echo about `ui_app`.
      it('refuses an --app-id app the server answers with a client_id', async () => {
        (appService.fetchApp as jest.Mock).mockResolvedValue({
          app_id: 'app-1',
          version: '3',
          client_id: 'cli-1',
          redirect_uris: ['https://example.com/callback'],
        });

        await expect(
          appInstallCommand({ accountId: '99999', appId: 'app-1', force: true }),
        ).rejects.toThrow(/only UI apps are installed into an account/i);
        expect(appService.installApp).not.toHaveBeenCalled();
      });

      // The bias is deliberate: no OAuth material reads as a UI app, so the failure mode
      // is a missed refusal rather than a wrongly refused UI app.
      it('installs a record carrying no OAuth material', async () => {
        (appService.fetchApp as jest.Mock).mockResolvedValue({ app_id: 'app-1', version: '3' });

        await appInstallCommand({ accountId: '99999', appId: 'app-1', force: true });
        expect(appService.installApp).toHaveBeenCalled();
      });

      // Same policy as the upload half of the gate: guarding against a silent no-op must
      // not become a new way to fail outright.
      it('does not block when the app read fails', async () => {
        (appService.fetchApp as jest.Mock).mockRejectedValue(new ApiError('boom', 500, undefined));

        await appInstallCommand({ accountId: '99999', appId: 'app-1', force: true });
        expect(appService.installApp).toHaveBeenCalled();
      });

      // One read now answers both halves of the gate; it used to be fetched twice.
      it('reads the app once for both checks', async () => {
        (appService.fetchApp as jest.Mock).mockResolvedValue({ app_id: 'app-1', version: '3' });

        await appInstallCommand({ accountId: '99999', appId: 'app-1', force: true });
        expect(appService.fetchApp).toHaveBeenCalledTimes(1);
      });
    });
  });

  // A bare account ID is not enough when the CLI chose the account itself: the user never
  // typed the number, so there is nothing for them to check it against.
  describe('how the target account is named', () => {
    const output = () => stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');

    // The explicit positional is the CI path, and its wording is unchanged.
    it('leaves an explicit account ID unnamed', async () => {
      await appInstallCommand({ accountId: '99999', force: true });

      expect(output()).toMatch(/installed into account 99999\./);
    });

    it('names the caller own account from the account response', async () => {
      (accountService.getAccount as jest.Mock).mockResolvedValue({
        type: 'user',
        companyName: 'Acme Retail',
      });

      await appInstallCommand({ force: true });

      expect(output()).toMatch(/installed into Acme Retail \(your own account, org ID 12345\)\./);
    });

    // The one path where the identifier can be a UUID the user has never seen — which is
    // exactly why the name matters here.
    it('names a UUID-identified account', async () => {
      (accountService.getAccount as jest.Mock).mockResolvedValue({
        type: 'user',
        companyName: 'Acme Retail',
      });
      (getOrganizationId as jest.Mock).mockReturnValue('550e8400-e29b-41d4-a716-446655440001');

      await appInstallCommand({ force: true });

      expect(output()).toMatch(/Acme Retail \(your own account, org ID 550e8400-/);
    });

    it('falls back to the identifier alone when the account has no company name', async () => {
      await appInstallCommand({ force: true });

      expect(output()).toMatch(/installed into your own account \(org ID 12345\)\./);
    });

    it('names a picked sub-account the way the picker did', async () => {
      (accountService.getAccount as jest.Mock).mockResolvedValue({ type: 'corporate' });
      (accountService.fetchSubAccounts as jest.Mock).mockResolvedValue([
        { id: 4043630, companyName: 'Company2', active: true },
      ]);
      mockPrompt.mockResolvedValueOnce({ selectedSubAccount: 4043630 });

      await appInstallCommand({ force: true });

      expect(output()).toMatch(/installed into Company2 \(account 4043630\)\./);
    });

    it('names the account in the confirmation too', async () => {
      (accountService.getAccount as jest.Mock).mockResolvedValue({
        type: 'user',
        companyName: 'Acme Retail',
      });
      mockPrompt.mockResolvedValueOnce({ confirmed: true });

      await appInstallCommand({});

      expect(mockPrompt.mock.calls[0]![0][0].message).toBe(
        'Install app "Invoice Manager" (42) into Acme Retail (your own account, org ID 12345)?',
      );
    });

    // `accountId` stays the raw identifier scripts already match on; the name is additive.
    it('adds accountName to --json only when one was resolved', async () => {
      (accountService.getAccount as jest.Mock).mockResolvedValue({
        type: 'user',
        companyName: 'Acme Retail',
      });

      await appInstallCommand({ json: true });

      const parsed = JSON.parse(stdoutSpy.mock.calls.map((c: [string]) => c[0]).join(''));
      expect(parsed).toEqual({
        installed: true,
        appId: '42',
        accountId: '12345',
        accountName: 'Acme Retail',
      });
    });
  });
});
