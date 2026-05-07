import inquirer from 'inquirer';
import {
  saveCredentials,
  saveOauthCredentials,
  clearCredentials,
  getCredentialsPath,
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

    let apiKey = process.env.BREVO_API_KEY;

    let method: 'api-key' | 'browser';
    // Explicit `--browser` wins over BREVO_API_KEY so users can force the
    // browser flow on machines that have a stale env var. Browser login still
    // needs a TTY (the inquirer prompts after success), so reject early in
    // non-interactive contexts instead of hanging until timeout.
    if (options.browser) {
      if (!process.stdin.isTTY) {
        throw new CliError(messages.AUTH_BROWSER_NON_INTERACTIVE);
      }
      method = 'browser';
    } else if (apiKey) {
      method = 'api-key';
    } else if (!process.stdin.isTTY) {
      throw new CliError(messages.AUTH_BROWSER_NON_INTERACTIVE);
    } else {
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
      method = chosen;
    }

    let account: AccountResponse | undefined;

    if (method === 'api-key') {
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

      const spinner = createSpinner('Validating API key...', { silent: quiet });
      try {
        account = await accountService.validateApiKey(apiKey);
        spinner.stop();
      } catch (err) {
        spinner.stop();
        if (err instanceof ApiError && err.statusCode === 401) {
          logError(messages.AUTH_INVALID_KEY);
          if (!quiet) logInfo(`  ${messages.AUTH_GET_KEY_URL}`);
          if (!process.stdin.isTTY) {
            throw err;
          }
          const retryKey = await promptApiKey();
          const retrySpinner = createSpinner('Validating API key...', { silent: quiet });
          try {
            account = await accountService.validateApiKey(retryKey);
            retrySpinner.stop();
            apiKey = retryKey;
          } catch (retryErr) {
            retrySpinner.stop();
            if (retryErr instanceof ApiError && retryErr.statusCode === 401) {
              throw new CliError(messages.AUTH_INVALID_KEY, EXIT_CODES.AUTH_FAILURE);
            }
            throw retryErr;
          }
        } else {
          throw err;
        }
      }

      if (!account) {
        throw new CliError('Authentication failed.');
      }

      saveCredentials(apiKey, {
        email: account.email,
        organizationId: account.organization_id,
        userId: account.user_id,
      });
    } else {
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

      saveOauthCredentials(tokensToStore, {
        email: account.email,
        organizationId: account.organization_id,
        userId: account.user_id,
      });
    }

    if (options.json) {
      jsonOutput({ authenticated: true, email: account.email, company: account.companyName });
      return;
    }

    logSuccess(messages.AUTH_SUCCESS(account.email));
    logInfo(messages.AUTH_SAVED(getCredentialsPath()));

    if (!options.suppressNextSteps) {
      let apps: import('../types').OAuthApp[] = [];
      const appsSpinner = createSpinner('Checking your apps...');
      try {
        apps = await appService.fetchAppsList();
        appsSpinner.stop();
      } catch {
        appsSpinner.stop();
      }

      if (apps.length > 0) {
        printBox("What's next?", [
          CLI.APP_CREATE,
          CLI.APP_LIST,
          CLI.APP_SCAFFOLD(),
          CLI.APP_CREDENTIALS(),
        ]);
      } else if (!process.stdin.isTTY) {
        logInfo(`\n  ${messages.AUTH_NEXT}\n`);
      } else {
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
    }
  },
);
