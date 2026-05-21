import { fetchSupportedScopes } from '../../services/oauth-metadata';
import { OAUTH_SCOPES_URL } from '../../lib/constants';
import { ApiError, CliError } from '../../lib/errors';

const mockFetch = jest.fn();
globalThis.fetch = mockFetch as unknown as typeof fetch;

describe('fetchSupportedScopes', () => {
  beforeEach(() => mockFetch.mockReset());

  it('returns name+category+apiEndpoints triples from /scopes', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          scopes: [
            {
              name: 'contacts:read',
              category: 'data_crm',
              api_endpoints: ['/contacts', '/contacts/lists'],
              is_oidc_reserved: false,
            },
            {
              name: 'crm:write',
              category: 'data_crm',
              api_endpoints: ['/companies'],
              is_oidc_reserved: false,
            },
          ],
          magic_scopes: ['all'],
        }),
    });

    const scopes = await fetchSupportedScopes();
    expect(mockFetch).toHaveBeenCalledWith(OAUTH_SCOPES_URL, expect.any(Object));
    expect(scopes).toEqual([
      {
        name: 'contacts:read',
        category: 'data_crm',
        apiEndpoints: ['/contacts', '/contacts/lists'],
      },
      { name: 'crm:write', category: 'data_crm', apiEndpoints: ['/companies'] },
    ]);
  });

  it('defaults apiEndpoints to [] when missing or malformed', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          scopes: [
            { name: 'a', category: 'x' },
            { name: 'b', category: 'x', api_endpoints: 'not-an-array' },
            { name: 'c', category: 'x', api_endpoints: ['/c', 42, null, '/d'] },
          ],
        }),
    });
    const scopes = await fetchSupportedScopes();
    expect(scopes).toEqual([
      { name: 'a', category: 'x', apiEndpoints: [] },
      { name: 'b', category: 'x', apiEndpoints: [] },
      { name: 'c', category: 'x', apiEndpoints: ['/c', '/d'] },
    ]);
  });

  it('filters out is_oidc_reserved scopes', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          scopes: [
            { name: 'contacts:read', category: 'data_crm', is_oidc_reserved: false },
            { name: 'openid', category: 'oidc', is_oidc_reserved: true },
            { name: 'profile', category: 'oidc', is_oidc_reserved: true },
          ],
        }),
    });

    const scopes = await fetchSupportedScopes();
    expect(scopes.map((s) => s.name)).toEqual(['contacts:read']);
    expect(scopes[0]!.apiEndpoints).toEqual([]);
  });

  it('throws ApiError on non-2xx', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503, json: () => Promise.resolve({}) });
    await expect(fetchSupportedScopes()).rejects.toBeInstanceOf(ApiError);
  });

  it('throws ApiError on network failure', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(fetchSupportedScopes()).rejects.toBeInstanceOf(ApiError);
  });

  it('throws CliError when scopes array is missing', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ magic_scopes: ['all'] }),
    });
    await expect(fetchSupportedScopes()).rejects.toBeInstanceOf(CliError);
  });

  it('throws CliError when scopes is not an array', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ scopes: 'all' }),
    });
    await expect(fetchSupportedScopes()).rejects.toBeInstanceOf(CliError);
  });

  it('silently drops entries with missing name or category', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          scopes: [
            { name: 'contacts:read', category: 'data_crm' },
            { name: 'no_category' },
            { category: 'no_name' },
            null,
          ],
        }),
    });
    const scopes = await fetchSupportedScopes();
    expect(scopes).toEqual([{ name: 'contacts:read', category: 'data_crm', apiEndpoints: [] }]);
  });
});
