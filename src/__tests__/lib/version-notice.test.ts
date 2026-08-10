import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  formatVersionNotice,
  sanitizeNoticeMessage,
  isKnownNoticeCode,
  readNoticeCache,
  writeNoticeCache,
  isNoticeStale,
  createVersionGate,
  MAX_NOTICE_MESSAGE_LEN,
  NOTICE_TTL_MS,
} from '../../lib/version-notice';
import { CliVersionUnsupportedError } from '../../lib/errors';
import { VersionNotice, VersionNoticeCache } from '../../types';

const CLI_VERSION = '2.0.1';
const PKG = '@getbrevo/cli';

let tmpDir: string;
let cachePath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brevo-notice-'));
  cachePath = path.join(tmpDir, 'cli-notice.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function gate(overrides: Partial<Parameters<typeof createVersionGate>[0]> = {}) {
  return createVersionGate({
    cliVersion: CLI_VERSION,
    pkgName: PKG,
    cachePath,
    env: {},
    argv: [],
    isTTY: true,
    now: () => 1_000_000,
    ...overrides,
  });
}

describe('sanitizeNoticeMessage', () => {
  it('passes plain text through', () => {
    expect(sanitizeNoticeMessage('The cli version is a mismatch.')).toBe(
      'The cli version is a mismatch.',
    );
  });

  it('strips ANSI escapes that could repaint the terminal', () => {
    expect(sanitizeNoticeMessage('\x1B[31mred\x1B[0m text')).toBe('red text');
  });

  it('strips OSC sequences', () => {
    expect(sanitizeNoticeMessage('\x1B]0;title\x07hello')).toBe('hello');
  });

  it('strips C1 control characters', () => {
    expect(sanitizeNoticeMessage('a\x9Bb')).toBe('ab');
  });

  it('flattens newlines and tabs to a single line', () => {
    expect(sanitizeNoticeMessage('line one\nline two\r\n\tline three')).toBe(
      'line one line two line three',
    );
  });

  it('clamps to the maximum length', () => {
    expect(sanitizeNoticeMessage('x'.repeat(500))).toHaveLength(MAX_NOTICE_MESSAGE_LEN);
  });

  it('rejects HTML bodies', () => {
    expect(sanitizeNoticeMessage('<!DOCTYPE html><html><body>login</body></html>')).toBeUndefined();
    expect(sanitizeNoticeMessage('<html>hi</html>')).toBeUndefined();
  });

  it('rejects empty, whitespace-only and non-string input', () => {
    expect(sanitizeNoticeMessage('')).toBeUndefined();
    expect(sanitizeNoticeMessage('   ')).toBeUndefined();
    expect(sanitizeNoticeMessage('\x1B[0m')).toBeUndefined();
    expect(sanitizeNoticeMessage(undefined)).toBeUndefined();
    expect(sanitizeNoticeMessage(42)).toBeUndefined();
  });
});

describe('isKnownNoticeCode', () => {
  it('accepts the documented code and nothing else', () => {
    expect(isKnownNoticeCode('cli_version_mismatch')).toBe(true);
    expect(isKnownNoticeCode('something_else')).toBe(false);
    expect(isKnownNoticeCode(undefined)).toBe(false);
  });
});

