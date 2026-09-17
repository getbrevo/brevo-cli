import {
  jsonOutput,
  hasEmittedJson,
  resetJsonOutputState,
  buildJsonError,
  emitJsonError,
  withSnakeCaseAliases,
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

  // ──────────────── snake_case aliasing (transition) ────────────────
  // Machine-readable output is moving to snake_case to match app-config.json and the
  // wire. Renaming outright would break every `jq .appId` in a pipeline, so every
  // document carries both spellings until the next major removes camelCase.
  describe('withSnakeCaseAliases', () => {
    it('adds a snake_case twin after each camelCase key, keeping order', () => {
      const out = withSnakeCaseAliases({ deleted: true, appId: '42', clientId: 'c' });
      expect(Object.keys(out)).toEqual(['deleted', 'appId', 'app_id', 'clientId', 'client_id']);
      expect(out).toEqual({
        deleted: true,
        appId: '42',
        app_id: '42',
        clientId: 'c',
        client_id: 'c',
      });
    });

    it('leaves keys that are already snake_case or single words alone', () => {
      expect(withSnakeCaseAliases({ app_id: '1', version: '2', ui_app: { a: 1 } })).toEqual({
        app_id: '1',
        version: '2',
        ui_app: { a: 1 },
      });
    });

    it('never overwrites a key the object already carries under the snake_case name', () => {
      const out = withSnakeCaseAliases({ appId: 'camel', app_id: 'snake' });
      expect(out).toEqual({ appId: 'camel', app_id: 'snake' });
    });

    it('maps the redirect URI keys to the wire name redirect_uris', () => {
      expect(withSnakeCaseAliases({ redirectUri: ['a'] })).toEqual({
        redirectUri: ['a'],
        redirect_uris: ['a'],
      });
      expect(withSnakeCaseAliases({ redirectUris: ['a'] })).toEqual({
        redirectUris: ['a'],
        redirect_uris: ['a'],
      });
    });

    it('handles multi-hump and digit-adjacent keys', () => {
      expect(
        withSnakeCaseAliases({ upToDate: true, scaffoldSkipped: 'x', mismatchedFields: [] }),
      ).toEqual({
        upToDate: true,
        up_to_date: true,
        scaffoldSkipped: 'x',
        scaffold_skipped: 'x',
        mismatchedFields: [],
        mismatched_fields: [],
      });
    });

    // Shallow on purpose: nested objects are wire records or the user's own data.
    it('does not rewrite keys inside nested objects or arrays of values', () => {
      const nested = { extension_type: 'actionLink', surface_point_list: [{ someCamel: 1 }] };
      const out = withSnakeCaseAliases({ uiApp: nested, list: [{ innerCamel: 1 }] }) as Record<
        string,
        unknown
      >;
      expect(out.uiApp).toBe(nested);
      expect(out.ui_app).toBe(nested);
      expect(out.list).toEqual([{ innerCamel: 1 }]);
    });

    it('aliases each element of an array document', () => {
      expect(withSnakeCaseAliases([{ app_id: '1', legacyAllScope: true }, 'plain', 3])).toEqual([
        { app_id: '1', legacyAllScope: true, legacy_all_scope: true },
        'plain',
        3,
      ]);
    });

    it('aliases the keys inside the error envelope', () => {
      expect(
        withSnakeCaseAliases({
          error: { name: 'ApiError', message: 'm', exitCode: 5, statusCode: 404, code: 'X' },
        }),
      ).toEqual({
        error: {
          name: 'ApiError',
          message: 'm',
          exitCode: 5,
          exit_code: 5,
          statusCode: 404,
          status_code: 404,
          code: 'X',
        },
      });
    });

    it('passes primitives and null through', () => {
      expect(withSnakeCaseAliases(null)).toBeNull();
      expect(withSnakeCaseAliases('s')).toBe('s');
      expect(withSnakeCaseAliases(7)).toBe(7);
    });

    it('is what jsonOutput writes', () => {
      jsonOutput({ appId: '42' });
      expect(written()).toBe('{"appId":"42","app_id":"42"}\n');
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
        error: {
          name: 'CliError',
          message: 'boom',
          exitCode: EXIT_CODES.ERROR,
          exit_code: EXIT_CODES.ERROR,
        },
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
