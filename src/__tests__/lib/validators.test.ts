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
  validateUiAppLabel,
  validateUiAppMoreInfo,
  validateUiAppUrl,
  validateSurfacePoint,
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

describe('validateUiAppLabel', () => {
  it('accepts a non-empty label and rejects whitespace-only', () => {
    expect(validateUiAppLabel('View in CRM')).toBe(true);
    expect(validateUiAppLabel('  ')).not.toBe(true);
  });

  // Enforced server-side too; without the local check the partner gets an opaque 400.
  it('rejects a label over 48 characters', () => {
    expect(validateUiAppLabel('x'.repeat(48))).toBe(true);
    expect(validateUiAppLabel('x'.repeat(49))).toMatch(/at most 48/);
  });
});

describe('validateUiAppMoreInfo', () => {
  // Optional field, so blank passes — only the ceiling is enforced.
  it('accepts blank and rejects over 255 characters', () => {
    expect(validateUiAppMoreInfo('')).toBe(true);
    expect(validateUiAppMoreInfo('x'.repeat(255))).toBe(true);
    expect(validateUiAppMoreInfo('x'.repeat(256))).toMatch(/at most 255/);
  });
});

// The check is shape-only. Whether a slot name is REGISTERED is the upload
// endpoint's answer (`checkExtensionPoints` reads `extension_points` and 400s naming
// the offenders) — the CLI deliberately holds no copy of that registry, because a
// copy could only lag it, rejecting slots the platform had added and passing ones it
// had removed.
describe('validateSurfacePoint', () => {
  it.each([
    ['contactDetails.headerMenu.action'],
    ['dealDetails.headerMenu.action'],
    ['companyDetails.headerMenu.action'],
    ['contactDetails.overviewMain.widget'],
    ['dealDetails.overviewAttributes.widget'],
    ['companyDetails.overviewSidebar.widget'],
  ])('accepts the registered point %s', (name) => {
    expect(validateSurfacePoint(name)).toBe(true);
  });

  // These are all wrong, and every one of them still renders nothing in production —
  // but they are wrong against the platform's registry, not against anything the CLI
  // knows, so the CLI now passes them through for the server to reject by name.
  it.each([
    ['the pre-BEX-350 region grammar', 'contact.center.region'],
    ['the pre-BEX-350 action grammar', 'contact.header.action'],
    ['a bare record type instead of the page', 'contact.headerMenu.action'],
    ['a wrong kind for the place', 'contactDetails.headerMenu.widget'],
    ['a location not in the registry', 'quoteDetails.headerMenu.action'],
    ['wrong casing', 'contactdetails.headerMenu.action'],
  ])('no longer rejects %s locally — the upload endpoint does', (_label, name) => {
    expect(validateSurfacePoint(name)).toBe(true);
  });

  it.each([
    ['an empty value', ''],
    ['whitespace only', '   '],
  ])('still rejects %s', (_label, name) => {
    expect(validateSurfacePoint(name)).not.toBe(true);
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

// The only context field names that exist in the platform's registry today:
// recordId, recordName, userId, locale, accountId. Fixtures use nothing else.
const VALID_POINT = 'contactDetails.headerMenu.action';

describe('validateUiApp', () => {
  // The BEX-290 block: `surface_point_list` is a list of objects, the two text fields are
  // `label`/`more_info`, and `link_target` is not authored (upload injects it).
  const VALID = {
    extension_type: 'actionLink',
    surface_point_list: [
      { surface_point: 'contactDetails.headerMenu.action', context: ['recordId'] },
    ],
    label: 'View in CRM',
    more_info: 'Open this contact in your connected CRM to see full activity history.',
    redirect_link: 'https://example.com/brevo',
  };

  it('accepts a well-formed action link', () => {
    expect(() => validateUiApp(VALID)).not.toThrow();
  });

  it('accepts one without more_info or a per-entry context', () => {
    const { more_info: _m, ...rest } = VALID;
    expect(() =>
      validateUiApp({
        ...rest,
        surface_point_list: [{ surface_point: 'contactDetails.headerMenu.action' }],
      }),
    ).not.toThrow();
  });

  // Tolerated rather than rejected: a leftover `_blank` in a hand-edited file is exactly
  // what upload injects anyway, so failing on it would be pedantry.
  it('accepts a leftover _blank link_target', () => {
    expect(() => validateUiApp({ ...VALID, link_target: '_blank' })).not.toThrow();
  });

  it('accepts several action slots', () => {
    expect(() =>
      validateUiApp({
        ...VALID,
        surface_point_list: [
          { surface_point: 'contactDetails.headerMenu.action', context: ['recordId'] },
          { surface_point: 'dealDetails.headerMenu.action', context: ['recordId', 'recordName'] },
        ],
      }),
    ).not.toThrow();
  });

  // The handover to the server, asserted so it cannot be undone by accident: an
  // unregistered slot name passes the local pre-flight and travels, and the upload
  // endpoint's `checkExtensionPoints` is what answers 400 naming it. Re-adding a local
  // allow-list would fail this test.
  it('passes an unregistered slot name through for the server to reject', () => {
    expect(() =>
      validateUiApp({
        ...VALID,
        surface_point_list: [{ surface_point: 'contact.header.action' }],
      }),
    ).not.toThrow();
  });

  it.each([
    ['not an object', 'nope'],
    ['null', null],
    ['a missing extension_type', { ...VALID, extension_type: undefined }],
    ['an empty surface_point_list', { ...VALID, surface_point_list: [] }],
    ['a missing surface_point_list', { ...VALID, surface_point_list: undefined }],
    ['a blank point', { ...VALID, surface_point_list: [{ surface_point: '   ' }] }],
    ['a missing point', { ...VALID, surface_point_list: [{ context: ['recordId'] }] }],
    [
      'duplicate points',
      {
        ...VALID,
        surface_point_list: [
          { surface_point: 'contactDetails.headerMenu.action' },
          { surface_point: 'contactDetails.headerMenu.action', context: ['recordId'] },
        ],
      },
    ],
    ['an empty label', { ...VALID, label: '  ' }],
    ['a missing label', { ...VALID, label: undefined }],
    ['an over-long label', { ...VALID, label: 'x'.repeat(49) }],
    ['an over-long more_info', { ...VALID, more_info: 'x'.repeat(256) }],
    ['a missing redirect_link', { ...VALID, redirect_link: undefined }],
    ['an insecure redirect_link', { ...VALID, redirect_link: 'http://example.com' }],
    ['an unknown link_target', { ...VALID, link_target: '_top' }],
    // _self is refused because the server refuses it. Accepting it locally would only
    // move the failure to upload time.
    [
      'the _self link_target while uploads are pinned to _blank',
      { ...VALID, link_target: '_self' },
    ],
    [
      'a non-array per-entry context',
      { ...VALID, surface_point_list: [{ surface_point: VALID_POINT, context: 'recordId' }] },
    ],
    [
      'an empty per-entry context field name',
      { ...VALID, surface_point_list: [{ surface_point: VALID_POINT, context: ['recordId', ''] }] },
    ],
    [
      'a duplicated per-entry context field name',
      {
        ...VALID,
        surface_point_list: [{ surface_point: VALID_POINT, context: ['recordId', 'recordId'] }],
      },
    ],
  ])('rejects %s', (_label, block) => {
    expect(() => validateUiApp(block)).toThrow(CliError);
  });

  // Widget slots are authorable: the UI kit renders both extension types on both kinds — a
  // widget slot gets a card, an action slot a menu entry — so there is no kind rule to
  // enforce here.
  it('accepts a widget slot', () => {
    expect(() =>
      validateUiApp({
        ...VALID,
        surface_point_list: [{ surface_point: 'contactDetails.overviewMain.widget' }],
      }),
    ).not.toThrow();
  });

  // ──────── The pre-BEX-290 shape fails with a migration hint, not a mystery ────────
  // These are a LOCAL diagnostic. The deployed upload endpoint 200s on a top-level
  // `context` and ignores it, and no longer reads heading/subheading at all — so without
  // these three, an old config uploads "successfully" and renders no text.

  it('rejects a bare-string surface_point_list, naming the new shape', () => {
    expect(() =>
      validateUiApp({ ...VALID, surface_point_list: ['contactDetails.headerMenu.action'] }),
    ).toThrow(/must be objects/i);
  });

  it('rejects the renamed heading field with a hint', () => {
    const { label: _l, ...rest } = VALID;
    expect(() => validateUiApp({ ...rest, heading: 'View in CRM' })).toThrow(
      /heading was renamed to ui_app\.label/i,
    );
  });

  it('rejects the renamed subheading field with a hint', () => {
    const { more_info: _m, ...rest } = VALID;
    expect(() => validateUiApp({ ...rest, subheading: 'Some detail' })).toThrow(
      /subheading was renamed to ui_app\.more_info/i,
    );
  });

  it('rejects a top-level context, pointing at the per-entry field', () => {
    expect(() => validateUiApp({ ...VALID, context: ['recordId'] })).toThrow(
      /no longer a top-level field/i,
    );
  });

  // legacyComponent is the pre-extensibility interpreter path, driven by the UI kit's own
  // config registry rather than by a snapshot — never partner-authored. The pre-BEX-350
  // snake_case spellings fail here too, by design: the CLI only writes canonical camelCase.
  it.each([['legacyComponent'], ['action_link'], ['iframe_extension']])(
    'rejects the %s type',
    (extension_type) => {
      expect(() => validateUiApp({ ...VALID, extension_type })).toThrow(/Unsupported/i);
    },
  );

  // The UI kit keeps modal_iframe_url only for iframeExtension, so one on an
  // action link is silently discarded.
  it('rejects modal_iframe_url on an action link', () => {
    expect(() =>
      validateUiApp({ ...VALID, modal_iframe_url: 'https://example.com/modal' }),
    ).toThrow(/only used by/i);
  });
});

// iframeExtension became authorable once the UI kit shipped modal rendering on both
// delivery paths (the modal card layout, and the header-menu action + its modal).
describe('validateUiApp — iframeExtension', () => {
  const VALID_IFRAME = {
    extension_type: 'iframeExtension',
    surface_point_list: [{ surface_point: VALID_POINT, context: ['recordId'] }],
    label: 'View in CRM',
    modal_iframe_url: 'https://example.com/embed',
  };

  it('accepts a valid iframe extension', () => {
    expect(() => validateUiApp(VALID_IFRAME)).not.toThrow();
  });

  it('accepts a widget slot', () => {
    expect(() =>
      validateUiApp({
        ...VALID_IFRAME,
        surface_point_list: [{ surface_point: 'contactDetails.overviewMain.widget' }],
      }),
    ).not.toThrow();
  });

  it.each([
    ['a missing modal_iframe_url', { ...VALID_IFRAME, modal_iframe_url: undefined }],
    ['an insecure modal_iframe_url', { ...VALID_IFRAME, modal_iframe_url: 'http://example.com' }],
    ['an empty label', { ...VALID_IFRAME, label: ' ' }],
  ])('rejects %s', (_label, block) => {
    expect(() => validateUiApp(block)).toThrow(CliError);
  });

  // The two delivery paths disagree about which URL wins when both are set: the card path
  // pairs strictly by extension_type and opens the modal, while the header-menu path routes
  // on redirect_link first and never opens it. Same app, different behaviour per slot.
  it('rejects redirect_link alongside modal_iframe_url', () => {
    expect(() =>
      validateUiApp({ ...VALID_IFRAME, redirect_link: 'https://example.com/go' }),
    ).toThrow(/cannot be combined/i);
  });

  // link_target governs where a redirect opens; a modal embeds its URL instead.
  it('rejects link_target', () => {
    expect(() => validateUiApp({ ...VALID_IFRAME, link_target: '_blank' })).toThrow(/no effect/i);
  });
});
