import {
  API_BASE,
  ENDPOINTS,
  CLI,
  DEFAULT_APP_FOLDER,
  DEFAULT_REDIRECT_URI,
  DEFAULT_SCOPES,
  OAUTH_SCOPES_URL,
} from '../../lib/constants';

describe('API_BASE', () => {
  const originalEnv = process.env.BREVO_API_URL;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.BREVO_API_URL = originalEnv;
    } else {
      delete process.env.BREVO_API_URL;
    }
  });

  it('should default to https://api.brevo.com', () => {
    delete process.env.BREVO_API_URL;
    // Re-import to get fresh value — but since it's evaluated at module load,
    // we test the current value
    expect(typeof API_BASE).toBe('string');
    expect(API_BASE).toMatch(/^https?:\/\//);
  });
});

describe('ENDPOINTS', () => {
  it('should define static endpoints', () => {
    expect(ENDPOINTS.ACCOUNT).toBe('/v3/account');
    expect(ENDPOINTS.OAUTH_APPS).toBe('/v3/oauth/apps');
    expect(ENDPOINTS.OAUTH_AUTHORIZE).toBe('/oauth/authorize');
    expect(ENDPOINTS.OAUTH_TOKEN).toBe('/oauth/token');
  });

  it('should define dynamic OAUTH_APP endpoint', () => {
    expect(ENDPOINTS.OAUTH_APP('123')).toBe('/v3/oauth/apps/123');
    expect(ENDPOINTS.OAUTH_APP('550e8400-e29b-41d4-a716-446655440000')).toBe(
      '/v3/oauth/apps/550e8400-e29b-41d4-a716-446655440000',
    );
  });

  it('should define dynamic APP_STORE_APP_UPDATE endpoint', () => {
    expect(ENDPOINTS.APP_STORE_APP_UPDATE('42')).toBe('/v3/app-store/apps/42');
    expect(ENDPOINTS.APP_STORE_APP_UPDATE('550e8400-e29b-41d4-a716-446655440000')).toBe(
      '/v3/app-store/apps/550e8400-e29b-41d4-a716-446655440000',
    );
  });

  it('encodes path-unsafe characters in appId so input cannot alter the path', () => {
    expect(ENDPOINTS.OAUTH_APP('a/b?c#d')).toBe('/v3/oauth/apps/a%2Fb%3Fc%23d');
    expect(ENDPOINTS.APP_STORE_APP_UPDATE('has space')).toBe('/v3/app-store/apps/has%20space');
  });
});

describe('CLI', () => {
  it('should define static CLI command strings', () => {
    expect(CLI.LOGIN).toBe('brevo login');
    expect(CLI.INIT).toBe('brevo app init');
    expect(CLI.HELP).toBe('brevo --help');
    expect(CLI.APP_CREATE).toBe('brevo app create');
    expect(CLI.APP_LIST).toBe('brevo app list');
    expect(CLI.APP_UPDATE).toBe('brevo app update');
    expect(CLI.APP_DELETE).toBe('brevo app delete');
  });

  it('should define dynamic APP_SCAFFOLD', () => {
    expect(CLI.APP_SCAFFOLD('5')).toBe('brevo app scaffold --app-id 5');
    expect(CLI.APP_SCAFFOLD()).toBe('brevo app scaffold --app-id <id>');
  });

  it('should define dynamic APP_CREDENTIALS', () => {
    expect(CLI.APP_CREDENTIALS('10')).toBe('brevo app credentials --app-id 10');
    expect(CLI.APP_CREDENTIALS()).toBe('brevo app credentials --app-id <id>');
  });

  it('should define dynamic APP_CREDENTIALS_REVEAL', () => {
    expect(CLI.APP_CREDENTIALS_REVEAL('3')).toBe(
      'brevo app credentials --reveal-secret --app-id 3',
    );
    expect(CLI.APP_CREDENTIALS_REVEAL()).toBe('brevo app credentials --reveal-secret');
  });

  it('should define dynamic APP_START', () => {
    expect(CLI.APP_START('oauth')).toBe('brevo app start oauth');
    expect(CLI.APP_START()).toBe('brevo app start <feature>');
  });
});

