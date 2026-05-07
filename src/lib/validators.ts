import { CliError } from './errors';

const APP_NAME_MAX_LENGTH = 48;
const APP_NAME_REGEX = /^[a-zA-Z0-9 ._\-\u00C0-\u024F]+$/;

/**
 * Validate an app name: alphanumeric, spaces, hyphens, dots, underscores,
 * and accented/extended Latin characters only. Max 48 characters.
 * Returns true if valid, or an error string for inquirer prompts.
 */
export function validateAppName(name: string): true | string {
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'App name cannot be empty.';
  if (trimmed.length > APP_NAME_MAX_LENGTH) {
    return `App name must be at most ${APP_NAME_MAX_LENGTH} characters (got ${trimmed.length}).`;
  }
  if (!APP_NAME_REGEX.test(trimmed)) {
    return 'App name can only contain letters, numbers, spaces, hyphens, dots, underscores, and accented characters.';
  }
  return true;
}

/**
 * Validate that a value is one of the allowed options.
 * Throws CliError with a user-friendly message if invalid.
 */
export function validateEnum(
  value: string | undefined,
  allowed: readonly string[],
  flagName: string,
): void {
  if (value && !allowed.includes(value)) {
    throw new CliError(`Invalid ${flagName} "${value}". Must be one of: ${allowed.join(', ')}.`);
  }
}

/**
 * Validate that a string is a valid HTTP/HTTPS URL.
 * Throws CliError if the format is invalid.
 */
export function validateUrl(value: string | undefined, fieldName: string): void {
  if (!value) return;
  // Reject whitespace and commas early — Node's URL parser silently percent-encodes
  // spaces, so "http://a/cb, http://b/cb" parses as a single valid URL. That has let
  // comma-separated values sneak into redirect_uris as one corrupted entry.
  if (/[\s,]/.test(value)) {
    throw new CliError(
      `Invalid ${fieldName}: "${value}" contains whitespace or a comma. Pass each URL with a separate --redirect-uri flag.`,
    );
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('bad protocol');
    }
  } catch {
    throw new CliError(`Invalid ${fieldName}: "${value}" is not a valid HTTP/HTTPS URL.`);
  }
}

/**
 * Commander.js collect function for repeatable --redirect-uri flags.
 * Validates each URL and accumulates into an array.
 */
export function collectUrls(value: string, previous: string[] = []): string[] {
  validateUrl(value, 'redirect URL');
  return [...previous, value];
}

/**
 * Validate that a value is a positive integer.
 * Throws CliError if the value is not a valid positive integer.
 */
export function parsePositiveInt(value: string, flagName: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new CliError(`Invalid ${flagName}: "${value}" is not a positive integer.`);
  }
  return n;
}

/**
 * Parse and validate a `--app-id` flag value.
 * Accepts any non-empty trimmed string (numeric or UUID).
 */
export function parseAppId(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new CliError('Invalid --app-id: value cannot be empty.');
  }
  return trimmed;
}
