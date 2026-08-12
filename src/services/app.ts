import inquirer from 'inquirer';
import { ApiClient } from '../api/client';
import { ENDPOINTS } from '../lib/constants';
import { ApiError, CliError } from '../lib/errors';
import { EXIT_CODES } from '../lib/exit-codes';
import { logInfo } from '../lib/logger';
import { createSpinner } from '../lib/ui';
import { messages } from '../lang/en';
import {
  OAuthApp,
  CreateAppResponse,
  AppStateResponse,
  RawSurfacePointRow,
  SurfacePointLocationsResponse,
  SurfacePointRow,
  SurfacePointsResponse,
  UiApp,
  UploadAppPayload,
  UploadAppResponse,
} from '../types';
import { getAppCredentials, getOrganizationId, saveAppCredentials } from '../lib/config';
import { normalizeAppId } from './normalize-app-id';

/** First of the candidates that is a non-blank string, trimmed; `undefined` if none is. */
function firstNonEmptyString(...candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return undefined;
}

/**
 * `{ key: value }` when the value is present, `{}` when it is not — so a row missing a
 * column stays missing rather than gaining an explicit `undefined`, which would survive
 * `JSON.stringify` differently and show up in the upload diff.
 */
function pick<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

function rethrowNotFound(err: unknown, appId: string): never {
  if (err instanceof ApiError && err.statusCode === 404) {
    throw new CliError(`App ${appId} not found.`, err.exitCode);
  }
  throw err;
}

/**
 * An account identifier as a number, or `undefined` when it is not one.
 *
 * Brevo identifies accounts two different ways depending on where the value came
 * from — a sub-account listing yields an integer `id`, while `organization_id` may be
 * a UUID — but **both body fields on the installs resource are Go `int64`**, and the
 * handler decodes the body *before* it consults anything else. A UUID in either field
 * is therefore a decode failure: HTTP 400, whole request lost.
 *
 * So a non-numeric identifier is dropped from the payload rather than sent. Omission
 * is not a loss of information, because the server has a better answer for each field
 * than the CLI does — see {@link buildInstallPayload}. What must never happen is
 * `Number()` on everything: `Number('550e8400-…')` is `NaN`, which `JSON.stringify`
 * emits as `null`, and `null` is a decode failure too.
 */
function toNumericIdentifier(value: string | undefined): number | undefined {
  const trimmed = value?.trim();
  return trimmed && /^\d+$/.test(trimmed) ? Number(trimmed) : undefined;
}

/**
 * The caller's own account identifier, as a display/target string.
 *
 * Unlike the wire fields this keeps a UUID intact — it is what `app deploy` labels the
 * target with and what a plain account resolves to when no `[account-id]` was given.
 * Only an absent or blank value throws, since that means the credentials carry no
 * account at all and re-authenticating is the fix.
 */
export function getCallerAccountId(): string {
  const organizationId = getOrganizationId()?.trim();
  if (!organizationId) {
    throw new CliError(messages.APP_DEPLOY_MISSING_CLIENT_ID);
  }
  return organizationId;
}

/**
 * Body shared by both verbs on the app-store installs resource (BEX-290).
 *
 * Both identifiers are **optional on the wire, and deliberately so** — the server
 * resolves each one better than the CLI can when it is absent:
 *
 * - `client_id` is the caller, the account that owns the app, which the server
 *   resolves it against via `FindIDByUUID(uuid, client_id)`. The handler reads the
 *   `X-Sib-Client-Id` header *first* and only falls back to this field, and the API
 *   gateway populates that header from the api-key/bearer credential the CLI already
 *   sends. So this is a fallback for a header that is normally there — worth sending
 *   when it is a number, never worth a 400 when it isn't.
 * - `deploy_client_id` is the target the install lands in, and the server defaults it
 *   to the caller when absent. That default is exactly right for a plain account
 *   deploying into itself, which is the only case that can produce a non-numeric value
 *   here (an explicit `[account-id]` is numeric by `parseAccountId`, and a sub-account
 *   `id` is numeric by construction).
 *
 * The two are not interchangeable: they differ whenever a corporate account deploys
 * into a sub-account, and collapsing them 404s the app lookup.
 */
