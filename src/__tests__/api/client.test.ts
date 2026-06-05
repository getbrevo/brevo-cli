import { ApiClient, parseRetryAfter, sanitizeErrorMessage } from '../../api/client';
import { ErrorCode } from '../../lib/errors';
import { messages } from '../../lang/en';

// Mock fetch globally
const mockFetch = jest.fn();
globalThis.fetch = mockFetch;

// Mock hidden-input to prevent interactive prompts
jest.mock('../../lib/hidden-input', () => ({
  readHiddenInput: jest.fn().mockResolvedValue('new-key'),
}));

function createTestClient(authHeader?: Record<string, string>) {
  const headers = authHeader ?? { 'api-key': 'test-api-key' };
  return new ApiClient({
    baseUrl: 'https://api.brevo.com',
    getAuthHeader: () => headers,
  });
}

describe('api client', () => {
  let client: ApiClient;
  let stderrSpy: jest.SpyInstance;
  let stdoutSpy: jest.SpyInstance;

  beforeEach(() => {
    client = createTestClient();
    mockFetch.mockReset();
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  describe('client.get', () => {
    it('should make a GET request with api-key header', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map(),
        text: () => Promise.resolve(JSON.stringify({ email: 'test@example.com' })),
      });

      const result = await client.get<{ email: string }>('/v3/account');
      expect(result.email).toBe('test@example.com');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v3/account'),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({ 'api-key': 'test-api-key' }),
        }),
      );
    });

    it('should make a GET request with Authorization Bearer header when configured', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map(),
        text: () => Promise.resolve(JSON.stringify({ email: 't@e.com' })),
      });
      const bearerClient = createTestClient({ Authorization: 'Bearer oauth-token' });
      await bearerClient.get('/v3/account');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v3/account'),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer oauth-token' }),
        }),
      );
      expect(mockFetch.mock.calls[0][1].headers).not.toHaveProperty('api-key');
    });

    it('should throw ApiError on network failure', async () => {
      mockFetch.mockRejectedValue(new Error('network error'));

      await expect(client.get('/v3/account')).rejects.toThrow('Cannot reach Brevo API');
    });

    it('should throw ApiError on non-ok response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        headers: new Map(),
        text: () => Promise.resolve(JSON.stringify({ message: 'Not found' })),
      });

      await expect(client.get('/v3/apps/999')).rejects.toThrow('Not found');
    });

    it('should pass apiCode from response to ApiError', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        headers: new Map(),
        text: () =>
          Promise.resolve(
            JSON.stringify({
              code: 'APP_LIMIT_REACHED',
              message: 'Maximum apps reached',
            }),
          ),
      });

      await expect(client.get('/v3/oauth/apps')).rejects.toMatchObject({
        apiCode: 'APP_LIMIT_REACHED',
        errorCode: ErrorCode.APP_LIMIT_REACHED,
      });
    });

    it('should use mapped message for known apiCode instead of raw API message', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        headers: new Map(),
        text: () =>
          Promise.resolve(
            JSON.stringify({
              code: 'APP_LIMIT_REACHED',
              message: 'raw api message',
            }),
          ),
      });

      await expect(client.get('/v3/oauth/apps')).rejects.toThrow(messages.APP_CREATE_LIMIT_REACHED);
    });

    it('should fall back to API message for unknown apiCode', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        headers: new Map(),
        text: () =>
          Promise.resolve(
            JSON.stringify({
              code: 'SOME_UNKNOWN_CODE',
              message: 'Something went wrong',
            }),
          ),
      });

      await expect(client.get('/v3/oauth/apps')).rejects.toThrow('Something went wrong');
    });
  });

  describe('client.post', () => {
    it('should make a POST request with body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 201,
        headers: new Map(),
        text: () => Promise.resolve(JSON.stringify({ app_id: 1 })),
      });

      const result = await client.post<{ app_id: number }>('/v3/oauth/apps', { name: 'test' });
      expect(result.app_id).toBe(1);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'test' }),
        }),
      );
    });
  });

  describe('client.patch', () => {
    it('should make a PATCH request', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map(),
        text: () => Promise.resolve(JSON.stringify({ updated: true })),
      });

      await client.patch('/v3/oauth/apps/1', { redirect_uris: ['http://localhost:3000'] });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: 'PATCH' }),
      );
    });
  });

  describe('client.put', () => {
    it('should make a PUT request', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map(),
        text: () => Promise.resolve(JSON.stringify({})),
      });

      await client.put('/v3/oauth/apps/1', { name: 'updated' });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: 'PUT' }),
      );
    });
  });

  describe('client.delete', () => {
    it('should make a DELETE request', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 204,
        headers: new Map(),
        text: () => Promise.resolve(''),
      });

      await client.delete('/v3/oauth/apps/1');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  describe('client.getWithKey', () => {
    it('should make GET request with provided key instead of stored key', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map(),
        text: () => Promise.resolve(JSON.stringify({ email: 'other@example.com' })),
      });

      await client.getWithKey('/v3/account', 'custom-api-key');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ 'api-key': 'custom-api-key' }),
        }),
      );
    });
  });

  describe('rate limiting (429)', () => {
    // Restore real timers in afterEach so a failed assertion inside a test
    // can't leak fake-timer state into unrelated tests below.
    afterEach(() => {
      jest.useRealTimers();
    });

    it('should retry after rate limit and write to stderr', async () => {
      jest.useFakeTimers({ advanceTimers: true });

      const headersMap = new Map([['retry-after', '1']]);
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: { get: (key: string) => headersMap.get(key) || null },
          text: () => Promise.resolve('{}'),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Map(),
          text: () => Promise.resolve(JSON.stringify({ ok: true })),
        });

      const promise = client.get('/v3/account');
      await jest.advanceTimersByTimeAsync(2000);
      const result = await promise;

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ ok: true });
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Rate limited'));
    });

    it('should throw after max retries on persistent 429', async () => {
      jest.useFakeTimers({ advanceTimers: true });
      const headersMap = new Map([['retry-after', '1']]);
      const mock429 = {
        ok: false,
        status: 429,
        headers: { get: (key: string) => headersMap.get(key) || null },
        text: () => Promise.resolve('{}'),
      };

      mockFetch
        .mockResolvedValueOnce(mock429)
        .mockResolvedValueOnce(mock429)
        .mockResolvedValueOnce(mock429)
        .mockResolvedValueOnce(mock429);

      const rejection = expect(client.get('/v3/account')).rejects.toThrow(
        'Rate limited — max retries exceeded.',
      );
      await jest.advanceTimersByTimeAsync(5000);
      await rejection;
      expect(mockFetch).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    });

    it('should cap retry-after at 300 seconds', async () => {
      jest.useFakeTimers({ advanceTimers: true });
      const headersMap = new Map([['retry-after', '999999']]);
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: { get: (key: string) => headersMap.get(key) || null },
          text: () => Promise.resolve('{}'),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Map(),
          text: () => Promise.resolve(JSON.stringify({ ok: true })),
        });

      const promise = client.get('/v3/account');
      await jest.advanceTimersByTimeAsync(301_000);
      await expect(promise).resolves.toEqual({ ok: true });
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('300'));
    });
  });

  describe('parseRetryAfter helper', () => {
    it('defaults to 5 when header is missing', () => {
      expect(parseRetryAfter(null)).toBe(5);
      expect(parseRetryAfter('')).toBe(5);
    });

    it('defaults to 5 for NaN / non-numeric input', () => {
      expect(parseRetryAfter('abc')).toBe(5);
      expect(parseRetryAfter('NaN')).toBe(5);
    });

    it('defaults to 5 for zero or negative values', () => {
      expect(parseRetryAfter('0')).toBe(5);
      expect(parseRetryAfter('-10')).toBe(5);
    });

    it('caps at 300 seconds', () => {
      expect(parseRetryAfter('999999')).toBe(300);
      expect(parseRetryAfter('301')).toBe(300);
    });

    it('passes through valid values within range', () => {
      expect(parseRetryAfter('1')).toBe(1);
      expect(parseRetryAfter('60')).toBe(60);
      expect(parseRetryAfter('300')).toBe(300);
    });
  });

  describe('sanitizeErrorMessage helper', () => {
    it('strips ANSI color codes', () => {
      expect(sanitizeErrorMessage('\x1B[31mbad\x1B[0m')).toBe('bad');
    });

    it('strips ANSI cursor-move sequences', () => {
      expect(sanitizeErrorMessage('before\x1B[2Jafter')).toBe('beforeafter');
    });

    it('strips OSC sequences (terminal title injection)', () => {
      expect(sanitizeErrorMessage('\x1B]0;evil\x07hello')).toBe('hello');
    });

    it(String.raw`strips control characters but keeps \t \n \r`, () => {
      expect(sanitizeErrorMessage('a\x00b\x08c')).toBe('abc');
      expect(sanitizeErrorMessage('line1\nline2\tcol\rend')).toBe('line1\nline2\tcol\rend');
    });

    it('strips DEL and C1 control chars (incl. 8-bit CSI/OSC introducers)', () => {
      expect(sanitizeErrorMessage('a\x7Fb')).toBe('ab'); // DEL
      expect(sanitizeErrorMessage('a\x9Bb')).toBe('ab'); // 8-bit CSI
      expect(sanitizeErrorMessage('a\x9Db')).toBe('ab'); // 8-bit OSC
      expect(sanitizeErrorMessage('a\x80\x9Fb')).toBe('ab'); // C1 range bounds
    });

    it('leaves plain text untouched', () => {
      expect(sanitizeErrorMessage('just a normal error')).toBe('just a normal error');
    });
  });

  describe('error message sanitization (integration)', () => {
    it('strips ANSI sequences from API error fallback before throwing', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        headers: new Map(),
        text: () => Promise.resolve(JSON.stringify({ message: '\x1B[31mboom\x1B[0m' })),
      });

      await expect(client.get('/v3/account')).rejects.toThrow('boom');
      await expect(client.get('/v3/account')).rejects.not.toThrow(
        new RegExp(String.fromCodePoint(0x1b)),
      );
    });
  });

  describe('setOnAuthFailure', () => {
    it('should call the auth failure handler on 401 and retry', async () => {
      const authHandler = jest.fn().mockResolvedValue(undefined);
      client.setOnAuthFailure(authHandler);

      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          headers: new Map(),
          text: () => Promise.resolve(JSON.stringify({ message: 'Unauthorized' })),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Map(),
          text: () => Promise.resolve(JSON.stringify({ email: 'test@example.com' })),
        });

      const result = await client.get<{ email: string }>('/v3/account');

      expect(authHandler).toHaveBeenCalledTimes(1);
      expect(result.email).toBe('test@example.com');
    });
  });
});
