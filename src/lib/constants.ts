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

/**
 * Base URL of the app-store service.
 *
 * The update-notice endpoint is called here **directly**, not through the v3
 * API gateway: the gateway enforces authentication on every path it fronts, and
 * this notice has to render while the user is logged out, mid-`brevo login`, or
 * holding expired credentials — exactly when telling them their CLI is stale
 * matters most. The service serves it unauthenticated.
 *
 * Override with BREVO_APP_STORE_URL to point at a non-production environment.
 */
function resolveAppStoreUrl(): string {
  const raw = process.env.BREVO_APP_STORE_URL || 'https://app-store-bo-be.brevo.com';
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new CliError(`Invalid BREVO_APP_STORE_URL: "${raw}" is not a valid URL.`);
  }
  if (parsed.protocol !== 'https:' && !isLocalHttpAllowed(parsed)) {
    throw new CliError(
      `BREVO_APP_STORE_URL must use HTTPS. Got: ${raw}\n  HTTP is only allowed for localhost/127.0.0.1.`,
    );
  }
  return parsed.origin;
}

export const APP_STORE_BASE = resolveAppStoreUrl();

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
  // Sub-accounts of a master (corporate) account — `{ count, subAccounts: [...] }`.
  // `offset` and `limit` are both required (there is no "return everything" call),
  // so `count` is the paging terminator. `app deploy` / `app rollback` read this to
  // resolve a deploy target when no <account-id> was given.
  CORPORATE_SUB_ACCOUNTS: '/v3/corporate/subAccount',
  APP_STORE_APPS: '/v3/app-store/apps',
  APP_STORE_APP: (appId: string) => `/v3/app-store/apps/${encodeURIComponent(appId)}`,
  // Served by the app-store service directly (APP_STORE_BASE), not via the v3
  // gateway — see resolveAppStoreUrl above and services/cli-info.ts.
  CLI_INFO: '/cli/info',
  APP_STATE: (appId: string) => `/v3/app-store/apps/${encodeURIComponent(appId)}/state`,
  APP_STORE_APP_UPLOAD: (appId: string) => `/v3/app-store/apps/${encodeURIComponent(appId)}/upload`,
  APP_STORE_APP_WITHDRAW: (appId: string) =>
    `/v3/app-store/apps/${encodeURIComponent(appId)}/withdraw`,
  // Per-account availability for UI apps (BEX-290). Until an in-product
  // enable/disable surface ships, this endpoint *is* the install mechanism for
  // an action link: POST to install into an account, DELETE to remove.
  //
  // Both verbs take the same body — `client_id` (the *caller's* organization ID,
  // which the server uses to resolve the app, and which it falls back to as the
  // install target), `deploy_client_id` (the numeric account being deployed to),
  // `name`, `is_developer`. Note the `deploy` / `rollback` *commands* are named
  // for the partner-facing verb, not the resource; the resource is an install.
  //
  // DELETE resolves the install from this body rather than from an installation ID
  // (BEX-364) — the developer never sees one — so it answers 404 both for an unknown
  // app and for an install that isn't there. `app rollback` reads either as
  // "not deployed"; see the comment on its catch block.
  APP_STORE_APP_INSTALLS: (appId: string) =>
    `/v3/app-store/apps/${encodeURIComponent(appId)}/installs`,
  APP_STORE_SURFACE_POINTS: '/v3/app-store/surface-points',
  // The registry's distinct `location_name` values, and nothing else:
  // `{ locations: ["companyDetails", …], count: 3 }`. `app create` reads this for the
  // record-page prompt and then narrows the row read with `?location=<csv>`, rather than
  // pulling the whole registry to derive the same handful of strings client-side.
  APP_STORE_SURFACE_POINT_LOCATIONS: '/v3/app-store/surface-points/locations',
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
  // The bootstrap form, kept separate from the bare `APP_SCAFFOLD` above rather than
  // folding both into one function: the bare string is quoted in a dozen messages that
  // mean "run it here", and only the migration copy means "link that app into here".
  APP_SCAFFOLD_APP_ID: (appId?: string) =>
    appId ? `brevo app scaffold --app-id ${appId}` : 'brevo app scaffold --app-id <id>',
  APP_CREDENTIALS: (appId?: string) =>
    appId ? `brevo app credentials --app-id ${appId}` : 'brevo app credentials --app-id <id>',
  APP_DELETE_APP_ID: (appId?: string) =>
    appId ? `brevo app delete --app-id ${appId}` : 'brevo app delete --app-id <id>',
  APP_CREDENTIALS_REVEAL: (appId?: string) =>
    appId
      ? `brevo app credentials --reveal-secret --app-id ${appId}`
      : 'brevo app credentials --reveal-secret',
  APP_UPLOAD: 'brevo app upload',
  // The account ID is optional — omitted, both commands resolve the target from the
  // authenticated account. The no-argument form is the one to show in guidance copy.
  APP_DEPLOY: (accountId?: string) =>
    accountId ? `brevo app deploy ${accountId}` : 'brevo app deploy',
  APP_ROLLBACK: (accountId?: string) =>
    accountId ? `brevo app rollback ${accountId}` : 'brevo app rollback',
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
// A UI app has no OAuth block at all — its config carries an empty
// `auth: {}`, so there is no per-type default scope set (BEX-290 follow-up).

