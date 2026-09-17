import { CliError, ApiError, ErrorCode } from './errors';
import { EXIT_CODES } from './exit-codes';

let emitted = false;

/**
 * camelCase output keys whose snake_case twin is NOT the mechanical conversion, because
 * the snake_case name has to match the wire field the value came from.
 *
 * `redirectUri` on `app create --json` and `redirectUris` on `app credentials --json` both
 * carry the app's `redirect_uris` array, so both alias to that one wire name rather than to
 * `redirect_uri` / `redirect_uris` respectively.
 */
const SNAKE_CASE_OVERRIDES: Readonly<Record<string, string>> = {
  redirectUri: 'redirect_uris',
  redirectUris: 'redirect_uris',
};

function camelToSnake(key: string): string {
  return key.replaceAll(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Add a snake_case twin next to every camelCase key of one object, keeping insertion order
 * (the camelCase key first, its twin right after). A twin is never written over a key the
 * object already has, so an object that already carries both spellings is left alone.
 */
function aliasKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    out[key] = value;
    const alias = SNAKE_CASE_OVERRIDES[key] ?? camelToSnake(key);
    if (alias !== key && !(alias in obj) && !(alias in out)) {
      out[alias] = value;
    }
  }
  return out;
}

/**
 * The transition shape of every `--json` document: each camelCase key is accompanied by
 * its snake_case twin.
 *
 * The CLI's machine-readable output grew two conventions. Commands that pass a platform
 * record through (`app list`, `app submit`, `function *`) emit the wire's snake_case
 * (`app_id`, `redirect_uris`); commands that build their own object emit camelCase
 * (`appId`, `clientId`, `exitCode`). `app-config.json` settled on snake_case (BEX-470), and
 * scripts should be able to read one spelling everywhere. Renaming outright would break
 * every `jq .appId` in a pipeline with nothing the CLI could migrate for the user, so this
 * is the deprecation step: both spellings for now, camelCase removed in the next major.
 *
 * Deliberately SHALLOW. Only the top level of the document is aliased (per element for an
 * array document), plus the `error` envelope `buildJsonError` produces, because those are
 * the keys the CLI itself names. Anything nested — a `ui_app` block, a `current` / `next`
 * diff, a Function record, contact data — is either already wire-shaped or is the user's
 * own data, and rewriting keys inside it would change what it means.
 */
export function withSnakeCaseAliases<T>(data: T): T {
  if (Array.isArray(data)) {
    return data.map((item) => (isPlainObject(item) ? aliasKeys(item) : item)) as T;
  }
  if (!isPlainObject(data)) return data;
  const aliased = aliasKeys(data);
  if (isPlainObject(aliased.error)) {
    aliased.error = aliasKeys(aliased.error);
  }
  return aliased as T;
}

/**
 * Write JSON data to stdout (for --json flag output).
 * Centralizes the JSON serialization pattern used by all commands — including the
 * camelCase → snake_case key aliasing every document carries during the transition (see
 * {@link withSnakeCaseAliases}).
 */
export function jsonOutput(data: unknown): void {
  emitted = true;
  process.stdout.write(JSON.stringify(withSnakeCaseAliases(data)) + '\n');
}

/**
 * True once any command has written a JSON document to stdout.
 *
 * The top-level error handler in `bin/index.ts` uses this to stay a *fallback*:
 * commands that already describe their own failure in JSON (`whoami` reports
 * `{authenticated:false,reason:'no_key'}` and then throws) must not get a
 * second document appended, or `--json` stdout stops being a single parseable
 * value.
 */
export function hasEmittedJson(): boolean {
  return emitted;
}

/** Reset the emitted flag. Tests only — each case needs a clean slate. */
export function resetJsonOutputState(): void {
  emitted = false;
}

export interface JsonErrorEnvelope {
  error: {
    name: string;
    message: string;
    exitCode: number;
    /** Present on `ApiError` only — the classified `ErrorCode`, when the API gave one. */
    code?: ErrorCode;
    /** Present on `ApiError` only — the HTTP status behind the failure. */
    statusCode?: number;
  };
}

/**
 * Shape a thrown error as the `--json` failure document.
 *
 * The `error` key is the discriminator: no success payload emits one, so a
 * script can branch on its presence without needing an `ok` flag added to
 * every existing success shape.
 */
export function buildJsonError(err: unknown): JsonErrorEnvelope {
  const envelope: JsonErrorEnvelope = {
    error: {
      name: err instanceof Error ? err.name : 'Error',
      message: err instanceof Error ? err.message : String(err),
      exitCode: err instanceof CliError ? err.exitCode : EXIT_CODES.ERROR,
    },
  };

  if (err instanceof ApiError) {
    if (err.errorCode) envelope.error.code = err.errorCode;
    envelope.error.statusCode = err.statusCode;
  }

  return envelope;
}

/**
 * Write the `--json` failure document to stdout, if one is owed.
 *
 * Called from the top-level error handler so that *every* command honours
 * `--json` on its failure paths, not just the handful that guard the error
 * themselves. Two conditions keep it from doing harm:
 *
 * - `--json` must actually be present, so human-facing runs are untouched.
 * - nothing may have been emitted yet, so a command that already reported its
 *   own failure in JSON stays the single source of that document.
 */
export function emitJsonError(err: unknown, argv: string[] = process.argv): void {
  if (!argv.includes('--json')) return;
  if (hasEmittedJson()) return;
  jsonOutput(buildJsonError(err));
}
