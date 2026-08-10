import { compareVersions, isNewer, shouldSkipCheck } from '../../lib/update-notifier';

// The npm-registry paths (fetch, cache, banners, force-update gate) were removed
// when update notices moved to the API — see lib/version-signal.ts. What remains
// here is the shared semver comparison and the notice opt-out rules.

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
