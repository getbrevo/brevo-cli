import { CliError } from './errors';

// Track whether URL suffix parts were stripped for deferred warning (avoid side effects at import time)
let strippedUrlSuffix: string | undefined;

function getStrippedUrlSuffix(parsed: URL): string | undefined {
  const pathname = parsed.pathname === '/' ? '' : parsed.pathname;
  const suffix = `${pathname}${parsed.search}${parsed.hash}`;
  return suffix || undefined;
}

function stripPath(parsed: URL): string {
  // Use origin only — endpoints already include full paths (e.g. /v3/account).
  // Prevents double-path issues when BREVO_API_URL includes a path like /v3.
  strippedUrlSuffix = getStrippedUrlSuffix(parsed);
  return parsed.origin;
}

export function warnIfPathStripped(): void {
  if (strippedUrlSuffix) {
    process.stderr.write(
      `  Warning: BREVO_API_URL path "${strippedUrlSuffix}" was stripped. Endpoints already include paths.\n`,
    );
    strippedUrlSuffix = undefined;
  }
}

function isLocalHttpAllowed(parsed: URL): boolean {
  return (
    parsed.protocol === 'http:' &&
    (parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '::1')
  );
}

function resolveApiBase(): string {
  const raw = process.env.BREVO_API_URL || 'https://api.brevo.com';
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new CliError(`Invalid BREVO_API_URL: "${raw}" is not a valid URL.`);
  }
  if (parsed.protocol === 'https:') return stripPath(parsed);
  if (isLocalHttpAllowed(parsed)) return stripPath(parsed);
  throw new CliError(
    `BREVO_API_URL must use HTTPS. Got: ${raw}\n  HTTP is only allowed for localhost/127.0.0.1.`,
  );
}

export const API_BASE = resolveApiBase();

function resolveOauthProxyUrl(): string {
  const raw = process.env.BREVO_OAUTH_PROXY_URL || 'https://oauth-cli.brevo.com';
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new CliError(`Invalid BREVO_OAUTH_PROXY_URL: "${raw}" is not a valid URL.`);
  }
  if (parsed.protocol !== 'https:' && !isLocalHttpAllowed(parsed)) {
    throw new CliError(
      `BREVO_OAUTH_PROXY_URL must use HTTPS. Got: ${raw}\n  HTTP is only allowed for localhost/127.0.0.1.`,
    );
  }
  return parsed.origin;
}

export const OAUTH_PROXY_URL = resolveOauthProxyUrl();

// Header identifying the CLI on every API request. The backend parses it to
// emit product-tracking events (e.g. "CLI installed") on the `cli` Kafka topic.
// Format: `brevo-cli/<version> (<os>[; auth=<method>])` — see lib/telemetry.ts.
export const USER_AGENT_HEADER = 'User-Agent';

// Auth-method markers carried in the User-Agent comment — part of the same
// backend contract as USER_AGENT_HEADER, so they live here rather than inline.
export const CLI_AUTH_METHODS = {
  API_KEY: 'api_key',
  OAUTH: 'oauth',
} as const;

export const ENDPOINTS = {
  ACCOUNT: '/v3/account/info',
  APP_STORE_APPS: '/v3/app-store/apps',
  APP_STORE_APP: (appId: string) => `/v3/app-store/apps/${encodeURIComponent(appId)}`,
  // Unauthenticated. Deliberately NOT fetched through ApiClient — see
  // services/cli-info.ts for why attaching the auth header would be harmful.
  CLI_INFO: '/v3/app-store/cli/info',
  OAUTH_AUTHORIZE: '/oauth/authorize',
  OAUTH_TOKEN: '/oauth/token',
} as const;

// Response headers carrying the backend's view of the calling CLI. Present on
// every response from a CLI-facing endpoint, including non-2xx, so the CLI
// learns from calls it already makes rather than from npm. Lower-cased:
// `Headers.get` is case-insensitive, but these are also used as literal keys in
// tests.
export const CLI_VERSION_HEADERS = {
  LATEST: 'x-brevo-cli-latest-version',
  STATUS: 'x-brevo-cli-status',
} as const;

