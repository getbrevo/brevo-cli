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
  it('returns the upgrade message', async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse({
        upgrade_message: "You're running an older Brevo CLI. Please upgrade the version.",
        is_blocked: false,
      }),
    );
    await expect(
      fetchCliInfo(QUERY, { baseUrl: BASE, fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).resolves.toBe("You're running an older Brevo CLI. Please upgrade the version.");
  });

  it('calls the unauthenticated endpoint with the documented query params', async () => {
    const fetchImpl = jest.fn(async (_url: string, _init?: RequestInit) => jsonResponse({}));
    await fetchCliInfo(QUERY, { baseUrl: BASE, fetchImpl: fetchImpl as unknown as typeof fetch });

    const url = new URL(fetchImpl.mock.calls[0]![0]);
    expect(url.pathname).toBe('/cli/info');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      cli_version: '2.0.1',
      reason: 'version_mismatch',
    });
  });

  // Called directly on the app-store service, which serves it unauthenticated —
  // so no credential is attached, and a 401 can never reach onAuthFailure to
  // clear the user's stored credentials.
  it('sends no auth header of any kind', async () => {
    const fetchImpl = jest.fn(async (_url: string, _init?: RequestInit) => jsonResponse({}));
    await fetchCliInfo(QUERY, { baseUrl: BASE, fetchImpl: fetchImpl as unknown as typeof fetch });

    const headers = fetchImpl.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(Object.keys(headers).map((k) => k.toLowerCase())).toEqual(['accept']);
    expect(headers).not.toHaveProperty('api-key');
    expect(headers).not.toHaveProperty('Authorization');
  });

  // It does not go through the v3 gateway, so it is unaffected by BREVO_API_URL
  // and by whatever auth that gateway enforces.
  it('targets the app-store service, not the v3 API base', async () => {
    const fetchImpl = jest.fn(async (_url: string, _init?: RequestInit) => jsonResponse({}));
    await fetchCliInfo(QUERY, {
      baseUrl: 'https://app-store.example.com',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const url = new URL(fetchImpl.mock.calls[0]![0]);
    expect(url.origin).toBe('https://app-store.example.com');
    expect(url.pathname).toBe('/cli/info');
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

    it('on a missing upgrade_message', async () => {
      await expect(call(async () => jsonResponse({ is_blocked: false }))).resolves.toBeUndefined();
    });

    it('on an empty upgrade_message', async () => {
      await expect(
        call(async () => jsonResponse({ upgrade_message: '' })),
      ).resolves.toBeUndefined();
    });

    it('on a non-2xx status', async () => {
      await expect(
        call(async () => jsonResponse({ upgrade_message: 'x' }, false, 500)),
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
        call(async () => jsonResponse({ upgrade_message: '<!DOCTYPE html><html>' })),
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
          upgrade_message: '\x1B[31mDanger\x1B[0m\nsecond line',
        })) as unknown as typeof fetch,
    });
    expect(notice).toBe('Danger second line');
  });
});