describe('notice cache', () => {
  const notice: VersionNotice = {
    code: 'cli_version_mismatch',
    message: 'The cli version is a mismatch.',
  };

  const base: VersionNoticeCache = {
    cliVersion: CLI_VERSION,
    latestVersion: '2.4.0',
    status: 'unsupported',
    notice,
    fetchedAt: 1000,
    ttlMs: NOTICE_TTL_MS,
  };

  it('round-trips', () => {
    writeNoticeCache(cachePath, base);
    expect(readNoticeCache(cachePath, CLI_VERSION)).toEqual(base);
  });

  it('creates the directory with owner-only permissions', () => {
    const nested = path.join(tmpDir, 'nested', 'cli-notice.json');
    writeNoticeCache(nested, base);
    expect(fs.statSync(path.dirname(nested)).mode & 0o777).toBe(0o700);
  });

  // The most important rule: a verdict about the version we just upgraded away
  // from must never survive the upgrade.
  it('discards a cache written by a different CLI version', () => {
    writeNoticeCache(cachePath, { ...base, cliVersion: '1.9.0' });
    expect(readNoticeCache(cachePath, CLI_VERSION)).toBeUndefined();
  });

  it('treats a missing file as absent', () => {
    expect(readNoticeCache(path.join(tmpDir, 'nope.json'), CLI_VERSION)).toBeUndefined();
  });

  it.each([['not json at all'], ['{"cliVersion":'], ['null'], ['[]'], ['"a string"']])(
    'treats corrupt content %j as absent',
    (raw) => {
      fs.writeFileSync(cachePath, raw);
      expect(readNoticeCache(cachePath, CLI_VERSION)).toBeUndefined();
    },
  );

  it('rejects a non-numeric fetchedAt', () => {
    fs.writeFileSync(cachePath, JSON.stringify({ ...base, fetchedAt: 'soon' }));
    expect(readNoticeCache(cachePath, CLI_VERSION)).toBeUndefined();
  });

  // A hand-edited status must not be able to invent a verdict.
  it('drops an unrecognised cached status', () => {
    fs.writeFileSync(cachePath, JSON.stringify({ ...base, status: 'blocked' }));
    expect(readNoticeCache(cachePath, CLI_VERSION)?.status).toBeUndefined();
  });

  it('re-sanitizes the cached message on read', () => {
    fs.writeFileSync(
      cachePath,
      JSON.stringify({ ...base, notice: { code: notice.code, message: '\x1B[31mevil\x1B[0m' } }),
    );
    expect(readNoticeCache(cachePath, CLI_VERSION)?.notice?.message).toBe('evil');
  });

  it('drops a cached notice carrying an unknown code but keeps the verdict', () => {
    fs.writeFileSync(
      cachePath,
      JSON.stringify({ ...base, notice: { code: 'made_up', message: 'hi' } }),
    );
    const read = readNoticeCache(cachePath, CLI_VERSION);
    expect(read?.notice).toBeUndefined();
    expect(read?.status).toBe('unsupported');
  });

  it('is stale past the TTL and fresh within it', () => {
    expect(isNoticeStale(base, base.fetchedAt + NOTICE_TTL_MS - 1)).toBe(false);
    expect(isNoticeStale(base, base.fetchedAt + NOTICE_TTL_MS + 1)).toBe(true);
  });

  it('is stale when there is no cache or no notice', () => {
    expect(isNoticeStale(undefined, 0)).toBe(true);
    expect(isNoticeStale({ ...base, notice: undefined }, base.fetchedAt)).toBe(true);
  });
});

describe('version gate — verdicts', () => {
  it('is silent with no cache and no signal', () => {
    const g = gate();
    expect(g.status()).toBeUndefined();
    expect(g.shouldBlock()).toBe(false);
    expect(g.shouldNotify()).toBe(false);
  });

  it('stays silent on ok', () => {
    const g = gate();
    g.record({ status: 'ok', latestVersion: '2.0.1' });
    expect(g.shouldNotify()).toBe(false);
    expect(g.shouldBlock()).toBe(false);
  });

  it('notifies but does not block on outdated', () => {
    const g = gate();
    g.record({ status: 'outdated', latestVersion: '2.4.0' });
    expect(g.shouldNotify()).toBe(true);
    expect(g.shouldBlock()).toBe(false);
  });

  it('blocks on unsupported, throwing from record', () => {
    const g = gate();
    expect(() => g.record({ status: 'unsupported' })).toThrow(CliVersionUnsupportedError);
    expect(g.shouldBlock()).toBe(true);
  });

  it('throws only on the first discovery, not on every later response', () => {
    const g = gate();
    expect(() => g.record({ status: 'unsupported' })).toThrow(CliVersionUnsupportedError);
    expect(() => g.record({ status: 'unsupported' })).not.toThrow();
  });

  it('ignores a signal with nothing in it', () => {
    const g = gate();
    g.record({});
    expect(g.status()).toBeUndefined();
  });

  // The CLI performs no comparison of its own — a version alone means nothing.
  it('does not act on a version without a status', () => {
    const g = gate();
    g.record({ latestVersion: '99.0.0' });
    expect(g.shouldNotify()).toBe(false);
    expect(g.shouldBlock()).toBe(false);
  });
});

describe('version gate — opt-outs', () => {
  const optOuts: Array<[string, Partial<Parameters<typeof createVersionGate>[0]>]> = [
    ['CI', { env: { CI: 'true' } }],
    ['non-TTY', { isTTY: false }],
    ['NO_UPDATE_NOTIFIER', { env: { NO_UPDATE_NOTIFIER: '1' } }],
    ['BREVO_NO_UPDATE_NOTIFIER', { env: { BREVO_NO_UPDATE_NOTIFIER: '1' } }],
    ['--no-update-notifier', { argv: ['--no-update-notifier'] }],
  ];

  it.each(optOuts)('%s suppresses the outdated notice', (_name, overrides) => {
    const g = gate(overrides);
    g.record({ status: 'outdated', latestVersion: '2.4.0' });
    expect(g.shouldNotify()).toBe(false);
  });

  // With an authoritative backend verdict, a CI job on a dead version must
  // still be stopped — it would otherwise fail later on real API errors.
  it.each(optOuts)('%s does NOT suppress an unsupported block', (_name, overrides) => {
    const g = gate(overrides);
    expect(() => g.record({ status: 'unsupported' })).toThrow(CliVersionUnsupportedError);
    expect(g.shouldBlock()).toBe(true);
    expect(g.shouldNotify()).toBe(true);
  });

  it.each([['1'], ['true']])('BREVO_CLI_SKIP_VERSION_GATE=%s bypasses the block', (value) => {
    const g = gate({ env: { BREVO_CLI_SKIP_VERSION_GATE: value } });
    g.record({ status: 'unsupported' });
    expect(g.shouldBlock()).toBe(false);
  });
});