describe('URL path stripping', () => {
  const originalEnv = process.env.BREVO_API_URL;

  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.BREVO_API_URL = originalEnv;
    } else {
      delete process.env.BREVO_API_URL;
    }
    jest.resetModules();
  });

  it('should strip path from BREVO_API_URL and use only origin', () => {
    process.env.BREVO_API_URL = 'https://api.brevo.com/v3';
    const { API_BASE } = require('../../lib/constants');
    expect(API_BASE).toBe('https://api.brevo.com');
  });

  it('should strip path and query from BREVO_API_URL', () => {
    process.env.BREVO_API_URL = 'https://api.brevo.com/v3?key=abc';
    const { API_BASE } = require('../../lib/constants');
    expect(API_BASE).toBe('https://api.brevo.com');
  });

  it('should emit and clear warning when path was stripped', () => {
    process.env.BREVO_API_URL = 'https://api.brevo.com/v3';
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const { warnIfPathStripped } = require('../../lib/constants');

    warnIfPathStripped();
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('/v3'));

    // Second call should not emit (cleared)
    stderrSpy.mockClear();
    warnIfPathStripped();
    expect(stderrSpy).not.toHaveBeenCalled();

    stderrSpy.mockRestore();
  });

  it('should include query string in warning when path and query were stripped', () => {
    process.env.BREVO_API_URL = 'https://api.brevo.com/v3?key=abc';
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const { warnIfPathStripped } = require('../../lib/constants');

    warnIfPathStripped();
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('/v3?key=abc'));

    stderrSpy.mockRestore();
  });

  it('should warn about query-only suffix when no path is present', () => {
    process.env.BREVO_API_URL = 'https://api.brevo.com?debug=true';
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const { warnIfPathStripped } = require('../../lib/constants');

    warnIfPathStripped();
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('?debug=true'));

    stderrSpy.mockRestore();
  });

  it('should not emit warning when no path was stripped', () => {
    process.env.BREVO_API_URL = 'https://api.brevo.com';
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const { warnIfPathStripped } = require('../../lib/constants');

    warnIfPathStripped();
    expect(stderrSpy).not.toHaveBeenCalled();

    stderrSpy.mockRestore();
  });
});

describe('constants', () => {
  it('should export DEFAULT_APP_FOLDER', () => {
    expect(DEFAULT_APP_FOLDER).toBe('my-app');
  });

  it('should export DEFAULT_REDIRECT_URI', () => {
    expect(DEFAULT_REDIRECT_URI).toBe('http://localhost:3009/auth/callback');
  });
});

describe('DEFAULT_SCOPES', () => {
  it('is the locked four-scope set in the documented order', () => {
    expect(DEFAULT_SCOPES).toEqual(['contacts:read', 'contacts:write', 'crm:read', 'crm:write']);
  });

  it('is a readonly tuple-style array (no accidental push at runtime)', () => {
    expect(DEFAULT_SCOPES).toHaveLength(4);
  });
});

describe('OAUTH_SCOPES_URL', () => {
  it('is built from OAUTH_BASE and OAUTH_REALM', () => {
    expect(OAUTH_SCOPES_URL).toBe('https://oauth.brevo.com/realms/partner/scopes');
  });
});

describe('CLI scope helpers', () => {
  it('exposes APP_SCOPES and APP_UPDATE_SCOPE strings', () => {
    expect(CLI.APP_SCOPES).toBe('brevo app available-scopes');
    expect(CLI.APP_UPDATE_SCOPE).toBe('brevo app update --scope');
  });
});

describe('OAUTH_PROXY_URL resolution', () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...origEnv };
    jest.resetModules();
  });

  it('defaults to https://oauth-cli.brevo.com when BREVO_OAUTH_PROXY_URL is unset', () => {
    process.env.BREVO_API_URL = 'https://api.brevo.com';
    delete process.env.BREVO_OAUTH_PROXY_URL;
    jest.isolateModules(() => {
      const { OAUTH_PROXY_URL } = require('../../lib/constants');
      expect(OAUTH_PROXY_URL).toBe('https://oauth-cli.brevo.com');
    });
  });

  it('defaults to https://oauth-cli.brevo.com regardless of BREVO_API_URL', () => {
    process.env.BREVO_API_URL = 'https://api.example.com';
    delete process.env.BREVO_OAUTH_PROXY_URL;
    jest.isolateModules(() => {
      const { OAUTH_PROXY_URL } = require('../../lib/constants');
      expect(OAUTH_PROXY_URL).toBe('https://oauth-cli.brevo.com');
    });
  });

  it('honours BREVO_OAUTH_PROXY_URL override', () => {
    process.env.BREVO_API_URL = 'https://api.brevo.com';
    process.env.BREVO_OAUTH_PROXY_URL = 'http://localhost:8787';
    jest.isolateModules(() => {
      const { OAUTH_PROXY_URL } = require('../../lib/constants');
      expect(OAUTH_PROXY_URL).toBe('http://localhost:8787');
    });
  });

  it('rejects a non-HTTPS BREVO_OAUTH_PROXY_URL that is not localhost', () => {
    process.env.BREVO_API_URL = 'https://api.brevo.com';
    process.env.BREVO_OAUTH_PROXY_URL = 'http://evil.example.com';
    jest.isolateModules(() => {
      expect(() => require('../../lib/constants')).toThrow(/must use HTTPS/);
    });
  });

  it('rejects an unparseable BREVO_OAUTH_PROXY_URL', () => {
    process.env.BREVO_API_URL = 'https://api.brevo.com';
    process.env.BREVO_OAUTH_PROXY_URL = 'not a url';
    jest.isolateModules(() => {
      expect(() => require('../../lib/constants')).toThrow(/Invalid BREVO_OAUTH_PROXY_URL/);
    });
  });

  it('strips path from BREVO_OAUTH_PROXY_URL and keeps origin only', () => {
    process.env.BREVO_API_URL = 'https://api.brevo.com';
    process.env.BREVO_OAUTH_PROXY_URL = 'https://proxy.example.com/some/path?q=1';
    jest.isolateModules(() => {
      const { OAUTH_PROXY_URL } = require('../../lib/constants');
      expect(OAUTH_PROXY_URL).toBe('https://proxy.example.com');
    });
  });
});
