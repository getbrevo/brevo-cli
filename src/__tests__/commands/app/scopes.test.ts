import { scopesCommand } from '../../../commands/app/scopes';

jest.mock('../../../services/oauth-metadata', () => ({
  fetchSupportedScopes: jest.fn(),
}));

jest.mock('../../../services/scopes-web', () => ({
  startScopesWebServer: jest.fn(),
}));

jest.mock('../../../lib/browser', () => ({
  openBrowser: jest.fn(),
}));

import { fetchSupportedScopes } from '../../../services/oauth-metadata';
import { startScopesWebServer } from '../../../services/scopes-web';
import { openBrowser } from '../../../lib/browser';

describe('app/scopes', () => {
  let stdoutSpy: jest.SpyInstance;
  const originalIsTTY = process.stdout.isTTY;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    jest.clearAllMocks();
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
  });

  it('groups scopes by category in text mode', async () => {
    (fetchSupportedScopes as jest.Mock).mockResolvedValue([
      { name: 'contacts:read', category: 'data_crm' },
      { name: 'crm:write', category: 'data_crm' },
      { name: 'account:read', category: 'account' },
    ]);

    await scopesCommand({});

    const out = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(out).toContain('data_crm:');
    expect(out).toContain('account:');
    expect(out).toContain('  contacts:read');
    expect(out).toContain('  crm:write');
    expect(out).toContain('  account:read');
    expect(out.indexOf('data_crm:')).toBeLessThan(out.indexOf('account:'));
    expect(out).toContain('brevo app update --scope');
  });

  it('emits a flat scope name array under --json', async () => {
    (fetchSupportedScopes as jest.Mock).mockResolvedValue([
      { name: 'contacts:read', category: 'data_crm' },
      { name: 'crm:write', category: 'data_crm' },
    ]);

    await scopesCommand({ json: true });

    const out = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    const lastJsonLine = out
      .split('\n')
      .reverse()
      .find((l) => l.trim().startsWith('{'));
    expect(lastJsonLine).toBeDefined();
    expect(JSON.parse(lastJsonLine!)).toEqual({
      scopes: ['contacts:read', 'crm:write'],
    });
    expect(out).not.toContain('brevo app update --scope');
  });

  it('prints the empty-scopes message in text mode when the registry is empty', async () => {
    (fetchSupportedScopes as jest.Mock).mockResolvedValue([]);

    await scopesCommand({});

    const out = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(out.toLowerCase()).toContain('empty');
  });

  it('surfaces errors thrown by fetchSupportedScopes', async () => {
    (fetchSupportedScopes as jest.Mock).mockRejectedValue(new Error('boom'));
    await expect(scopesCommand({})).rejects.toThrow('boom');
  });

  it('does not start the web server without --web', async () => {
    (fetchSupportedScopes as jest.Mock).mockResolvedValue([
      { name: 'contacts:read', category: 'data_crm' },
    ]);

    await scopesCommand({});

    expect(startScopesWebServer).not.toHaveBeenCalled();
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it('does not start the web server without --web even when stdout is a TTY', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    (fetchSupportedScopes as jest.Mock).mockResolvedValue([
      { name: 'contacts:read', category: 'data_crm' },
    ]);

    await scopesCommand({});

    expect(startScopesWebServer).not.toHaveBeenCalled();
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it('does not start the web server in --json mode even with --web', async () => {
    (fetchSupportedScopes as jest.Mock).mockResolvedValue([
      { name: 'contacts:read', category: 'data_crm' },
    ]);

    await scopesCommand({ json: true, web: true });

    expect(startScopesWebServer).not.toHaveBeenCalled();
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it('starts the web server and opens the browser when --web is passed', async () => {
    const entries = [
      { name: 'contacts:read', category: 'data_crm' },
      { name: 'account:read', category: 'account' },
    ];
    (fetchSupportedScopes as jest.Mock).mockResolvedValue(entries);

    const close = jest.fn().mockResolvedValue(undefined);
    const url = 'http://127.0.0.1:54321/';
    (startScopesWebServer as jest.Mock).mockResolvedValue({ url, close });

    const run = scopesCommand({ web: true });
    // Give the server-start microtask + signal listener time to register.
    await new Promise((r) => setImmediate(r));
    process.emit('SIGINT');
    await run;

    expect(startScopesWebServer).toHaveBeenCalledWith(entries, {
      refetch: fetchSupportedScopes,
    });
    expect(openBrowser).toHaveBeenCalledWith(url);
    expect(close).toHaveBeenCalled();

    const out = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(out).toContain(url);
  });
});