describe('version gate — startup verdict from cache', () => {
  it('blocks at startup with no network at all', () => {
    writeNoticeCache(cachePath, {
      cliVersion: CLI_VERSION,
      status: 'unsupported',
      latestVersion: '2.4.0',
      fetchedAt: 1000,
      ttlMs: NOTICE_TTL_MS,
    });
    expect(gate().shouldBlock()).toBe(true);
  });

  it('does not block from a cache written by another CLI version', () => {
    writeNoticeCache(cachePath, {
      cliVersion: '1.0.0',
      status: 'unsupported',
      fetchedAt: 1000,
      ttlMs: NOTICE_TTL_MS,
    });
    expect(gate().shouldBlock()).toBe(false);
  });

  it('persists a live verdict so the next run decides offline', () => {
    const g = gate();
    g.record({ status: 'outdated', latestVersion: '2.4.0' });
    expect(readNoticeCache(cachePath, CLI_VERSION)).toMatchObject({
      status: 'outdated',
      latestVersion: '2.4.0',
    });
  });
});

describe('version gate — rendering', () => {
  it('renders nothing when there is nothing to say', async () => {
    await expect(gate().render()).resolves.toBeUndefined();
  });

  it('uses the server message when the fetch succeeds', async () => {
    const g = gate({
      fetchNotice: async () => ({ code: 'cli_version_mismatch', message: 'Server supplied copy.' }),
    });
    g.record({ status: 'outdated', latestVersion: '2.4.0' });
    const box = await g.render();
    expect(box).toContain('Server supplied copy.');
    expect(box).toContain('npm install -g @getbrevo/cli');
  });

  // /cli/info is cosmetic — its failure costs wording, never the verdict.
  it('falls back to local wording when the fetch yields nothing', async () => {
    const g = gate({ fetchNotice: async () => undefined });
    g.record({ status: 'outdated', latestVersion: '2.4.0' });
    expect(await g.render()).toContain('A newer version of the Brevo CLI is available.');
    expect(g.status()).toBe('outdated');
  });

  it('shows the unsupported wording for a block', async () => {
    const g = gate({ fetchNotice: async () => undefined });
    expect(() => g.record({ status: 'unsupported', latestVersion: '2.4.0' })).toThrow();
    expect(await g.render()).toContain('v2.0.1 is no longer supported');
  });

  it('does not refetch while the cached notice is fresh', async () => {
    writeNoticeCache(cachePath, {
      cliVersion: CLI_VERSION,
      status: 'outdated',
      latestVersion: '2.4.0',
      notice: { code: 'cli_version_mismatch', message: 'Cached copy.' },
      fetchedAt: 1_000_000,
      ttlMs: NOTICE_TTL_MS,
    });
    const fetchNotice = jest.fn();
    const box = await gate({ fetchNotice, now: () => 1_000_100 }).render();
    expect(fetchNotice).not.toHaveBeenCalled();
    expect(box).toContain('Cached copy.');
  });

  it('refetches once the cached notice is stale', async () => {
    writeNoticeCache(cachePath, {
      cliVersion: CLI_VERSION,
      status: 'outdated',
      latestVersion: '2.4.0',
      notice: { code: 'cli_version_mismatch', message: 'Old copy.' },
      fetchedAt: 0,
      ttlMs: NOTICE_TTL_MS,
    });
    const fetchNotice = jest.fn(async () => ({
      code: 'cli_version_mismatch',
      message: 'Fresh copy.',
    }));
    const box = await gate({ fetchNotice, now: () => NOTICE_TTL_MS + 1 }).render();
    expect(fetchNotice).toHaveBeenCalledTimes(1);
    expect(box).toContain('Fresh copy.');
  });

  it('passes what it knows to the info endpoint', async () => {
    const fetchNotice = jest.fn(async () => undefined);
    const g = gate({ fetchNotice, os: 'macos' });
    g.record({ status: 'outdated', latestVersion: '2.4.0' });
    await g.render();
    expect(fetchNotice).toHaveBeenCalledWith({
      reason: 'version_mismatch',
      currentVersion: CLI_VERSION,
      latestVersion: '2.4.0',
      status: 'outdated',
      os: 'macos',
    });
  });
});

