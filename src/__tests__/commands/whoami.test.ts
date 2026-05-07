import { whoamiCommand } from '../../commands/whoami';
import * as config from '../../lib/config';
import { CliError } from '../../lib/errors';

jest.mock('../../lib/config');
jest.mock('../../container', () => ({
  accountService: {
    getAccount: jest.fn(),
    validateApiKey: jest.fn(),
  },
  appService: {},
  client: {},
}));

import { accountService } from '../../container';

describe('whoamiCommand', () => {
  let stdoutSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    jest.clearAllMocks();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('should show not-authenticated message when no stored key', async () => {
    (config.isAuthenticated as jest.Mock).mockReturnValue(false);

    await expect(whoamiCommand({ json: false })).rejects.toThrow('Not authenticated');
  });

  it('should output JSON when not authenticated with --json', async () => {
    (config.isAuthenticated as jest.Mock).mockReturnValue(false);

    await expect(whoamiCommand({ json: true })).rejects.toThrow(CliError);
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('"authenticated":false'));
  });

  it('should show email and company when authenticated', async () => {
    (config.isAuthenticated as jest.Mock).mockReturnValue(true);
    (config.getEmail as jest.Mock).mockReturnValue('user@example.com');
    (config.getOrganizationId as jest.Mock).mockReturnValue('org-123');
    (config.getUserId as jest.Mock).mockReturnValue(1001);
    (accountService.getAccount as jest.Mock).mockResolvedValue({
      email: 'user@example.com',
      companyName: 'Acme Corp',
      organization_id: 'org-123',
      user_id: 1001,
    });

    await whoamiCommand({ json: false });

    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('user@example.com'));
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('org-123'));
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('1001'));
  });

  it('should output JSON when authenticated with --json', async () => {
    (config.isAuthenticated as jest.Mock).mockReturnValue(true);
    (config.getEmail as jest.Mock).mockReturnValue('user@example.com');
    (config.getOrganizationId as jest.Mock).mockReturnValue('org-123');
    (config.getUserId as jest.Mock).mockReturnValue(1001);
    (accountService.getAccount as jest.Mock).mockResolvedValue({
      email: 'user@example.com',
      companyName: 'Acme Corp',
      organization_id: 'org-123',
      user_id: 1001,
    });

    await whoamiCommand({ json: true });

    const output = stdoutSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.authenticated).toBe(true);
    expect(parsed.email).toBe('user@example.com');
    expect(parsed.company).toBe('Acme Corp');
    expect(parsed.organizationId).toBe('org-123');
    expect(parsed.userId).toBe(1001);
  });

  it('should throw on credential mismatch between local and API', async () => {
    (config.isAuthenticated as jest.Mock).mockReturnValue(true);
    (config.getEmail as jest.Mock).mockReturnValue('old@example.com');
    (config.getOrganizationId as jest.Mock).mockReturnValue('org-999');
    (config.getUserId as jest.Mock).mockReturnValue(9999);
    (accountService.getAccount as jest.Mock).mockResolvedValue({
      email: 'user@example.com',
      companyName: 'Acme Corp',
      organization_id: 'org-123',
      user_id: 1001,
    });

    await expect(whoamiCommand({ json: false })).rejects.toThrow('mismatch');
  });

  it('should output JSON on credential mismatch with --json', async () => {
    (config.isAuthenticated as jest.Mock).mockReturnValue(true);
    (config.getEmail as jest.Mock).mockReturnValue('old@example.com');
    (config.getOrganizationId as jest.Mock).mockReturnValue('org-123');
    (config.getUserId as jest.Mock).mockReturnValue(1001);
    (accountService.getAccount as jest.Mock).mockResolvedValue({
      email: 'user@example.com',
      companyName: 'Acme Corp',
      organization_id: 'org-123',
      user_id: 1001,
    });

    await expect(whoamiCommand({ json: true })).rejects.toThrow(CliError);
    const output = stdoutSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.authenticated).toBe(false);
    expect(parsed.reason).toBe('credential_mismatch');
    expect(parsed.mismatchedFields).toContain('email');
  });

  it('should pass when stored credentials are undefined (first login)', async () => {
    (config.isAuthenticated as jest.Mock).mockReturnValue(true);
    (config.getEmail as jest.Mock).mockReturnValue(undefined);
    (config.getOrganizationId as jest.Mock).mockReturnValue(undefined);
    (config.getUserId as jest.Mock).mockReturnValue(undefined);
    (accountService.getAccount as jest.Mock).mockResolvedValue({
      email: 'user@example.com',
      companyName: 'Acme Corp',
      organization_id: 'org-123',
      user_id: 1001,
    });

    await whoamiCommand({ json: false });

    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('user@example.com'));
  });

  it('should handle expired key', async () => {
    (config.isAuthenticated as jest.Mock).mockReturnValue(true);
    (accountService.getAccount as jest.Mock).mockRejectedValue(new Error('Unauthorized'));

    await expect(whoamiCommand({ json: false })).rejects.toThrow(CliError);
  });

  it('reports authKind in --json output', async () => {
    (config.isAuthenticated as jest.Mock).mockReturnValue(true);
    (config.getAuthCred as jest.Mock).mockReturnValue({
      kind: 'oauth',
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: Date.now() + 3600_000,
      tokenType: 'Bearer',
    });
    (accountService.getAccount as jest.Mock).mockResolvedValue({
      email: 't@e.com',
      organization_id: 'org',
      user_id: 1,
      companyName: 'Acme',
    });

    await whoamiCommand({ json: true });
    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(JSON.parse(output)).toMatchObject({ authenticated: true, authKind: 'oauth' });
  });

  it('shows "(browser login)" suffix in TTY output for OAuth sessions', async () => {
    (config.isAuthenticated as jest.Mock).mockReturnValue(true);
    (config.getAuthCred as jest.Mock).mockReturnValue({
      kind: 'oauth',
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: Date.now() + 3600_000,
      tokenType: 'Bearer',
    });
    (accountService.getAccount as jest.Mock).mockResolvedValue({
      email: 'oauth@e.com',
      organization_id: 'org',
      user_id: 1,
      companyName: 'Acme',
    });

    await whoamiCommand({ json: false });
    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('(browser login)');
    expect(output).not.toContain('(API key)');
  });

  it('shows "(API key)" suffix in TTY output for api-key sessions', async () => {
    (config.isAuthenticated as jest.Mock).mockReturnValue(true);
    (config.getAuthCred as jest.Mock).mockReturnValue({
      kind: 'api-key',
      apiKey: 'xkeysib-test',
    });
    (accountService.getAccount as jest.Mock).mockResolvedValue({
      email: 'apikey@e.com',
      organization_id: 'org',
      user_id: 1,
      companyName: 'Acme',
    });

    await whoamiCommand({ json: false });
    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('(API key)');
    expect(output).not.toContain('(browser login)');
  });
});
