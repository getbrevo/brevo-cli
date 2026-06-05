import inquirer from 'inquirer';
import {
  saveCredentials,
  saveOauthCredentials,
  clearCredentials,
  getCredentialsPath,
  getOrganizationId,
  clearAppsCache,
} from '../lib/config';
import {
  CLI,
  BREVO_DASHBOARD_API_KEYS_URL,
  BREVO_API_KEY_DOCS_URL,
  ENDPOINTS,
  OAUTH_PROXY_URL,
} from '../lib/constants';
import { openBrowser } from '../lib/browser';
import { logSuccess, logInfo, logError } from '../lib/logger';
import { messages } from '../lang/en';
import { CliError, ApiError } from '../lib/errors';
import { EXIT_CODES } from '../lib/exit-codes';
import { withCommandHandler } from '../lib/command-handler';
import { createCommand } from './app/create';
import { appService, accountService, client } from '../container';
import { printBox, createSpinner } from '../lib/ui';
import { jsonOutput } from '../lib/json-output';
import { AccountResponse } from '../types';
import { runBrowserLoginFlow } from '../services/browser-auth';

// On re-login, the cached per-app clientId/clientSecret values belong to apps
// owned by the previously-authenticated organization. A new organization cannot
// see those apps, so keeping the cache risks surfacing stale or wrong-account
// secrets. Same organization → keep the cache to avoid an unnecessary refetch.
function wipeAppsCacheIfAccountChanged(newOrganizationId: string): void {
  const previousOrganizationId = getOrganizationId();
  if (previousOrganizationId && previousOrganizationId !== newOrganizationId) {
    clearAppsCache();
  }
}

async function promptApiKey(): Promise<string> {
  const { key } = await inquirer.prompt([
    {
      type: 'password',
      name: 'key',
      message: messages.AUTH_PROMPT_API_KEY,
      mask: '*',
      validate: (input: string) => input.trim().length > 0 || 'API key cannot be empty',
    },
  ]);
  return key;
}

type LoginMethod = 'api-key' | 'browser';

// Explicit `--browser` wins over BREVO_API_KEY so users can force the
// browser flow on machines that have a stale env var. Browser login still
// needs a TTY (the inquirer prompts after success), so reject early in
// non-interactive contexts instead of hanging until timeout.
async function resolveLoginMethod(
  forceBrowser: boolean | undefined,
  apiKey: string | undefined,
): Promise<LoginMethod> {
  if (forceBrowser) {
    if (!process.stdin.isTTY) {
      throw new CliError(messages.AUTH_BROWSER_NON_INTERACTIVE);
    }
    return 'browser';
  }
  if (apiKey) {
    return 'api-key';
  }
  if (!process.stdin.isTTY) {
    throw new CliError(messages.AUTH_BROWSER_NON_INTERACTIVE);
  }
  const { chosen } = await inquirer.prompt([
    {
      type: 'list',
      name: 'chosen',
      message: messages.AUTH_PROMPT_METHOD,
      choices: [
        { name: 'Browser  (sign in through your browser)', value: 'browser' },
        { name: 'API key  (paste from your Brevo dashboard)', value: 'api-key' },
      ],
      default: 'browser',
    },
  ]);
  return chosen;
}

interface ValidatedKey {
  account: AccountResponse;
  apiKey: string;
}

// One interactive retry on a 401: the first paste is easy to fumble. A second
// 401 (or any other error) propagates to the command handler.
async function retryApiKeyValidation(quiet: boolean): Promise<ValidatedKey> {
  const retryKey = await promptApiKey();
  const retrySpinner = createSpinner('Validating API key...', { silent: quiet });
  try {
    const account = await accountService.validateApiKey(retryKey);
    retrySpinner.stop();
    return { account, apiKey: retryKey };
  } catch (retryErr) {
    retrySpinner.stop();
    if (retryErr instanceof ApiError && retryErr.statusCode === 401) {
      throw new CliError(messages.AUTH_INVALID_KEY, EXIT_CODES.AUTH_FAILURE);
    }
    throw retryErr;
  }
}

async function validateApiKeyWithRetry(apiKey: string, quiet: boolean): Promise<ValidatedKey> {
  const spinner = createSpinner('Validating API key...', { silent: quiet });
  try {
    const account = await accountService.validateApiKey(apiKey);
    spinner.stop();
    return { account, apiKey };
  } catch (err) {
    spinner.stop();
    if (!(err instanceof ApiError && err.statusCode === 401)) {
      throw err;
    }
    logError(messages.AUTH_INVALID_KEY);
    if (!quiet) logInfo(`  ${messages.AUTH_GET_KEY_URL}`);
    if (!process.stdin.isTTY) {
      throw err;
    }
    return retryApiKeyValidation(quiet);
  }
}

