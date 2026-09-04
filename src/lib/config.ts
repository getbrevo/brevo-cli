import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { splitScopes } from './validators';
import { OAuthApp, UiApp } from '../types';
import { isUiAppConfigShape, isUiAppRecordShape } from '../app-types/ui/detect';

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
  /**
   * OAuth apps carry `{ scopes, redirectUris }`. UI apps carry exactly the
   * empty object `{}` — no scopes, no redirect URIs, no jwtSecret (nothing is
   * issued for them today). Enforced in `app upload` (see validateAuthShape),
   * not here, so unrelated commands that merely read config keep working on a
   * half-edited file.
   *
   * Caution: an `auth.type` key existed twice historically — briefly as an
   * *interim distribution* carrier ('private' | 'public'), then as the UI-app
   * marker `'none'`. The read path folds distribution values into
   * `distribution_type` and drops every `type`, so dev-era configs migrate to
   * the empty shape on their next write.
   */
  auth: {
    scopes?: string[];
    // Absent for UI apps: an action link has no OAuth callback to register.
    // OAuth apps still require at least one (enforced in `app upload`).
    redirectUris?: string[];
  };
  /** Explicit app type: 'oauth', 'ui', or 'function'. */
  app_type?: 'oauth' | 'ui' | 'function';
  /**
   * Present only for UI apps (BEX-290). Its presence is the discriminator
   * between the two app types — there is no separate `appType` key, matching
   * the UIApp Support Spec's config examples. Use {@link isUiAppConfig}
   * rather than testing for the key directly.
   */
  ui_app?: UiApp;
}

const PROJECT_CONFIG_FILE = 'app-config.json';

export function readProjectConfig(): ProjectConfig | null {
  return readProjectConfigAt(process.cwd());
}

/**
 * Normalize appId at the boundary: accept strings (trimmed) and finite numeric IDs from
 * legacy configs, reject anything else. Downstream callers can treat `config.appId` as a
 * guaranteed non-empty string.
 *
 * Returning `undefined` is what makes "has a file called app-config.json" and "is a
 * project" different questions — see {@link readProjectConfigAt}.
 */
function readNormalizedAppId(raw: Record<string, unknown>): string | undefined {
  const rawAppId = raw.appId;
  if (typeof rawAppId === 'string') {
    return rawAppId.trim() || undefined;
  }
  if (typeof rawAppId === 'number' && Number.isFinite(rawAppId)) {
    return String(rawAppId);
  }
  return undefined;
}

/**
 * Normalize the `auth` block, or `undefined` to leave the file's own block untouched.
 *
 * Three migrations, applied in order to one copy of the block.
 */
