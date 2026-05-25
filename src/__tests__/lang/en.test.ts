import { messages } from '../../lang/en';

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
    expect(messages.APP_SCAFFOLD_SUCCESS(5)).toContain('5');
    expect(messages.ERR_RATE_LIMITED(5)).toContain('5');
    expect(messages.INIT_APPS_EXIST(3)).toContain('3');
    expect(messages.INIT_APPS_EXIST(1)).not.toContain('apps');
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

  it('should have working scaffold next-steps messages', () => {
    const lines = messages.APP_SCAFFOLD_NEXT_STEPS_LINES('./my-app');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain('./my-app');
    expect(lines[1]).toContain('yarn --cwd');
    expect(lines[2]).toContain('npm --prefix');
    expect(lines[3]).toContain('oauth');
  });

  it('should have working app update messages', () => {
    expect(messages.APP_UPDATE_INVALID_REDIRECT_URL('ftp://bad')).toContain('ftp://bad');
    expect(messages.APP_UPDATE_INVALID_REDIRECT_PROTOCOL('ftp://bad')).toContain('ftp://bad');
  });

  it('should advertise https for the logo URL', () => {
    expect(messages.APP_CREATE_LOGO_PROMPT).toContain('https://');
    expect(messages.APP_CREATE_LOGO_INVALID).toContain('https://');
  });

  it('should have proper WHOAMI messages', () => {
    expect(messages.WHOAMI_AUTHENTICATED('a@b.com', 'Corp')).toContain('a@b.com');
    expect(messages.WHOAMI_AUTHENTICATED('a@b.com', 'Corp')).toContain('Corp');
    expect(messages.WHOAMI_NOT_AUTHENTICATED).toContain('brevo login');
  });
});
