import { CliError, ApiError, ErrorCode } from './errors';
import { EXIT_CODES } from './exit-codes';

let emitted = false;

/**
 * Write JSON data to stdout (for --json flag output).
 * Centralizes the JSON serialization pattern used by all commands.
 */
export function jsonOutput(data: unknown): void {
  emitted = true;
  process.stdout.write(JSON.stringify(data) + '\n');
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
