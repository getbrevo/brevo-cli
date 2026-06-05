import { CLI_VERSION } from './cli-version';
import { TELEMETRY_HEADERS } from './constants';

/**
 * CLI identification metadata sent as headers on every API request so the
 * backend can emit product-tracking events (taxonomy card "CLI installed",
 * Kafka topic `cli`) without a dedicated telemetry endpoint.
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

export function getCliUserAgent(): string {
  return `brevo-cli/${sanitizeHeaderValue(CLI_VERSION, '0.0.0')} (${getCliOs()})`;
}

export function buildCliHeaders(): Record<string, string> {
  return {
    [TELEMETRY_HEADERS.USER_AGENT]: getCliUserAgent(),
    [TELEMETRY_HEADERS.CLI_VERSION]: sanitizeHeaderValue(CLI_VERSION, '0.0.0'),
    [TELEMETRY_HEADERS.CLI_OS]: getCliOs(),
  };
}

// Derived from the auth header about to be sent rather than from stored
// credentials, so login-time validation calls (explicit key/bearer) report
// the right method without coupling telemetry to credential storage.
export function buildAuthMethodHeader(
  authHeader: Record<string, string> | undefined,
): Record<string, string> {
  if (authHeader && 'api-key' in authHeader) {
    return { [TELEMETRY_HEADERS.CLI_AUTH_METHOD]: 'api_key' };
  }
  if (authHeader && 'Authorization' in authHeader) {
    return { [TELEMETRY_HEADERS.CLI_AUTH_METHOD]: 'oauth' };
  }
  return {};
}
