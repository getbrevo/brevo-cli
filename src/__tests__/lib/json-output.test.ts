import {
  jsonOutput,
  hasEmittedJson,
  resetJsonOutputState,
  buildJsonError,
  emitJsonError,
} from '../../lib/json-output';
import { CliError, ApiError, ErrorCode } from '../../lib/errors';
import { EXIT_CODES } from '../../lib/exit-codes';

describe('json output', () => {
  let write: jest.SpyInstance;

  beforeEach(() => {
    resetJsonOutputState();
    write = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    write.mockRestore();
    resetJsonOutputState();
  });

  const written = (): string => write.mock.calls.map((c) => String(c[0])).join('');

  describe('jsonOutput', () => {
    it('writes a single newline-terminated JSON document', () => {
      jsonOutput({ apps: [] });
      expect(written()).toBe('{"apps":[]}\n');
    });

    it('records that a document was emitted', () => {
      expect(hasEmittedJson()).toBe(false);
      jsonOutput({ ok: true });
      expect(hasEmittedJson()).toBe(true);
    });
  });

  describe('buildJsonError', () => {
    it('describes a plain CliError', () => {
      expect(buildJsonError(new CliError('Not authenticated. Run: brevo login'))).toEqual({
        error: {
          name: 'CliError',
          message: 'Not authenticated. Run: brevo login',
          exitCode: EXIT_CODES.ERROR,
        },
      });
    });

    it('carries the error-specific exit code', () => {
      const envelope = buildJsonError(new CliError('nope', EXIT_CODES.NOT_FOUND));
      expect(envelope.error.exitCode).toBe(EXIT_CODES.NOT_FOUND);
    });

    it('adds status and classified code for an ApiError', () => {
      const envelope = buildJsonError(
        new ApiError('App not found', 404, ErrorCode.APP_NOT_FOUND, 'app_missing'),
      );
      expect(envelope).toEqual({
        error: {
          name: 'ApiError',
          message: 'App not found',
          exitCode: EXIT_CODES.NOT_FOUND,
          code: ErrorCode.APP_NOT_FOUND,
          statusCode: 404,
        },
      });
    });

    it('omits code when the API gave no classified one', () => {
      const envelope = buildJsonError(new ApiError('Server exploded', 500));
      expect(envelope.error.statusCode).toBe(500);
      expect(envelope.error).not.toHaveProperty('code');
    });

    it('handles a non-Error throw', () => {
      expect(buildJsonError('something odd')).toEqual({
        error: { name: 'Error', message: 'something odd', exitCode: EXIT_CODES.ERROR },
      });
    });
  });

  describe('emitJsonError', () => {
    it('emits the envelope when --json is present', () => {
      emitJsonError(new CliError('boom'), ['node', 'brevo', 'app', 'list', '--json']);
      expect(JSON.parse(written())).toEqual({
        error: { name: 'CliError', message: 'boom', exitCode: EXIT_CODES.ERROR },
      });
    });

    it('stays silent without --json, so human runs are untouched', () => {
      emitJsonError(new CliError('boom'), ['node', 'brevo', 'app', 'list']);
      expect(write).not.toHaveBeenCalled();
    });

    // whoami reports {authenticated:false,...} and *then* throws. Appending a
    // second document would make stdout two concatenated values instead of one
    // parseable result.
    it('does not append a second document when the command already emitted one', () => {
      jsonOutput({ authenticated: false, reason: 'no_key' });
      emitJsonError(new CliError('Not authenticated.'), ['node', 'brevo', 'whoami', '--json']);

      const out = written();
      expect(JSON.parse(out)).toEqual({ authenticated: false, reason: 'no_key' });
      expect(out.trimEnd().split('\n')).toHaveLength(1);
    });

    it('leaves stdout parseable as exactly one document', () => {
      emitJsonError(new ApiError('Rate limited', 429, ErrorCode.RATE_LIMITED), [
        'node',
        'brevo',
        'app',
        'list',
        '--json',
      ]);
      const out = written().trimEnd();
      expect(out.split('\n')).toHaveLength(1);
      expect(() => JSON.parse(out)).not.toThrow();
    });
  });
});
