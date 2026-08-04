import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { splitScopes } from './validators';

// ──────────────── Directory ────────────────

function getConfigDir(): string {
  return process.env.BREVO_CONFIG_HOME || path.join(os.homedir(), '.brevo');
}

export function getCredentialsPath(): string {
  return path.join(getConfigDir(), 'credentials.json');
}

function ensureDir(): void {
  fs.mkdirSync(getConfigDir(), { recursive: true, mode: 0o700 });
}

// ──────────────── Credentials (~/.brevo/credentials.json) ────────────────
// Stores sensitive secrets — API key and app client credentials.
// File permissions: 0o600 (owner read/write only).

export interface AppCredential {
  clientId: string;
  clientSecret: string;
}

// ──────────────── Auth (discriminated union) ────────────────

export type AuthCred =
  | { kind: 'api-key'; apiKey: string }
  | {
      kind: 'oauth';
      accessToken: string;
      refreshToken: string;
      expiresAt: number;
      tokenType: string;
      scope?: string;
    };

interface CachedAppName {
  name: string;
  savedAt: number;
}

// Cached names patch the eventually-consistent `app list` response. Beyond this
// window we trust the server, so any out-of-band rename (e.g. dashboard) becomes
// visible without forcing the user to run `app credentials`.
const APP_NAME_CACHE_TTL_MS = 10 * 60 * 1000;

interface BrevoCredentials {
  auth?: AuthCred;
  accountEmail?: string;
  organizationId?: string;
  userId?: number;
  apps: Record<string, AppCredential>;
  appNames?: Record<string, CachedAppName>;
}

function sanitizeAppNames(value: unknown): Record<string, CachedAppName> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const out: Record<string, CachedAppName> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'string' && raw.trim()) {
      // Legacy plain-string entry from earlier alphas — treat as expired so the
      // server response wins on the next list call.
      out[key] = { name: raw, savedAt: 0 };
    } else if (raw && typeof raw === 'object') {
      const entry = raw as Record<string, unknown>;
      if (
        typeof entry.name === 'string' &&
        entry.name.trim() &&
        typeof entry.savedAt === 'number' &&
        Number.isFinite(entry.savedAt)
      ) {
        out[key] = { name: entry.name, savedAt: entry.savedAt };
      }
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeApps(apps: Record<string, unknown>): Record<string, AppCredential> {
  const sanitized: Record<string, AppCredential> = {};
  for (const [key, value] of Object.entries(apps)) {
    if (value && typeof value === 'object') {
      const entry = value as Record<string, unknown>;
      if (typeof entry.clientId === 'string' && typeof entry.clientSecret === 'string') {
        sanitized[key] = { clientId: entry.clientId, clientSecret: entry.clientSecret };
      }
    }
  }
  return sanitized;
}

function readCredentials(): BrevoCredentials {
  try {
    const parsed = JSON.parse(fs.readFileSync(getCredentialsPath(), 'utf-8'));

    // Migrate old multi-profile format
    if (parsed.profiles) {
      const profileName =
        (typeof parsed.activeProfile === 'string' && parsed.activeProfile) || 'default';
      const firstKey = Object.keys(parsed.profiles)[0];
      const profile =
        parsed.profiles[profileName] ?? (firstKey ? parsed.profiles[firstKey] : undefined);
      const migrated: BrevoCredentials = {
        auth:
          typeof profile?.apiKey === 'string' && profile.apiKey
            ? { kind: 'api-key', apiKey: profile.apiKey }
            : undefined,
        accountEmail: profile?.accountEmail,
        organizationId: profile?.organizationId,
        userId: profile?.userId,
        apps: sanitizeApps(parsed.apps ?? {}),
      };
      try {
        writeCredentials(migrated);
      } catch {
        // non-fatal
      }
      return migrated;
    }

    // Migrate legacy flat { apiKey } shape → { auth: { kind: 'api-key' } }
    if (!parsed.auth && typeof parsed.apiKey === 'string' && parsed.apiKey) {
      const migrated: BrevoCredentials = {
        auth: { kind: 'api-key', apiKey: parsed.apiKey },
        accountEmail: parsed.accountEmail,
        organizationId: parsed.organizationId,
        userId: parsed.userId,
        apps: sanitizeApps(parsed.apps ?? {}),
      };
      try {
        writeCredentials(migrated);
      } catch {
        // non-fatal
      }
      return migrated;
    }

    return {
      auth: sanitizeAuth(parsed.auth),
      accountEmail: parsed.accountEmail,
      organizationId: parsed.organizationId,
      userId: parsed.userId,
      apps: sanitizeApps(parsed.apps ?? {}),
      appNames: sanitizeAppNames(parsed.appNames),
    };
  } catch {
    return { apps: {} };
  }
}

function sanitizeAuth(raw: unknown): AuthCred | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const v = raw as Record<string, unknown>;
  if (v.kind === 'api-key' && typeof v.apiKey === 'string' && v.apiKey) {
    return { kind: 'api-key', apiKey: v.apiKey };
  }
  if (
    v.kind === 'oauth' &&
    typeof v.accessToken === 'string' &&
    v.accessToken &&
    typeof v.refreshToken === 'string' &&
    v.refreshToken &&
    typeof v.tokenType === 'string' &&
    v.tokenType &&
    typeof v.expiresAt === 'number' &&
    Number.isFinite(v.expiresAt)
  ) {
    return {
      kind: 'oauth',
      accessToken: v.accessToken,
      refreshToken: v.refreshToken,
      expiresAt: v.expiresAt,
      tokenType: v.tokenType,
      scope: typeof v.scope === 'string' ? v.scope : undefined,
    };
  }
  return undefined;
}

