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

  it('POSTs the correct wire shape — top-level distribution_type, app_version, redirect_uris under auth', async () => {
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
      app_version: '1.0.0',
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

  it('never sends a ui_app field', async () => {
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
});
