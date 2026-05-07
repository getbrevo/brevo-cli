import inquirer from 'inquirer';
import {
  isAuthenticated,
  hasAppCredentials,
  deleteCredentialsFile,
  countAppCredentials,
} from '../lib/config';
import { logSuccess, logInfo, logWarn } from '../lib/logger';
import { CliError } from '../lib/errors';
import { messages } from '../lang/en';
import { withCommandHandler } from '../lib/command-handler';
import { jsonOutput } from '../lib/json-output';

export const logoutCommand = withCommandHandler(
  async (options: { force?: boolean; json?: boolean }): Promise<void> => {
    if (!isAuthenticated()) {
      if (options.json) {
        jsonOutput({ loggedOut: false, reason: 'not_authenticated' });
      } else {
        logInfo(`\n  ${messages.AUTH_NOT_LOGGED_IN}\n`);
      }
      return;
    }

    if (!options.force && !options.json && hasAppCredentials()) {
      if (!process.stdin.isTTY) {
        throw new CliError(messages.AUTH_LOGOUT_NON_INTERACTIVE);
      }
      logWarn(messages.AUTH_LOGOUT_APP_WARNING);
      const { confirmed } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmed',
          message: messages.AUTH_LOGOUT_CONFIRM,
          default: false,
        },
      ]);

      if (!confirmed) {
        logInfo(`\n  ${messages.ABORTED}\n`);
        return;
      }
    }

    const appCount = countAppCredentials();
    deleteCredentialsFile();

    if (options.json) {
      jsonOutput({ loggedOut: true, appsCleared: appCount });
    } else if (appCount > 0) {
      logSuccess(messages.AUTH_LOGGED_OUT_WITH_APPS(appCount));
    } else {
      logSuccess(messages.AUTH_LOGGED_OUT);
    }
  },
);
