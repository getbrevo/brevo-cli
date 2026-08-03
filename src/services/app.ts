import inquirer from 'inquirer';
import { ApiClient } from '../api/client';
import { CLI_VERSION } from '../lib/cli-version';
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
  UploadAppPayload,
  UploadAppResponse,
} from '../types';
import { getAppCredentials, saveAppCredentials } from '../lib/config';
import { normalizeAppId } from './normalize-app-id';

function rethrowNotFound(err: unknown, appId: string): never {
  if (err instanceof ApiError && err.statusCode === 404) {
    throw new CliError(`App ${appId} not found.`, err.exitCode);
  }
  throw err;
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
     */
    async resolveAppCredentials(appId: string): Promise<{ app: OAuthApp; diffs: string[] } | null> {
      let raw: OAuthApp;
      try {
        raw = await client.get<OAuthApp>(ENDPOINTS.APP_STORE_APP(appId));
      } catch (err) {
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

    async createApp(payload: {
      name: string;
      distribution_type: 'public' | 'private';
      redirect_uris?: string[];
      scopes?: string[];
      logo_uri?: string;
    }): Promise<CreateAppResponse> {
      const raw = await client.post<CreateAppResponse>(ENDPOINTS.APP_STORE_APPS, {
        ...payload,
        source: 'cli',
        cli_version: CLI_VERSION,
      });
      return normalizeAppId(raw);
    },

    async updateApp(
      appId: string,
      body: { name?: string; redirect_uris: string[]; scopes?: string[]; logo_uri?: string },
    ): Promise<void> {
      await client.patch(ENDPOINTS.APP_STORE_APP(appId), {
        ...body,
        cli_version: CLI_VERSION,
      });
    },

    async uploadApp(appId: string, payload: UploadAppPayload): Promise<UploadAppResponse> {
      return client.post<UploadAppResponse>(ENDPOINTS.APP_STORE_APP_UPLOAD(appId), {
        ...payload,
        cli_version: CLI_VERSION,
      });
    },

    async deleteApp(appId: string): Promise<void> {
      try {
        await client.delete(ENDPOINTS.APP_STORE_APP(appId));
      } catch (err) {
        rethrowNotFound(err, appId);
      }
    },

    /**
     * Make a UI app available in a single Brevo account (BEX-290).
     *
     * ⚠️ ASSUMED CONTRACT — `account_id` in the body, path from
     * ENDPOINTS.APP_STORE_APP_DEPLOY. Pending confirmation from the app-store
     * backend team; this and `undeployApp` are the only places to change.
     *
     * 404 becomes a friendly CliError; everything else (notably the "not yet
     * uploaded" rejection) propagates for the command to map.
     */
    async deployApp(appId: string, accountId: string): Promise<void> {
      try {
        await client.post(ENDPOINTS.APP_STORE_APP_DEPLOY(appId), { account_id: accountId });
      } catch (err) {
        rethrowNotFound(err, appId);
      }
    },

    /**
     * Withdraw a UI app's availability from a single account. Counterpart to
     * {@link deployApp}; same assumed contract caveat.
     */
    async undeployApp(appId: string, accountId: string): Promise<void> {
      try {
        await client.post(ENDPOINTS.APP_STORE_APP_UNDEPLOY(appId), { account_id: accountId });
      } catch (err) {
        rethrowNotFound(err, appId);
      }
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