/**
 * Extension-point slot grammar: `<location>.<place>.<kind>` (BEX-350).
 *
 * The CLI holds no list of valid slot names. It used to mirror the platform's
 * twelve-row `extension_points` registry here so `app upload` could pre-flight a
 * hand-edited `surface_point_list` offline, but that mirror could only ever be a
 * lagging copy: a slot the platform had and the mirror didn't failed an upload the
 * server would have accepted, and a slot the platform had dropped still passed.
 *
 * The registry is now the only authority, read at the two points that need it:
 * `app create` prompts from it (`GET /v3/app-store/surface-points/locations` for the
 * record pages, then `GET /v3/app-store/surface-points?location=<csv>` for the
 * placements on the pages that were picked), and the upload
 * endpoint checks every authored name against `extension_points` in one indexed
 * read, answering 400 with the offending names (`checkExtensionPoints`, BEX-361).
 * Neither the UI kit's exact-match rendering nor the platform's silent drop of an
 * unregistered name has changed — a bad slot is still invisible in production —
 * but the partner is now told by the layer that actually knows.
 */

/**
 * The `kind` segment. Both extension types render on both kinds — a widget slot gets a
 * card, an action slot a menu entry — so kind is a placement choice, not a consequence
 * of the extension type.
 */
export const EXTENSION_KIND_ACTION = 'action';
export const EXTENSION_KIND_WIDGET = 'widget';

/**
 * Friendly labels for the placement prompt — partners think in page regions, the wire
 * wants the `place` segment (served as `section_name`).
 *
 * These are CLI-OWNED and stay that way. An earlier version of this comment claimed they
 * mirror `extension_points.surface_point_name`, "the platform's own display text" — that
 * is false: the seeded values of that column are kebab-case slugs
 * (`contact-details-header-menu`), so rendering them to a partner would be worse than
 * these. The registry exposes no display-name column, so until it does, this map is the
 * only source of partner-facing placement labels.
 */
export const EXTENSION_PLACE_LABELS: Readonly<Record<string, string>> = {
  headerMenu: 'Header "More" (•••) menu',
  overviewMain: 'Main column',
  overviewSidebar: 'Sidebar',
  overviewAttributes: 'Attributes panel',
} as const;

/**
 * There is deliberately no friendly-name map for record pages, and no default page.
 *
 * `app create`'s record-page prompt shows the registry's own `location_name` values
 * verbatim (`contactDetails`, …) and pre-selects none of them. A local `contact →
 * contactDetails` map used to sit here: it gave every page a second, CLI-owned name that
 * had to be kept in step with the platform, needed a strip-`Details` guess for any page
 * the map didn't know, and let the prompt show something the API never said. Do not
 * reintroduce it. `EXTENSION_PLACE_LABELS` above is not a counter-example: it labels a
 * fixed segment of the BEX-350 grammar, not a server-supplied identifier.
 */

/**
 * `extension_type` values, camelCase per BEX-350 — the same casing as the
 * extension-point grammar. Source of truth is `FEATURE_TYPES` in the
 * extensibility UI kit (integrations-common-frontend
 * `shared/constants/global.ts`); the kit routes on an exact match against these
 * strings.
 *
 * The pre-BEX-350 snake_case spellings (`action_link`, `iframe_extension`,
 * `legacy_component`) are deliberately NOT accepted. The kit still maps them for
 * backward compatibility, but that map is slated for removal once every producer
 * emits camelCase — and the CLI is a producer, so it only ever writes canonical
 * values. UI apps aren't live yet, so there is no authored config to migrate.
 */
export const EXTENSION_TYPE_ACTION_LINK = 'actionLink';
export const EXTENSION_TYPE_IFRAME = 'iframeExtension';
export const EXTENSION_TYPE_LEGACY = 'legacyComponent';

export const LINK_TARGETS: readonly string[] = ['_blank', '_self'] as const;
// NOT authored into app-config.json (BEX-290) — `brevo app upload` injects this value
// into an actionLink's upload payload, and `brevo app create` never writes it. Sent
// explicitly rather than left to a default, so the payload is unambiguous.
export const DEFAULT_LINK_TARGET = '_blank';

/**
 * The only link_target uploads accept today. `_self` is refused server-side even though
 * both the platform and the UI kit handle it, so the CLI writes `_blank` unconditionally
 * rather than prompting for a choice one of whose options would 400.
 *
 * To restore the choice: widen this back to LINK_TARGETS and re-add the prompt, in step
 * with the server relaxing its own check.
 */
export const UPLOADABLE_LINK_TARGETS: readonly string[] = [DEFAULT_LINK_TARGET] as const;

export const BREVO_DASHBOARD_API_KEYS_URL = 'https://app.brevo.com/settings/keys/api';
export const BREVO_API_KEY_DOCS_URL = 'https://developers.brevo.com/docs/api-key-authentication';
export const BREVO_STATUS_URL = 'https://status.brevo.com';
export const BREVO_DOCS_URL = 'https://developers.brevo.com';
export const BREVO_CLI_REFERENCE_URL = 'https://developers.brevo.com/docs/cli-reference';
export const BREVO_OAUTH_SCOPES_DOCS_URL =
  'https://developers.brevo.com/docs/oauth-scopes#scope-catalog';
