import { messages } from '../../lang/en';
// Cross-root import on purpose: the assertion is that the smoke suite's
// patterns and this repo's copy agree, so the test has to see both.
import { UI_CREATE_EXPECT } from '../../../scripts/smoke/ui-app';

describe('messages (lang/en)', () => {
  it('should export all required static messages', () => {
    expect(messages.AUTH_WELCOME).toBeDefined();
    expect(messages.AUTH_PROMPT_API_KEY).toBeDefined();
    expect(messages.AUTH_INVALID_KEY).toBeDefined();
    expect(messages.AUTH_LOGGED_OUT).toBeDefined();
    expect(messages.AUTH_NOT_LOGGED_IN).toBeDefined();
    expect(messages.APP_LIST_EMPTY).toBeDefined();
    expect(messages.APP_CREATE_SUCCESS).toBeDefined();
    expect(messages.APP_DELETE_CANCELLED).toBeDefined();
    expect(messages.ERR_NETWORK).toBeDefined();
    expect(messages.ABORTED).toBe('Aborted.');
  });

  it('should have working dynamic message functions', () => {
    expect(messages.AUTH_SUCCESS('user@test.com')).toContain('user@test.com');
    expect(messages.APP_DELETE_CONFIRM('MyApp', '42')).toContain('MyApp');
    expect(messages.APP_DELETE_CONFIRM('MyApp', '42')).toContain('42');
    expect(messages.APP_DELETE_SUCCESS('1')).toContain('1');
    expect(messages.APP_SCAFFOLD_SUCCESS(5, 5)).toContain('5');
    expect(messages.ERR_RATE_LIMITED(5)).toContain('5');
    expect(messages.INIT_APPS_EXIST(3)).toContain('3');
    expect(messages.INIT_APPS_EXIST(1)).not.toContain('apps');
  });

  // A merge keeps existing files and writes only the missing ones, so "wrote 0" and
  // "the project has 5" are both true. Reporting only the first printed
  // "created (0 files)" directly above a five-file tree, which read as a failure.
  it('reports written and total separately when a merge kept existing files', () => {
    expect(messages.APP_CREATE_BASE_SUCCESS(5, 5)).toBe('Project structure created (5 files)');
    expect(messages.APP_CREATE_BASE_SUCCESS(0, 5)).toBe(
      'Project structure already in place (5 files, nothing rewritten)',
    );
    expect(messages.APP_CREATE_BASE_SUCCESS(2, 5)).toBe(
      'Project structure created (2 of 5 files written)',
    );
    expect(messages.APP_SCAFFOLD_SUCCESS(3, 3)).toBe('Feature scaffolded (3 files)');
    expect(messages.APP_SCAFFOLD_SUCCESS(0, 3)).toContain('already in place');
  });

  // `init` closes by naming the obvious next command, and a UI app has no OAuth flow
  // to start — the OAuth line pointed at a command that would fail.
  it('does not send a UI app to the OAuth test server', () => {
    expect(messages.INIT_DONE).toContain('app start oauth');
    expect(messages.INIT_DONE_UI_APP).not.toContain('oauth');
    expect(messages.INIT_DONE_UI_APP).toContain('--help');
  });

  it('should have working app start messages', () => {
    expect(messages.APP_START_FEATURE_NOT_FOUND('src/test/server.js')).toContain(
      'src/test/server.js',
    );
    expect(messages.APP_START_MISSING_FEATURE('  oauth')).toContain('oauth');
    expect(messages.APP_START_UNKNOWN_FEATURE('bad', 'oauth')).toContain('bad');
    expect(messages.APP_START_EXITED('oauth', 1)).toContain('oauth');
    expect(messages.APP_START_FAILED('oauth', 'ENOENT')).toContain('ENOENT');
  });

  it('should have working logout messages', () => {
    expect(messages.AUTH_LOGGED_OUT_WITH_APPS(2)).toContain('2');
    expect(messages.AUTH_LOGGED_OUT_WITH_APPS(1)).not.toContain('apps');
    expect(messages.AUTH_LOGOUT_APP_WARNING).toContain('--reveal-secret');
  });

  it('should have working scaffold next-steps messages without a cd hint', () => {
    const lines = messages.APP_SCAFFOLD_NEXT_STEPS_LINES();
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('yarn --cwd');
    expect(lines[1]).toContain('npm --prefix');
    expect(lines[2]).toContain('oauth');
  });

  it('should lead with a cd step when a cd hint is given', () => {
    const lines = messages.APP_SCAFFOLD_NEXT_STEPS_LINES('my-app');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe('1. cd my-app');
    expect(lines[1]).toContain('yarn --cwd');
    expect(lines[2]).toContain('npm --prefix');
    expect(lines[3]).toContain('oauth');
  });

  it('should have working scaffold directory-notice messages', () => {
    expect(messages.APP_SCAFFOLD_TARGET_IS_CWD).toContain('current directory');
    expect(messages.APP_SCAFFOLD_CREATING_DIR('./my-app')).toContain('./my-app');
  });

  it('should have a scaffold scopes tip that points at editing app-config.json + upload', () => {
    const tip = messages.APP_SCAFFOLD_SCOPES_TIP;
    expect(tip).toContain('brevo app available-scopes');
    expect(tip).toContain('brevo app upload');
    expect(tip).toContain('app-config.json');
  });

  it('should have working app upload messages', () => {
    expect(messages.APP_UPLOAD_INVALID_REDIRECT_URL('ftp://bad')).toContain('ftp://bad');
    expect(messages.APP_UPLOAD_INVALID_REDIRECT_PROTOCOL('ftp://bad')).toContain('ftp://bad');
  });

  // The prompt used to carry the example URL too, which pushed it past 80 columns —
  // where inquirer wraps it and leaves `skip):` alone and flush-left. The format is
  // advertised by the validation error instead, which is when a user needs it.
  it('should advertise https for the logo URL, in the error rather than the prompt', () => {
    expect(messages.APP_CREATE_LOGO_INVALID).toContain('https://');
    expect(messages.APP_CREATE_LOGO_INVALID).toContain('example.com/logo.png');
  });

  // Every interactive prompt has to fit an 80-column terminal once inquirer's own `? `
  // prefix is counted, because inquirer wraps a prompt without indenting the
  // continuation — the tail lands flush-left and reads as a separate line.
  //
  // The three UI-app field prompts (label/more_info/redirect_link) were missing from
  // this list until a copy pass noticed `APP_CREATE_UI_REDIRECT_LINK_PROMPT` had drifted
  // to ~100 chars with nothing catching it — the whole point of this test, silently
  // not applying to the prompts most likely to grow a clause too many. Added so the
  // same drift can't happen again unnoticed.
  it('keeps interactive prompts inside 80 columns including inquirer’s prefix', () => {
    const PREFIX = 2; // '? '
    const prompts: Array<[string, string]> = [
      ['APP_CREATE_NAME_PROMPT', messages.APP_CREATE_NAME_PROMPT],
      ['APP_CREATE_LOGO_PROMPT', messages.APP_CREATE_LOGO_PROMPT],
      ['APP_CREATE_TYPE_PROMPT', messages.APP_CREATE_TYPE_PROMPT],
      ['APP_CREATE_APP_TYPE_PROMPT', messages.APP_CREATE_APP_TYPE_PROMPT],
      ['APP_CREATE_REDIRECT_PROMPT', messages.APP_CREATE_REDIRECT_PROMPT],
      ['APP_SCAFFOLD_FEATURE_EXISTS', messages.APP_SCAFFOLD_FEATURE_EXISTS],
      ['APP_CREATE_UI_LABEL_PROMPT', messages.APP_CREATE_UI_LABEL_PROMPT],
      ['APP_CREATE_UI_MORE_INFO_PROMPT', messages.APP_CREATE_UI_MORE_INFO_PROMPT],
      ['APP_CREATE_UI_REDIRECT_LINK_PROMPT', messages.APP_CREATE_UI_REDIRECT_LINK_PROMPT],
    ];
    for (const [name, text] of prompts) {
      expect([...text].length + PREFIX).toBeLessThanOrEqual(80);
      expect(name).toBeTruthy();
      expect(text).toBeTruthy();
    }
  });

  it('should have proper WHOAMI messages', () => {
    expect(messages.WHOAMI_AUTHENTICATED('a@b.com', 'Corp')).toContain('a@b.com');
    expect(messages.WHOAMI_AUTHENTICATED('a@b.com', 'Corp')).toContain('Corp');
    expect(messages.WHOAMI_NOT_AUTHENTICATED).toContain('brevo login');
  });

  describe('scope-related messages', () => {
    it('exports the create-time box strings (title, scopes label, upload hint)', () => {
      expect(messages.APP_CREATE_BOX_TITLE).toMatch(/created/i);
      expect(messages.APP_CREATE_BOX_SCOPES_LABEL).toMatch(/scope/i);
      expect(messages.APP_CREATE_BOX_SCOPE_HINT).toContain('brevo app upload');
    });

    it('exports the app scopes empty-result message', () => {
      expect(messages.APP_SCOPES_EMPTY).toBeDefined();
      expect(messages.APP_SCOPES_EMPTY).toMatch(/scope/i);
    });

    it('exports the app scopes usage hint pointing to app-config.json + brevo app upload', () => {
      expect(messages.APP_SCOPES_USAGE_HINT).toContain('brevo app upload');
      expect(messages.APP_SCOPES_USAGE_HINT).toContain('app-config.json');
    });

    it('exports IdP scopes error messages', () => {
      expect(messages.OAUTH_METADATA_MISSING_SCOPES).toMatch(/scopes/i);
      expect(messages.OAUTH_METADATA_FETCH_FAILED('https://x/y', 500)).toContain('https://x/y');
      expect(messages.OAUTH_METADATA_FETCH_FAILED('https://x/y', 500)).toContain('500');
    });

    it("exports the legacy 'all' scope deprecation strings", () => {
      expect(messages.LEGACY_ALL_SCOPE_DEPRECATED_BLOCK).toContain("'all'");
      expect(messages.LEGACY_ALL_SCOPE_DEPRECATED_BLOCK).toContain('app-config.json');
      expect(messages.LEGACY_ALL_SCOPE_DEPRECATED_BLOCK).toContain('brevo app available-scopes');
      expect(messages.LEGACY_ALL_SCOPE_DEPRECATED_BLOCK).toContain('brevo app upload');
      expect(messages.LEGACY_ALL_SCOPE_START_BLOCK).toContain("'all'");
      expect(messages.LEGACY_ALL_SCOPE_START_BLOCK).toContain('brevo app upload');
      expect(messages.LEGACY_ALL_SCOPE_START_BLOCK).toContain('brevo app start oauth');
      expect(messages.LEGACY_ALL_SCOPE_LIST_TAG).toMatch(/legacy/i);
      expect(messages.LEGACY_ALL_SCOPE_LIST_TAG).toMatch(/deprecated/i);
      expect(messages.LEGACY_ALL_SCOPE_UPDATE_MIGRATING).toMatch(/legacy 'all'/i);
      expect(messages.LEGACY_ALL_SCOPE_SCAFFOLD_SUBSTITUTED('contacts:read')).toContain(
        'contacts:read',
      );
      expect(messages.LEGACY_ALL_SCOPE_SCAFFOLD_SUBSTITUTED('contacts:read')).toMatch(/legacy/i);
    });

    it('exports the app scopes web-view strings', () => {
      expect(messages.APP_SCOPES_WEB_LISTENING('http://127.0.0.1:1234/')).toContain(
        'http://127.0.0.1:1234/',
      );
      expect(messages.APP_SCOPES_WEB_TITLE).toBeDefined();
      expect(messages.APP_SCOPES_WEB_INTRO(3, 'https://x/y')).toContain('3 scopes');
      expect(messages.APP_SCOPES_WEB_INTRO(1, 'https://x/y')).toContain('1 scope');
      expect(messages.APP_SCOPES_WEB_INTRO(1, 'https://x/y')).not.toContain('1 scopes');
      expect(messages.APP_SCOPES_WEB_INTRO(3, 'https://x/y')).toContain('https://x/y');
      expect(messages.APP_SCOPES_WEB_SEARCH_PLACEHOLDER).toBeDefined();
      expect(messages.APP_SCOPES_WEB_EMPTY).toMatch(/empty/i);
      expect(messages.APP_SCOPES_WEB_FOOTER).toMatch(/Ctrl/i);
      expect(messages.APP_SCOPES_WEB_REFRESH).toBeDefined();
      expect(messages.APP_SCOPES_WEB_REFRESHING).toBeDefined();
      expect(messages.APP_SCOPES_WEB_REFRESH_FAILED).toMatch(/fail/i);
      expect(messages.APP_SCOPES_WEB_ENDPOINTS_LABEL).toMatch(/endpoint/i);
      expect(messages.APP_SCOPES_WEB_NO_ENDPOINTS).toMatch(/endpoint/i);
      expect(messages.APP_SCOPES_WEB_COPY).toBeDefined();
      expect(messages.APP_SCOPES_WEB_COPIED).toMatch(/copied/i);
      expect(messages.APP_SCOPES_WEB_COPY_CATEGORY_ARIA).toContain('{category}');
      expect(messages.APP_SCOPES_WEB_SELECT_SCOPE_ARIA).toContain('{scope}');
      expect(messages.APP_SCOPES_WEB_COPY_SELECTED).toMatch(/copy/i);
      expect(messages.APP_SCOPES_WEB_SELECTED_PLACEHOLDER).toContain('auth.scopes');
      expect(messages.APP_SCOPES_WEB_LEGACY_BADGE).toMatch(/deprecated/i);
      expect(messages.APP_SCOPES_WEB_LEGACY_TITLE).toMatch(/legacy 'all'/i);
      expect(messages.APP_SCOPES_WEB_DOCS_LINK).toMatch(/cli reference/i);
    });
  });
});