function buildAuthOverride(rawAuth: unknown): Record<string, unknown> | undefined {
  if (!rawAuth || typeof rawAuth !== 'object') return undefined;
  const auth = rawAuth as Record<string, unknown>;
  let override: Record<string, unknown> | undefined;

  // Normalize auth.scopes silently — split on commas/whitespace so an entry like
  // "crm:read, campaigns:read" written by a user editing the JSON by hand becomes two
  // scopes. Strict charset validation is enforced later, in the upload command, so
  // unrelated commands that just happen to read config aren't broken by a malformed scope.
  //
  // A bare string is accepted as well as an array: the field is typed string[], but a
  // hand-edited file can carry `"crm:read, crm:write"`, and `splitScopes` handles both.
  // Gating on Array.isArray alone let the string through unnormalized, and the upload
  // validator then iterated it one character at a time and rejected `":"` as a scope.
  const scopes = auth.scopes;
  if (Array.isArray(scopes) || typeof scopes === 'string') {
    override = { ...auth, scopes: splitScopes(scopes as string | string[]) };
  }

  // Redirect URLs were renamed auth.redirectUrls → auth.redirectUris to track the wire key
  // (redirect_uris, BEX-355/366). Read the legacy key when the new one is absent and drop
  // it from the returned config, so callers that write the object back to disk (upload.ts,
  // start.ts) migrate old projects on their next write.
  //
  // Downgrade caveat, and it is NOT a loud one: releases up to 2.0.2 read only the legacy
  // key, so a migrated file reads there as an app with no redirect URLs at all. `app start
  // oauth` then offers to register `http://localhost:<port>/auth/callback` (confirm prompt,
  // default yes) and PATCHes `redirect_uris` with just that one URL — the old write path
  // replaces the list rather than merging it, so the app's real redirect URLs are dropped
  // server-side with no error. Only reachable when a new and an old CLI share one project
  // directory (a teammate or CI left behind); a downgrade caveat, not a same-machine one.
  if ('redirectUrls' in auth) {
    override = override ?? { ...auth };
    const legacyRedirects = auth.redirectUrls;
    if (!Array.isArray(override.redirectUris) && Array.isArray(legacyRedirects)) {
      override.redirectUris = legacyRedirects;
    }
    delete override.redirectUrls;
  }

  // Legacy auth.type is always dropped: the interim distribution carrier
  // ('private'/'public') is folded into distribution_type by `readDistributionType`, and
  // the dev-era UI-app marker 'none' is obsolete — a UI app's auth is now the empty object
  // `{}` (the `ui_app` block alone discriminates the app type). Callers that write the
  // config back to disk migrate old files on their next write.
  if (override && 'type' in override) {
    delete override.type;
  } else if ('type' in auth) {
    override = { ...auth };
    delete override.type;
  }

  return override;
}

/**
 * distribution_type has moved twice: originally a top-level `distribution` key (still the
 * shape of every currently-published scaffold), briefly `auth.type` (an interim design that
 * never shipped), now a top-level `distribution_type` key. Backfill from whichever legacy
 * shape is present, preferring the new key when it already exists.
 */
function readDistributionType(
  rawRecord: Record<string, unknown>,
  rawAuth: unknown,
): 'private' | 'public' {
  const newDistributionType = rawRecord.distribution_type;
  if (typeof newDistributionType === 'string' && newDistributionType.trim()) {
    return newDistributionType.trim() as 'private' | 'public';
  }

  const legacyAuthType =
    rawAuth && typeof rawAuth === 'object' ? (rawAuth as Record<string, unknown>).type : undefined;
  if (
    typeof legacyAuthType === 'string' &&
    legacyAuthType.trim() &&
    legacyAuthType !== 'none' // 'none' is the UI-app auth marker, not a distribution
  ) {
    return legacyAuthType.trim() as 'private' | 'public';
  }

  const legacyDistribution = rawRecord.distribution;
  if (typeof legacyDistribution === 'string' && legacyDistribution.trim()) {
    return legacyDistribution.trim() as 'private' | 'public';
  }

  return 'private';
}

/**
 * `readProjectConfig` for an arbitrary directory.
 *
 * Exists for {@link findEnclosingProjectDir}, which has to ask the same "is this a
 * project?" question of a directory that is not cwd. Kept as the one implementation
 * rather than a second parser so an ancestor is judged a project by exactly the rules
 * every command already applies to cwd — most importantly the appId normalization
 * in {@link readNormalizedAppId}, which is what makes "has a file called
 * app-config.json" and "is a project" different questions.
 */
