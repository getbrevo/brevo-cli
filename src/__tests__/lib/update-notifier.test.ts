import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  compareVersions,
  isNewer,
  shouldSkipCheck,
  readCache,
  writeCache,
  formatBanner,
  fetchLatestVersion,
  startUpdateCheck,
  notifyUpdate,
  shouldShowBannerBefore,
} from '../../lib/update-notifier';

const TMP_ROOT = path.join(os.tmpdir(), `brevo-update-test-${Date.now()}`);

function makeCachePath(): string {
  return path.join(TMP_ROOT, `cache-${crypto.randomBytes(8).toString('hex')}.json`);
}

afterAll(() => {
  if (fs.existsSync(TMP_ROOT)) {
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  }
});

describe('compareVersions', () => {
  it('returns positive when latest is newer (patch)', () => {
    expect(compareVersions('1.0.0', '1.0.1')).toBeGreaterThan(0);
  });

  it('returns positive when latest is newer (minor)', () => {
    expect(compareVersions('1.0.5', '1.1.0')).toBeGreaterThan(0);
  });

  it('returns positive when latest is newer (major)', () => {
    expect(compareVersions('1.9.9', '2.0.0')).toBeGreaterThan(0);
  });

  it('returns 0 for equal versions', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it('returns negative when current is newer', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBeLessThan(0);
  });

  it('treats prerelease as older than release at same numeric version', () => {
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBeLessThan(0);
  });

  it('orders numeric prerelease identifiers numerically (rc.2 < rc.10)', () => {
    expect(compareVersions('1.0.0-rc.2', '1.0.0-rc.10')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0-rc.10', '1.0.0-rc.2')).toBeLessThan(0);
    expect(compareVersions('1.0.0-rc.2', '1.0.0-rc.2')).toBe(0);
  });

  it('ranks numeric prerelease identifiers below non-numeric ones', () => {
    expect(compareVersions('1.0.0-alpha', '1.0.0-1')).toBeLessThan(0);
    expect(compareVersions('1.0.0-1', '1.0.0-alpha')).toBeGreaterThan(0);
  });

  it('treats a longer prerelease set as higher precedence when prefix matches', () => {
    expect(compareVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0-alpha.1', '1.0.0-alpha')).toBeLessThan(0);
  });

  it('returns 0 for unparseable versions', () => {
    expect(compareVersions('not-a-version', '1.0.0')).toBe(0);
  });

  it('handles a leading v', () => {
    expect(compareVersions('v1.0.0', 'v1.0.1')).toBeGreaterThan(0);
  });
});

describe('isNewer', () => {
  it('returns true when latest > current', () => {
    expect(isNewer('1.0.0', '1.0.1')).toBe(true);
  });

  it('returns false when versions are equal', () => {
    expect(isNewer('1.0.0', '1.0.0')).toBe(false);
  });

  it('returns false when current > latest', () => {
    expect(isNewer('2.0.0', '1.0.0')).toBe(false);
  });
});

describe('shouldSkipCheck', () => {
  const pkg = { name: '@getbrevo/cli', version: '1.0.0' };

  it('skips when CI=true', () => {
    expect(shouldSkipCheck({ pkg, env: { CI: 'true' }, argv: [], isTTY: true })).toBe(true);
  });

  it('skips when CI=1', () => {
    expect(shouldSkipCheck({ pkg, env: { CI: '1' }, argv: [], isTTY: true })).toBe(true);
  });

  it('skips when not a TTY', () => {
    expect(shouldSkipCheck({ pkg, env: {}, argv: [], isTTY: false })).toBe(true);
  });

  it('skips when NO_UPDATE_NOTIFIER=1', () => {
    expect(shouldSkipCheck({ pkg, env: { NO_UPDATE_NOTIFIER: '1' }, argv: [], isTTY: true })).toBe(
      true,
    );
  });

  it('skips when BREVO_NO_UPDATE_NOTIFIER=1', () => {
    expect(
      shouldSkipCheck({ pkg, env: { BREVO_NO_UPDATE_NOTIFIER: '1' }, argv: [], isTTY: true }),
    ).toBe(true);
  });

  it('skips when --no-update-notifier flag is passed', () => {
    expect(
      shouldSkipCheck({
        pkg,
        env: {},
        argv: ['node', 'brevo', '--no-update-notifier'],
        isTTY: true,
      }),
    ).toBe(true);
  });

  it('does not skip in a normal interactive session', () => {
    expect(
      shouldSkipCheck({ pkg, env: {}, argv: ['node', 'brevo', 'app', 'list'], isTTY: true }),
    ).toBe(false);
  });
});

describe('readCache / writeCache', () => {
  it('returns undefined when cache file does not exist', () => {
    expect(readCache(path.join(TMP_ROOT, 'missing.json'))).toBeUndefined();
  });

  it('writes and reads back a cache entry', () => {
    const p = makeCachePath();
    const entry = { latest: '1.2.0', lastChecked: 1700000000000 };
    writeCache(p, entry);
    expect(readCache(p)).toEqual(entry);
  });

  it('returns undefined for malformed JSON', () => {
    const p = makeCachePath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, 'not json');
    expect(readCache(p)).toBeUndefined();
  });

  it('returns undefined when required fields are missing', () => {
    const p = makeCachePath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ latest: '1.0.0' }));
    expect(readCache(p)).toBeUndefined();
  });
});

