import { CliError } from '../lib/errors';

/**
 * Coerce `app_id` on an API response object to a string.
 * Defensive boundary in case the server still returns a number for a legacy app.
 * Fails fast on unexpected types so invalid server responses never propagate as
 * bogus IDs (e.g. "undefined", "[object Object]") into requests or credential keys.
 */
export function normalizeAppId<T extends { app_id: unknown }>(
  raw: T,
): Omit<T, 'app_id'> & { app_id: string } {
  const { app_id } = raw;
  if (typeof app_id === 'string') {
    const trimmed = app_id.trim();
    if (trimmed.length === 0) {
      throw new CliError(
        'Invalid app_id in API response: expected non-empty string, received empty string.',
      );
    }
    return { ...raw, app_id: trimmed };
  }
  if (typeof app_id === 'number' && Number.isFinite(app_id)) {
    return { ...raw, app_id: String(app_id) };
  }
  const received = describeAppId(app_id);
  throw new CliError(
    `Invalid app_id in API response: expected string or finite number, received ${received}.`,
  );
}

function describeAppId(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'number (NaN)';
    if (!Number.isFinite(value)) return `number (${value > 0 ? 'Infinity' : '-Infinity'})`;
    return 'number';
  }
  return typeof value;
}
