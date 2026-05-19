import { fetchSupportedScopes } from '../../services/oauth-metadata';
import { OAUTH_WELL_KNOWN_URL } from '../../lib/constants';
import { ApiError, CliError } from '../../lib/errors';

const mockFetch = jest.fn();
globalThis.fetch = mockFetch as unknown as typeof fetch;

describe('fetchSupportedScopes', () => {
  beforeEach(() => mockFetch.mockReset());

  it('returns scopes_supported on a 200 response', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          scopes_supported: ['contacts:read', 'crm:write', 'offline_access'],
        }),
    });

    const scopes = await fetchSupportedScopes();
    expect(mockFetch).toHaveBeenCalledWith(OAUTH_WELL_KNOWN_URL, expect.any(Object));
    expect(scopes).toEqual(['contacts:read', 'crm:write', 'offline_access']);
  });

  it('throws ApiError on non-2xx', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503, json: () => Promise.resolve({}) });
    await expect(fetchSupportedScopes()).rejects.toBeInstanceOf(ApiError);
  });

  it('throws ApiError on network failure', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(fetchSupportedScopes()).rejects.toBeInstanceOf(ApiError);
  });

  it('throws CliError when scopes_supported is missing', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ issuer: 'https://x' }),
    });
    await expect(fetchSupportedScopes()).rejects.toBeInstanceOf(CliError);
  });

  it('throws CliError when scopes_supported is not an array of strings', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ scopes_supported: 'all' }),
    });
    await expect(fetchSupportedScopes()).rejects.toBeInstanceOf(CliError);
  });
});