describe('formatBanner', () => {
  it('contains current version, latest version, and install command', () => {
    const banner = formatBanner('1.0.0', '1.2.0', '@getbrevo/cli');
    expect(banner).toContain('1.0.0');
    expect(banner).toContain('1.2.0');
    expect(banner).toContain('npm install -g @getbrevo/cli');
    expect(banner).toContain('yarn global add @getbrevo/cli');
  });

  it('produces a bordered box', () => {
    const banner = formatBanner('1.0.0', '1.2.0', '@getbrevo/cli');
    expect(banner).toContain('╭');
    expect(banner).toContain('╯');
  });
});

describe('shouldShowBannerBefore', () => {
  it('returns true for `brevo app init`', () => {
    expect(shouldShowBannerBefore(['node', 'brevo', 'app', 'init'])).toBe(true);
  });

  it('returns true for `brevo app create` with flags', () => {
    expect(shouldShowBannerBefore(['node', 'brevo', 'app', 'create', '--name', 'My App'])).toBe(
      true,
    );
  });

  it('returns true for bare `brevo` (no subcommand)', () => {
    expect(shouldShowBannerBefore(['node', 'brevo'])).toBe(true);
  });

  it('returns true for `--help` and `-h`', () => {
    expect(shouldShowBannerBefore(['node', 'brevo', '--help'])).toBe(true);
    expect(shouldShowBannerBefore(['node', 'brevo', '-h'])).toBe(true);
    expect(shouldShowBannerBefore(['node', 'brevo', 'whoami', '--help'])).toBe(true);
  });

  it('returns true for `--version` and `-V`', () => {
    expect(shouldShowBannerBefore(['node', 'brevo', '--version'])).toBe(true);
    expect(shouldShowBannerBefore(['node', 'brevo', '-V'])).toBe(true);
  });

  it('returns false for other app subcommands', () => {
    expect(shouldShowBannerBefore(['node', 'brevo', 'app', 'list'])).toBe(false);
    expect(shouldShowBannerBefore(['node', 'brevo', 'app', 'scaffold'])).toBe(false);
  });

  it('returns false for top-level commands', () => {
    expect(shouldShowBannerBefore(['node', 'brevo', 'login'])).toBe(false);
    expect(shouldShowBannerBefore(['node', 'brevo', 'whoami'])).toBe(false);
  });
});

describe('fetchLatestVersion', () => {
  it('returns the version from a successful response', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '2.0.0' }),
    }) as unknown as typeof fetch;
    const v = await fetchLatestVersion('@getbrevo/cli', {
      pkg: { name: '@getbrevo/cli', version: '1.0.0' },
      fetchImpl,
    });
    expect(v).toBe('2.0.0');
  });

  it('returns undefined on non-OK response', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue({ ok: false, json: async () => ({}) }) as unknown as typeof fetch;
    const v = await fetchLatestVersion('@getbrevo/cli', {
      pkg: { name: '@getbrevo/cli', version: '1.0.0' },
      fetchImpl,
    });
    expect(v).toBeUndefined();
  });

  it('returns undefined on network error', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('boom')) as unknown as typeof fetch;
    const v = await fetchLatestVersion('@getbrevo/cli', {
      pkg: { name: '@getbrevo/cli', version: '1.0.0' },
      fetchImpl,
    });
    expect(v).toBeUndefined();
  });

  it('returns undefined when payload is missing version', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    }) as unknown as typeof fetch;
    const v = await fetchLatestVersion('@getbrevo/cli', {
      pkg: { name: '@getbrevo/cli', version: '1.0.0' },
      fetchImpl,
    });
    expect(v).toBeUndefined();
  });
});

