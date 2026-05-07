import {
  logHttp,
  logHttpResponse,
  logDebug,
  logError,
  logSuccess,
  logInfo,
  logWarn,
  isDebug,
} from '../../lib/logger';

describe('logger', () => {
  let stderrSpy: jest.SpyInstance;
  let stdoutSpy: jest.SpyInstance;
  const originalEnv = process.env.BREVO_DEBUG;
  const originalArgv = process.argv;

  beforeEach(() => {
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
    process.env.BREVO_DEBUG = originalEnv;
    process.argv = originalArgv;
  });

  describe('isDebug', () => {
    it('should return true when BREVO_DEBUG=1', () => {
      process.env.BREVO_DEBUG = '1';
      expect(isDebug()).toBe(true);
    });

    it('should return true when --debug flag is present', () => {
      process.argv = ['node', 'script', '--debug'];
      expect(isDebug()).toBe(true);
    });

    it('should return false when neither env nor flag is set', () => {
      delete process.env.BREVO_DEBUG;
      process.argv = ['node', 'script'];
      expect(isDebug()).toBe(false);
    });
  });

  describe('logHttp', () => {
    it('should log HTTP request in debug mode', () => {
      process.env.BREVO_DEBUG = '1';
      logHttp('GET', '/v3/account');
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('GET /v3/account'));
    });

    it('should not log in non-debug mode', () => {
      delete process.env.BREVO_DEBUG;
      process.argv = ['node', 'script'];
      logHttp('GET', '/v3/account');
      expect(stderrSpy).not.toHaveBeenCalled();
    });
  });

  describe('logHttpResponse', () => {
    it('should log successful status in debug mode', () => {
      process.env.BREVO_DEBUG = '1';
      logHttpResponse(200, '/v3/account');
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('200'));
    });

    it('should log error status in debug mode', () => {
      process.env.BREVO_DEBUG = '1';
      logHttpResponse(500, '/v3/account');
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('500'));
    });
  });

  describe('logDebug', () => {
    it('should log debug context and data', () => {
      process.env.BREVO_DEBUG = '1';
      logDebug('test-context', { foo: 'bar' });
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('test-context'));
    });

    it('should redact sensitive fields in debug output', () => {
      process.env.BREVO_DEBUG = '1';
      logDebug('response', {
        email: 'test@example.com',
        access_token: 'secret-token-123',
        client_secret: 'my-secret',
        nested: { api_key: 'key-456' },
      });
      const output = stderrSpy.mock.calls[0][0];
      expect(output).toContain('[REDACTED]');
      expect(output).not.toContain('secret-token-123');
      expect(output).not.toContain('my-secret');
      expect(output).not.toContain('key-456');
      expect(output).toContain('test@example.com');
    });
  });

  describe('logError', () => {
    it('should write error message to stderr', () => {
      logError('Something went wrong');
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Something went wrong'));
    });

    it('should show stack in debug mode', () => {
      process.env.BREVO_DEBUG = '1';
      logError('fail', new Error('inner'));
      expect(stderrSpy).toHaveBeenCalledTimes(2);
    });

    it('should show hint to run with --debug when error exists but not in debug', () => {
      delete process.env.BREVO_DEBUG;
      process.argv = ['node', 'script'];
      logError('fail', new Error('inner'));
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('--debug'));
    });
  });

  describe('logSuccess', () => {
    it('should write success message to stdout', () => {
      logSuccess('Done!');
      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Done!'));
    });
  });

  describe('logInfo', () => {
    it('should write info message to stdout', () => {
      logInfo('Info text');
      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Info text'));
    });
  });

  describe('logWarn', () => {
    it('should write warning message to stdout', () => {
      logWarn('Warning text');
      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Warning text'));
    });
  });

  describe('NO_COLOR support', () => {
    const originalNoColor = process.env.NO_COLOR;

    afterEach(() => {
      if (originalNoColor === undefined) {
        delete process.env.NO_COLOR;
      } else {
        process.env.NO_COLOR = originalNoColor;
      }
    });

    it('should strip ANSI codes when NO_COLOR is set', () => {
      process.env.NO_COLOR = '1';
      logSuccess('colored test');
      const output = stdoutSpy.mock.calls[0][0];
      expect(output).not.toContain('\x1b[');
      expect(output).toContain('colored test');
    });
  });
});
