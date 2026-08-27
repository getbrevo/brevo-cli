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
    ['contact-details-header-menu'],
    ['deal-details-header-menu'],
    ['company-details-header-menu'],
    ['contact-details-overview-main'],
    ['deal-details-overview-attributes'],
    ['company-details-overview-sidebar'],
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
    ['a wrong kind for the place', 'contact-details-header-menu'],
    ['a location not in the registry', 'quote-details-header-menu'],
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
const VALID_POINT = 'contact-details-header-menu';

describe('validateUiApp', () => {
  // One well-formed entry: the CTA fields live per placement (BEX-426), so a complete
  // entry carries its own label, supporting text and destination beside its context.
  const ENTRY = {
    surface_point_name: 'contact-details-header-menu',
    context: ['recordId'],
    label: 'View in CRM',
    more_info: 'Open this contact in your connected CRM to see full activity history.',
    redirect_link: 'https://example.com/brevo',
  };

  // The BEX-426 block: `surface_point_list` is a list of objects each carrying its own
  // CTA fields; the root holds only `extension_type`. `link_target` is not authored at all
  // — upload injects it onto each entry — so no fixture carries one.
  const VALID = {
    extension_type: 'actionLink',
    surface_point_list: [ENTRY],
  };

  /** The valid block with its single entry's fields overridden (or removed via undefined). */
  const withEntry = (overrides: Record<string, unknown>) => ({
    ...VALID,
    surface_point_list: [{ ...ENTRY, ...overrides }],
  });

  it('accepts a well-formed action link', () => {
    expect(() => validateUiApp(VALID)).not.toThrow();
  });

  it('accepts one without more_info or a per-entry context', () => {
    expect(() =>
      validateUiApp(withEntry({ more_info: undefined, context: undefined })),
    ).not.toThrow();
  });

  // Tolerated rather than rejected: a leftover `_blank` on an entry in a hand-edited file
  // is exactly what upload injects there anyway, so failing on it would be pedantry.
  it('accepts a leftover _blank link_target on an entry', () => {
    expect(() => validateUiApp(withEntry({ link_target: '_blank' }))).not.toThrow();
  });

  // The root spelling is a different matter: it moved with the CTA fields (BEX-426) and the
  // server refuses it by name, so a leftover root value has to be named rather than ignored.
  // The hint says "remove it", not "move it" — the CLI never wants this field in the file.
  it('refuses a root link_target with a remove-it hint', () => {
    expect(() => validateUiApp({ ...VALID, link_target: '_blank' })).toThrow(
      /ui_app\.link_target moved onto each surface_point_list entry.*Remove it from the file/s,
    );
  });

  // Two slots, and each carries its OWN copy and destination — the whole point of the
  // per-entry move: a deal page can open a different deep link than a contact page.
  it('accepts several action slots with differing labels and links', () => {
    expect(() =>
      validateUiApp({
        ...VALID,
        surface_point_list: [
          ENTRY,
          {
            surface_point_name: 'deal-details-header-menu',
            context: ['recordId', 'recordName'],
            label: 'View deal in CRM',
            redirect_link: 'https://example.com/deals',
          },
        ],
      }),
    ).not.toThrow();
  });

  it('accepts an entry-level size beside context (BEX-416)', () => {
    expect(() =>
      validateUiApp({
        ...VALID,
        surface_point_list: [
          { ...ENTRY, size: { width: '280px', height: '160px' } },
          {
            surface_point_name: 'deal-details-header-menu',
            label: 'View in CRM',
            redirect_link: 'https://example.com/brevo',
          },
        ],
      }),
    ).not.toThrow();
  });

  // A single-axis size is valid — the omitted axis stays on the host slot's default — and
  // % sizes the axis relative to the host slot's box (1-100).
  it('accepts a single-axis percentage size (BEX-416)', () => {
    expect(() => validateUiApp(withEntry({ size: { height: '50%' } }))).not.toThrow();
  });

  // Both axes are optional, so an empty size object is valid too — it authors nothing and
  // the server stores it as no size at all, same as omitting the key.
  it('accepts an empty size object (BEX-416)', () => {
    expect(() => validateUiApp(withEntry({ size: {} }))).not.toThrow();
  });

  // The out-of-range message quotes the axis value back, which it can only do from the
  // regex match — quoting the raw `unknown` would render "[object Object]" for a
  // non-string. The table below asserts the throw; this pins the wording, entry name
  // included, so the value can never silently become a default stringification.
  it('names the entry and quotes the axis when a % size is over 100 (BEX-416)', () => {
    expect(() => validateUiApp(withEntry({ size: { height: '120%' } }))).toThrow(
      'ui_app.surface_point_list["contact-details-header-menu"].size: height "120%" is out of range — a % axis must be between 1% and 100%.',
    );
  });

  // The handover to the server, asserted so it cannot be undone by accident: an
  // unregistered slot name passes the local pre-flight and travels, and the upload
  // endpoint's `checkExtensionPoints` is what answers 400 naming it. Re-adding a local
  // allow-list would fail this test.
  it('passes an unregistered slot name through for the server to reject', () => {
    expect(() =>
      validateUiApp(withEntry({ surface_point_name: 'contact.header.action' })),
    ).not.toThrow();
  });

  it.each([
    ['not an object', 'nope'],
    ['null', null],
    ['a missing extension_type', { ...VALID, extension_type: undefined }],
    ['an empty surface_point_list', { ...VALID, surface_point_list: [] }],
    ['a missing surface_point_list', { ...VALID, surface_point_list: undefined }],
    ['a blank point', withEntry({ surface_point_name: '   ' })],
    ['a missing point', withEntry({ surface_point_name: undefined })],
    [
      'duplicate points',
      { ...VALID, surface_point_list: [ENTRY, { ...ENTRY, context: undefined }] },
    ],
    ['a size that is not an object', withEntry({ size: '280x160' })],
    ['a unitless size axis', withEntry({ size: { width: '280' } })],
    [
      'a numeric size axis (the pre-revision shape)',
      withEntry({ size: { width: 280, height: 160 } }),
    ],
    ['a zero size axis', withEntry({ size: { height: '0px' } })],
    ['a percentage axis over 100', withEntry({ size: { height: '120%' } })],
    ['an entry with an empty label', withEntry({ label: '  ' })],
    ['an entry with a missing label', withEntry({ label: undefined })],
    ['an entry with an over-long label', withEntry({ label: 'x'.repeat(49) })],
    ['an entry with an over-long more_info', withEntry({ more_info: 'x'.repeat(256) })],
    ['an entry with a missing redirect_link', withEntry({ redirect_link: undefined })],
    ['an entry with an insecure redirect_link', withEntry({ redirect_link: 'http://example.com' })],
    ['an entry with an unknown link_target', withEntry({ link_target: '_top' })],
    // _self is refused because the server refuses it. Accepting it locally would only
    // move the failure to upload time.
    [
      "an entry's _self link_target while uploads are pinned to _blank",
      withEntry({ link_target: '_self' }),
    ],
    ['a non-array per-entry context', withEntry({ context: 'recordId' })],
    ['an empty per-entry context field name', withEntry({ context: ['recordId', ''] })],
    ['a duplicated per-entry context field name', withEntry({ context: ['recordId', 'recordId'] })],
  ])('rejects %s', (_label, block) => {
    expect(() => validateUiApp(block)).toThrow(CliError);
  });

  // A violation must name its entry: "ui_app.redirect_link is required" is useless once
  // three entries each carry one (the acceptance criterion of BEX-426).
  it('names the offending entry in per-entry violations', () => {
    expect(() =>
      validateUiApp({
        ...VALID,
        surface_point_list: [
          ENTRY,
          {
            surface_point_name: 'deal-details-header-menu',
            label: 'View deal',
            redirect_link: 'http://example.com',
          },
        ],
      }),
    ).toThrow(/surface_point_list\["deal-details-header-menu"\]\.redirect_link/);
    expect(() => validateUiApp(withEntry({ label: ' ' }))).toThrow(
      /surface_point_list\["contact-details-header-menu"\]\.label/,
    );
  });

  // Widget slots are authorable: the UI kit renders both extension types on both kinds — a
  // widget slot gets a card, an action slot a menu entry — so there is no kind rule to
  // enforce here.
  it('accepts a widget slot', () => {
    expect(() =>
      validateUiApp(withEntry({ surface_point_name: 'contact-details-overview-main' })),
    ).not.toThrow();
  });

  // ──────── The pre-BEX-290 shape fails with a migration hint, not a mystery ────────
  // These are a LOCAL diagnostic. The deployed upload endpoint 200s on a top-level
  // `context` and ignores it, and no longer reads heading/subheading at all — so without
  // these three, an old config uploads "successfully" and renders no text.

  it('rejects a bare-string surface_point_list, naming the new shape', () => {
    expect(() =>
      validateUiApp({ ...VALID, surface_point_list: ['contact-details-header-menu'] }),
    ).toThrow(/must be objects/i);
  });

  // A missing key is reported as a missing key — not as a blank slot name, which points
  // at the wrong thing when the name IS there under the wrong spelling.
  it('rejects an entry with no surface_point_name key, naming the key', () => {
    expect(() => validateUiApp(withEntry({ surface_point_name: undefined }))).toThrow(
      /entries must carry "surface_point_name"/,
    );
  });

  it('rejects the pre-rename surface_point spelling with a rename hint', () => {
    const { surface_point_name: _dropped, ...rest } = ENTRY;
    expect(() =>
      validateUiApp({
        ...VALID,
        surface_point_list: [{ ...rest, surface_point: 'contact-details-header-menu' }],
      }),
    ).toThrow(/"surface_point" is not a field — rename it to "surface_point_name"/);
  });

  it('rejects the renamed heading field with a hint', () => {
    expect(() => validateUiApp({ ...VALID, heading: 'View in CRM' })).toThrow(
      /heading was renamed to ui_app\.label/i,
    );
  });

  it('rejects the renamed subheading field with a hint', () => {
    expect(() => validateUiApp({ ...VALID, subheading: 'Some detail' })).toThrow(
      /subheading was renamed to ui_app\.more_info/i,
    );
  });

  it('rejects a top-level context, pointing at the per-entry field', () => {
    expect(() => validateUiApp({ ...VALID, context: ['recordId'] })).toThrow(
      /no longer a top-level field/i,
    );
  });

  // ──────── The pre-BEX-426 root CTA fields fail with a migration hint too ────────
  // Hard move, refused by name: a root value silently mirrored onto every entry would be
  // a second placement for the same fact, and the server refuses these spellings as well.
  it.each([
    ['label', 'View in CRM'],
    ['more_info', 'Some detail'],
    ['redirect_link', 'https://example.com/brevo'],
    ['modal_iframe_url', 'https://example.com/embed'],
  ])('rejects a root-level %s, pointing at the per-entry field', (key, value) => {
    expect(() => validateUiApp({ ...VALID, [key]: value })).toThrow(
      new RegExp(`ui_app\\.${key} moved into each surface_point_list entry`),
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
  // action link entry is silently discarded.
  it('rejects modal_iframe_url on an action link entry', () => {
    expect(() =>
      validateUiApp(withEntry({ modal_iframe_url: 'https://example.com/modal' })),
    ).toThrow(/only used by/i);
  });
});

// iframeExtension became authorable once the UI kit shipped modal rendering on both
// delivery paths (the modal card layout, and the header-menu action + its modal).
describe('validateUiApp — iframeExtension', () => {
  const IFRAME_ENTRY = {
    surface_point_name: VALID_POINT,
    context: ['recordId'],
    label: 'View in CRM',
    modal_iframe_url: 'https://example.com/embed',
  };
  const VALID_IFRAME = {
    extension_type: 'iframeExtension',
    surface_point_list: [IFRAME_ENTRY],
  };

  const withIframeEntry = (overrides: Record<string, unknown>) => ({
    ...VALID_IFRAME,
    surface_point_list: [{ ...IFRAME_ENTRY, ...overrides }],
  });

  it('accepts a valid iframe extension', () => {
    expect(() => validateUiApp(VALID_IFRAME)).not.toThrow();
  });

  it('accepts a widget slot', () => {
    expect(() =>
      validateUiApp(withIframeEntry({ surface_point_name: 'contact-details-overview-main' })),
    ).not.toThrow();
  });

  it.each([
    ['a missing modal_iframe_url', withIframeEntry({ modal_iframe_url: undefined })],
    ['an insecure modal_iframe_url', withIframeEntry({ modal_iframe_url: 'http://example.com' })],
    ['an empty label', withIframeEntry({ label: ' ' })],
  ])('rejects an entry with %s', (_label, block) => {
    expect(() => validateUiApp(block)).toThrow(CliError);
  });

  // The two delivery paths disagree about which URL wins when both are set: the card path
  // pairs strictly by extension_type and opens the modal, while the header-menu path routes
  // on redirect_link first and never opens it. Same entry, different behaviour per slot kind.
  it('rejects redirect_link alongside modal_iframe_url on an entry', () => {
    expect(() =>
      validateUiApp(withIframeEntry({ redirect_link: 'https://example.com/go' })),
    ).toThrow(/cannot be combined/i);
  });

  // link_target governs where a redirect opens; a modal embeds its URL instead. Refused per
  // entry since BEX-426, which is where the field now lives — and named per entry, so an app
  // on three slots says which one is wrong.
  it('rejects a per-entry link_target', () => {
    expect(() => validateUiApp(withIframeEntry({ link_target: '_blank' }))).toThrow(/no effect/i);
  });

  it('names the entry carrying it', () => {
    expect(() => validateUiApp(withIframeEntry({ link_target: '_blank' }))).toThrow(
      new RegExp(`surface_point_list\\["${VALID_POINT}"\\]\\.link_target`),
    );
  });
});