describe('startUpdateCheck', () => {
  const baseEnv = {};
  const baseArgv = ['node', 'brevo'];

  it('returns no cached value and a resolved promise when skipped', async () => {
    const handle = startUpdateCheck({
      pkg: { name: '@getbrevo/cli', version: '1.0.0' },
      env: { CI: 'true' },
      argv: baseArgv,
      isTTY: true,
      cachePath: makeCachePath(),
    });
    expect(handle.cachedLatest).toBeUndefined();
    await expect(handle.pending).resolves.toBeUndefined();
  });

  it('uses cache when fresh (within TTL) and does not fetch', async () => {
    const cachePath = makeCachePath();
    const now = 1_700_000_000_000;
    writeCache(cachePath, { latest: '1.2.0', lastChecked: now - 1000 });
    const fetchImpl = jest.fn() as unknown as typeof fetch;

    const handle = startUpdateCheck({
      pkg: { name: '@getbrevo/cli', version: '1.0.0' },
      env: baseEnv,
      argv: baseArgv,
      isTTY: true,
      cachePath,
      fetchImpl,
      now: () => now,
    });

    expect(handle.cachedLatest).toBe('1.2.0');
    await handle.pending;
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fetches and updates cache when stale (older than TTL)', async () => {
    const cachePath = makeCachePath();
    const now = 1_700_000_000_000;
    const ttlMs = 24 * 60 * 60 * 1000;
    writeCache(cachePath, { latest: '1.0.0', lastChecked: now - ttlMs - 1 });
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '1.5.0' }),
    }) as unknown as typeof fetch;

    const handle = startUpdateCheck({
      pkg: { name: '@getbrevo/cli', version: '1.0.0' },
      env: baseEnv,
      argv: baseArgv,
      isTTY: true,
      cachePath,
      fetchImpl,
      now: () => now,
    });

    expect(handle.cachedLatest).toBe('1.0.0');
    await handle.pending;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(readCache(cachePath)).toEqual({ latest: '1.5.0', lastChecked: now });
  });

  it('fetches when no cache exists', async () => {
    const cachePath = makeCachePath();
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '2.0.0' }),
    }) as unknown as typeof fetch;

    const handle = startUpdateCheck({
      pkg: { name: '@getbrevo/cli', version: '1.0.0' },
      env: baseEnv,
      argv: baseArgv,
      isTTY: true,
      cachePath,
      fetchImpl,
      now: () => 1_700_000_000_000,
    });

    expect(handle.cachedLatest).toBeUndefined();
    await handle.pending;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // Fresh fetch must be visible to notifyUpdate without another run.
    expect(handle.cachedLatest).toBe('2.0.0');
  });

  it('updates handle.cachedLatest with the freshly fetched version on stale cache', async () => {
    const cachePath = makeCachePath();
    const now = 1_700_000_000_000;
    const ttlMs = 24 * 60 * 60 * 1000;
    writeCache(cachePath, { latest: '1.0.0', lastChecked: now - ttlMs - 1 });
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '1.5.0' }),
    }) as unknown as typeof fetch;

    const handle = startUpdateCheck({
      pkg: { name: '@getbrevo/cli', version: '1.0.0' },
      env: baseEnv,
      argv: baseArgv,
      isTTY: true,
      cachePath,
      fetchImpl,
      now: () => now,
    });

    expect(handle.cachedLatest).toBe('1.0.0');
    await handle.pending;
    expect(handle.cachedLatest).toBe('1.5.0');
  });

  it('honours BREVO_CONFIG_HOME from opts.env when no cachePath override is given', () => {
    fs.mkdirSync(TMP_ROOT, { recursive: true });
    const tmpHome = fs.mkdtempSync(path.join(TMP_ROOT, 'home-'));
    const expectedCache = path.join(tmpHome, 'update-check.json');
    const now = 1_700_000_000_000;
    writeCache(expectedCache, { latest: '9.9.9', lastChecked: now - 1000 });
    const fetchImpl = jest.fn() as unknown as typeof fetch;

    const handle = startUpdateCheck({
      pkg: { name: '@getbrevo/cli', version: '1.0.0' },
      env: { BREVO_CONFIG_HOME: tmpHome },
      argv: baseArgv,
      isTTY: true,
      fetchImpl,
      now: () => now,
    });

    expect(handle.cachedLatest).toBe('9.9.9');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

function makeStream(): { stream: NodeJS.WriteStream; output: string[] } {
  const output: string[] = [];
  const stream = {
    write: (chunk: string) => {
      output.push(chunk);
      return true;
    },
  } as unknown as NodeJS.WriteStream;
  return { stream, output };
}

describe('notifyUpdate', () => {
  it('writes a banner when cached latest is newer', async () => {
    const { stream, output } = makeStream();
    await notifyUpdate(
      { cachedLatest: '1.2.0', pending: Promise.resolve() },
      { name: '@getbrevo/cli', version: '1.0.0' },
      stream,
      0,
    );
    const written = output.join('');
    expect(written).toContain('1.0.0');
    expect(written).toContain('1.2.0');
  });

  it('writes nothing when no cached latest', async () => {
    const { stream, output } = makeStream();
    await notifyUpdate(
      { pending: Promise.resolve() },
      { name: '@getbrevo/cli', version: '1.0.0' },
      stream,
      0,
    );
    expect(output).toHaveLength(0);
  });

  it('writes nothing when current >= latest', async () => {
    const { stream, output } = makeStream();
    await notifyUpdate(
      { cachedLatest: '1.0.0', pending: Promise.resolve() },
      { name: '@getbrevo/cli', version: '1.0.0' },
      stream,
      0,
    );
    expect(output).toHaveLength(0);
  });

  it('does not block beyond the wait timeout', async () => {
    const { stream } = makeStream();
    const neverResolves = new Promise<void>(() => {});
    const start = Date.now();
    await notifyUpdate(
      { pending: neverResolves },
      { name: '@getbrevo/cli', version: '1.0.0' },
      stream,
      50,
    );
    expect(Date.now() - start).toBeLessThan(500);
  });
});
