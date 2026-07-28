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
  APP_STATE: (appId: string) => `/v3/app-store/apps/${encodeURIComponent(appId)}/state`,
  APP_STORE_APP_UPLOAD: (appId: string) => `/v3/app-store/apps/${encodeURIComponent(appId)}/upload`,
  APP_STORE_APP_WITHDRAW: (appId: string) =>
    `/v3/app-store/apps/${encodeURIComponent(appId)}/withdraw`,
  // Per-account availability for UI apps (BEX-290). Until the ManageIntegrations
  // enable/disable surface ships, these two endpoints *are* the install
  // mechanism for an action link.
  //
  // ⚠️ ASSUMED CONTRACT — pending confirmation from the app-store backend team:
  // paths below, and `account_id` carried in the request body rather than as a
  // path segment. If the real contract differs, this and appService.deployApp /
  // removeApp are the only two places to change.
  APP_STORE_APP_DEPLOY: (appId: string) => `/v3/app-store/apps/${encodeURIComponent(appId)}/deploy`,
  APP_STORE_APP_REMOVE: (appId: string) => `/v3/app-store/apps/${encodeURIComponent(appId)}/remove`,
  OAUTH_AUTHORIZE: '/oauth/authorize',
  OAUTH_TOKEN: '/oauth/token',
} as const;

export const CLI = {
  LOGIN: 'brevo login',
  INIT: 'brevo app init',
  HELP: 'brevo --help',
  APP_CREATE: 'brevo app create',
  APP_LIST: 'brevo app list',
  APP_STATUS: 'brevo app status',
  APP_SCAFFOLD: 'brevo app scaffold',
  APP_CREDENTIALS: (appId?: string) =>
    appId ? `brevo app credentials --app-id ${appId}` : 'brevo app credentials --app-id <id>',
  APP_CREDENTIALS_REVEAL: (appId?: string) =>
    appId
      ? `brevo app credentials --reveal-secret --app-id ${appId}`
      : 'brevo app credentials --reveal-secret',
  APP_UPLOAD: 'brevo app upload',
  APP_DEPLOY: (accountId?: string) =>
    accountId ? `brevo app deploy ${accountId}` : 'brevo app deploy <account-id>',
  APP_REMOVE: (accountId?: string) =>
    accountId ? `brevo app remove ${accountId}` : 'brevo app remove <account-id>',
  APP_DELETE: 'brevo app delete',
  APP_WITHDRAW: (appId?: string) =>
    appId ? `brevo app withdraw --app-id ${appId}` : 'brevo app withdraw --app-id <id>',
  APP_SUBMIT: (appId?: string) =>
    appId ? `brevo app submit --app-id ${appId}` : 'brevo app submit --app-id <id>',
  APP_START: (feature?: string) =>
    feature ? `brevo app start ${feature}` : 'brevo app start <feature>',
  APP_SCOPES: 'brevo app available-scopes',
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

// ──────────────── UI apps (BEX-290) ────────────────
// An action link reads record context rather than driving an OAuth flow, so it
// starts from a narrower scope set than DEFAULT_SCOPES. Widen via `auth.scopes`
// in app-config.json + `app upload`.
export const DEFAULT_UI_APP_SCOPES: readonly string[] = [
  'contacts:read',
  'contacts:write',
] as const;

/**
 * Extension-point slot grammar: `<location>.<place>.<kind>` (BEX-350).
 *
 * These values are a hard contract with two consumers. The extensibility UI kit
 * matches an item's `extensionPoint` against a slot name by **exact string
 * equality**, and the app-store backend **drops** an authored name that has no
 * `extension_points` registry row. Both failures are silent — the slot renders
 * nothing, with a 200 and no error — so a typo here is invisible in production.
 * That is why the CLI validates authored names locally against the registry
 * below rather than trusting the server to complain.
 *
 * Sources of truth:
 *   - integrations-common-frontend `bex-350-app-configs-link-target`
 *     (`widgets/extension-slot/slots.ts`)
 *   - app-store-backend `feature/BEX-308-extensibility-app-configs`
 *     (`http_get_apps_extensibility.go` + its twelve-point test registry)
 */
export const EXTENSION_LOCATIONS: readonly string[] = [
  'contactDetails',
  'companyDetails',
  'dealDetails',
] as const;

// `place` is a ROLE within the page, not a layout coordinate — columns stack on
// mobile, so encoding left/center/right would invalidate every registration on a
// redesign. The owning tab is folded in as a prefix.
export const EXTENSION_WIDGET_PLACES: readonly string[] = [
  'overviewAttributes',
  'overviewMain',
  'overviewSidebar',
] as const;

// The only action place in the current registry: the record page's header "More"
// (•••) overflow menu. An action link mounts here.
export const EXTENSION_ACTION_PLACE = 'headerMenu';

/** Build an action slot name for a record page. */
export function actionPointForLocation(location: string): string {
  return `${location}.${EXTENSION_ACTION_PLACE}.action`;
}

/**
 * The full twelve-point registry — three record pages x (three widget places +
 * one action place). Mirrors the backend's seeded `extension_points` table.
 */
export const EXTENSION_POINTS: readonly string[] = EXTENSION_LOCATIONS.flatMap((location) => [
  ...EXTENSION_WIDGET_PLACES.map((place) => `${location}.${place}.widget`),
  actionPointForLocation(location),
]);

/** Action slots only — the subset an action link can target. */
export const EXTENSION_ACTION_POINTS: readonly string[] =
  EXTENSION_LOCATIONS.map(actionPointForLocation);

/**
 * Friendly `--surface` values mapped to their `location` segment. Partners think
 * in record types; the wire wants the page name.
 */
export const UI_APP_SURFACE_TO_LOCATION: Readonly<Record<string, string>> = {
  contact: 'contactDetails',
  company: 'companyDetails',
  deal: 'dealDetails',
} as const;

export const UI_APP_SURFACES: readonly string[] = Object.keys(UI_APP_SURFACE_TO_LOCATION);
export const DEFAULT_UI_APP_SURFACE = 'contact';

export const EXTENSION_TYPE_ACTION_LINK = 'action_link';
export const EXTENSION_TYPE_IFRAME = 'iframe_extension';
export const EXTENSION_TYPE_LEGACY = 'legacy_component';
export const EXTENSION_TYPES: readonly string[] = [
  EXTENSION_TYPE_ACTION_LINK,
  EXTENSION_TYPE_IFRAME,
  EXTENSION_TYPE_LEGACY,
] as const;

export const LINK_TARGETS: readonly string[] = ['_blank', '_self'] as const;
// The backend defaults an action_link's linkTarget to `_blank` when the snapshot
// leaves it unset; the CLI writes it explicitly so the authored file is complete.
export const DEFAULT_LINK_TARGET = '_blank';

export const BREVO_DASHBOARD_API_KEYS_URL = 'https://app.brevo.com/settings/keys/api';
export const BREVO_API_KEY_DOCS_URL = 'https://developers.brevo.com/docs/api-key-authentication';
export const BREVO_STATUS_URL = 'https://status.brevo.com';
export const BREVO_DOCS_URL = 'https://developers.brevo.com';
export const BREVO_CLI_REFERENCE_URL = 'https://developers.brevo.com/docs/cli-reference';
export const BREVO_OAUTH_SCOPES_DOCS_URL =
  'https://developers.brevo.com/docs/oauth-scopes#scope-catalog';
