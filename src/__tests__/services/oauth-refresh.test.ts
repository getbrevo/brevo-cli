import { refreshAccessToken } from '../../services/oauth-refresh';

const mockFetch = jest.fn();
globalThis.fetch = mockFetch as unknown as typeof fetch;

describe('refreshAccessToken', () => {
  beforeEach(() => mockFetch.mockReset());

  it('POSTs refresh_token to the Worker and returns new tokens', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          access_token: 'at-2',
          refresh_token: 'rt-2',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
    });

    const tokens = await refreshAccessToken('rt-1', 'https://worker.example.com');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://worker.example.com/refresh',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ refresh_token: 'rt-1' }),
      }),
    );
    expect(tokens).toEqual({
      accessToken: 'at-2',
      refreshToken: 'rt-2',
      expiresIn: 3600,
      tokenType: 'Bearer',
    });
  });

  it('keeps the incoming refresh token when the response does not rotate it', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          access_token: 'at-2',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
    });
    const tokens = await refreshAccessToken('rt-keep', 'https://worker.example.com');
    expect(tokens.refreshToken).toBe('rt-keep');
  });

  it('throws RefreshError with unauthorized=true on 401', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: 'invalid_grant' }),
    });
    await expect(refreshAccessToken('rt-1', 'https://worker.example.com')).rejects.toMatchObject({
      name: 'RefreshError',
      unauthorized: true,
    });
  });

  it('throws RefreshError with unauthorized=false on 5xx', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      json: () => Promise.resolve({ error: 'bad_gateway' }),
    });
    await expect(refreshAccessToken('rt-1', 'https://worker.example.com')).rejects.toMatchObject({
      name: 'RefreshError',
      unauthorized: false,
    });
  });

  it('throws RefreshError on network failure', async () => {
    mockFetch.mockRejectedValue(new Error('network down'));
    await expect(refreshAccessToken('rt-1', 'https://worker.example.com')).rejects.toMatchObject({
      name: 'RefreshError',
      unauthorized: false,
    });
  });

  it('throws RefreshError when the response body is not JSON', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON at position 0')),
    });
    await expect(refreshAccessToken('rt-1', 'https://worker.example.com')).rejects.toMatchObject({
      name: 'RefreshError',
      unauthorized: false,
      message: expect.stringContaining('Malformed'),
    });
  });

  it.each([
    ['NaN expires_in', NaN],
    ['Infinity expires_in', Infinity],
    ['negative expires_in', -1],
    ['zero expires_in', 0],
  ])('rejects malformed expires_in: %s', async (_name, expires) => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          access_token: 'at',
          refresh_token: 'rt',
          expires_in: expires,
          token_type: 'Bearer',
        }),
    });
    await expect(refreshAccessToken('rt-1', 'https://worker.example.com')).rejects.toMatchObject({
      name: 'RefreshError',
      unauthorized: false,
    });
  });

  it.each([
    ['empty refresh_token', ''],
    ['non-string refresh_token', 42],
    ['null refresh_token', null],
  ])('rejects malformed refresh_token when present: %s', async (_name, value) => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          access_token: 'at',
          refresh_token: value,
          expires_in: 3600,
          token_type: 'Bearer',
        }),
    });
    await expect(refreshAccessToken('rt-keep', 'https://worker.example.com')).rejects.toMatchObject(
      {
        name: 'RefreshError',
        unauthorized: false,
      },
    );
  });
});
