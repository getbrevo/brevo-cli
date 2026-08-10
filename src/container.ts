import { ApiClient } from './api/client';
import { createAccountService, AccountService } from './services/account';
import { createAppService, AppService } from './services/app';
import { fetchCliInfo } from './services/cli-info';
import { API_BASE } from './lib/constants';
import { CLI_NAME, CLI_VERSION } from './lib/cli-version';
import { getCliOs } from './lib/telemetry';
import { createVersionGate, VersionGate } from './lib/version-notice';
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

/**
 * Version gate — seeded from the cached verdict at module init (sync, no
 * network) so a known-unsupported CLI stops before any command runs, then
 * refreshed from the headers on every live response.
 */
export const versionGate: VersionGate = createVersionGate({
  cliVersion: CLI_VERSION,
  pkgName: CLI_NAME,
  argv: process.argv,
  os: getCliOs(),
  fetchNotice: (query) => fetchCliInfo(query, { baseUrl: API_BASE }),
});

export const client = new ApiClient({
  baseUrl: API_BASE,
  getAuthHeader: buildAuthHeader,
  onVersionSignal: (signal) => versionGate.record(signal),
});

export const accountService: AccountService = createAccountService(client);
export const appService: AppService = createAppService(client);
