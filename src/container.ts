import { ApiClient } from './api/client';
import { DpFunctionsClient } from './api/dp-functions-client';
import { createAccountService, AccountService } from './services/account';
import { createAppService, AppService } from './services/app';
import { createDpFunctionsService, DpFunctionsService } from './services/dp-functions';
import { API_BASE, DP_FUNCTIONS_API_BASE } from './lib/constants';
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

// DP Functions — can be behind the main Brevo API gateway (production) or its
// own host (local dev). Reuses the same auth credentials (api-key or OAuth Bearer).
function buildDpAuthHeader(): Record<string, string> | undefined {
  if (process.env.DP_FUNCTIONS_API_KEY) {
    return { 'api-key': process.env.DP_FUNCTIONS_API_KEY };
  }
  return buildAuthHeader();
}

export const dpFunctionsClient = new DpFunctionsClient(DP_FUNCTIONS_API_BASE, buildDpAuthHeader);
export const dpFunctionsService: DpFunctionsService = createDpFunctionsService(dpFunctionsClient);