export function readProjectConfigAt(dir: string): ProjectConfig | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.resolve(dir, PROJECT_CONFIG_FILE), 'utf-8'));
    if (!raw || typeof raw !== 'object') return null;
    const rawRecord = raw as Record<string, unknown>;

    const appId = readNormalizedAppId(rawRecord);
    if (!appId) return null;

    // `auth` normalization and the distribution backfill are independent: the backfill
    // reads the RAW auth block, never the normalized one, so neither can see the other's
    // work and the order between them does not matter.
    const rawAuth = rawRecord.auth;
    const authOverride = buildAuthOverride(rawAuth);
    const distributionType = readDistributionType(rawRecord, rawAuth);

    // Drop the legacy top-level `distribution` key from the returned config —
    // it's already folded into distribution_type above. `permittedUrls` and
    // `support` were scaffolded into every config but never read by anything;
    // they're dropped the same way. Callers that write this object back to
    // disk (upload.ts, start.ts) then naturally migrate old projects to the
    // new shape on their next write, instead of round-tripping stray keys
    // forever.
    const {
      distribution: _legacyDistribution,
      permittedUrls: _permittedUrls,
      support: _support,
      ...rawWithoutLegacyDistribution
    } = rawRecord;
    // `ui_app` (BEX-290) is passed through structurally intact — the spread
    // above already carries it — but a non-object value is dropped so callers
    // can trust `config.ui_app` is an object whenever it is present. Field-level
    // validation is deliberately *not* done here: unrelated commands that merely
    // read the config must not fail because the block is half-written. `app
    // upload` is the enforcement point (see validateUiApp).
    const rawUiApp = rawWithoutLegacyDistribution.ui_app;
    if ('ui_app' in rawWithoutLegacyDistribution && (!rawUiApp || typeof rawUiApp !== 'object')) {
      delete rawWithoutLegacyDistribution.ui_app;
    }
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

/**
 * The nearest ANCESTOR directory of cwd that is itself a project, or null.
 *
 * Guards `brevo app scaffold`'s no-config branch. `readProjectConfig` reads cwd and
 * deliberately does not walk up — every other command wants exactly that, because it
 * keeps "which app am I acting on" a property of the directory you are standing in.
 * But it means a directory one level inside a project looks identical to an empty
 * directory outside one, and the two must not get the same answer: offering to
 * materialize a project into `myapp/src/` would leave a second `app-config.json`
 * nested in the first, after which `app upload` from that directory pushes the wrong
 * app with no warning.
 *
 * cwd itself is excluded. The only caller has already established that cwd holds no
 * usable config, and counting cwd would make every ordinary in-project run report
 * itself as nested.
 *
 * Stops at the filesystem root. Unreadable or appId-less ancestors are skipped rather
 * than treated as a hit, so the walk agrees with `readProjectConfig` on what counts
 * as a project — a stray malformed file cannot wedge the command.
 */
export function findEnclosingProjectDir(): string | null {
  let dir = path.dirname(process.cwd());
  // `path.dirname('/') === '/'`, which is how the walk terminates. Compare against the
  // previous value rather than testing for a literal separator so this holds on Windows
  // drive roots too.
  for (;;) {
    if (readProjectConfigAt(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Whether a project config describes a UI app rather than an OAuth app.
 *
 * Thin re-export: the predicate itself lives in `src/app-types/ui/detect.ts`, beside the app
 * type it describes, so the registry and every command agree by construction. Kept exported
 * here because a good number of call sites (and their test mocks) already import it from this
 * module. See that file for why the logic must not live behind this one.
 */
export function isUiAppConfig(config: Pick<ProjectConfig, 'ui_app'> | null | undefined): boolean {
  return isUiAppConfigShape(config);
}

/**
 * Whether a *server* app record describes a UI app. The record counterpart to
 * {@link isUiAppConfig}, and the same thin re-export — see `app-types/ui/detect.ts` for the
 * fallback it applies and why it requires both an empty client_id and no callbacks.
 */
export function isUiAppRecord(
  app: Pick<OAuthApp, 'ui_app' | 'client_id' | 'redirect_uris'> | null | undefined,
): boolean {
  return isUiAppRecordShape(app);
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
  if (normalized?.appId !== appId) return [];

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
    // auth.type carried the distribution only in its interim shape — 'none'
    // was the dev-era UI-app auth marker and says nothing about distribution.
    (isNonEmptyString(legacyAuthType) && legacyAuthType !== 'none');
  if (!hasDistribution) {
    next.distribution_type = server.distribution_type ?? normalized.distribution_type;
    backfilled.push('distribution_type');
  }

  if (backfilled.length === 0) return [];
  writeProjectConfig(next);
  return backfilled;
}