// The verdict values the CLI understands. Anything else is treated as absent,
// so a backend that starts sending a new status cannot accidentally block
// clients that predate it.
export const CLI_VERSION_STATUS = {
  OK: 'ok',
  OUTDATED: 'outdated',
  UNSUPPORTED: 'unsupported',
} as const;

// Notice codes the CLI recognises from `GET /cli/info`. An unrecognised code
// means the body is ignored wholesale and local wording is used instead — the
// same contract as `apiCodeMessages` in api/client.ts.
export const CLI_NOTICE_CODES = {
  VERSION_MISMATCH: 'cli_version_mismatch',
} as const;

// Emergency escape hatch for a mistaken backend rollout. Downgrades a block to
// a warning so work can continue; deliberately not documented as a routine
// opt-out.
export const SKIP_VERSION_GATE_ENV = 'BREVO_CLI_SKIP_VERSION_GATE';

export const CLI = {
  LOGIN: 'brevo login',
  INIT: 'brevo app init',
  HELP: 'brevo --help',
  APP_CREATE: 'brevo app create',
  APP_LIST: 'brevo app list',
  APP_SCAFFOLD: (appId?: string) =>
    appId ? `brevo app scaffold --app-id ${appId}` : 'brevo app scaffold --app-id <id>',
  APP_CREDENTIALS: (appId?: string) =>
    appId ? `brevo app credentials --app-id ${appId}` : 'brevo app credentials --app-id <id>',
  APP_CREDENTIALS_REVEAL: (appId?: string) =>
    appId
      ? `brevo app credentials --reveal-secret --app-id ${appId}`
      : 'brevo app credentials --reveal-secret',
  APP_UPDATE: 'brevo app update',
  APP_DELETE: 'brevo app delete',
  APP_START: (feature?: string) =>
    feature ? `brevo app start ${feature}` : 'brevo app start <feature>',
  APP_SCOPES: 'brevo app available-scopes',
  APP_UPDATE_SCOPE: 'brevo app update --scope',
  SKILL_INSTALL: 'brevo skill:cli install',
  SKILL_UNINSTALL: 'brevo skill:cli uninstall',
} as const;

export const DEFAULT_APP_FOLDER = 'my-app';
export const DEFAULT_PORT = 3009;
export const DEFAULT_REDIRECT_URI = `http://localhost:${DEFAULT_PORT}/auth/callback`;
export const PLACEHOLDER_CLIENT_ID = 'YOUR_CLIENT_ID';
export const OAUTH_BASE = 'https://oauth.brevo.com';
export const OAUTH_REALM = 'partner';
export const OAUTH_SCOPES_URL = `${OAUTH_BASE}/realms/${OAUTH_REALM}/scopes`;

// Legacy catch-all OAuth scope being deprecated (BEX-214). Single source of
// truth for the spelling — every detection path goes through
// `containsLegacyAllScope` in lib/validators.
export const LEGACY_ALL_SCOPE = 'all';

export const DEFAULT_SCOPES: readonly string[] = [
  'contacts:read',
  'contacts:write',
  'crm:read',
  'crm:write',
] as const;

export const BREVO_DASHBOARD_API_KEYS_URL = 'https://app.brevo.com/settings/keys/api';
export const BREVO_API_KEY_DOCS_URL = 'https://developers.brevo.com/docs/api-key-authentication';
export const BREVO_STATUS_URL = 'https://status.brevo.com';
export const BREVO_DOCS_URL = 'https://developers.brevo.com';
export const BREVO_CLI_REFERENCE_URL = 'https://developers.brevo.com/docs/cli-reference';
export const BREVO_OAUTH_SCOPES_DOCS_URL =
  'https://developers.brevo.com/docs/oauth-scopes#scope-catalog';