function writeCredentials(creds: BrevoCredentials): void {
  ensureDir();
  const filePath = getCredentialsPath();
  fs.writeFileSync(filePath, JSON.stringify(creds, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // chmod may not work on all platforms (e.g. Windows) — ignore
  }
}

export function getApiKey(): string | undefined {
  if (process.env.BREVO_API_KEY) {
    return process.env.BREVO_API_KEY;
  }
  const auth = readCredentials().auth;
  return auth?.kind === 'api-key' ? auth.apiKey : undefined;
}

export function getAccessToken(): string | undefined {
  const auth = readCredentials().auth;
  return auth?.kind === 'oauth' ? auth.accessToken : undefined;
}

export function getAuthCred(): AuthCred | undefined {
  if (process.env.BREVO_API_KEY) {
    return { kind: 'api-key', apiKey: process.env.BREVO_API_KEY };
  }
  return readCredentials().auth;
}

export function getEmail(): string | undefined {
  return readCredentials().accountEmail;
}

export function getOrganizationId(): string | undefined {
  return readCredentials().organizationId;
}

export function getUserId(): number | undefined {
  return readCredentials().userId;
}

export function saveCredentials(
  apiKey: string,
  account: { email: string; organizationId: string; userId: number },
): void {
  const creds = readCredentials();
  creds.auth = { kind: 'api-key', apiKey };
  creds.accountEmail = account.email;
  creds.organizationId = account.organizationId;
  creds.userId = account.userId;
  writeCredentials(creds);
}

export interface OauthTokensToStore {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
  scope?: string;
}

export function saveOauthCredentials(
  tokens: OauthTokensToStore,
  account?: { email: string; organizationId: string; userId: number },
): void {
  const creds = readCredentials();
  creds.auth = {
    kind: 'oauth',
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: Date.now() + tokens.expiresIn * 1000,
    tokenType: tokens.tokenType,
    scope: tokens.scope,
  };
  // Account omitted = fresh token write before validation. Clear any stale
  // account info from a previous login so whoami doesn't surface mismatched data.
  if (account) {
    creds.accountEmail = account.email;
    creds.organizationId = account.organizationId;
    creds.userId = account.userId;
  } else {
    delete creds.accountEmail;
    delete creds.organizationId;
    delete creds.userId;
  }
  writeCredentials(creds);
}

export function updateOauthTokens(tokens: OauthTokensToStore): void {
  const creds = readCredentials();
  creds.auth = {
    kind: 'oauth',
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: Date.now() + tokens.expiresIn * 1000,
    tokenType: tokens.tokenType,
    scope: tokens.scope,
  };
  writeCredentials(creds);
}

export function clearCredentials(): void {
  const creds = readCredentials();
  delete creds.auth;
  delete creds.accountEmail;
  delete creds.organizationId;
  delete creds.userId;
  writeCredentials(creds);
}

export function deleteCredentialsFile(): void {
  try {
    fs.unlinkSync(getCredentialsPath());
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return;
    }
    throw error;
  }
}

