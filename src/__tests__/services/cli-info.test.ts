import { fetchCliInfo } from '../../services/cli-info';
import { CliInfoQuery } from '../../types';

const QUERY: CliInfoQuery = {
  cliVersion: '2.0.1',
  reason: 'version_mismatch',
};

const BASE = 'https://api.example.com';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('fetchCliInfo', () => {
  it('returns the notice for a recognised code', async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse({ code: 'cli_version_mismatch', message: 'The cli version is a mismatch.' }),
    );
    await expect(
      fetchCliInfo(QUERY, { baseUrl: BASE, fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).resolves.toEqual({
      code: 'cli_version_mismatch',
      message: 'The cli version is a mismatch.',
    });
  });

  it('calls the unauthenticated endpoint with the documented query params', async () => {
    const fetchImpl = jest.fn(async (_url: string, _init?: RequestInit) => jsonResponse({}));
    await fetchCliInfo(QUERY, { baseUrl: BASE, fetchImpl: fetchImpl as unknown as typeof fetch });

    const url = new URL(fetchImpl.mock.calls[0]![0]);
    expect(url.pathname).toBe('/v3/app-store/cli/info');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      cli_version: '2.0.1',
      reason: 'version_mismatch',
    });
  });

  // The point of fetching outside ApiClient: no credential ever goes to this
  // endpoint, so a 401 from it can never reach onAuthFailure and clear the
  // user's stored credentials.
  it('sends no auth header of any kind', async () => {
    const fetchImpl = jest.fn(async (_url: string, _init?: RequestInit) => jsonResponse({}));
    await fetchCliInfo(QUERY, { baseUrl: BASE, fetchImpl: fetchImpl as unknown as typeof fetch });

    const init = fetchImpl.mock.calls[0]![1]!;
    const headers = init.headers as Record<string, string>;
    expect(Object.keys(headers).map((k) => k.toLowerCase())).toEqual(['accept']);
    expect(headers).not.toHaveProperty('api-key');
    expect(headers).not.toHaveProperty('Authorization');
  });

  it('sends exactly the two documented params and nothing else', async () => {
    const fetchImpl = jest.fn(async (_url: string, _init?: RequestInit) => jsonResponse({}));
    await fetchCliInfo(
      { cliVersion: '2.0.1', reason: 'startup' },
      { baseUrl: BASE, fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    const url = new URL(fetchImpl.mock.calls[0]![0]);
    expect([...url.searchParams.keys()].sort()).toEqual(['cli_version', 'reason']);
    expect(url.searchParams.get('cli_version')).toBe('2.0.1');
  });

  describe('fails soft', () => {
    const call = (fetchImpl: unknown): Promise<unknown> =>
      fetchCliInfo(QUERY, { baseUrl: BASE, fetchImpl: fetchImpl as typeof fetch });

    it('on an unknown code — the body is ignored wholesale', async () => {
      await expect(
        call(async () => jsonResponse({ code: 'brand_new_code', message: 'trust me' })),
      ).resolves.toBeUndefined();
    });

    it('on a missing code', async () => {
      await expect(
        call(async () => jsonResponse({ message: 'no code here' })),
      ).resolves.toBeUndefined();
    });

    it('on a missing message', async () => {
      await expect(
        call(async () => jsonResponse({ code: 'cli_version_mismatch' })),
      ).resolves.toBeUndefined();
    });

    it('on a non-2xx status', async () => {
      await expect(
        call(async () => jsonResponse({ code: 'cli_version_mismatch', message: 'x' }, false, 500)),
      ).resolves.toBeUndefined();
    });

    it('on a non-JSON body', async () => {
      await expect(
        call(async () => ({
          ok: true,
          status: 200,
          json: async () => {
            throw new SyntaxError('Unexpected token <');
          },
        })),
      ).resolves.toBeUndefined();
    });

    it('on an HTML body from a gateway', async () => {
      await expect(
        call(async () =>
          jsonResponse({ code: 'cli_version_mismatch', message: '<!DOCTYPE html><html>' }),
        ),
      ).resolves.toBeUndefined();
    });

    it('on a null body', async () => {
      await expect(call(async () => jsonResponse(null))).resolves.toBeUndefined();
    });

    it('on a network error', async () => {
      await expect(
        call(async () => {
          throw new TypeError('fetch failed');
        }),
      ).resolves.toBeUndefined();
    });

    it('on a timeout', async () => {
      await expect(
        fetchCliInfo(QUERY, {
          baseUrl: BASE,
          timeoutMs: 5,
          fetchImpl: ((_url: string, init: RequestInit) =>
            new Promise((_resolve, reject) => {
              init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
            })) as unknown as typeof fetch,
        }),
      ).resolves.toBeUndefined();
    });
  });

  it('sanitizes and clamps the message it does accept', async () => {
    const notice = await fetchCliInfo(QUERY, {
      baseUrl: BASE,
      fetchImpl: (async () =>
        jsonResponse({
          code: 'cli_version_mismatch',
          message: '\x1B[31mDanger\x1B[0m\nsecond line',
        })) as unknown as typeof fetch,
    });
    expect(notice?.message).toBe('Danger second line');
  });
});