describe('version gate — --json envelope', () => {
  it('emits the documented shape', () => {
    const g = gate();
    try {
      g.record({ status: 'unsupported', latestVersion: '2.4.0' });
    } catch {
      // expected — the gate aborts the run
    }
    expect(g.jsonEnvelope()).toEqual({
      error: {
        code: 'CLI_VERSION_UNSUPPORTED',
        message: expect.stringContaining('no longer supported'),
        current_version: '2.0.1',
        latest_version: '2.4.0',
        upgrade: 'npm install -g @getbrevo/cli@latest',
      },
    });
  });

  it('prefers the server message once one is known', async () => {
    const g = gate({
      fetchNotice: async () => ({
        code: 'cli_version_mismatch',
        message: 'The cli version is a mismatch.',
      }),
    });
    try {
      g.record({ status: 'unsupported' });
    } catch {
      // expected
    }
    await g.render();
    expect((g.jsonEnvelope().error as Record<string, unknown>).message).toBe(
      'The cli version is a mismatch.',
    );
  });
});

describe('formatVersionNotice — placement and colour', () => {
  const boxLines = (out: string): string[] => out.split('\n').filter((l) => l.includes('│'));

  it('puts the explanation outside the box, above it', () => {
    const out = formatVersionNotice('outdated', '2.0.1', '2.4.0', PKG, 'Server copy.');
    const lines = out.split('\n');
    expect(lines.findIndex((l) => l.includes('Server copy.'))).toBeLessThan(
      lines.findIndex((l) => l.includes('╭')),
    );
    expect(boxLines(out).join('\n')).not.toContain('Server copy.');
  });

  it('keeps the locally-owned lines inside the box', () => {
    const inside = boxLines(
      formatVersionNotice('unsupported', '2.0.1', '2.4.0', PKG, 'Server copy.'),
    ).join('\n');
    expect(inside).toContain('no longer supported');
    expect(inside).toContain('npm install -g @getbrevo/cli');
    expect(inside).toContain('brew upgrade brevo');
  });

  // The box must not resize because of what a server returned.
  it('box width is unaffected by the length of the server message', () => {
    const short = boxLines(formatVersionNotice('outdated', '2.0.1', '2.4.0', PKG, 'hi'));
    const long = boxLines(
      formatVersionNotice('outdated', '2.0.1', '2.4.0', PKG, 'x'.repeat(MAX_NOTICE_MESSAGE_LEN)),
    );
    expect(long.map((l) => l.length)).toEqual(short.map((l) => l.length));
  });

  describe('colour', () => {
    const ORIGINAL = { ...process.env };
    afterEach(() => {
      process.env = { ...ORIGINAL };
    });

    it('wraps the message in red when colour is enabled', () => {
      process.env.FORCE_COLOR = '1';
      delete process.env.NO_COLOR;
      expect(formatVersionNotice('outdated', '2.0.1', '2.4.0', PKG, 'Server copy.')).toContain(
        '\x1b[31mServer copy.\x1b[0m',
      );
    });

    it('emits no escape codes under NO_COLOR', () => {
      process.env.NO_COLOR = '1';
      process.env.FORCE_COLOR = '1';
      const out = formatVersionNotice('outdated', '2.0.1', '2.4.0', PKG, 'Server copy.');
      expect(out).toContain('Server copy.');
      // eslint-disable-next-line no-control-regex
      expect(out).not.toMatch(/\x1b\[/);
    });

    it('emits no escape codes when the stream is not a terminal', () => {
      delete process.env.FORCE_COLOR;
      delete process.env.NO_COLOR;
      const out = formatVersionNotice('outdated', '2.0.1', '2.4.0', PKG, 'Server copy.');
      // eslint-disable-next-line no-control-regex
      expect(out).not.toMatch(/\x1b\[/);
    });

    it('cannot be escaped by a sanitized message', () => {
      process.env.FORCE_COLOR = '1';
      const injected = sanitizeNoticeMessage('\x1b[0mnot red\x1b[31m') ?? '';
      const out = formatVersionNotice('outdated', '2.0.1', '2.4.0', PKG, injected);
      expect(out).toContain('\x1b[31mnot red\x1b[0m');
      // eslint-disable-next-line no-control-regex
      expect(out.match(/\x1b\[31m/g)).toHaveLength(1);
    });
  });
});