// ── Smoke-suite prompt patterns ────────────────────────────────────────────
//
// `scripts/smoke/ui-app.ts` drives `brevo app create` through a pty and waits
// for each prompt by regex. Those regexes duplicate the copy in this file by
// necessity — the smoke exercises the REAL binary, and under
// `--against=published` its strings may legitimately lag this repo — so nothing
// in the smoke itself can catch a reword. This does.
//
// It exists because PR #73 (`890b19e`) reworded three UI-app prompts without
// touching the suite. Nothing failed at PR time; it surfaced as a 122s pty
// timeout on `main`, six steps deep, reported as "pty run timed out waiting for
// prompt 6/9" — which reads like a broken terminal, not a stale string.
describe('smoke-suite prompt patterns', () => {
  it('every UI-app create pattern still matches the copy it waits for', () => {
    const pairs: ReadonlyArray<[keyof typeof UI_CREATE_EXPECT, string]> = [
      ['logo', messages.APP_CREATE_LOGO_PROMPT],
      ['appTypeOAuth', messages.APP_CREATE_APP_TYPE_OAUTH],
      ['appTypeUi', messages.APP_CREATE_APP_TYPE_UI],
      ['integration', messages.APP_CREATE_UI_INTEGRATION_PROMPT],
      ['page', messages.APP_CREATE_UI_SURFACE_PROMPT],
      // Any non-empty page name works; 'contact' is representative.
      ['placement', messages.APP_CREATE_UI_PLACEMENT_PAGE_PROMPT('contact')],
      ['label', messages.APP_CREATE_UI_LABEL_PROMPT],
      ['moreInfo', messages.APP_CREATE_UI_MORE_INFO_PROMPT],
      ['redirect', messages.APP_CREATE_UI_REDIRECT_LINK_PROMPT],
      ['outputDir', messages.APP_SCAFFOLD_DIR_PROMPT],
    ];
    for (const [key, copy] of pairs) {
      expect({ key, matches: UI_CREATE_EXPECT[key].test(copy) }).toEqual({ key, matches: true });
    }
  });

  // The traps #73 walked into. A pattern spanning a curly apostrophe or an em
  // dash is brittle against a reword, and a long one can wrap in the pty
  // transcript — so they are kept short and punctuation-free on purpose.
  it('keeps the patterns free of typographic punctuation', () => {
    for (const [key, re] of Object.entries(UI_CREATE_EXPECT)) {
      expect({ key, clean: !/[’‘“”—–]/.test(re.source) }).toEqual({ key, clean: true });
    }
  });
});
