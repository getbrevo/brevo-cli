import { scopesCommand } from '../../../commands/app/scopes';

jest.mock('../../../services/oauth-metadata', () => ({
  fetchSupportedScopes: jest.fn(),
}));

import { fetchSupportedScopes } from '../../../services/oauth-metadata';

describe('app/scopes', () => {
  let stdoutSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    jest.clearAllMocks();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it('prints one scope per line in text mode', async () => {
    (fetchSupportedScopes as jest.Mock).mockResolvedValue([
      'contacts:read',
      'crm:write',
      'offline_access',
    ]);

    await scopesCommand({});

    const out = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(out).toContain('contacts:read');
    expect(out).toContain('crm:write');
    expect(out).toContain('offline_access');
    const lines = out.split('\n').filter((l) => l.trim().length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(3);
  });

  it('emits { scopes: [...] } under --json', async () => {
    (fetchSupportedScopes as jest.Mock).mockResolvedValue(['contacts:read', 'crm:write']);

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
});
