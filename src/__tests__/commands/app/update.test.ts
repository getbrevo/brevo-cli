import * as fs from 'node:fs';
import { updateCommand } from '../../../commands/app/update';

jest.mock('inquirer', () => ({
  prompt: jest.fn(),
}));

jest.mock('../../../container', () => ({
  appService: {
    fetchAppsList: jest.fn(),
    fetchApp: jest.fn(),
    pickApp: jest.fn(),
    createApp: jest.fn(),
    updateApp: jest.fn(),
    deleteApp: jest.fn(),
  },
  accountService: {
    validateApiKey: jest.fn(),
    getAccount: jest.fn(),
  },
  client: {},
}));

jest.mock('node:fs');

jest.mock('../../../lib/config', () => ({
  readProjectConfig: jest.fn(),
  writeProjectConfig: jest.fn(),
  hasLocalApp: jest.fn(),
  getApiKey: jest.fn().mockReturnValue('test-key'),
  getAppCredentials: jest.fn(),
  saveAppCredentials: jest.fn(),
  saveAppName: jest.fn(),
}));

import inquirer from 'inquirer';
import { appService } from '../../../container';
import { readProjectConfig, writeProjectConfig } from '../../../lib/config';

const VALID_CONFIG = {
  appId: '42',
  appName: 'My Test App',
  auth: {
    type: 'private',
    scopes: ['global'],
    redirectUrls: ['http://localhost:3000/callback', 'https://myapp.com/callback'],
  },
  distribution: 'private',
};

