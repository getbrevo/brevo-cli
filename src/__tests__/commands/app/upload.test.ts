import { uploadCommand } from '../../../commands/app/upload';

jest.mock('inquirer', () => ({
  prompt: jest.fn(),
}));

jest.mock('../../../container', () => ({
  appService: {
    fetchApp: jest.fn(),
    uploadApp: jest.fn(),
  },
}));

jest.mock('../../../lib/config', () => ({
  readProjectConfig: jest.fn(),
  writeProjectConfig: jest.fn(),
  saveAppName: jest.fn(),
  // Pure predicate over the config object — use the real logic rather than a
  // jest.fn() so every test doesn't have to stub the app-type branch.
  isUiAppConfig: (config: { ui_app?: unknown } | null | undefined) => !!config?.ui_app,
}));

jest.mock('node:fs');

import * as fs from 'node:fs';
import inquirer from 'inquirer';
import { appService } from '../../../container';
import { readProjectConfig, writeProjectConfig, saveAppName } from '../../../lib/config';

const mockPrompt = inquirer.prompt as unknown as jest.Mock;

const BASE_CONFIG = {
  appId: '1',
  appName: 'Test App',
  distribution_type: 'private' as const,
  logoUri: '',
  version: '1.0.0',
  auth: { scopes: ['contacts:read'], redirectUris: ['http://localhost:3009/auth/callback'] },
};

const BASE_REMOTE = {
  app_id: '1',
  name: 'Test App',
  client_id: 'cli-123',
  distribution_type: 'private' as const,
  redirect_uris: ['http://localhost:3009/auth/callback'],
  scopes: ['contacts:read'],
  logo_uri: '',
  version: '1.0.0',
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
};

// Wire shape for appService.uploadApp()'s resolved response — distinct from
// BASE_REMOTE (which mirrors OAuthApp / fetchApp's shape): distribution_type
// is top-level and auth carries only scopes + redirect_uris (locked contract —
// no server build ever nested distribution_type under auth in the response).
const BASE_UPLOAD_RESPONSE = {
  app_id: '1',
  name: 'Test App',
  logo_uri: '',
  version: '1.0.0',
  distribution_type: 'private' as const,
  auth: {
    scopes: ['contacts:read'],
    redirect_uris: ['http://localhost:3009/auth/callback'],
  },
};

