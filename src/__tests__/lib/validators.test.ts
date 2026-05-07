import { validateUrl, collectUrls, parseAppId } from '../../lib/validators';
import { CliError } from '../../lib/errors';

describe('validateUrl', () => {
  it('accepts a valid http URL', () => {
    expect(() => validateUrl('http://localhost:3000/auth/callback', 'redirect URL')).not.toThrow();
  });

  it('accepts a valid https URL', () => {
    expect(() => validateUrl('https://example.com/callback', 'redirect URL')).not.toThrow();
  });

  it('returns silently for undefined', () => {
    expect(() => validateUrl(undefined, 'redirect URL')).not.toThrow();
  });

  it('rejects a URL containing a space', () => {
    expect(() =>
      validateUrl(
        'http://localhost:3009/auth/callback http://localhost:3011/auth/callback',
        'redirect URL',
      ),
    ).toThrow(CliError);
  });

  it('rejects a URL containing a tab', () => {
    expect(() => validateUrl('http://localhost:3000/cb\thttp://other/cb', 'redirect URL')).toThrow(
      CliError,
    );
  });

  it('rejects a URL containing a comma (caller likely passed a comma-separated list)', () => {
    expect(() =>
      validateUrl(
        'http://localhost:3009/auth/callback,http://localhost:3011/auth/callback',
        'redirect URL',
      ),
    ).toThrow(CliError);
  });

  it('rejects a URL containing a comma and a space', () => {
    expect(() =>
      validateUrl(
        'http://localhost:3009/auth/callback, http://localhost:3011/auth/callback',
        'redirect URL',
      ),
    ).toThrow(CliError);
  });

  it('error message for comma-containing value hints at repeating the flag', () => {
    expect(() => validateUrl('http://a/cb, http://b/cb', 'redirect URL')).toThrow(/--redirect-uri/);
  });

  it('rejects a non-http protocol', () => {
    expect(() => validateUrl('ftp://example.com/', 'redirect URL')).toThrow(CliError);
  });
});

describe('collectUrls', () => {
  it('rejects when a single flag value contains two comma-joined URLs', () => {
    expect(() =>
      collectUrls('http://localhost:3009/auth/callback, http://localhost:3011/auth/callback', []),
    ).toThrow(CliError);
  });

  it('accumulates repeated flag values', () => {
    const first = collectUrls('http://localhost:3009/auth/callback', []);
    const second = collectUrls('http://localhost:3011/auth/callback', first);
    expect(second).toEqual([
      'http://localhost:3009/auth/callback',
      'http://localhost:3011/auth/callback',
    ]);
  });
});

describe('parseAppId', () => {
  it('returns a numeric string unchanged', () => {
    expect(parseAppId('42')).toBe('42');
  });

  it('returns a UUID string unchanged', () => {
    expect(parseAppId('550e8400-e29b-41d4-a716-446655440000')).toBe(
      '550e8400-e29b-41d4-a716-446655440000',
    );
  });

  it('trims surrounding whitespace', () => {
    expect(parseAppId('  abc-123  ')).toBe('abc-123');
  });

  it('throws CliError on empty string', () => {
    expect(() => parseAppId('')).toThrow(CliError);
  });

  it('throws CliError on whitespace-only string', () => {
    expect(() => parseAppId('   ')).toThrow(CliError);
  });
});
