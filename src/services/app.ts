import inquirer from 'inquirer';
import { ApiClient } from '../api/client';
import { ENDPOINTS } from '../lib/constants';
import { ApiError, CliError } from '../lib/errors';
import { EXIT_CODES } from '../lib/exit-codes';
import { logInfo } from '../lib/logger';
import { createSpinner } from '../lib/ui';
import { messages } from '../lang/en';
import { OAuthApp, CreateAppResponse } from '../types';
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
    const apps = await client.get<OAuthApp[]>(ENDPOINTS.OAUTH_APPS);
    return (apps || []).map(normalizeAppId);
  }

  return {
    fetchAppsList,

    async fetchApp(appId: string): Promise<OAuthApp | null> {
      let app: OAuthApp;
      try {
        app = await client.get<OAuthApp>(ENDPOINTS.OAUTH_APP(appId));
      } catch (err) {
        rethrowNotFound(err, appId);
      }
      return app ? normalizeAppId(app) : null;
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
        raw = await client.get<OAuthApp>(ENDPOINTS.OAUTH_APP(appId));
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
      public: boolean;
      redirect_uris?: string[];
      scopes?: string[];
    }): Promise<CreateAppResponse> {
      const raw = await client.post<CreateAppResponse>(ENDPOINTS.OAUTH_APPS, {
        ...payload,
        source: 'cli',
      });
      return normalizeAppId(raw);
    },

    async updateApp(
      appId: string,
      body: { name?: string; redirect_uris: string[]; scopes?: string[] },
    ): Promise<void> {
      await client.put(ENDPOINTS.APP_STORE_APP_UPDATE(appId), body);
    },

    async deleteApp(appId: string): Promise<void> {
      try {
        await client.delete(ENDPOINTS.OAUTH_APP(appId));
      } catch (err) {
        rethrowNotFound(err, appId);
      }
    },
  };
}

export type AppService = ReturnType<typeof createAppService>;
