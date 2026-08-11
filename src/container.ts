import { ApiClient } from './api/client';
import { createAccountService, AccountService } from './services/account';
import { createAppService, AppService } from './services/app';
import { API_BASE } from './lib/constants';
import { getAuthCred } from './lib/config';

/**
 * Application container — creates and holds all shared instances.
 * Initialized once by bin/index.ts. Commands import services from here.
 *
 * The auth-failure handler is wired in bin/index.ts so it can branch on
 * stored auth kind (oauth: refresh+retry; api-key: prompt for new key)
 * without pulling UI/prompt concerns into the container.
 */

function buildAuthHeader(): Record<string, string> | undefined {
  const auth = getAuthCred();
  if (!auth) return undefined;
  if (auth.kind === 'api-key') return { 'api-key': auth.apiKey };
  return { Authorization: `${auth.tokenType} ${auth.accessToken}` };
}

export const client = new ApiClient({ baseUrl: API_BASE, getAuthHeader: buildAuthHeader });

export const accountService: AccountService = createAccountService(client);
export const appService: AppService = createAppService(client);
