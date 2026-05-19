import inquirer from 'inquirer';
import { CLI, DEFAULT_PORT, DEFAULT_REDIRECT_URI, DEFAULT_SCOPES } from '../../lib/constants';
import { findAvailablePort } from '../../lib/port';
import { logSuccess, logInfo, logError } from '../../lib/logger';
import { messages } from '../../lang/en';
import { ApiError, CliError, ErrorCode } from '../../lib/errors';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { validateEnum, validateAppName } from '../../lib/validators';
import { printBox, createSpinner } from '../../lib/ui';
import { saveAppCredentials, saveAppName, hasLocalApp, readProjectConfig } from '../../lib/config';
import { scaffoldCommand } from './scaffold';
import { appService } from '../../container';
import { CreateAppResponse } from '../../types';

export const createCommand = withCommandHandler(
  async (options: {
    name?: string;
    distribution?: string;
    redirectUri?: string[];
    json?: boolean;
  }): Promise<void> => {
    // 0. Check for existing app-config.json in current directory
    if (hasLocalApp()) {
      if (!process.stdin.isTTY) {
        throw new CliError(
          'An app is already linked in this directory (app-config.json). Use --force or run interactively.',
        );
      }
      const projectConfig = readProjectConfig();
      const linkedName = projectConfig?.appName || String(projectConfig?.appId);
      logInfo(`  App "${linkedName}" is already linked in this directory (app-config.json).`);

      const { proceed } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'proceed',
          message: 'Create a new app anyway?',
          default: false,
        },
      ]);

      if (!proceed) {
        logInfo(`\n  Use \`${CLI.APP_UPDATE}\` to modify the existing app.\n`);
        return;
      }
    }

    // 1. App name
    let appName = options.name;
    if (appName) {
      const nameCheck = validateAppName(appName);
      if (nameCheck !== true) throw new CliError(nameCheck);
    } else {
      const answer = await inquirer.prompt([
        {
          type: 'input',
          name: 'name',
          message: messages.APP_CREATE_NAME_PROMPT,
          validate: validateAppName,
        },
      ]);
      appName = answer.name;
    }

    // 2. Distribution type
    const VALID_DISTRIBUTIONS = ['private', 'public'] as const;
    let distribution = options.distribution;
    validateEnum(distribution, VALID_DISTRIBUTIONS, '--distribution');
    if (distribution === 'public') {
      throw new CliError(messages.APP_CREATE_PUBLIC_UNAVAILABLE);
    }
    if (!distribution) {
      const answer = await inquirer.prompt([
        {
          type: 'list',
          name: 'distribution',
          message: messages.APP_CREATE_TYPE_PROMPT,
          choices: [
            {
              name: 'Private  (Used exclusively by your organisation)',
              value: 'private',
            },
            {
              name: 'Public   (Distributed to end users or marketplace listings)',
              value: 'public',
              disabled: 'coming soon',
            },
          ],
        },
      ]);
      distribution = answer.distribution;
    }

    // 3. Redirect URI(s) — already validated by collectUrls parser when passed via flag
    let redirectUrls = options.redirectUri ?? [];
    if (redirectUrls.length === 0) {
      if (process.stdin.isTTY) {
        // Find an available port for the default redirect URL
        const availablePort = await findAvailablePort(DEFAULT_PORT);
        const defaultRedirect =
          availablePort == null || availablePort === DEFAULT_PORT
            ? DEFAULT_REDIRECT_URI
            : `http://localhost:${availablePort}/auth/callback`;
        if (!options.json) {
          if (availablePort == null) {
            logInfo(messages.APP_CREATE_PORT_SCAN_FAILED(DEFAULT_PORT));
          } else if (availablePort !== DEFAULT_PORT) {
            logInfo(messages.APP_CREATE_PORT_IN_USE(DEFAULT_PORT, availablePort));
          }
          logInfo(messages.APP_CREATE_REDIRECT_HINT(CLI.APP_START('oauth')));
        }

        const validateRedirectUrl = (input: string): true | string => {
          const trimmed = input.trim();
          if (!trimmed) return messages.APP_CREATE_REDIRECT_EMPTY;
          try {
            const parsed = new URL(trimmed);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
              return messages.APP_CREATE_REDIRECT_INVALID;
            }
            return true;
          } catch {
            return messages.APP_CREATE_REDIRECT_INVALID;
          }
        };

        const { redirectUrl: firstUrl } = await inquirer.prompt([
          {
            type: 'input',
            name: 'redirectUrl',
            message: messages.APP_CREATE_REDIRECT_PROMPT,
            default: defaultRedirect,
            validate: validateRedirectUrl,
          },
        ]);
        redirectUrls.push((firstUrl as string).trim());

        let addMore = true;
        while (addMore) {
          const { anotherRaw } = await inquirer.prompt([
            {
              type: 'input',
              name: 'anotherRaw',
              message: messages.APP_CREATE_REDIRECT_ANOTHER + ' (y/N)',
              default: 'n',
              validate: (input: string) => {
                const val = String(input).toLowerCase().trim();
                if (val === 'y' || val === 'yes' || val === 'n' || val === 'no' || val === '') {
                  return true;
                }
                return 'Please enter y or n';
              },
            },
          ]);
          const another = String(anotherRaw).toLowerCase().trim().startsWith('y');
          if (another) {
            const { nextUrl } = await inquirer.prompt([
              {
                type: 'input',
                name: 'nextUrl',
                message: messages.APP_CREATE_REDIRECT_PROMPT,
                validate: validateRedirectUrl,
              },
            ]);
            redirectUrls.push((nextUrl as string).trim());
          } else {
            addMore = false;
          }
        }
      } else {
        redirectUrls = [DEFAULT_REDIRECT_URI];
      }
    }

    // 4. Create the app
    const payload = {
      name: appName!,
      public: distribution === 'public',
      redirect_uris: redirectUrls,
      scopes: [...DEFAULT_SCOPES],
    };

    let result: CreateAppResponse;
    const spinner = createSpinner('Creating app...', { silent: options.json });
    try {
      result = await appService.createApp(payload);
      spinner.stop();
    } catch (err) {
      spinner.stop();
      if (err instanceof ApiError && err.errorCode === ErrorCode.APP_LIMIT_REACHED) {
        if (options.json) {
          jsonOutput({ error: 'APP_LIMIT_REACHED', message: messages.APP_CREATE_LIMIT_REACHED });
        }
        throw new CliError(messages.APP_CREATE_LIMIT_REACHED);
      }
      if (err instanceof ApiError && err.statusCode === 409) {
        logError(messages.APP_CREATE_NAME_TAKEN);
        const retry = await inquirer.prompt([
          {
            type: 'input',
            name: 'name',
            message: messages.APP_CREATE_NAME_PROMPT,
            validate: validateAppName,
          },
        ]);
        const retrySpinner = createSpinner('Creating app...');
        try {
          result = await appService.createApp({
            name: retry.name,
            public: distribution === 'public',
            redirect_uris: redirectUrls,
            scopes: [...DEFAULT_SCOPES],
          });
          retrySpinner.stop();
          // Use the retried name for cache, JSON output, display, and scaffold prompt
          appName = retry.name;
        } catch (retryErr) {
          retrySpinner.stop();
          throw retryErr;
        }
      } else {
        throw err;
      }
    }

    // Store app credentials locally — client_secret may not be retrievable again
    saveAppCredentials(result.app_id, {
      clientId: result.client_id,
      clientSecret: result.client_secret,
    });
    if (appName) saveAppName(result.app_id, appName);

    const resultRedirectUris = result.redirect_uris;

    if (options.json) {
      jsonOutput({
        appId: result.app_id,
        appName,
        clientId: result.client_id,
        clientSecret: messages.CLIENT_SECRET_HIDDEN_JSON,
        redirectUri: resultRedirectUris,
      });
      return;
    }

    logSuccess(messages.APP_CREATE_SUCCESS);
    logInfo(`  App name:      ${appName}`);
    logInfo(`  App ID:        ${result.app_id}`);
    logInfo(`  Client ID:     ${result.client_id}`);
    logInfo(`  Client secret: ${messages.CLIENT_SECRET_HIDDEN_HUMAN}`);
    resultRedirectUris.forEach((uri, i) => {
      logInfo(`  Redirect URL ${i + 1}: ${uri}`);
    });
    logInfo(`  ${messages.APP_CREATE_SCOPE_NOTICE([...DEFAULT_SCOPES])}`);
    process.stdout.write('\n');

    // 4. Smart hand-off → scaffold
    const { shouldScaffold } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'shouldScaffold',
        message: messages.APP_CREATE_SCAFFOLD_PROMPT,
        default: true,
      },
    ]);

    if (shouldScaffold) {
      logInfo(`  ↳ Scaffolding "${appName}"...\n`);
      await scaffoldCommand({ appId: result.app_id });
    } else {
      printBox("What's next?", [
        CLI.APP_SCAFFOLD(result.app_id),
        CLI.APP_CREDENTIALS(result.app_id),
        CLI.APP_LIST,
      ]);
    }
  },
);