async function loginWithApiKey(
  envApiKey: string | undefined,
  quiet: boolean,
): Promise<AccountResponse> {
  let apiKey = envApiKey;
  if (!apiKey) {
    openBrowser(BREVO_DASHBOARD_API_KEYS_URL);
    if (!quiet) {
      process.stdout.write(
        messages.AUTH_HINT(BREVO_DASHBOARD_API_KEYS_URL, BREVO_API_KEY_DOCS_URL),
      );
    }
    apiKey = await promptApiKey();
  }
  if (!apiKey) {
    throw new CliError('No API key provided.');
  }

  const validated = await validateApiKeyWithRetry(apiKey, quiet);
  if (!validated.account) {
    throw new CliError('Authentication failed.');
  }

  wipeAppsCacheIfAccountChanged(validated.account.organization_id);

  saveCredentials(validated.apiKey, {
    email: validated.account.email,
    organizationId: validated.account.organization_id,
    userId: validated.account.user_id,
  });
  return validated.account;
}

async function loginWithBrowser(quiet: boolean): Promise<AccountResponse> {
  if (!quiet) logInfo(`  ${messages.AUTH_BROWSER_OPENING}`);
  const tokens = await runBrowserLoginFlow({
    proxyUrl: OAUTH_PROXY_URL,
    openBrowser,
    onWaiting: (url) => {
      if (quiet) return;
      logInfo(`  ${messages.AUTH_BROWSER_FALLBACK_URL(url)}`);
      logInfo(`  ${messages.AUTH_BROWSER_WAITING}`);
    },
  });

  // Persist tokens before validating /v3/account so transient API failures
  // (5xx, 424, network) don't force the user to redo the OAuth dance. Only
  // a 401 unambiguously means the token itself is bad — see catch below.
  const tokensToStore = {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn,
    tokenType: tokens.tokenType,
    scope: tokens.scope,
  };
  saveOauthCredentials(tokensToStore);
  if (!quiet) logSuccess(messages.AUTH_BROWSER_TOKENS_RECEIVED(getCredentialsPath()));

  const spinner = createSpinner('Finishing login...', { silent: quiet });
  let account: AccountResponse | undefined;
  try {
    account = await client.getWithBearer<AccountResponse>(
      ENDPOINTS.ACCOUNT,
      tokens.accessToken,
      tokens.tokenType,
    );
  } catch (err) {
    if (err instanceof ApiError && err.statusCode === 401) {
      clearCredentials();
    }
    throw err;
  } finally {
    spinner.stop();
  }

  if (!account) {
    throw new CliError('Authentication failed.');
  }

  wipeAppsCacheIfAccountChanged(account.organization_id);

  saveOauthCredentials(tokensToStore, {
    email: account.email,
    organizationId: account.organization_id,
    userId: account.user_id,
  });
  return account;
}

async function showNextSteps(): Promise<void> {
  let apps: import('../types').OAuthApp[] = [];
  const appsSpinner = createSpinner('Checking your apps...');
  try {
    apps = await appService.fetchAppsList();
  } catch {
    // Best-effort: the next-steps box is a nicety — login already succeeded.
  } finally {
    appsSpinner.stop();
  }

  if (apps.length > 0) {
    printBox("What's next?", [
      CLI.APP_CREATE,
      CLI.APP_LIST,
      CLI.APP_SCAFFOLD(),
      CLI.APP_CREDENTIALS(),
    ]);
    return;
  }
  if (!process.stdin.isTTY) {
    logInfo(`\n  ${messages.AUTH_NEXT}\n`);
    return;
  }

  process.stdout.write('\n');
  const { shouldCreate } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'shouldCreate',
      message: messages.AUTH_CREATE_APP_PROMPT,
      default: true,
    },
  ]);

  if (shouldCreate) {
    process.stdout.write('\n');
    await createCommand({});
    return;
  }

  logInfo(`\n  ${messages.AUTH_NEXT}\n`);
}

export const loginCommand = withCommandHandler(
  async (options: {
    browser?: boolean;
    json?: boolean;
    suppressNextSteps?: boolean;
  }): Promise<void> => {
    // In --json mode, stdout must be a single JSON document. Suppress the
    // welcome banner and every human-oriented log on stdout below; errors
    // still go to stderr via logError, which is fine for JSON consumers.
    const quiet = !!options.json;

    if (!quiet) {
      process.stdout.write(`\n  ${messages.AUTH_WELCOME}\n`);
      process.stdout.write('  ──────────────────────────────────────\n');
    }

    const apiKey = process.env.BREVO_API_KEY;
    const method = await resolveLoginMethod(options.browser, apiKey);

    const account =
      method === 'api-key' ? await loginWithApiKey(apiKey, quiet) : await loginWithBrowser(quiet);

    if (options.json) {
      jsonOutput({ authenticated: true, email: account.email, company: account.companyName });
      return;
    }

    logSuccess(messages.AUTH_SUCCESS(account.email));
    logInfo(messages.AUTH_SAVED(getCredentialsPath()));

    if (options.suppressNextSteps) return;

    await showNextSteps();
  },
);
