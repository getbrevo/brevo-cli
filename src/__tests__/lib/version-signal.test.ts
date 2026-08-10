import {
  parseHeaderVersion,
  parseHeaderStatus,
  parseVersionSignal,
  mergeVersionSignal,
  hasVersionSignal,
  isUnsupported,
  isOutdated,
  needsNotice,
} from '../../lib/version-signal';
import { CLI_VERSION_HEADERS } from '../../lib/constants';

function headers(map: Record<string, string>): Headers {
  return new Headers(map);
}

describe('parseHeaderVersion', () => {
  it.each([
    ['2.4.0', '2.4.0'],
    ['v2.4.0', 'v2.4.0'],
    ['  2.4.0  ', '2.4.0'],
    ['2.4.0-rc.1', '2.4.0-rc.1'],
    ['2.4.0-alpha.1+build.5', '2.4.0-alpha.1+build.5'],
  ])('accepts %j', (raw, expected) => {
    expect(parseHeaderVersion(raw)).toBe(expected);
  });

  it.each([['latest'], ['2.4'], ['2'], [''], ['   '], ['2.4.0.1'], ['<html>'], ['１.２.３']])(
    'rejects %j',
    (raw) => {
      expect(parseHeaderVersion(raw)).toBeUndefined();
    },
  );

  it('rejects non-strings and absent values', () => {
    expect(parseHeaderVersion(null)).toBeUndefined();
    expect(parseHeaderVersion(undefined)).toBeUndefined();
  });

  it('rejects an over-long value rather than running the regex on it', () => {
    expect(parseHeaderVersion('1.2.3-' + 'a'.repeat(200))).toBeUndefined();
  });
});

describe('parseHeaderStatus', () => {
  it.each([
    ['ok', 'ok'],
    ['outdated', 'outdated'],
    ['unsupported', 'unsupported'],
    ['  OUTDATED  ', 'outdated'],
    ['Unsupported', 'unsupported'],
  ])('accepts %j', (raw, expected) => {
    expect(parseHeaderStatus(raw)).toBe(expected);
  });

  // An unrecognised status must read as "no information", never as a block.
  // That is what lets the backend add a new status without breaking older CLIs.
  it.each([['blocked'], ['deprecated'], ['true'], ['1'], [''], ['ok!'], ['un supported']])(
    'treats unrecognised value %j as absent',
    (raw) => {
      expect(parseHeaderStatus(raw)).toBeUndefined();
    },
  );

  it('rejects non-strings and absent values', () => {
    expect(parseHeaderStatus(null)).toBeUndefined();
    expect(parseHeaderStatus(undefined)).toBeUndefined();
  });
});

describe('parseVersionSignal', () => {
  it('reads both headers', () => {
    expect(
      parseVersionSignal(
        headers({
          [CLI_VERSION_HEADERS.LATEST]: '2.4.0',
          [CLI_VERSION_HEADERS.STATUS]: 'outdated',
        }),
      ),
    ).toEqual({ latestVersion: '2.4.0', status: 'outdated' });
  });

  it('is case-insensitive on header names', () => {
    expect(
      parseVersionSignal(
        headers({ 'X-Brevo-Cli-Latest-Version': '2.4.0', 'X-BREVO-CLI-STATUS': 'unsupported' }),
      ),
    ).toEqual({ latestVersion: '2.4.0', status: 'unsupported' });
  });

  it('returns an empty signal when the headers are absent', () => {
    expect(parseVersionSignal(headers({}))).toEqual({
      latestVersion: undefined,
      status: undefined,
    });
  });

  it('drops only the malformed half', () => {
    expect(
      parseVersionSignal(
        headers({ [CLI_VERSION_HEADERS.LATEST]: 'garbage', [CLI_VERSION_HEADERS.STATUS]: 'ok' }),
      ),
    ).toEqual({ latestVersion: undefined, status: 'ok' });
  });

  it('never throws on a missing or malformed header bag', () => {
    expect(parseVersionSignal(undefined)).toEqual({});
    expect(parseVersionSignal(null)).toEqual({});
    expect(parseVersionSignal({} as never)).toEqual({});
  });
});

describe('verdict helpers', () => {
  it('classifies each status', () => {
    expect(isUnsupported({ status: 'unsupported' })).toBe(true);
    expect(isUnsupported({ status: 'outdated' })).toBe(false);
    expect(isOutdated({ status: 'outdated' })).toBe(true);
    expect(isOutdated({ status: 'ok' })).toBe(false);
  });

  it('needs a notice for outdated and unsupported only', () => {
    expect(needsNotice({ status: 'unsupported' })).toBe(true);
    expect(needsNotice({ status: 'outdated' })).toBe(true);
    expect(needsNotice({ status: 'ok' })).toBe(false);
    expect(needsNotice({})).toBe(false);
  });

  // No verdict means no action, even when a version is known.
  it('does nothing on a version with no status', () => {
    expect(needsNotice({ latestVersion: '9.9.9' })).toBe(false);
    expect(isUnsupported({ latestVersion: '9.9.9' })).toBe(false);
  });
});

describe('mergeVersionSignal', () => {
  it('lets a present field win', () => {
    expect(mergeVersionSignal({ status: 'ok' }, { status: 'unsupported' })).toEqual({
      latestVersion: undefined,
      status: 'unsupported',
    });
  });

  // A response carrying only one header must not erase the other.
  it('keeps a known value when the incoming half is absent', () => {
    expect(
      mergeVersionSignal({ latestVersion: '2.4.0', status: 'outdated' }, { status: 'unsupported' }),
    ).toEqual({ latestVersion: '2.4.0', status: 'unsupported' });
  });
});

describe('hasVersionSignal', () => {
  it('is false only when both halves are absent', () => {
    expect(hasVersionSignal({})).toBe(false);
    expect(hasVersionSignal({ latestVersion: '2.4.0' })).toBe(true);
    expect(hasVersionSignal({ status: 'ok' })).toBe(true);
  });
});
