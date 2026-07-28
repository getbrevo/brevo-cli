import {
  validateUrl,
  collectUrls,
  parseAppId,
  splitScopes,
  validateScopes,
  collectScopes,
  containsLegacyAllScope,
  parseAccountId,
  validateUiApp,
  validateUiAppHeading,
  validateUiAppUrl,
  validateExtensionPointName,
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

describe('containsLegacyAllScope', () => {
  it.each<[string, string[] | undefined, boolean]>([
    ["['all'] alone", ['all'], true],
    ["'all' mixed with granular scopes", ['contacts:read', 'all'], true],
    ['granular scopes only', ['contacts:read', 'crm:write'], false],
    ['empty array', [], false],
    ['undefined', undefined, false],
    ["near-misses ('ALL', 'all:read') do not match", ['ALL', 'all:read', 'contacts:all'], false],
  ])('returns %s → %s', (_label, scopes, expected) => {
    expect(containsLegacyAllScope(scopes)).toBe(expected);
  });
});

// ──────────────── UI apps (BEX-290) ────────────────

describe('validateUiAppUrl', () => {
  it.each([
    ['https URL', 'https://example.com/brevo'],
    ['https with path and query', 'https://example.com/a?b=c'],
    // Loopback http is allowed so a partner can point at a local dev server.
    ['http on localhost', 'http://localhost:3000/card'],
    ['http on 127.0.0.1', 'http://127.0.0.1:3000/card'],
  ])('accepts a %s', (_label, url) => {
    expect(validateUiAppUrl(url)).toBe(true);
  });

  it.each([
    ['plain http on a public host', 'http://example.com/brevo'],
    ['a non-HTTP scheme', 'ftp://example.com'],
    ['javascript:', 'javascript:alert(1)'],
    ['a non-URL', 'not a url'],
    ['an empty value', ''],
  ])('rejects %s', (_label, url) => {
    expect(validateUiAppUrl(url)).not.toBe(true);
  });
});

describe('validateUiAppHeading', () => {
  it('accepts a non-empty heading and rejects whitespace-only', () => {
    expect(validateUiAppHeading('Invoice Manager')).toBe(true);
    expect(validateUiAppHeading('  ')).not.toBe(true);
  });
});

// Slot names are matched by exact string equality by the UI kit, and an authored
// name with no registry row is silently dropped by the backend — so this is the
// only place a typo ever surfaces.
describe('validateExtensionPointName', () => {
  it.each([
    ['contactDetails.headerMenu.action'],
    ['dealDetails.headerMenu.action'],
    ['companyDetails.headerMenu.action'],
    ['contactDetails.overviewMain.widget'],
    ['dealDetails.overviewAttributes.widget'],
    ['companyDetails.overviewSidebar.widget'],
  ])('accepts the registered point %s', (name) => {
    expect(validateExtensionPointName(name)).toBe(true);
  });

  it.each([
    ['the pre-BEX-350 region grammar', 'contact.center.region'],
    ['the pre-BEX-350 action grammar', 'contact.header.action'],
    ['a bare record type instead of the page', 'contact.headerMenu.action'],
    ['a wrong kind for the place', 'contactDetails.headerMenu.widget'],
    ['a location not in the registry', 'quoteDetails.headerMenu.action'],
    ['wrong casing', 'contactdetails.headerMenu.action'],
    ['an empty value', ''],
  ])('rejects %s', (_label, name) => {
    expect(validateExtensionPointName(name)).not.toBe(true);
  });
});

describe('parseAccountId', () => {
  it('accepts and trims a numeric account ID', () => {
    expect(parseAccountId(' 99999 ')).toBe('99999');
  });

  it.each([
    ['empty', ''],
    ['non-numeric', 'abc'],
    ['mixed', '99a'],
    ['negative', '-1'],
  ])('rejects a %s account ID', (_label, value) => {
    expect(() => parseAccountId(value)).toThrow(CliError);
  });
});

describe('validateUiApp', () => {
  const VALID = {
    extensionType: 'action_link',
    surfacePointList: ['contactDetails.headerMenu.action'],
    heading: 'Invoice Manager',
    subheading: 'Review invoice history for this contact',
    redirectLink: 'https://example.com/brevo',
    linkTarget: '_blank',
  };

  it('accepts a well-formed action link', () => {
    expect(() => validateUiApp(VALID)).not.toThrow();
  });

  it('accepts one without a subheading or linkTarget', () => {
    const { subheading: _s, linkTarget: _l, ...rest } = VALID;
    expect(() => validateUiApp(rest)).not.toThrow();
  });

  it('accepts several action slots', () => {
    expect(() =>
      validateUiApp({
        ...VALID,
        surfacePointList: ['contactDetails.headerMenu.action', 'dealDetails.headerMenu.action'],
      }),
    ).not.toThrow();
  });

  it.each([
    ['not an object', 'nope'],
    ['null', null],
    ['a missing extensionType', { ...VALID, extensionType: undefined }],
    ['an empty surfacePointList', { ...VALID, surfacePointList: [] }],
    ['a missing surfacePointList', { ...VALID, surfacePointList: undefined }],
    ['an unregistered point', { ...VALID, surfacePointList: ['contact.header.action'] }],
    [
      'a widget slot for an action link',
      { ...VALID, surfacePointList: ['contactDetails.overviewMain.widget'] },
    ],
    [
      'duplicate points',
      {
        ...VALID,
        surfacePointList: ['contactDetails.headerMenu.action', 'contactDetails.headerMenu.action'],
      },
    ],
    ['an empty heading', { ...VALID, heading: '  ' }],
    ['a missing redirectLink', { ...VALID, redirectLink: undefined }],
    ['an insecure redirectLink', { ...VALID, redirectLink: 'http://example.com' }],
    ['an unknown linkTarget', { ...VALID, linkTarget: '_top' }],
  ])('rejects %s', (_label, block) => {
    expect(() => validateUiApp(block)).toThrow(CliError);
  });

  // Types beyond the action link exist on the platform but the CLI can't author
  // them yet — pushing one would produce a config nothing renders.
  it.each([['iframe_extension'], ['legacy_component']])('rejects the %s type', (extensionType) => {
    expect(() => validateUiApp({ ...VALID, extensionType })).toThrow(/Unsupported/i);
  });

  // The UI kit keeps modalIframeUrl only for iframe_extension, so one on an
  // action link is silently discarded.
  it('rejects modalIframeUrl on an action link', () => {
    expect(() => validateUiApp({ ...VALID, modalIframeUrl: 'https://example.com/modal' })).toThrow(
      /only used by/i,
    );
  });
});