describe('app/upload', () => {
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
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify({ appId: '1' }));
    (readProjectConfig as jest.Mock).mockReturnValue(BASE_CONFIG);
    (appService.fetchApp as jest.Mock).mockResolvedValue(BASE_REMOTE);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    if (originalIsTTYDescriptor) {
      Object.defineProperty(process.stdin, 'isTTY', originalIsTTYDescriptor);
    } else {
      Reflect.deleteProperty(process.stdin, 'isTTY');
    }
  });

  it('hard-errors when app-config.json does not exist', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    await expect(uploadCommand({})).rejects.toThrow(/No app-config.json/i);
    expect(appService.fetchApp).not.toHaveBeenCalled();
  });

  it('hard-errors on invalid JSON', async () => {
    (fs.readFileSync as jest.Mock).mockReturnValue('{not json');
    await expect(uploadCommand({})).rejects.toThrow(/invalid JSON/i);
  });

  it('hard-errors when appId is missing from the file', async () => {
    (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify({}));
    await expect(uploadCommand({})).rejects.toThrow(/missing "appId"/i);
  });

  it('always fetches remote state and shows the diff, even under --yes', async () => {
    const changedConfig = {
      ...BASE_CONFIG,
      auth: { ...BASE_CONFIG.auth, redirectUris: ['http://localhost:9999/auth/callback'] },
    };
    (readProjectConfig as jest.Mock).mockReturnValue(changedConfig);
    (appService.uploadApp as jest.Mock).mockResolvedValue({
      ...BASE_REMOTE,
      auth: { ...BASE_REMOTE, redirect_uris: ['http://localhost:9999/auth/callback'] },
    });

    await uploadCommand({ yes: true });

    expect(appService.fetchApp).toHaveBeenCalledWith('1');
    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('Upload summary');
    expect(mockPrompt).not.toHaveBeenCalled();
  });

  it('exits 0 with "already up to date" and does not call uploadApp when config matches the server', async () => {
    await uploadCommand({ yes: true });

    expect(appService.uploadApp).not.toHaveBeenCalled();
    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toMatch(/already up to date/i);
  });

  it('prompts for confirmation when something differs and --yes/--json are absent', async () => {
    const changedConfig = { ...BASE_CONFIG, appName: 'Renamed App' };
    (readProjectConfig as jest.Mock).mockReturnValue(changedConfig);
    mockPrompt.mockResolvedValueOnce({ confirmed: true });
    (appService.uploadApp as jest.Mock).mockResolvedValue({
      ...BASE_UPLOAD_RESPONSE,
      name: 'Renamed App',
    });

    await uploadCommand({});

    expect(mockPrompt).toHaveBeenCalled();
    expect(appService.uploadApp).toHaveBeenCalled();
  });

  it('cancels without uploading when the user declines the confirmation', async () => {
    const changedConfig = { ...BASE_CONFIG, appName: 'Renamed App' };
    (readProjectConfig as jest.Mock).mockReturnValue(changedConfig);
    mockPrompt.mockResolvedValueOnce({ confirmed: false });

    await uploadCommand({});

    expect(appService.uploadApp).not.toHaveBeenCalled();
  });

  it('throws in non-interactive mode without --yes/--json when something differs', async () => {
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      writable: true,
      value: false,
    });
    const changedConfig = { ...BASE_CONFIG, appName: 'Renamed App' };
    (readProjectConfig as jest.Mock).mockReturnValue(changedConfig);

    await expect(uploadCommand({})).rejects.toThrow(/non-interactive/i);
    expect(appService.uploadApp).not.toHaveBeenCalled();
  });

  it('POSTs the correct wire shape — top-level distribution_type, version, redirect_uris under auth', async () => {
    const changedConfig = { ...BASE_CONFIG, appName: 'Renamed App' };
    (readProjectConfig as jest.Mock).mockReturnValue(changedConfig);
    (appService.uploadApp as jest.Mock).mockResolvedValue({
      ...BASE_UPLOAD_RESPONSE,
      name: 'Renamed App',
    });

    await uploadCommand({ yes: true });

    expect(appService.uploadApp).toHaveBeenCalledWith('1', {
      app_id: '1',
      name: 'Renamed App',
      logo_uri: '',
      version: '1.0.0',
      distribution_type: 'private',
      auth: {
        scopes: ['contacts:read'],
        redirect_uris: ['http://localhost:3009/auth/callback'],
      },
    });
  });

  it('blocks the upload when local distribution_type differs from the app on Brevo', async () => {
    // distribution_type is immutable via upload. The server (BEX-355) rejects
    // drift with a 422, but the CLI fast-fails first against the remote state
    // it already fetches for the diff — no round trip wasted on a doomed push.
    (readProjectConfig as jest.Mock).mockReturnValue({
      ...BASE_CONFIG,
      distribution_type: 'public' as const,
    });

    await expect(uploadCommand({ yes: true })).rejects.toThrow(/distribution/i);
    expect(appService.uploadApp).not.toHaveBeenCalled();
    expect(writeProjectConfig).not.toHaveBeenCalled();
  });

  // Earlier CLI versions guaranteed `ui_app` was never sent at all. That
  // guarantee now applies to OAuth apps only (BEX-290) — the UI-app half of the
  // contract is covered in the 'UI apps' block below.
  it('never sends a ui_app field for an OAuth app', async () => {
    const changedConfig = { ...BASE_CONFIG, appName: 'Renamed App' };
    (readProjectConfig as jest.Mock).mockReturnValue(changedConfig);
    (appService.uploadApp as jest.Mock).mockResolvedValue({
      ...BASE_UPLOAD_RESPONSE,
      name: 'Renamed App',
    });

    await uploadCommand({ yes: true });

    const payload = (appService.uploadApp as jest.Mock).mock.calls[0][1];
    expect(payload).not.toHaveProperty('ui_app');
  });

  it('writes the server-confirmed state back into app-config.json on success', async () => {
    const changedConfig = { ...BASE_CONFIG, appName: 'Renamed App' };
    (readProjectConfig as jest.Mock).mockReturnValue(changedConfig);
    (appService.uploadApp as jest.Mock).mockResolvedValue({
      app_id: '1',
      name: 'Renamed App',
      logo_uri: '',
      version: '2.0.0',
      distribution_type: 'private',
      auth: {
        scopes: ['contacts:read'],
        redirect_uris: ['http://localhost:3009/auth/callback'],
      },
    });

    await uploadCommand({ yes: true });

    expect(writeProjectConfig).toHaveBeenCalledWith(
      expect.objectContaining({ appName: 'Renamed App', version: '2.0.0' }),
    );
    expect(saveAppName).toHaveBeenCalledWith('1', 'Renamed App');
  });

  it('persists the server-confirmed distribution_type when the response carries it top-level', async () => {
    // Current server builds return distribution_type at the top level of the
    // upload response; the auth block only carries scopes + redirect_uris. The
    // write-back must pick up the server-confirmed value, not silently fall
    // back to whatever the local config already said.
    const changedConfig = { ...BASE_CONFIG, appName: 'Renamed App' };
    (readProjectConfig as jest.Mock).mockReturnValue(changedConfig);
    (appService.uploadApp as jest.Mock).mockResolvedValue({
      app_id: '1',
      name: 'Renamed App',
      logo_uri: '',
      version: '2.0.0',
      distribution_type: 'public',
      auth: {
        scopes: ['contacts:read'],
        redirect_uris: ['http://localhost:3009/auth/callback'],
      },
    });

    await uploadCommand({ yes: true });

    expect(writeProjectConfig).toHaveBeenCalledWith(
      expect.objectContaining({ distribution_type: 'public' }),
    );
  });

  it('keeps the local scopes/redirect URLs when the response auth carries nulls', async () => {
    // The auth key is always present in the upload response, but its values are
    // null (not empty arrays, not absent) when the stored snapshot has no OAuth
    // block — e.g. UI-only apps. The write-back must fall back to what was sent
    // rather than persisting nulls or crashing.
    const changedConfig = { ...BASE_CONFIG, appName: 'Renamed App' };
    (readProjectConfig as jest.Mock).mockReturnValue(changedConfig);
    (appService.uploadApp as jest.Mock).mockResolvedValue({
      app_id: '1',
      name: 'Renamed App',
      logo_uri: '',
      version: '2.0.0',
      distribution_type: 'private',
      auth: { scopes: null, redirect_uris: null },
    });

    await uploadCommand({ yes: true });

    expect(writeProjectConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: {
          scopes: ['contacts:read'],
          redirectUris: ['http://localhost:3009/auth/callback'],
        },
      }),
    );
  });

  it('captures the new version when the upload response names it `app_version` (not `version`)', async () => {
    // The BO emits the bumped version under `version` (canonical — see
    // UploadAppResponse), but the CLI tolerates the request-side key
    // `app_version` too, so a server build that mirrors the request naming
    // never makes the CLI silently keep the old value.
    const changedConfig = { ...BASE_CONFIG, appName: 'Renamed App' };
    (readProjectConfig as jest.Mock).mockReturnValue(changedConfig);
    (appService.uploadApp as jest.Mock).mockResolvedValue({
      app_id: '1',
      name: 'Renamed App',
      logo_uri: '',
      // no `version`; new version arrives under the request-side key
      app_version: '2.0.0',
      distribution_type: 'private',
      auth: {
        scopes: ['contacts:read'],
        redirect_uris: ['http://localhost:3009/auth/callback'],
      },
    });

    await uploadCommand({ yes: true });

    expect(writeProjectConfig).toHaveBeenCalledWith(
      expect.objectContaining({ appName: 'Renamed App', version: '2.0.0' }),
    );
    const printed = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(printed).toContain('2.0.0');
  });

  it('rejects (propagates the error) when the server returns app_version_outdated', async () => {
    const changedConfig = { ...BASE_CONFIG, version: '0.5.0' };
    (readProjectConfig as jest.Mock).mockReturnValue(changedConfig);
    (appService.uploadApp as jest.Mock).mockRejectedValue(new Error('app_version_outdated'));

    await expect(uploadCommand({ yes: true })).rejects.toThrow('app_version_outdated');
  });

  it('blocks with the legacy all-scope message when local scopes contain "all"', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue({
      ...BASE_CONFIG,
      auth: { ...BASE_CONFIG.auth, scopes: ['all'] },
    });

    await expect(uploadCommand({ yes: true })).rejects.toThrow(/legacy 'all'/i);
    expect(appService.uploadApp).not.toHaveBeenCalled();
  });

  it('throws when app-config.json has no redirect URLs', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue({
      ...BASE_CONFIG,
      auth: { ...BASE_CONFIG.auth, redirectUris: [] },
    });

    await expect(uploadCommand({ yes: true })).rejects.toThrow(/no redirect URLs/i);
  });

  it('rejects an invalid redirect URL protocol', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue({
      ...BASE_CONFIG,
      auth: { ...BASE_CONFIG.auth, redirectUris: ['ftp://bad'] },
    });

    await expect(uploadCommand({ yes: true })).rejects.toThrow(/http:\/\/ or https:\/\//);
  });

  it('outputs structured JSON including the diff under --json, with no prompt', async () => {
    const changedConfig = { ...BASE_CONFIG, appName: 'Renamed App' };
    (readProjectConfig as jest.Mock).mockReturnValue(changedConfig);
    (appService.uploadApp as jest.Mock).mockResolvedValue({
      ...BASE_UPLOAD_RESPONSE,
      name: 'Renamed App',
    });

    await uploadCommand({ json: true });

    expect(mockPrompt).not.toHaveBeenCalled();
    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    const parsed = JSON.parse(output);
    expect(parsed.name).toBe('Renamed App');
    expect(parsed.current).toBeDefined();
    expect(parsed.next).toBeDefined();
  });

  it('shows the legacy all-scope migration banner when the REMOTE app still has "all" scope', async () => {
    const changedConfig = {
      ...BASE_CONFIG,
      auth: { ...BASE_CONFIG.auth, scopes: ['contacts:read', 'crm:read'] },
    };
    (readProjectConfig as jest.Mock).mockReturnValue(changedConfig);
    (appService.fetchApp as jest.Mock).mockResolvedValue({
      ...BASE_REMOTE,
      scopes: ['all'],
    });
    (appService.uploadApp as jest.Mock).mockResolvedValue({
      ...BASE_UPLOAD_RESPONSE,
      auth: { ...BASE_UPLOAD_RESPONSE.auth, scopes: ['contacts:read', 'crm:read'] },
    });

    await uploadCommand({ yes: true });

    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain("Migrating from legacy 'all' scope");
    expect(appService.uploadApp).toHaveBeenCalled();
  });

  it('outputs upToDate JSON (no upload call) when nothing differs under --json', async () => {
    await uploadCommand({ json: true });

    expect(appService.uploadApp).not.toHaveBeenCalled();
    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    const parsed = JSON.parse(output);
    expect(parsed.upToDate).toBe(true);
  });

  // ──────────────── UI apps (BEX-290) ────────────────
  // The block mirrors the platform's stored app snapshot field for field.
  describe('UI apps', () => {
    const UI_APP = {
      extensionType: 'actionLink' as const,
      surfacePointList: ['contactDetails.headerMenu.action'],
      heading: 'Invoice Manager',
      subheading: 'Review invoice history for this contact',
      redirectLink: 'https://example.com/brevo',
      linkTarget: '_blank' as const,
    };

    // A UI app carries no OAuth block at all — `auth` is exactly the empty
    // object `{}`, and that absence of scopes/redirectUris is the point of the
    // OAuth-only checks (and enforced by validateAuthShape).
    const UI_CONFIG = {
      appId: '1',
      appName: 'Invoice Manager',
      distribution_type: 'private' as const,
      logoUri: '',
      version: '1.0.0',
      auth: {},
      ui_app: UI_APP,
    };

    // Must match UI_CONFIG on every field outside the ui_app block, so the
    // tests below isolate the block as the only thing that can differ.
    const UI_REMOTE = {
      ...BASE_REMOTE,
      name: 'Invoice Manager',
      redirect_uris: [],
      scopes: ['contacts:read', 'contacts:write'],
    };

    beforeEach(() => {
      (readProjectConfig as jest.Mock).mockReturnValue(UI_CONFIG);
      (appService.fetchApp as jest.Mock).mockResolvedValue(UI_REMOTE);
      (appService.uploadApp as jest.Mock).mockResolvedValue({
        ...BASE_UPLOAD_RESPONSE,
        name: 'Invoice Manager',
        auth: {
          distribution_type: 'private' as const,
          scopes: ['contacts:read', 'contacts:write'],
        },
      });
    });

    // The platform's upload endpoint binds the block as `ui_app` and rejects
    // unknown keys with a 400, so the legacy `snapshot` key must never be sent.
    it('sends the block under the ui_app key', async () => {
      await uploadCommand({ yes: true });

      const payload = (appService.uploadApp as jest.Mock).mock.calls[0][1];
      expect(payload.ui_app).toEqual(UI_APP);
      expect(payload).not.toHaveProperty('snapshot');
    });

    it('does not require redirect URLs', async () => {
      await expect(uploadCommand({ yes: true })).resolves.toBeUndefined();
      expect(appService.uploadApp).toHaveBeenCalled();
    });

    it('still requires redirect URLs for an OAuth app', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue({
        ...BASE_CONFIG,
        auth: { scopes: ['contacts:read'] },
      });

      await expect(uploadCommand({ yes: true })).rejects.toThrow(/OAuth apps need at least one/i);
      expect(appService.uploadApp).not.toHaveBeenCalled();
    });

    // The auth block's shape follows the app type; a mismatch is a hard error
    // rather than a silent ignore — the CLI is the only layer that will ever
    // tell the partner (validateAuthShape).
    it('rejects a UI app config with no auth block', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue({
        ...UI_CONFIG,
        auth: undefined,
      });

      await expect(uploadCommand({ yes: true })).rejects.toThrow(/set `auth` to `\{\}`/);
      expect(appService.uploadApp).not.toHaveBeenCalled();
    });

    it('rejects a UI app whose auth still carries OAuth fields', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue({
        ...UI_CONFIG,
        auth: { scopes: [] },
      });

      await expect(uploadCommand({ yes: true })).rejects.toThrow(/don't use OAuth/i);
      expect(appService.uploadApp).not.toHaveBeenCalled();
    });

    // UI apps have no OAuth block on the wire either — the whole auth key is
    // omitted, not sent with empty arrays (assumed contract, tracked in
    // RELEASE-CHECKLIST.md → Before UI-apps GA).
    it('omits the auth key from the upload payload', async () => {
      await uploadCommand({ yes: true });

      const payload = (appService.uploadApp as jest.Mock).mock.calls[0][1];
      expect(payload).not.toHaveProperty('auth');
    });

    it('writes auth back as exactly the empty object', async () => {
      await uploadCommand({ yes: true });

      expect(writeProjectConfig).toHaveBeenCalledWith(expect.objectContaining({ auth: {} }));
    });

    // The regression this guards: `hasNoChanges` compared every field *except*
    // the ui_app block, so a block-only edit reported "Already up to date" and
    // silently never reached the server.
    it('uploads when only the ui_app block changed', async () => {
      (appService.fetchApp as jest.Mock).mockResolvedValue({
        ...UI_REMOTE,
        ui_app: { ...UI_APP, heading: 'Old Heading' },
      });

      await uploadCommand({ yes: true });

      expect(appService.uploadApp).toHaveBeenCalled();
      const payload = (appService.uploadApp as jest.Mock).mock.calls[0][1];
      expect(payload.ui_app.heading).toBe('Invoice Manager');
    });

    it('reports up to date when the ui_app block matches the server', async () => {
      (appService.fetchApp as jest.Mock).mockResolvedValue({ ...UI_REMOTE, ui_app: UI_APP });

      await uploadCommand({ json: true });

      expect(appService.uploadApp).not.toHaveBeenCalled();
      const parsed = JSON.parse(stdoutSpy.mock.calls.map((c: [string]) => c[0]).join(''));
      expect(parsed.upToDate).toBe(true);
    });

    // Key order in app-config.json varies with how it was edited; a raw
    // stringify comparison would report phantom drift.
    it('treats a reordered ui_app block as unchanged', async () => {
      (appService.fetchApp as jest.Mock).mockResolvedValue({
        ...UI_REMOTE,
        ui_app: {
          linkTarget: '_blank' as const,
          redirectLink: 'https://example.com/brevo',
          subheading: 'Review invoice history for this contact',
          heading: 'Invoice Manager',
          surfacePointList: ['contactDetails.headerMenu.action'],
          extensionType: 'actionLink' as const,
        },
      });

      await uploadCommand({ json: true });

      expect(appService.uploadApp).not.toHaveBeenCalled();
    });

    // Slot names are matched by exact string equality and an unregistered name is
    // silently DROPPED by the backend, so these two are the highest-value checks
    // in the whole UI-app flow — nothing downstream would ever report them.
    it('rejects an extension point that is not in the registry', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue({
        ...UI_CONFIG,
        ui_app: { ...UI_APP, surfacePointList: ['contact.headerMenu.action'] },
      });

      await expect(uploadCommand({ yes: true })).rejects.toThrow(/Unknown extension point/i);
      expect(appService.uploadApp).not.toHaveBeenCalled();
    });

    // Widget slots upload now: the UI kit renders an actionLink on both kinds — a widget
    // slot gets a redirect CTA card, an action slot a menu entry — so the previous
    // action-slots-only restriction left nine of the twelve registered slots unreachable.
    it('accepts a widget slot for an action link', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue({
        ...UI_CONFIG,
        ui_app: { ...UI_APP, surfacePointList: ['contactDetails.overviewMain.widget'] },
      });

      await uploadCommand({ yes: true });

      expect(appService.uploadApp).toHaveBeenCalled();
    });

    it('rejects an empty surfacePointList', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue({
        ...UI_CONFIG,
        ui_app: { ...UI_APP, surfacePointList: [] },
      });

      await expect(uploadCommand({ yes: true })).rejects.toThrow(/at least one extension point/i);
    });

    it('accepts multiple record pages', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue({
        ...UI_CONFIG,
        ui_app: {
          ...UI_APP,
          surfacePointList: [
            'contactDetails.headerMenu.action',
            'dealDetails.headerMenu.action',
            'companyDetails.headerMenu.action',
          ],
        },
      });

      await uploadCommand({ yes: true });

      const payload = (appService.uploadApp as jest.Mock).mock.calls[0][1];
      expect(payload.ui_app.surfacePointList).toHaveLength(3);
    });

    it('rejects duplicate extension points', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue({
        ...UI_CONFIG,
        ui_app: {
          ...UI_APP,
          surfacePointList: [
            'contactDetails.headerMenu.action',
            'contactDetails.headerMenu.action',
          ],
        },
      });

      await expect(uploadCommand({ yes: true })).rejects.toThrow(/duplicate/i);
    });

    it('rejects an insecure redirect link', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue({
        ...UI_CONFIG,
        ui_app: { ...UI_APP, redirectLink: 'http://example.com/brevo' },
      });

      await expect(uploadCommand({ yes: true })).rejects.toThrow(/must use https/i);
      expect(appService.uploadApp).not.toHaveBeenCalled();
    });

    it('rejects an empty heading', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue({
        ...UI_CONFIG,
        ui_app: { ...UI_APP, heading: '  ' },
      });

      await expect(uploadCommand({ yes: true })).rejects.toThrow(/Heading cannot be empty/i);
    });

    it('rejects an invalid linkTarget', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue({
        ...UI_CONFIG,
        ui_app: { ...UI_APP, linkTarget: '_top' },
      });

      await expect(uploadCommand({ yes: true })).rejects.toThrow(/Invalid ui_app.linkTarget/i);
    });

    // legacyComponent is the pre-extensibility interpreter path, driven by the UI kit's own
    // config registry rather than by a snapshot — never partner-authored. The pre-BEX-350
    // snake_case spellings are refused too: the CLI only ever writes canonical camelCase.
    it.each([['legacyComponent'], ['action_link'], ['iframe_extension']])(
      'rejects the non-authorable %s type',
      async (extensionType) => {
        (readProjectConfig as jest.Mock).mockReturnValue({
          ...UI_CONFIG,
          ui_app: { ...UI_APP, extensionType },
        });

        await expect(uploadCommand({ yes: true })).rejects.toThrow(
          /Unsupported ui_app.extensionType/i,
        );
      },
    );

    // iframeExtension uploads now — the UI kit ships modal rendering on both the card and
    // the header-menu path, so the surface the old block cited as missing exists.
    it('uploads an iframeExtension with a modalIframeUrl', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue({
        ...UI_CONFIG,
        ui_app: {
          extensionType: 'iframeExtension',
          surfacePointList: ['contactDetails.headerMenu.action'],
          heading: 'Invoice Manager',
          modalIframeUrl: 'https://example.com/embed',
        },
      });

      await uploadCommand({ yes: true });

      expect(appService.uploadApp).toHaveBeenCalled();
    });

    it('rejects an iframeExtension carrying a redirectLink', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue({
        ...UI_CONFIG,
        ui_app: {
          extensionType: 'iframeExtension',
          surfacePointList: ['contactDetails.headerMenu.action'],
          heading: 'Invoice Manager',
          modalIframeUrl: 'https://example.com/embed',
          redirectLink: 'https://example.com/go',
        },
      });

      await expect(uploadCommand({ yes: true })).rejects.toThrow(/cannot be combined/i);
      expect(appService.uploadApp).not.toHaveBeenCalled();
    });

    // context is a request to narrow, checked locally only for shape. Whether a name is
    // ALLOWED is a server-side check against the extension-point registry, whose allow-list
    // the CLI cannot read.
    it('uploads a context narrowing', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue({
        ...UI_CONFIG,
        ui_app: { ...UI_APP, context: ['contactId'] },
      });

      await uploadCommand({ yes: true });

      const payload = (appService.uploadApp as jest.Mock).mock.calls[0][1];
      expect(payload.ui_app.context).toEqual(['contactId']);
    });

    it.each([
      ['a duplicated context field', ['contactId', 'contactId']],
      ['an empty context field name', ['contactId', '']],
    ])('rejects %s', async (_label, context) => {
      (readProjectConfig as jest.Mock).mockReturnValue({
        ...UI_CONFIG,
        ui_app: { ...UI_APP, context },
      });

      await expect(uploadCommand({ yes: true })).rejects.toThrow(/ui_app.context/i);
      expect(appService.uploadApp).not.toHaveBeenCalled();
    });

    // The UI kit drops modalIframeUrl for anything that isn't an
    // iframeExtension, so authoring one on an action link is a silent no-op.
    it('rejects modalIframeUrl on an action link', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue({
        ...UI_CONFIG,
        ui_app: { ...UI_APP, modalIframeUrl: 'https://example.com/modal' },
      });

      await expect(uploadCommand({ yes: true })).rejects.toThrow(/only used by "iframeExtension"/i);
    });

    it('writes the ui_app block back into app-config.json, preferring the server copy', async () => {
      // The server defaults linkTarget, so its copy is the authority.
      const serverNormalized = { ...UI_APP, linkTarget: '_self' as const };
      (appService.uploadApp as jest.Mock).mockResolvedValue({
        ...BASE_UPLOAD_RESPONSE,
        name: 'Invoice Manager',
        auth: { distribution_type: 'private' as const, scopes: ['contacts:read'] },
        ui_app: serverNormalized,
      });

      await uploadCommand({ yes: true });

      expect(writeProjectConfig).toHaveBeenCalledWith(
        expect.objectContaining({ ui_app: serverNormalized }),
      );
    });

    it('keeps the locally sent ui_app block when the server does not echo one', async () => {
      await uploadCommand({ yes: true });

      expect(writeProjectConfig).toHaveBeenCalledWith(expect.objectContaining({ ui_app: UI_APP }));
    });

    it('does not add a redirectUrls key back into a UI app config', async () => {
      await uploadCommand({ yes: true });

      const written = (writeProjectConfig as jest.Mock).mock.calls[0][0];
      expect(written.auth).not.toHaveProperty('redirectUrls');
    });

    it('renders the ui_app fields in the diff, without a Redirect URLs row', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue({ ...UI_CONFIG, appName: 'Renamed' });
      (appService.uploadApp as jest.Mock).mockResolvedValue({
        ...BASE_UPLOAD_RESPONSE,
        name: 'Renamed',
        auth: { distribution_type: 'private' as const, scopes: ['contacts:read'] },
      });

      await uploadCommand({ yes: true });

      const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
      expect(output).toContain('contactDetails.headerMenu.action');
      expect(output).toContain('Link target');
      expect(output).not.toContain('Redirect URLs');
    });
  });
});
