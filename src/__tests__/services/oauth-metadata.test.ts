import { fetchSupportedScopes, groupScopesByCategory } from '../../services/oauth-metadata';
import { OAUTH_SCOPES_URL } from '../../lib/constants';
import { ApiError, CliError } from '../../lib/errors';

const mockFetch = jest.fn();
globalThis.fetch = mockFetch;

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
  it('keeps the English display name and description, ignoring the other languages', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          scopes: [
            {
              name: 'contacts:read',
              category: 'contacts_crm',
              api_endpoints: ['/contacts'],
              display_name: { en: 'Contacts', fr: 'Contacts', de: 'Kontakte' },
              description: { en: 'Read contacts', fr: 'Lire les contacts' },
            },
          ],
        }),
    });

    await expect(fetchSupportedScopes()).resolves.toEqual([
      expect.objectContaining({ displayName: 'Contacts', description: 'Read contacts' }),
    ]);
  });

  it('labels each scope’s category from the response’s own categories list', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          scopes: [
            { name: 'contacts:read', category: 'contacts_crm' },
            { name: 'events:write', category: 'events' },
          ],
          categories: [
            { key: 'contacts_crm', display_name: { en: 'Contacts & CRM', fr: 'Contacts et CRM' } },
            // Malformed rows are skipped rather than throwing or labelling something wrong.
            { key: 'events' },
            { display_name: { en: 'No key' } },
            null,
          ],
        }),
    });

    await expect(fetchSupportedScopes()).resolves.toEqual([
      expect.objectContaining({ name: 'contacts:read', categoryLabel: 'Contacts & CRM' }),
      // No usable label for `events`, so the field is absent and callers fall back to the key.
      { name: 'events:write', category: 'events', apiEndpoints: [] },
    ]);
  });

  it('omits a label that is missing, non-string, or in no language the CLI speaks', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          scopes: [
            {
              name: 'contacts:read',
              category: 'contacts_crm',
              display_name: { fr: 'Contacts' },
              description: 'not a localized map',
            },
            { name: 'crm:read', category: 'contacts_crm', display_name: { en: '' } },
          ],
          categories: 'not an array',
        }),
    });

    // Present-and-undefined would make every `toEqual` on a bare catalog entry a lie, so
    // an unusable label leaves no key behind at all.
    await expect(fetchSupportedScopes()).resolves.toEqual([
      { name: 'contacts:read', category: 'contacts_crm', apiEndpoints: [] },
      { name: 'crm:read', category: 'contacts_crm', apiEndpoints: [] },
    ]);
  });
});

describe('groupScopesByCategory', () => {
  const entry = (name: string, category: string) => ({ name, category, apiEndpoints: [] });

  it('groups by category in first-seen order, keeping the catalog’s own ordering', () => {
    const grouped = groupScopesByCategory([
      entry('transactional.email:read', 'transactional'),
      entry('contacts:read', 'contacts_crm'),
      entry('transactional.email:write', 'transactional'),
    ]);

    expect([...grouped.keys()]).toEqual(['transactional', 'contacts_crm']);
    expect(grouped.get('transactional')?.map((s) => s.name)).toEqual([
      'transactional.email:read',
      'transactional.email:write',
    ]);
  });

  it('returns an empty map for an empty catalog', () => {
    expect(groupScopesByCategory([]).size).toBe(0);
  });
});
