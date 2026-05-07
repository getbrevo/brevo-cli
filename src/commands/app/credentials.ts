import inquirer from 'inquirer';
import { logInfo, logWarn } from '../../lib/logger';
import { messages } from '../../lang/en';
import { CliError } from '../../lib/errors';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { appService } from '../../container';
import { createSpinner } from '../../lib/ui';
import { saveAppName } from '../../lib/config';

export const credentialsCommand = withCommandHandler(
  async (options: { appId?: string; revealSecret?: boolean; json?: boolean }): Promise<void> => {
    let appId = options.appId;

    if (!appId) {
      appId = await appService.pickApp(messages.APP_CREDENTIALS_SELECT);
    }

    const spinner = createSpinner('Fetching credentials...', { silent: options.json });
    const result = await appService.resolveAppCredentials(appId);
    spinner.stop();
    if (!result) {
      throw new CliError(`App ${appId} not found.`);
    }
    const { app, diffs } = result;

    if (app.name) saveAppName(appId, app.name);

    let secretDisplay: string = messages.CLIENT_SECRET_HIDDEN_HUMAN;
    let revealConfirmed = false;

    if (options.revealSecret) {
      if (!process.stdin.isTTY) {
        // Non-interactive: auto-deny reveal to prevent secrets leaking into CI logs
        logInfo(
          '  Secret not revealed in non-interactive mode. Use --reveal-secret in a terminal.',
        );
      } else {
        const { confirmed } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirmed',
            message: messages.APP_CREDENTIALS_REVEAL_CONFIRM,
            default: false,
          },
        ]);

        if (confirmed) {
          revealConfirmed = true;
          secretDisplay = app.client_secret || messages.CLIENT_SECRET_NOT_AVAILABLE;
        }
      }
    }

    if (options.json) {
      jsonOutput({
        appName: app.name || null,
        appId,
        clientId: app.client_id,
        clientSecret: revealConfirmed
          ? (app.client_secret ?? messages.CLIENT_SECRET_NOT_AVAILABLE)
          : messages.CLIENT_SECRET_HIDDEN_JSON,
        scopes: app.scopes || [],
        redirectUris: app.redirect_uris ?? [],
      });
    } else {
      logInfo(`\n  App name:      ${app.name || '—'}`);
      logInfo(`  App ID:        ${appId}`);
      logInfo(`  Client ID:     ${app.client_id}`);
      logInfo(`  Client secret: ${secretDisplay}`);
      if (app.scopes && app.scopes.length > 0) {
        logInfo(`  Scopes:        ${app.scopes.join(', ')}`);
      } else {
        logInfo(`  Scopes:        (none)`);
      }
      if (app.redirect_uris.length > 0) {
        app.redirect_uris.forEach((uri, i) => {
          logInfo(`  Redirect URL ${i + 1}: ${uri}`);
        });
      } else {
        logInfo(`  Redirect URLs: (none)`);
      }
      process.stdout.write('\n');
    }

    // After displaying credentials, warn if local cache differs and prompt to update
    if (diffs.length > 0) {
      logWarn(`Local credentials for app ${appId} differ from server (${diffs.join(', ')}).`);

      if (process.stdin.isTTY && !options.json) {
        const { shouldUpdate } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'shouldUpdate',
            message: 'Update local credentials to match the server?',
            default: true,
          },
        ]);

        if (shouldUpdate) {
          appService.syncAppCredentials(appId, app);
          logInfo('  Local credentials updated.\n');
        }
      } else {
        // Non-interactive or JSON mode: auto-update silently
        appService.syncAppCredentials(appId, app);
      }
    } else {
      // No diffs — still save if this is the first time (no local cache yet)
      appService.syncAppCredentials(appId, app);
    }
  },
);