describe('app/update', () => {
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
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    if (originalIsTTYDescriptor) {
      Object.defineProperty(process.stdin, 'isTTY', originalIsTTYDescriptor);
    } else {
      Reflect.deleteProperty(process.stdin, 'isTTY');
    }
  });

  // ── Current behavior (no flags) ──

  it('should throw when no config and no flags', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(null);

    await expect(updateCommand({})).rejects.toThrow('Nothing to update');
  });

  it('should read config and update app with redirect URLs (no flags)', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(VALID_CONFIG);
    (appService.fetchApp as jest.Mock).mockResolvedValue({
      app_id: '42',
      name: 'My Test App',
      redirect_uris: ['http://localhost:3000/callback', 'https://myapp.com/callback'],
    });
    (appService.updateApp as jest.Mock).mockResolvedValue({
      app_id: '42',
      name: 'My Test App',
      redirect_uris: ['http://localhost:3000/callback', 'https://myapp.com/callback'],
    });

    await updateCommand({ yes: true });

    expect(appService.updateApp).toHaveBeenCalledWith('42', {
      name: 'My Test App',
      redirect_uris: ['http://localhost:3000/callback', 'https://myapp.com/callback'],
      scopes: ['global'],
    });
    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('updated');
  });

  it('should output JSON when --json flag is used (no flags)', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(VALID_CONFIG);
    (appService.updateApp as jest.Mock).mockResolvedValue(undefined);

    await updateCommand({ yes: true, json: true });

    const output = stdoutSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed).toEqual({
      app_id: '42',
      name: 'My Test App',
      redirect_uris: ['http://localhost:3000/callback', 'https://myapp.com/callback'],
      scopes: ['global'],
    });
  });

  it('should throw when app-config.json has an empty appId', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue({
      appId: '',
      appName: 'Test',
      auth: { redirectUrls: ['http://localhost:3000'] },
    });

    await expect(updateCommand({})).rejects.toThrow('invalid "appId"');
  });

  it('should throw when app-config.json has no redirect URLs (no flags)', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue({
      appId: '42',
      appName: 'Test',
      auth: { type: 'private', scopes: [], redirectUrls: [] },
      distribution: 'private',
    });

    await expect(updateCommand({})).rejects.toThrow('no redirect URLs');
  });

  // ── Flag-based: --name ──

  it('should update name from flag and keep existing redirect URLs from config', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(VALID_CONFIG);
    (appService.updateApp as jest.Mock).mockResolvedValue({
      app_id: '42',
      name: 'New Name',
      redirect_uris: ['http://localhost:3000/callback', 'https://myapp.com/callback'],
    });

    await updateCommand({ name: 'New Name', yes: true });

    expect(appService.updateApp).toHaveBeenCalledWith('42', {
      name: 'New Name',
      redirect_uris: ['http://localhost:3000/callback', 'https://myapp.com/callback'],
      scopes: ['global'],
    });
    expect(writeProjectConfig).toHaveBeenCalledWith(
      expect.objectContaining({ appName: 'New Name' }),
    );
  });

  // ── Flag-based: --redirect-uri ──

  it('should append redirect URL from flag and deduplicate', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(VALID_CONFIG);
    (appService.updateApp as jest.Mock).mockResolvedValue({
      app_id: '42',
      name: 'My Test App',
      redirect_uris: [
        'http://localhost:3000/callback',
        'https://myapp.com/callback',
        'https://new.com/callback',
      ],
    });

    await updateCommand({ redirectUri: ['https://new.com/callback'], yes: true });

    expect(appService.updateApp).toHaveBeenCalledWith('42', {
      name: 'My Test App',
      redirect_uris: [
        'http://localhost:3000/callback',
        'https://myapp.com/callback',
        'https://new.com/callback',
      ],
      scopes: ['global'],
    });
    expect(writeProjectConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: expect.objectContaining({
          redirectUrls: [
            'http://localhost:3000/callback',
            'https://myapp.com/callback',
            'https://new.com/callback',
          ],
        }),
      }),
    );
  });

  it('should not duplicate an existing redirect URL', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(VALID_CONFIG);
    (appService.updateApp as jest.Mock).mockResolvedValue({
      app_id: '42',
      name: 'My Test App',
      redirect_uris: ['http://localhost:3000/callback', 'https://myapp.com/callback'],
    });

    await updateCommand({ redirectUri: ['http://localhost:3000/callback'], yes: true });

    expect(appService.updateApp).toHaveBeenCalledWith('42', {
      name: 'My Test App',
      redirect_uris: ['http://localhost:3000/callback', 'https://myapp.com/callback'],
      scopes: ['global'],
    });
  });

  // ── Flag-based: --app-id ──

  it('should use --app-id and fetch from API when no config', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(null);
    (appService.fetchApp as jest.Mock).mockResolvedValue({
      app_id: '99',
      name: 'API App',
      redirect_uris: ['https://old.com/callback'],
    });
    (appService.updateApp as jest.Mock).mockResolvedValue({
      app_id: '99',
      name: 'Renamed',
      redirect_uris: ['https://old.com/callback'],
    });

    await updateCommand({ appId: '99', name: 'Renamed', yes: true });

    expect(appService.fetchApp).toHaveBeenCalledWith('99');
    expect(appService.updateApp).toHaveBeenCalledWith('99', {
      name: 'Renamed',
      redirect_uris: ['https://old.com/callback'],
      scopes: [],
    });
    expect(writeProjectConfig).not.toHaveBeenCalled();
  });

  it('should not write back when --app-id differs from config appId', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(VALID_CONFIG); // appId: '42'
    (appService.fetchApp as jest.Mock).mockResolvedValue({
      app_id: '99',
      name: 'Other App',
      redirect_uris: ['https://other.com/callback'],
    });
    (appService.updateApp as jest.Mock).mockResolvedValue({
      app_id: '99',
      name: 'Other App',
      redirect_uris: ['https://other.com/callback', 'https://new.com/cb'],
    });

    await updateCommand({ appId: '99', redirectUri: ['https://new.com/cb'], yes: true });

    expect(appService.fetchApp).toHaveBeenCalledWith('99');
    expect(writeProjectConfig).not.toHaveBeenCalled();
  });

  it('should write back when --app-id matches config appId', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(VALID_CONFIG);
    (appService.updateApp as jest.Mock).mockResolvedValue({
      app_id: '42',
      name: 'Updated',
      redirect_uris: ['http://localhost:3000/callback', 'https://myapp.com/callback'],
    });

    await updateCommand({ appId: '42', name: 'Updated', yes: true });

    expect(writeProjectConfig).toHaveBeenCalledWith(
      expect.objectContaining({ appName: 'Updated' }),
    );
  });

  // ── Success summary is built from values we sent (server only returns a message) ──

  it('should print the redirect URLs that were sent (no flags)', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(VALID_CONFIG);
    (appService.fetchApp as jest.Mock).mockResolvedValue({
      app_id: '42',
      name: 'My Test App',
      redirect_uris: ['http://localhost:3000/callback', 'https://myapp.com/callback'],
    });
    (appService.updateApp as jest.Mock).mockResolvedValue(undefined);

    await updateCommand({ yes: true });

    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    const afterSuccess = output.split('App updated.')[1] || '';
    expect(afterSuccess).toContain('Name:          My Test App');
    expect(afterSuccess).toContain(
      'Redirect URLs: http://localhost:3000/callback, https://myapp.com/callback',
    );
  });

  it('should print the redirect URLs that were sent (with flags)', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(null);
    (appService.fetchApp as jest.Mock).mockResolvedValue({
      app_id: '99',
      name: 'API App',
      redirect_uris: ['https://old.com/callback'],
    });
    (appService.updateApp as jest.Mock).mockResolvedValue(undefined);

    await updateCommand({ appId: '99', name: 'Renamed', yes: true });

    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    const afterSuccess = output.split('App updated.')[1] || '';
    expect(afterSuccess).toContain('Name:          Renamed');
    expect(afterSuccess).toContain('Redirect URLs: https://old.com/callback');
  });

  // ── Error cases ──

  it('should throw when --app-id provided without flags and no config', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(null);

    await expect(updateCommand({ appId: '42' })).rejects.toThrow('Nothing to update');
  });

  it('should throw when --app-id differs from config appId and no flags', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(VALID_CONFIG); // appId: '42'
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(VALID_CONFIG));

    await expect(updateCommand({ appId: '99' })).rejects.toThrow(/does not match/);

    // Must NOT push app 42's config values to app 99
    expect(appService.updateApp).not.toHaveBeenCalled();
  });

  it('should surface invalid-appId error over mismatch when config appId is empty', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue({
      appId: '',
      appName: 'Test',
      auth: { redirectUrls: ['http://localhost:3000'] },
    });

    await expect(updateCommand({ appId: '99' })).rejects.toThrow('invalid "appId"');
    expect(appService.updateApp).not.toHaveBeenCalled();
  });

  it('should accept a UUID --app-id and update via the UUID endpoint', async () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    (readProjectConfig as jest.Mock).mockReturnValue(null);
    (appService.fetchApp as jest.Mock).mockResolvedValue({
      app_id: uuid,
      name: 'UUID App',
      redirect_uris: ['http://localhost:3000/callback'],
    });
    (appService.updateApp as jest.Mock).mockResolvedValue({
      app_id: uuid,
      name: 'Renamed',
      redirect_uris: ['http://localhost:3000/callback'],
    });

    await updateCommand({ appId: uuid, name: 'Renamed', yes: true });

    expect(appService.fetchApp).toHaveBeenCalledWith(uuid);
    expect(appService.updateApp).toHaveBeenCalledWith(uuid, {
      name: 'Renamed',
      redirect_uris: ['http://localhost:3000/callback'],
      scopes: [],
    });
  });

  it('should stop spinner when fetchApp rejects (no stale activeSpinner)', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(null);
    (appService.fetchApp as jest.Mock).mockRejectedValue(new Error('network down'));

    await expect(updateCommand({ appId: '42', name: 'New Name', yes: true })).rejects.toThrow(
      'network down',
    );

    // Re-import here to read the module-scoped activeSpinner via stopActiveSpinner.
    // If the spinner wasn't stopped, a second createSpinner call would tear it down
    // (which is also acceptable), but the critical check is no unhandled interval.
    const { stopActiveSpinner } = await import('../../../lib/ui');
    expect(() => stopActiveSpinner()).not.toThrow();
  });

  it('should throw when app not found via API', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(null);
    (appService.fetchApp as jest.Mock).mockResolvedValue(null);

    await expect(updateCommand({ appId: '999', name: 'Test' })).rejects.toThrow('not found');
  });

  // ── JSON output with flags ──

  it('should output JSON with flags', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(VALID_CONFIG);
    (appService.updateApp as jest.Mock).mockResolvedValue(undefined);

    await updateCommand({ name: 'New Name', yes: true, json: true });

    const output = stdoutSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed).toEqual({
      app_id: '42',
      name: 'New Name',
      redirect_uris: ['http://localhost:3000/callback', 'https://myapp.com/callback'],
      scopes: ['global'],
    });
  });

  // ── Confirmation prompt ──

  it('should show update summary before confirming (no flags)', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(VALID_CONFIG);
    (appService.fetchApp as jest.Mock).mockResolvedValue({
      app_id: '42',
      name: 'My Test App',
      redirect_uris: ['http://localhost:3000/callback', 'https://myapp.com/callback'],
    });
    (appService.updateApp as jest.Mock).mockResolvedValue({
      app_id: '42',
      name: 'My Test App',
      redirect_uris: ['http://localhost:3000/callback', 'https://myapp.com/callback'],
    });
    (inquirer.prompt as unknown as jest.Mock).mockResolvedValue({ confirmed: true });

    await updateCommand({});

    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('Update summary:');
    expect(output).toContain('42');
    expect(output).toContain('My Test App');
    expect(output).toContain('http://localhost:3000/callback');
    expect(output).toContain('https://myapp.com/callback');
    expect(appService.updateApp).toHaveBeenCalled();
  });

  it('should cancel update when user declines confirmation (no flags)', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(VALID_CONFIG);
    (appService.fetchApp as jest.Mock).mockResolvedValue({
      app_id: '42',
      name: 'My Test App',
      redirect_uris: ['http://localhost:3000/callback', 'https://myapp.com/callback'],
    });
    (inquirer.prompt as unknown as jest.Mock).mockResolvedValue({ confirmed: false });

    await updateCommand({});

    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('Update cancelled.');
    expect(appService.updateApp).not.toHaveBeenCalled();
  });

  it('should cancel update when user declines confirmation (with flags)', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(VALID_CONFIG);
    (inquirer.prompt as unknown as jest.Mock).mockResolvedValue({ confirmed: false });

    await updateCommand({ name: 'New Name' });

    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('Update cancelled.');
    expect(appService.updateApp).not.toHaveBeenCalled();
  });

  it('should show name change with arrow in summary when name differs', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(VALID_CONFIG);
    (appService.updateApp as jest.Mock).mockResolvedValue({
      app_id: '42',
      name: 'New Name',
      redirect_uris: ['http://localhost:3000/callback', 'https://myapp.com/callback'],
    });
    (inquirer.prompt as unknown as jest.Mock).mockResolvedValue({ confirmed: true });

    await updateCommand({ name: 'New Name' });

    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('My Test App → New Name');
  });

  it('should mark new redirect URLs in summary', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(VALID_CONFIG);
    (appService.updateApp as jest.Mock).mockResolvedValue({
      app_id: '42',
      name: 'My Test App',
      redirect_uris: [
        'http://localhost:3000/callback',
        'https://myapp.com/callback',
        'https://new.com/callback',
      ],
    });
    (inquirer.prompt as unknown as jest.Mock).mockResolvedValue({ confirmed: true });

    await updateCommand({ redirectUri: ['https://new.com/callback'] });

    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('https://new.com/callback (new)');
  });

  // ── Non-interactive mode ──

  it('should throw in non-interactive mode without --yes or --json (no flags)', async () => {
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      value: undefined,
    });
    (readProjectConfig as jest.Mock).mockReturnValue(VALID_CONFIG);

    await expect(updateCommand({})).rejects.toThrow('non-interactive mode');
  });

  it('should throw in non-interactive mode without --yes or --json (with flags)', async () => {
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      value: undefined,
    });
    (readProjectConfig as jest.Mock).mockReturnValue(VALID_CONFIG);

    await expect(updateCommand({ name: 'New Name' })).rejects.toThrow('non-interactive mode');
  });

  // ── Diff vs. remote state (no flags / config push) ──

  it('should show name arrow when config name differs from remote (no flags)', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(VALID_CONFIG);
    (appService.fetchApp as jest.Mock).mockResolvedValue({
      app_id: '42',
      name: 'Old Remote Name',
      redirect_uris: ['http://localhost:3000/callback', 'https://myapp.com/callback'],
    });
    (appService.updateApp as jest.Mock).mockResolvedValue({
      app_id: '42',
      name: 'My Test App',
      redirect_uris: ['http://localhost:3000/callback', 'https://myapp.com/callback'],
    });

    await updateCommand({ yes: true });

    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    const summary = output.split('updated successfully')[0];
    expect(summary).toContain('Old Remote Name → My Test App');
  });

  it('should mark (new) on URLs in config missing from remote (no flags)', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(VALID_CONFIG);
    (appService.fetchApp as jest.Mock).mockResolvedValue({
      app_id: '42',
      name: 'My Test App',
      redirect_uris: ['http://localhost:3000/callback'],
    });
    (appService.updateApp as jest.Mock).mockResolvedValue({
      app_id: '42',
      name: 'My Test App',
      redirect_uris: ['http://localhost:3000/callback', 'https://myapp.com/callback'],
    });

    await updateCommand({ yes: true });

    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    const summary = output.split('updated successfully')[0];
    expect(summary).toContain('https://myapp.com/callback (new)');
  });

  it('should mark (removed) on URLs in remote missing from config (no flags)', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(VALID_CONFIG);
    (appService.fetchApp as jest.Mock).mockResolvedValue({
      app_id: '42',
      name: 'My Test App',
      redirect_uris: [
        'http://localhost:3000/callback',
        'https://myapp.com/callback',
        'https://gone.com/callback',
      ],
    });
    (appService.updateApp as jest.Mock).mockResolvedValue({
      app_id: '42',
      name: 'My Test App',
      redirect_uris: ['http://localhost:3000/callback', 'https://myapp.com/callback'],
    });

    await updateCommand({ yes: true });

    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    const summary = output.split('updated successfully')[0];
    expect(summary).toContain('https://gone.com/callback (removed)');
  });

  it('should show no markers when config matches remote exactly (no flags)', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(VALID_CONFIG);
    (appService.fetchApp as jest.Mock).mockResolvedValue({
      app_id: '42',
      name: 'My Test App',
      redirect_uris: ['http://localhost:3000/callback', 'https://myapp.com/callback'],
      scopes: ['global'],
    });
    (appService.updateApp as jest.Mock).mockResolvedValue({
      app_id: '42',
      name: 'My Test App',
      redirect_uris: ['http://localhost:3000/callback', 'https://myapp.com/callback'],
      scopes: ['global'],
    });

    await updateCommand({ yes: true });

    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    const summary = output.split('updated successfully')[0];
    expect(summary).not.toContain('(new)');
    expect(summary).not.toContain('(removed)');
    expect(summary).not.toContain('→');
    // Push still happens per design (option B).
    expect(appService.updateApp).toHaveBeenCalled();
  });

  it('should hard-fail without pushing when fetch fails (no flags)', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(VALID_CONFIG);
    (appService.fetchApp as jest.Mock).mockRejectedValue(new Error('network down'));

    await expect(updateCommand({ yes: true })).rejects.toThrow('network down');
    expect(appService.updateApp).not.toHaveBeenCalled();
  });

  it('should hard-fail when remote returns null (no flags)', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(VALID_CONFIG);
    (appService.fetchApp as jest.Mock).mockResolvedValue(null);

    await expect(updateCommand({ yes: true })).rejects.toThrow('App 42 not found');
    expect(appService.updateApp).not.toHaveBeenCalled();
  });

  it('should skip fetch in --json mode (no flags)', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(VALID_CONFIG);
    (appService.updateApp as jest.Mock).mockResolvedValue({
      app_id: '42',
      name: 'My Test App',
      redirect_uris: ['http://localhost:3000/callback', 'https://myapp.com/callback'],
    });

    await updateCommand({ yes: true, json: true });

    expect(appService.fetchApp).not.toHaveBeenCalled();
    expect(appService.updateApp).toHaveBeenCalled();
  });

  // ── logo_uri ──

  it('should treat --logo-uri alone as a flag-driven update', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    (readProjectConfig as jest.Mock).mockReturnValue(null);
    (appService.fetchApp as jest.Mock).mockResolvedValue({
      app_id: '42',
      name: 'Remote Name',
      client_id: 'cli',
      redirect_uris: ['https://example.com/cb'],
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    });

    await updateCommand({
      appId: '42',
      logoUri: 'https://example.com/logo.png',
      yes: true,
    });

    expect(appService.updateApp).toHaveBeenCalledWith(
      '42',
      expect.objectContaining({ logo_uri: 'https://example.com/logo.png' }),
    );
  });

  it('should preserve existing logo_uri from remote when --logo-uri is not passed', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    (readProjectConfig as jest.Mock).mockReturnValue(null);
    (appService.fetchApp as jest.Mock).mockResolvedValue({
      app_id: '42',
      name: 'Remote',
      client_id: 'cli',
      redirect_uris: ['https://example.com/cb'],
      logo_uri: 'https://existing.example.com/logo.png',
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    });

    await updateCommand({ appId: '42', name: 'Renamed', yes: true });

    expect(appService.updateApp).toHaveBeenCalledWith(
      '42',
      expect.objectContaining({ logo_uri: 'https://existing.example.com/logo.png' }),
    );
  });

  it('should push logoUri from app-config.json on flagless update', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue({
      ...VALID_CONFIG,
      logoUri: 'https://example.com/from-config.png',
    });
    (appService.fetchApp as jest.Mock).mockResolvedValue({
      app_id: '42',
      name: 'My Test App',
      client_id: 'cli',
      redirect_uris: VALID_CONFIG.auth.redirectUrls,
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    });

    await updateCommand({ yes: true });

    expect(appService.updateApp).toHaveBeenCalledWith(
      '42',
      expect.objectContaining({ logo_uri: 'https://example.com/from-config.png' }),
    );
  });

  it('should write logoUri back into app-config.json when --logo-uri matches the local app', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue({ ...VALID_CONFIG });

    await updateCommand({
      logoUri: 'https://example.com/new.png',
      yes: true,
    });

    expect(writeProjectConfig).toHaveBeenCalledWith(
      expect.objectContaining({ logoUri: 'https://example.com/new.png' }),
    );
  });

  it('should omit logo_uri from the PUT body when no flag and no config logoUri', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue({ ...VALID_CONFIG });
    (appService.fetchApp as jest.Mock).mockResolvedValue({
      app_id: '42',
      name: 'My Test App',
      client_id: 'cli',
      redirect_uris: VALID_CONFIG.auth.redirectUrls,
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    });

    await updateCommand({ yes: true });

    const body = (appService.updateApp as jest.Mock).mock.calls[0][1];
    expect(body).not.toHaveProperty('logo_uri');
  });

  describe('--scope flag', () => {
    it("appends new scopes to the app's existing scopes, de-duped, preserving order", async () => {
      (readProjectConfig as jest.Mock).mockReturnValue(null);
      (appService.fetchApp as jest.Mock).mockResolvedValue({
        app_id: '42',
        name: 'My App',
        redirect_uris: ['https://x/cb'],
        scopes: ['contacts:read', 'crm:read'],
      });

      await updateCommand({
        appId: '42',
        scope: ['crm:read', 'crm:write'],
        yes: true,
      });

      expect(appService.updateApp).toHaveBeenCalledWith(
        '42',
        expect.objectContaining({
          scopes: ['contacts:read', 'crm:read', 'crm:write'],
        }),
      );
    });

    it('writes merged scopes back to app-config.json when config is the source', async () => {
      const config = {
        appId: '42',
        appName: 'My App',
        auth: {
          type: 'private',
          scopes: ['contacts:read'],
          redirectUrls: ['https://x/cb'],
        },
        distribution: 'private',
      };
      (readProjectConfig as jest.Mock).mockReturnValue(config);

      await updateCommand({ scope: ['crm:write'], yes: true });

      const writeArg = (writeProjectConfig as jest.Mock).mock.calls[0][0];
      expect(writeArg.auth.scopes).toEqual(['contacts:read', 'crm:write']);
    });

    it('coexists with --name and --redirect-uri in a single call', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue(null);
      (appService.fetchApp as jest.Mock).mockResolvedValue({
        app_id: '42',
        name: 'Old',
        redirect_uris: ['https://x/old'],
        scopes: ['contacts:read'],
      });

      await updateCommand({
        appId: '42',
        name: 'New',
        redirectUri: ['https://x/new'],
        scope: ['crm:read'],
        yes: true,
      });

      expect(appService.updateApp).toHaveBeenCalledWith('42', {
        name: 'New',
        redirect_uris: ['https://x/old', 'https://x/new'],
        scopes: ['contacts:read', 'crm:read'],
      });
    });

    it('treats --scope as a flag that satisfies hasFlags (no "nothing to update" error)', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue(null);
      (appService.fetchApp as jest.Mock).mockResolvedValue({
        app_id: '42',
        name: 'X',
        redirect_uris: ['https://x/cb'],
        scopes: [],
      });

      await expect(
        updateCommand({ appId: '42', scope: ['crm:read'], yes: true }),
      ).resolves.toBeUndefined();
    });

    it('renders the merged scope list in the pre-confirm summary, marking newly-added entries', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue(null);
      (appService.fetchApp as jest.Mock).mockResolvedValue({
        app_id: '42',
        name: 'My App',
        redirect_uris: ['https://x/cb'],
        scopes: ['contacts:read'],
      });

      await updateCommand({
        appId: '42',
        scope: ['contacts:read', 'crm:write'],
        yes: true,
      });

      const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
      const beforeSuccess = output.split('App updated.')[0];
      expect(beforeSuccess).toContain('Scopes:        contacts:read');
      expect(beforeSuccess).toContain('crm:write (new)');
      expect(beforeSuccess).not.toContain('contacts:read (new)');
    });

    it('renders the existing Scopes line in the pre-confirm summary even when --scope is not passed', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue(null);
      (appService.fetchApp as jest.Mock).mockResolvedValue({
        app_id: '42',
        name: 'My App',
        redirect_uris: ['https://x/cb'],
        scopes: ['contacts:read'],
      });

      await updateCommand({ appId: '42', name: 'Renamed', yes: true });

      const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
      const beforeSuccess = output.split('App updated.')[0];
      expect(beforeSuccess).toContain('Scopes:        contacts:read');
      // No `(new)` or `(removed)` markers when scopes are unchanged.
      expect(beforeSuccess).not.toContain('contacts:read (new)');
      expect(beforeSuccess).not.toContain('contacts:read (removed)');
    });

    it('sends scopes from app-config.json even when only --name is passed', async () => {
      const config = {
        appId: '42',
        appName: 'Old',
        auth: {
          type: 'private',
          scopes: ['contacts:read', 'crm:read'],
          redirectUrls: ['https://x/cb'],
        },
        distribution: 'private',
      };
      (readProjectConfig as jest.Mock).mockReturnValue(config);

      await updateCommand({ name: 'New', yes: true });

      expect(appService.updateApp).toHaveBeenCalledWith(
        '42',
        expect.objectContaining({ scopes: ['contacts:read', 'crm:read'] }),
      );
    });

    it('sends scopes on the no-flag full-config push from app-config.json', async () => {
      const config = {
        appId: '42',
        appName: 'My App',
        auth: {
          type: 'private',
          scopes: ['contacts:read', 'crm:write'],
          redirectUrls: ['https://x/cb'],
        },
        distribution: 'private',
      };
      (readProjectConfig as jest.Mock).mockReturnValue(config);
      (appService.fetchApp as jest.Mock).mockResolvedValue({
        app_id: '42',
        name: 'My App',
        redirect_uris: ['https://x/cb'],
        scopes: ['contacts:read'],
      });

      await updateCommand({ yes: true });

      expect(appService.updateApp).toHaveBeenCalledWith('42', {
        name: 'My App',
        redirect_uris: ['https://x/cb'],
        scopes: ['contacts:read', 'crm:write'],
      });
    });

    it('rejects scopes containing forbidden characters before calling the API', async () => {
      // Simulates a config that survived readProjectConfig's split (no commas/whitespace
      // to split on) but still has an invalid character in a token.
      const config = {
        appId: '42',
        appName: 'My App',
        auth: {
          type: 'private',
          scopes: ['contacts:read', 'crm;read'],
          redirectUrls: ['https://x/cb'],
        },
        distribution: 'private',
      };
      (readProjectConfig as jest.Mock).mockReturnValue(config);

      await expect(updateCommand({ yes: true })).rejects.toThrow(/Invalid scope/);
      expect(appService.updateApp).not.toHaveBeenCalled();
    });

    it("blocks the no-flag full-config push when auth.scopes contains 'all'", async () => {
      (readProjectConfig as jest.Mock).mockReturnValue({
        ...VALID_CONFIG,
        auth: { ...VALID_CONFIG.auth, scopes: ['all'] },
      });

      await expect(updateCommand({ yes: true })).rejects.toThrow(/legacy 'all'/);
      expect(appService.updateApp).not.toHaveBeenCalled();
    });

    it("blocks the no-flag push in --json mode when auth.scopes contains 'all'", async () => {
      (readProjectConfig as jest.Mock).mockReturnValue({
        ...VALID_CONFIG,
        auth: { ...VALID_CONFIG.auth, scopes: ['all'] },
      });

      await expect(updateCommand({ yes: true, json: true })).rejects.toThrow(/legacy 'all'/);
      expect(appService.updateApp).not.toHaveBeenCalled();
    });

    it("blocks a --name-only update when remote scopes contain 'all'", async () => {
      (readProjectConfig as jest.Mock).mockReturnValue(null);
      (appService.fetchApp as jest.Mock).mockResolvedValue({
        app_id: '42',
        name: 'My App',
        redirect_uris: ['https://x/cb'],
        scopes: ['all'],
      });

      await expect(updateCommand({ appId: '42', name: 'Renamed', yes: true })).rejects.toThrow(
        /legacy 'all'/,
      );
      expect(appService.updateApp).not.toHaveBeenCalled();
    });

    it("blocks when --scope explicitly re-adds 'all'", async () => {
      (readProjectConfig as jest.Mock).mockReturnValue(null);
      (appService.fetchApp as jest.Mock).mockResolvedValue({
        app_id: '42',
        name: 'My App',
        redirect_uris: ['https://x/cb'],
        scopes: ['all'],
      });

      await expect(updateCommand({ appId: '42', scope: ['all'], yes: true })).rejects.toThrow(
        /legacy 'all'/,
      );
      expect(appService.updateApp).not.toHaveBeenCalled();
    });

    it("--scope drops 'all' from the baseline and pushes a clean payload", async () => {
      (readProjectConfig as jest.Mock).mockReturnValue(null);
      (appService.fetchApp as jest.Mock).mockResolvedValue({
        app_id: '42',
        name: 'My App',
        redirect_uris: ['https://x/cb'],
        scopes: ['all'],
      });

      await updateCommand({
        appId: '42',
        scope: ['crm:read', 'contacts:read'],
        yes: true,
      });

      expect(appService.updateApp).toHaveBeenCalledWith(
        '42',
        expect.objectContaining({ scopes: ['crm:read', 'contacts:read'] }),
      );
    });

    it("writes migrated scopes (without 'all') back to app-config.json", async () => {
      (readProjectConfig as jest.Mock).mockReturnValue({
        ...VALID_CONFIG,
        auth: { ...VALID_CONFIG.auth, scopes: ['all'] },
      });

      await updateCommand({ scope: ['crm:read'], yes: true });

      const writeArg = (writeProjectConfig as jest.Mock).mock.calls[0][0];
      expect(writeArg.auth.scopes).toEqual(['crm:read']);
    });

    it("renders the migration line and 'all (removed)' in the summary when --scope migrates", async () => {
      (readProjectConfig as jest.Mock).mockReturnValue(null);
      (appService.fetchApp as jest.Mock).mockResolvedValue({
        app_id: '42',
        name: 'My App',
        redirect_uris: ['https://x/cb'],
        scopes: ['all'],
      });

      await updateCommand({
        appId: '42',
        scope: ['crm:read', 'contacts:read'],
        yes: true,
      });

      const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
      const beforeSuccess = output.split('App updated.')[0];
      expect(beforeSuccess).toContain("Migrating from legacy 'all' scope");
      expect(beforeSuccess).toContain('crm:read (new)');
      expect(beforeSuccess).toContain('all (removed)');
    });

    it('does not render the migration line when --scope is passed but existing scopes are granular', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue(null);
      (appService.fetchApp as jest.Mock).mockResolvedValue({
        app_id: '42',
        name: 'My App',
        redirect_uris: ['https://x/cb'],
        scopes: ['contacts:read'],
      });

      await updateCommand({ appId: '42', scope: ['crm:read'], yes: true });

      const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
      expect(output).not.toContain("Migrating from legacy 'all' scope");
    });

    it('marks (removed) scopes in the summary when local config drops a scope the server still has', async () => {
      const config = {
        appId: '42',
        appName: 'My App',
        auth: {
          type: 'private',
          scopes: ['contacts:read'],
          redirectUrls: ['https://x/cb'],
        },
        distribution: 'private',
      };
      (readProjectConfig as jest.Mock).mockReturnValue(config);
      (appService.fetchApp as jest.Mock).mockResolvedValue({
        app_id: '42',
        name: 'My App',
        redirect_uris: ['https://x/cb'],
        scopes: ['contacts:read', 'crm:read'],
      });
      (inquirer.prompt as unknown as jest.Mock).mockResolvedValue({ confirmed: true });

      await updateCommand({});

      const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
      const beforeSuccess = output.split('App updated.')[0];
      expect(beforeSuccess).toContain('Scopes:        contacts:read');
      expect(beforeSuccess).toContain('crm:read (removed)');
    });
  });
});
