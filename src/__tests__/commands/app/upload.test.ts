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
  auth: { scopes: ['contacts:read'], redirectUrls: ['http://localhost:3009/auth/callback'] },
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
      auth: { ...BASE_CONFIG.auth, redirectUrls: ['http://localhost:9999/auth/callback'] },
    };
    (readProjectConfig as jest.Mock).mockReturnValue(changedConfig);
    (appService.uploadApp as jest.Mock).mockResolvedValue({
      ...BASE_REMOTE,
      auth: { ...BASE_REMOTE, redirect_urls: ['http://localhost:9999/auth/callback'] },
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
    (appService.uploadApp as jest.Mock).mockResolvedValue({ ...BASE_REMOTE, name: 'Renamed App' });

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

  it('POSTs the correct wire shape — distribution_type nested under auth, app_version, redirect_urls', async () => {
    const changedConfig = { ...BASE_CONFIG, appName: 'Renamed App' };
    (readProjectConfig as jest.Mock).mockReturnValue(changedConfig);
    (appService.uploadApp as jest.Mock).mockResolvedValue({ ...BASE_REMOTE, name: 'Renamed App' });

    await uploadCommand({ yes: true });

    expect(appService.uploadApp).toHaveBeenCalledWith('1', {
      app_id: '1',
      name: 'Renamed App',
      logo_uri: '',
      app_version: '1.0.0',
      auth: {
        distribution_type: 'private',
        scopes: ['contacts:read'],
        redirect_urls: ['http://localhost:3009/auth/callback'],
      },
    });
  });

  it('never sends a ui_app field', async () => {
    const changedConfig = { ...BASE_CONFIG, appName: 'Renamed App' };
    (readProjectConfig as jest.Mock).mockReturnValue(changedConfig);
    (appService.uploadApp as jest.Mock).mockResolvedValue({ ...BASE_REMOTE, name: 'Renamed App' });

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
      app_version: '2.0.0',
      auth: {
        distribution_type: 'private',
        scopes: ['contacts:read'],
        redirect_urls: ['http://localhost:3009/auth/callback'],
      },
    });

    await uploadCommand({ yes: true });

    expect(writeProjectConfig).toHaveBeenCalledWith(
      expect.objectContaining({ appName: 'Renamed App', version: '2.0.0' }),
    );
    expect(saveAppName).toHaveBeenCalledWith('1', 'Renamed App');
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
      auth: { ...BASE_CONFIG.auth, redirectUrls: [] },
    });

    await expect(uploadCommand({ yes: true })).rejects.toThrow(/no redirect URLs/i);
  });

  it('rejects an invalid redirect URL protocol', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue({
      ...BASE_CONFIG,
      auth: { ...BASE_CONFIG.auth, redirectUrls: ['ftp://bad'] },
    });

    await expect(uploadCommand({ yes: true })).rejects.toThrow(/http:\/\/ or https:\/\//);
  });

  it('outputs structured JSON including the diff under --json, with no prompt', async () => {
    const changedConfig = { ...BASE_CONFIG, appName: 'Renamed App' };
    (readProjectConfig as jest.Mock).mockReturnValue(changedConfig);
    (appService.uploadApp as jest.Mock).mockResolvedValue({ ...BASE_REMOTE, name: 'Renamed App' });

    await uploadCommand({ json: true });

    expect(mockPrompt).not.toHaveBeenCalled();
    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    const parsed = JSON.parse(output);
    expect(parsed.name).toBe('Renamed App');
    expect(parsed.current).toBeDefined();
    expect(parsed.next).toBeDefined();
  });

  it('outputs upToDate JSON (no upload call) when nothing differs under --json', async () => {
    await uploadCommand({ json: true });

    expect(appService.uploadApp).not.toHaveBeenCalled();
    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    const parsed = JSON.parse(output);
    expect(parsed.upToDate).toBe(true);
  });
});