export function hasAppCredentials(): boolean {
  return Object.keys(readCredentials().apps).length > 0;
}

export function countAppCredentials(): number {
  return Object.keys(readCredentials().apps).length;
}

export function isAuthenticated(): boolean {
  return !!getAuthCred();
}

export function saveAppCredentials(appId: string, cred: AppCredential): void {
  const creds = readCredentials();
  creds.apps[appId] = cred;
  writeCredentials(creds);
}

// Wipe the per-app credential and name caches without touching auth/account
// fields. Used when re-login detects a different account — the cached
// clientId/clientSecret values belong to apps the new account cannot see.
export function clearAppsCache(): void {
  const creds = readCredentials();
  creds.apps = {};
  delete creds.appNames;
  writeCredentials(creds);
}

export function getAppCredentials(appId: string): AppCredential | undefined {
  return readCredentials().apps[appId];
}

export function deleteAppCredentials(appId: string): void {
  if (!appId) return;
  const creds = readCredentials();
  if (!(appId in creds.apps)) return;
  delete creds.apps[appId];
  writeCredentials(creds);
}

// Locally cached app names mirror values from `app upload` and `app credentials`.
// Server-side, the PUT endpoint and the GET-list endpoint are eventually consistent,
// so `app list` can return a stale name immediately after an update. Merging this
// cache on top of the list response masks the lag. Entries expire after
// APP_NAME_CACHE_TTL_MS so they cannot indefinitely hide an out-of-band rename.
export function saveAppName(appId: string, name: string): void {
  if (!appId || !name) return;
  const creds = readCredentials();
  creds.appNames = {
    ...creds.appNames,
    [appId]: { name, savedAt: Date.now() },
  };
  writeCredentials(creds);
}

export function getAppNames(): Record<string, string> {
  const creds = readCredentials();
  const cache = creds.appNames ?? {};
  const now = Date.now();
  const fresh: Record<string, CachedAppName> = {};
  const result: Record<string, string> = {};
  let pruned = false;
  for (const [id, entry] of Object.entries(cache)) {
    if (now - entry.savedAt < APP_NAME_CACHE_TTL_MS) {
      fresh[id] = entry;
      result[id] = entry.name;
    } else {
      pruned = true;
    }
  }
  if (pruned) {
    creds.appNames = Object.keys(fresh).length > 0 ? fresh : undefined;
    try {
      writeCredentials(creds);
    } catch {
      // non-fatal — we've already returned the fresh subset to the caller
    }
  }
  return result;
}

export function deleteAppName(appId: string): void {
  if (!appId) return;
  const creds = readCredentials();
  if (!creds.appNames || !(appId in creds.appNames)) return;
  const { [appId]: _removed, ...rest } = creds.appNames;
  creds.appNames = Object.keys(rest).length > 0 ? rest : undefined;
  writeCredentials(creds);
}

// ──────────────── Local project config (app-config.json) ────────────────
// Written inside the scaffolded project folder by the scaffold template.
// Read by the CLI when run from within a project directory.

