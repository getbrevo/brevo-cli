import { CLI_VERSION } from './cli-version';
import { USER_AGENT_HEADER, CLI_AUTH_METHODS } from './constants';

/**
 * CLI identification sent as a single `User-Agent` header on every API
 * request so the backend can emit product-tracking events (taxonomy card
 * "CLI installed", Kafka topic `cli`) without a dedicated telemetry endpoint.
 *
 * Format: `brevo-cli/<version> (<os>)`, extended with `; auth=<method>` when
 * the request carries credentials — e.g. `brevo-cli/1.2.0 (macos; auth=oauth)`.
 *
 * Values are sanitized to printable ASCII: undici throws a TypeError on
 * header values containing control characters, which would fail every
 * request — sanitizing here removes that failure mode entirely.
 */

const OS_BY_PLATFORM: Record<string, string> = {
  darwin: 'macos',
  win32: 'windows',
  linux: 'linux',
};

// The taxonomy card only allows known values to reach Amplitude, so anything
// outside the mapped platforms is reported as `other` rather than passed raw.
export function getCliOs(): string {
  return OS_BY_PLATFORM[process.platform] ?? 'other';
}

export function sanitizeHeaderValue(value: string, fallback: string): string {
  const sanitized = value.replace(/[^\x20-\x7E]/g, '');
  return sanitized || fallback;
}

// CLI_VERSION is fixed at module init, so sanitize it once rather than on
// every request. Falls back to the same default as cli-version.ts.
const SAFE_CLI_VERSION = sanitizeHeaderValue(CLI_VERSION, '0.0.0');

type CliAuthMethod = (typeof CLI_AUTH_METHODS)[keyof typeof CLI_AUTH_METHODS];

// Derived from the auth header about to be sent rather than from stored
// credentials, so login-time validation calls (explicit key/bearer) report
// the right method without coupling telemetry to credential storage.
export function getAuthMethod(
  authHeader: Record<string, string> | undefined,
): CliAuthMethod | undefined {
  if (authHeader && 'api-key' in authHeader) return CLI_AUTH_METHODS.API_KEY;
  if (authHeader && 'Authorization' in authHeader) return CLI_AUTH_METHODS.OAUTH;
  return undefined;
}

export function getCliUserAgent(authHeader?: Record<string, string>): string {
  const method = getAuthMethod(authHeader);
  const comment = method ? `${getCliOs()}; auth=${method}` : getCliOs();
  return `brevo-cli/${SAFE_CLI_VERSION} (${comment})`;
}

export function buildCliHeaders(authHeader?: Record<string, string>): Record<string, string> {
  return { [USER_AGENT_HEADER]: getCliUserAgent(authHeader) };
}
