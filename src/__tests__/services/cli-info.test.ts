import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
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

// A fresh scratch dir per test, pointed at via BREVO_CONFIG_HOME, so no test
// can read another test's cache file and nothing ever touches the developer's
// real ~/.brevo directory.
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brevo-cli-info-test-'));
  process.env.BREVO_CONFIG_HOME = tmpDir;
});

afterEach(() => {
  delete process.env.BREVO_CONFIG_HOME;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

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
    ).resolves.toEqual({
      upgradeMessage: "You're running an older Brevo CLI. Please upgrade the version.",
      isBlocked: false,
    });
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

    // An unusable message no longer collapses the whole response: the block
    // verdict travels beside it and has to survive on its own.
    it('drops a missing upgrade_message but keeps the verdict', async () => {
      await expect(call(async () => jsonResponse({ is_blocked: false }))).resolves.toEqual({
        upgradeMessage: undefined,
        isBlocked: false,
      });
    });

    it('drops an empty upgrade_message but keeps the verdict', async () => {
      await expect(call(async () => jsonResponse({ upgrade_message: '' }))).resolves.toEqual({
        upgradeMessage: undefined,
        isBlocked: false,
      });
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
    expect(notice?.upgradeMessage).toBe('Danger second line');
  });
});

describe('is_blocked', () => {
  const call = (body: unknown): Promise<unknown> =>
    fetchCliInfo(QUERY, {
      baseUrl: BASE,
      fetchImpl: (async () => jsonResponse(body)) as unknown as typeof fetch,
    });

  it('blocks only on an explicit boolean true', async () => {
    await expect(call({ is_blocked: true })).resolves.toMatchObject({ isBlocked: true });
  });

  // Anything other than a real `true` must let the user keep working. A stray
  // string or number stopping every command would be a very bad failure mode.
  it.each([['false'], ['"true"'], ['1'], ['null'], ['undefined']])(
    'does not block on %s',
    async (raw) => {
      const value = raw === 'undefined' ? undefined : JSON.parse(raw);
      await expect(call({ is_blocked: value })).resolves.toMatchObject({ isBlocked: false });
    },
  );

  it('does not block when the field is absent entirely', async () => {
    await expect(call({ upgrade_message: 'hi' })).resolves.toMatchObject({ isBlocked: false });
  });
});

describe('caching', () => {
  const FIFTEEN_MIN_MS = 15 * 60 * 1000;

  it('serves a second call within the TTL from cache, without refetching', async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse({ upgrade_message: 'first', is_blocked: false }),
    );
    let now = 1_000_000;

    const first = await fetchCliInfo(QUERY, {
      baseUrl: BASE,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => now,
    });
    now += 1000;
    const second = await fetchCliInfo(QUERY, {
      baseUrl: BASE,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => now,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it('refetches once the cache entry is older than the TTL', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ upgrade_message: 'first', is_blocked: false }))
      .mockResolvedValueOnce(jsonResponse({ upgrade_message: 'second', is_blocked: true }));
    let now = 1_000_000;

    await fetchCliInfo(QUERY, {
      baseUrl: BASE,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => now,
    });
    now += FIFTEEN_MIN_MS + 1;
    const second = await fetchCliInfo(QUERY, {
      baseUrl: BASE,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => now,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(second).toEqual({ upgradeMessage: 'second', isBlocked: true });
  });

  it('ignores a fresh cache entry written for a different cliVersion', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ upgrade_message: 'old version', is_blocked: false }))
      .mockResolvedValueOnce(jsonResponse({ upgrade_message: 'new version', is_blocked: false }));
    const now = 1_000_000;

    await fetchCliInfo(
      { cliVersion: '1.0.0', reason: 'startup' },
      { baseUrl: BASE, fetchImpl: fetchImpl as unknown as typeof fetch, now: () => now },
    );
    const upgraded = await fetchCliInfo(
      { cliVersion: '2.0.0', reason: 'startup' },
      { baseUrl: BASE, fetchImpl: fetchImpl as unknown as typeof fetch, now: () => now },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(upgraded).toEqual({ upgradeMessage: 'new version', isBlocked: false });
  });

  it('does not cache a failed response, so the next call retries', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, false, 500))
      .mockResolvedValueOnce(jsonResponse({ upgrade_message: 'ok', is_blocked: false }));
    const now = 1_000_000;

    const failed = await fetchCliInfo(QUERY, {
      baseUrl: BASE,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => now,
    });
    const recovered = await fetchCliInfo(QUERY, {
      baseUrl: BASE,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => now,
    });

    expect(failed).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(recovered).toEqual({ upgradeMessage: 'ok', isBlocked: false });
  });

  it('honours an explicit ttlMs override', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ upgrade_message: 'first', is_blocked: false }))
      .mockResolvedValueOnce(jsonResponse({ upgrade_message: 'second', is_blocked: false }));
    let now = 1_000_000;

    await fetchCliInfo(QUERY, {
      baseUrl: BASE,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => now,
      ttlMs: 5000,
    });
    now += 5001;
    await fetchCliInfo(QUERY, {
      baseUrl: BASE,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => now,
      ttlMs: 5000,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('the cache is keyed to the service it came from', () => {
  const PROD = 'https://app-store.example.com';
  const STAGING = 'https://app-store-staging.example.com';

  const server = (message?: string) =>
    jest.fn(async () =>
      jsonResponse(message === undefined ? { is_blocked: false } : { upgrade_message: message }),
    );

  // Without baseUrl in the key, a run against one environment is served the
  // answer the other gave moments earlier — which presents as "staging works,
  // production doesn't" while curl against both says the reverse.
  it('does not serve one environment answer for another', async () => {
    const cachePath = path.join(tmpDir, 'cli-info-cache.json');
    const staging = server(undefined);

    await expect(
      fetchCliInfo(QUERY, {
        baseUrl: PROD,
        cachePath,
        fetchImpl: server('PROD MESSAGE') as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({ upgradeMessage: 'PROD MESSAGE' });

    // Same CLI version, same instant — only the target differs.
    await expect(
      fetchCliInfo(QUERY, {
        baseUrl: STAGING,
        cachePath,
        fetchImpl: staging as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({ upgradeMessage: undefined });

    expect(staging).toHaveBeenCalledTimes(1);
  });

  it('still reuses the entry when the base URL is unchanged', async () => {
    const cachePath = path.join(tmpDir, 'cli-info-cache.json');
    const prod = server('PROD MESSAGE');
    const opts = { baseUrl: PROD, cachePath, fetchImpl: prod as unknown as typeof fetch };
    await fetchCliInfo(QUERY, opts);
    await fetchCliInfo(QUERY, opts);
    expect(prod).toHaveBeenCalledTimes(1);
  });

  it('ignores an entry written before baseUrl was part of the key', async () => {
    const cachePath = path.join(tmpDir, 'cli-info-cache.json');
    fs.writeFileSync(
      cachePath,
      JSON.stringify({
        cliVersion: QUERY.cliVersion,
        info: { upgradeMessage: 'STALE', isBlocked: false },
        lastChecked: Date.now(),
      }),
    );
    await expect(
      fetchCliInfo(QUERY, {
        baseUrl: PROD,
        cachePath,
        fetchImpl: server('LIVE MESSAGE') as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({ upgradeMessage: 'LIVE MESSAGE' });
  });
});