export interface ProjectConfig {
  appId: string;
  appName: string;
  version?: string;
  logoUri?: string;
  createdAt?: string;
  updatedAt?: string;
  /** Distribution type of the app: 'private' or 'public' */
  distribution_type: 'private' | 'public';
  auth: {
    scopes: string[];
    redirectUris?: string[];
  };
  permittedUrls: {
    fetch: string[];
    img: string[];
    iframe: string[];
    js: string[];
    css: string[];
  };
  support: {
    supportEmail: string;
    documentationUrl: string;
    supportUrl: string;
    supportPhone: string;
  };
}

const PROJECT_CONFIG_FILE = 'app-config.json';

export function readProjectConfig(): ProjectConfig | null {
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), PROJECT_CONFIG_FILE), 'utf-8'),
    );
    if (!raw || typeof raw !== 'object') return null;
    // Normalize appId at the boundary: accept strings (trimmed) and finite
    // numeric IDs from legacy configs, reject anything else. Downstream
    // callers can treat `config.appId` as a guaranteed non-empty string.
    const rawAppId = (raw as Record<string, unknown>).appId;
    let appId: string | undefined;
    if (typeof rawAppId === 'string') {
      const trimmed = rawAppId.trim();
      if (trimmed) appId = trimmed;
    } else if (typeof rawAppId === 'number' && Number.isFinite(rawAppId)) {
      appId = String(rawAppId);
    }
    if (!appId) return null;
    // Normalize auth.scopes silently — split on commas/whitespace so an entry
    // like "crm:read, campaigns:read" written by a user editing the JSON by
    // hand becomes two scopes. Strict charset validation is enforced later,
    // in the upload command, so unrelated commands that just happen to read
    // config aren't broken by a malformed scope.
    const rawAuth = (raw as Record<string, unknown>).auth;
    let authOverride: Record<string, unknown> | undefined;
    if (rawAuth && typeof rawAuth === 'object') {
      const scopes = (rawAuth as Record<string, unknown>).scopes;
      if (Array.isArray(scopes)) {
        authOverride = { ...rawAuth, scopes: splitScopes(scopes as string[]) };
      }
    }
    // Redirect URLs were renamed auth.redirectUrls → auth.redirectUris to track
    // the wire key (redirect_uris, BEX-355/366). Read the legacy key when the
    // new one is absent and drop it from the returned config, so callers that
    // write the object back to disk (upload.ts, start.ts) migrate old projects
    // on their next write. Downgrade caveat: older CLI releases read only the
    // legacy key, so a migrated file fails loudly there ("no redirect URLs"),
    // never silently.
    if (rawAuth && typeof rawAuth === 'object' && 'redirectUrls' in rawAuth) {
      authOverride = authOverride ?? { ...rawAuth };
      const legacyRedirects = (rawAuth as Record<string, unknown>).redirectUrls;
      if (!Array.isArray(authOverride.redirectUris) && Array.isArray(legacyRedirects)) {
        authOverride.redirectUris = legacyRedirects;
      }
      delete authOverride.redirectUrls;
    }
    // distribution_type has moved twice: originally a top-level `distribution`
    // key (still the shape of every currently-published scaffold), briefly
    // `auth.type` (an interim design that never shipped), now a top-level
    // `distribution_type` key. Backfill from whichever legacy shape is present,
    // preferring the new key when it already exists.
    const rawRecord = raw as Record<string, unknown>;
    const newDistributionType = rawRecord.distribution_type;
    const legacyAuthType =
      rawAuth && typeof rawAuth === 'object'
        ? (rawAuth as Record<string, unknown>).type
        : undefined;
    const legacyDistribution = rawRecord.distribution;
    let distributionType: 'private' | 'public' | undefined;
    if (typeof newDistributionType === 'string' && newDistributionType.trim()) {
      distributionType = newDistributionType.trim() as 'private' | 'public';
    } else if (typeof legacyAuthType === 'string' && legacyAuthType.trim()) {
      distributionType = legacyAuthType.trim() as 'private' | 'public';
    } else if (typeof legacyDistribution === 'string' && legacyDistribution.trim()) {
      distributionType = legacyDistribution.trim() as 'private' | 'public';
    } else {
      distributionType = 'private';
    }
    // Legacy auth.type is folded into distributionType above and dropped here
    // so it doesn't leak into authOverride.
    if (authOverride && 'type' in authOverride) {
      delete authOverride.type;
    } else if (rawAuth && typeof rawAuth === 'object' && 'type' in rawAuth) {
      authOverride = { ...rawAuth };
      delete (authOverride as Record<string, unknown>).type;
    }
    // Drop the legacy top-level `distribution` key from the returned config —
    // it's already folded into distribution_type above. Callers that write
    // this object back to disk (upload.ts, start.ts) then naturally migrate
    // old projects to the new shape on their next write, instead of
    // round-tripping the stray key forever.
    const { distribution: _legacyDistribution, ...rawWithoutLegacyDistribution } = rawRecord;
    return {
      ...rawWithoutLegacyDistribution,
      appId,
      distribution_type: distributionType,
      ...(authOverride ? { auth: authOverride } : {}),
    } as ProjectConfig;
  } catch {
    return null;
  }
}