function buildInstallPayload(accountId: string, name: string) {
  return {
    ...pick('client_id', toNumericIdentifier(getOrganizationId())),
    ...pick('deploy_client_id', toNumericIdentifier(accountId)),
    name,
    is_developer: true,
  };
}

/**
 * Check apps exist and throw with user-facing message if empty.
 */
function logEmptyAndThrow(): never {
  logInfo(`\n  ${messages.APP_LIST_EMPTY}\n`);
  throw new CliError(messages.APP_LIST_EMPTY, EXIT_CODES.ERROR);
}

export function createAppService(client: ApiClient) {
  async function fetchAppsList(): Promise<OAuthApp[]> {
    const apps = await client.get<OAuthApp[]>(ENDPOINTS.APP_STORE_APPS);
    return (apps || []).map(normalizeAppId);
  }

  return {
    fetchAppsList,

    /**
     * The record-page locations the registry offers, in server order (BEX-361).
     *
     * `GET .../surface-points/locations` answers with the distinct `location_name` values
     * and nothing else (`{ locations, count }`), which is exactly what `app create`'s
     * record-page prompt needs. Reading it beats pulling every row and reducing to the
     * same handful of strings: it is the registry's own answer to "which pages exist"
     * rather than the CLI's inference from whichever rows happened to come back, and it
     * doesn't make the page prompt wait on the full registry.
     *
     * Tolerates a bare array alongside the wrapped shape, and drops non-string, blank and
     * duplicate entries, so callers can trust every value they get.
     *
     * Errors propagate — the caller owns the actionable message, same as below.
     */
    async fetchSurfacePointLocations(): Promise<string[]> {
      const res = await client.get<SurfacePointLocationsResponse | string[] | null>(
        ENDPOINTS.APP_STORE_SURFACE_POINT_LOCATIONS,
      );
      const raw = Array.isArray(res) ? res : (res?.locations ?? []);
      const locations = new Set<string>();
      for (const entry of raw) {
        if (typeof entry !== 'string') continue;
        const name = entry.trim();
        if (name) locations.add(name);
      }
      return [...locations];
    },

    /**
     * Read the extension-point registry rows for UI-app slot authoring (BEX-361).
     *
     * `locations` narrows to the given `location_name` values (comma-separated on the
     * wire), which is how `app create` fetches the placements for the pages a partner
     * actually picked — the pages come from `fetchSurfacePointLocations` above. Omit it
     * for the whole registry, which the create flow only falls back to when the narrowed
     * read doesn't cover the picked pages.
     *
     * There is deliberately NO extension-type filter. Both extension types render on both
     * kinds, so filtering server-side would hide authorable placements; the create flow
     * checks each row's own `extension_type_list` instead.
     *
     * The backend route is specified (app-store-bo-be GET /cli/surface-points) but not
     * built yet; only the public /v3 mapping is assumed. See RELEASE-CHECKLIST.md → Before
     * UI-apps GA. Errors propagate — the caller owns the actionable message, since a 404
     * currently just means "endpoint not built".
     *
     * Normalization: rows are keyed on `extension_point_name`, falling back to the pre-BEX-361
     * `extension_point` spelling, and the three decomposed segments accept either naming
     * (see RawSurfacePointRow for why both are tolerated). Rows with no usable name are
     * dropped and duplicates deduped, so callers can trust every row's identity.
     */
    async fetchSurfacePoints(locations?: readonly string[]): Promise<SurfacePointRow[]> {
      const filter = (locations ?? []).map((l) => String(l).trim()).filter(Boolean);
      const query = filter.length ? `?location=${encodeURIComponent(filter.join(','))}` : '';
      const res = await client.get<SurfacePointsResponse | RawSurfacePointRow[] | null>(
        `${ENDPOINTS.APP_STORE_SURFACE_POINTS}${query}`,
      );
      const rows = Array.isArray(res) ? res : (res?.surface_points ?? []);
      const seen = new Set<string>();
      const normalized: SurfacePointRow[] = [];
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const name = firstNonEmptyString(row.extension_point_name, row.extension_point);
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const {
          extension_point: _legacyName,
          location: legacyLocation,
          place: legacyPlace,
          kind: legacyKind,
          supported_extension_types: legacySupportedTypes,
          ...rest
        } = row;
        normalized.push({
          ...rest,
          extension_point_name: name,
          ...pick('location_name', firstNonEmptyString(row.location_name, legacyLocation)),
          ...pick('section_name', firstNonEmptyString(row.section_name, legacyPlace)),
          ...pick('component_type', firstNonEmptyString(row.component_type, legacyKind)),
          ...((row.extension_type_list ?? legacySupportedTypes)
            ? { extension_type_list: row.extension_type_list ?? legacySupportedTypes }
            : {}),
        });
      }
      return normalized;
    },

    async fetchApp(appId: string): Promise<OAuthApp | null> {
      let app: OAuthApp;
      try {
        app = await client.get<OAuthApp>(ENDPOINTS.APP_STORE_APP(appId));
      } catch (err) {
        rethrowNotFound(err, appId);
      }
      return app ? normalizeAppId(app) : null;
    },

    /**
     * Canonical read of an app's review lifecycle state. This is the single
     * state-read path — `brevo app status` and, later, `submit` (BEX-251) and
     * `withdraw` (BEX-253) all go through here rather than querying separately.
     * Read-only; no mutation.
     */
    async fetchAppState(appId: string): Promise<AppStateResponse> {
      let res: AppStateResponse;
      try {
        res = await client.get<AppStateResponse>(ENDPOINTS.APP_STATE(appId));
      } catch (err) {
        rethrowNotFound(err, appId);
      }
      return res;
    },

    async pickApp(
      promptMessage: string,
      formatChoice?: (app: OAuthApp) => string,
    ): Promise<string> {
      const spinner = createSpinner('Loading apps...');
      const apps = await fetchAppsList();
      spinner.stop();
      if (apps.length === 0) {
        logEmptyAndThrow();
      }

      const { selectedApp } = await inquirer.prompt([
        {
          type: 'rawlist',
          name: 'selectedApp',
          message: promptMessage,
          choices: apps.map((a) => {
            const appName = a.name || 'App ' + a.app_id;
            return {
              name: formatChoice
                ? formatChoice(a)
                : `${appName}  (App ID: ${a.app_id}, Client ID: ${a.client_id})`,
              value: a.app_id,
            };
          }),
        },
      ]);
      return selectedApp as string;
    },

    /**
     * Fetch app from API and merge with local cache.
     * The GET endpoint may not return client_secret (only shown at creation),
     * so we fall back to the locally cached value.
     *
     * `tolerateMissing` turns a 404 into `null` instead of the friendly not-found
     * error. Only one caller wants that: `app create`'s read-back of the app it
     * just created, where a 404 means the server cannot resolve an ID it issued
     * itself moments earlier — see `fetchAppContext`'s `fallbackApp`. Every other
     * caller reads an ID the user supplied, where 404 genuinely means "wrong ID"
     * and must stay fatal.
     */
    async resolveAppCredentials(
      appId: string,
      opts?: { tolerateMissing?: boolean },
    ): Promise<{ app: OAuthApp; diffs: string[] } | null> {
      let raw: OAuthApp;
      try {
        raw = await client.get<OAuthApp>(ENDPOINTS.APP_STORE_APP(appId));
      } catch (err) {
        if (opts?.tolerateMissing && err instanceof ApiError && err.statusCode === 404) {
          return null;
        }
        rethrowNotFound(err, appId);
      }
      if (!raw) return null;
      const app = normalizeAppId(raw);

      const local = getAppCredentials(appId);
      const diffs: string[] = [];

      // Merge: prefer remote values, fall back to local cache for missing fields
      if (local) {
        if (!app.client_id && local.clientId) {
          app.client_id = local.clientId;
        } else if (local.clientId && local.clientId !== app.client_id) {
          diffs.push('client_id');
        }
        if (!app.client_secret && local.clientSecret) {
          app.client_secret = local.clientSecret;
        } else if (local.clientSecret && local.clientSecret !== app.client_secret) {
          diffs.push('client_secret');
        }
      }

      return { app, diffs };
    },

    /**
     * Save credentials to local cache.
     * Preserves existing local values when the app has missing fields
     * (e.g. GET endpoint doesn't return client_secret).
     */
    syncAppCredentials(appId: string, app: OAuthApp): void {
      const existing = getAppCredentials(appId);
      const clientId = app.client_id || existing?.clientId;
      const clientSecret = app.client_secret || existing?.clientSecret;
      // Only write if we have at least a client ID and a non-empty secret
      if (clientId && clientSecret) {
        saveAppCredentials(appId, { clientId, clientSecret });
      }
    },

    // The payload goes over the wire unchanged, for the same reason `uploadApp`
    // does: a top-level key outside the declared create contract is a key the
    // server can start rejecting. `source: 'cli'` used to be stamped here and was
    // removed — the backend derives the caller from the structured `User-Agent`
    // (`brevo-cli/...`, see telemetry.ts), so nothing is lost by not sending it.
    async createApp(payload: {
      name: string;
      distribution_type: 'public' | 'private';
      // OAuth fields travel inside `auth`, the same block the upload endpoint
      // takes (unified payload structure). Omitted entirely for UI apps.
      auth?: {
        scopes: string[];
        redirect_uris: string[];
      };
      // Sent for UI apps only, under the same key the upload endpoint takes and
      // the same key the block carries in app-config.json. It is the app-type
      // discriminator on the wire as well as locally: without it, create has no
      // way to know the app has no OAuth flow, and rejects the absent `auth`
      // block with `redirect_uris is required and must not be empty`.
      ui_app?: UiApp;
      logo_uri?: string;
    }): Promise<CreateAppResponse> {
      const raw = await client.post<CreateAppResponse>(ENDPOINTS.APP_STORE_APPS, payload);
      return normalizeAppId(raw);
    },

    // The payload goes over the wire unchanged: the upload endpoint rejects
    // unknown top-level keys with a 400, and the CLI version already reaches
    // the server on every request via the User-Agent header (see telemetry.ts).
    async uploadApp(appId: string, payload: UploadAppPayload): Promise<UploadAppResponse> {
      return client.post<UploadAppResponse>(ENDPOINTS.APP_STORE_APP_UPLOAD(appId), payload);
    },

    async deleteApp(appId: string): Promise<void> {
      try {
        await client.delete(ENDPOINTS.APP_STORE_APP(appId));
      } catch (err) {
        rethrowNotFound(err, appId);
      }
    },

    /**
     * Make a UI app available in a single Brevo account (BEX-290) by creating an
     * install on `POST /v3/app-store/apps/{id}/installs`.
     *
     * `deploy_client_id` is the numeric account ID — sent as a number, not the
     * string `parseAccountId` returns. `is_developer` is always true: every
     * install the CLI creates is a developer install by construction.
     *
     * 404 becomes a friendly CliError: on install there is only one thing to miss,
     * the app itself. Everything else (notably the "not yet uploaded" rejection)
     * propagates for the command to map.
     */
    async deployApp(appId: string, accountId: string, name: string): Promise<void> {
      try {
        await client.post(
          ENDPOINTS.APP_STORE_APP_INSTALLS(appId),
          buildInstallPayload(accountId, name),
        );
      } catch (err) {
        rethrowNotFound(err, appId);
      }
    },

    /**
     * Withdraw a UI app's availability from a single account — deletes the
     * install created by {@link deployApp}. Same resource, same body, DELETE.
     *
     * Deliberately no `rethrowNotFound` here, unlike every other verb. The developer
     * uninstall route (BEX-364) has no `installation_id` to delete by, so it resolves
     * the install from the same details the install was created with — and answers 404
     * for *both* "app doesn't exist" and "no such install", distinguishable only by the
     * error copy. Collapsing them into "App not found" would report a hard failure for
     * the ordinary already-rolled-back case, so the ApiError reaches the command intact
     * and `rollback` maps any 404 to its informational not-deployed path.
     */
    async rollbackApp(appId: string, accountId: string, name: string): Promise<void> {
      await client.delete(
        ENDPOINTS.APP_STORE_APP_INSTALLS(appId),
        buildInstallPayload(accountId, name),
      );
    },

    async withdrawApp(appId: string): Promise<void> {
      try {
        await client.post(ENDPOINTS.APP_STORE_APP_WITHDRAW(appId));
      } catch (err) {
        // 404 becomes a friendly CliError; everything else (including 422
        // "not submitted") propagates unchanged for the command to handle.
        rethrowNotFound(err, appId);
      }
    },
  };
}

export type AppService = ReturnType<typeof createAppService>;
