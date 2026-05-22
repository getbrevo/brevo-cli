import {
  validateUrl,
  collectUrls,
  parseAppId,
  splitScopes,
  validateScopes,
  collectScopes,
} from '../../lib/validators';
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

describe('splitScopes', () => {
  it('returns [] for null/undefined input', () => {
    expect(splitScopes(null)).toEqual([]);
    expect(splitScopes(undefined)).toEqual([]);
  });

  it('returns [] for empty string', () => {
    expect(splitScopes('')).toEqual([]);
  });

  it('splits a single comma-joined string into individual tokens', () => {
    expect(splitScopes('crm:read, campaigns:read')).toEqual(['crm:read', 'campaigns:read']);
  });

  it('splits on whitespace as well as commas', () => {
    expect(splitScopes('crm:read crm:write')).toEqual(['crm:read', 'crm:write']);
  });

  it('handles mixed delimiters and runs of whitespace', () => {
    expect(splitScopes('crm:read,  crm:write\tcampaigns:read')).toEqual([
      'crm:read',
      'crm:write',
      'campaigns:read',
    ]);
  });

  it('heals a malformed array entry containing an embedded comma', () => {
    // Simulates app-config.json with: "scopes": ["crm:read","crm:write, campaigns:read"]
    expect(splitScopes(['crm:read', 'crm:write, campaigns:read'])).toEqual([
      'crm:read',
      'crm:write',
      'campaigns:read',
    ]);
  });

  it('deduplicates while preserving first-seen order', () => {
    expect(splitScopes(['crm:read', 'crm:write', 'crm:read'])).toEqual(['crm:read', 'crm:write']);
  });

  it('drops empty tokens from leading/trailing/consecutive delimiters', () => {
    expect(splitScopes(',  ,crm:read,,')).toEqual(['crm:read']);
  });

  it('ignores non-string entries in an array', () => {
    expect(splitScopes(['crm:read', null as unknown as string, 'crm:write'])).toEqual([
      'crm:read',
      'crm:write',
    ]);
  });
});

describe('validateScopes', () => {
  it('accepts well-formed scope tokens', () => {
    expect(() =>
      validateScopes(['crm:read', 'contacts:write', 'campaigns:read', 'a.b-c_d', 'global']),
    ).not.toThrow();
  });

  it('accepts an empty array', () => {
    expect(() => validateScopes([])).not.toThrow();
  });

  it('rejects a scope containing a comma', () => {
    expect(() => validateScopes(['crm:write, campaigns:read'])).toThrow(CliError);
  });

  it('rejects a scope containing a space', () => {
    expect(() => validateScopes(['crm read'])).toThrow(CliError);
  });

  it('rejects a scope containing a semicolon', () => {
    expect(() => validateScopes(['crm;read'])).toThrow(CliError);
  });

  it('rejects an empty string', () => {
    expect(() => validateScopes([''])).toThrow(CliError);
  });

  it('rejects a scope starting with a non-alphanumeric character', () => {
    expect(() => validateScopes([':read'])).toThrow(CliError);
  });

  it('error message quotes the offending value', () => {
    expect(() => validateScopes(['bad;scope'])).toThrow(/"bad;scope"/);
  });
});

describe('collectScopes', () => {
  it('accumulates a single token per flag invocation', () => {
    const first = collectScopes('crm:read', []);
    const second = collectScopes('crm:write', first);
    expect(second).toEqual(['crm:read', 'crm:write']);
  });

  it('splits a comma-joined flag value into multiple tokens', () => {
    expect(collectScopes('crm:read, crm:write', [])).toEqual(['crm:read', 'crm:write']);
  });

  it('deduplicates against previous values', () => {
    expect(collectScopes('crm:read', ['crm:read', 'crm:write'])).toEqual(['crm:read', 'crm:write']);
  });

  it('throws when the value is empty after splitting', () => {
    expect(() => collectScopes('   ', [])).toThrow(CliError);
  });

  it('throws when a token contains an invalid character', () => {
    expect(() => collectScopes('crm;read', [])).toThrow(CliError);
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