export function hasLocalApp(): boolean {
  const cfg = readProjectConfig();
  return cfg?.appId != null && cfg.appId !== '';
}

export function writeProjectConfig(config: ProjectConfig): void {
  const configPath = path.resolve(process.cwd(), PROJECT_CONFIG_FILE);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Converge a legacy `app-config.json` in the current directory toward the
 * current config shape by backfilling fields that were absent when it was
 * scaffolded — mirroring the migration `brevo app upload` already performs, but
 * from a read-only command (`brevo app credentials`) so projects that are never
 * uploaded still catch up.
 *
 * Backfill is strictly fill-when-missing: a field the file already carries (in
 * any historical shape) is never overwritten with the server's value, even when
 * they differ. Guarded by an appId match so it only ever touches the config for
 * the app the caller actually resolved.
 *
 * @returns the names of the fields written (`'version'`, `'distribution_type'`),
 *          or `[]` when there is no matching local config or nothing was missing
 *          (in which case the file is left byte-for-byte untouched).
 */
export function backfillProjectConfigFromServer(
  appId: string,
  server: { version?: string; distribution_type?: 'public' | 'private' },
): string[] {
  const configPath = path.resolve(process.cwd(), PROJECT_CONFIG_FILE);
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    return [];
  }
  if (!raw || typeof raw !== 'object') return [];

  const normalized = readProjectConfig();
  if (!normalized || normalized.appId !== appId) return [];

  const rawRecord = raw as Record<string, unknown>;
  const backfilled: string[] = [];
  const next: ProjectConfig = { ...normalized };

  // `version` is optional: only backfill when the file lacks a usable value and
  // the server actually returned one.
  if (!isNonEmptyString(rawRecord.version) && isNonEmptyString(server.version)) {
    next.version = server.version;
    backfilled.push('version');
  }

  // `distribution_type` is required in the current shape. It is "missing" only
  // when none of its historical carriers is present on disk (new top-level key,
  // the oldest top-level `distribution`, or the interim `auth.type`). When
  // missing, prefer the server's value, falling back to the normalized default.
  const rawAuth = rawRecord.auth;
  const legacyAuthType =
    rawAuth && typeof rawAuth === 'object' ? (rawAuth as Record<string, unknown>).type : undefined;
  const hasDistribution =
    isNonEmptyString(rawRecord.distribution_type) ||
    isNonEmptyString(rawRecord.distribution) ||
    isNonEmptyString(legacyAuthType);
  if (!hasDistribution) {
    next.distribution_type = server.distribution_type ?? normalized.distribution_type;
    backfilled.push('distribution_type');
  }

  if (backfilled.length === 0) return [];
  writeProjectConfig(next);
  return backfilled;
}
