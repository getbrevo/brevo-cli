import inquirer from 'inquirer';
import { logInfo, logWarn } from '../../lib/logger';
import { messages } from '../../lang/en';
import { CliError } from '../../lib/errors';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { appService } from '../../container';
import { createSpinner } from '../../lib/ui';
import { saveAppName } from '../../lib/config';

type AppDetails = Awaited<ReturnType<typeof appService.resolveAppCredentials>>;

async function resolveSecretReveal(
  revealRequested: boolean | undefined,
  app: NonNullable<AppDetails>['app'],
): Promise<{ display: string; revealed: boolean }> {
  if (!revealRequested) {
    return { display: messages.CLIENT_SECRET_HIDDEN_HUMAN, revealed: false };
  }
  if (!process.stdin.isTTY) {
    logInfo('  Secret not revealed in non-interactive mode. Use --reveal-secret in a terminal.');
    return { display: messages.CLIENT_SECRET_HIDDEN_HUMAN, revealed: false };
  }
  const { confirmed } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmed',
      message: messages.APP_CREDENTIALS_REVEAL_CONFIRM,
      default: false,
    },
  ]);
  if (!confirmed) {
    return { display: messages.CLIENT_SECRET_HIDDEN_HUMAN, revealed: false };
  }
  return {
    display: app.client_secret || messages.CLIENT_SECRET_NOT_AVAILABLE,
    revealed: true,
  };
}

function printCredentialsHuman(
  app: NonNullable<AppDetails>['app'],
  appId: string,
  secretDisplay: string,
): void {
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

async function reconcileLocalCache(
  appId: string,
  app: NonNullable<AppDetails>['app'],
  diffs: string[],
  jsonMode: boolean | undefined,
): Promise<void> {
  if (diffs.length === 0) {
    // First-time save (no local cache yet) is silent
    appService.syncAppCredentials(appId, app);
    return;
  }

  logWarn(`Local credentials for app ${appId} differ from server (${diffs.join(', ')}).`);

  if (!process.stdin.isTTY || jsonMode) {
    appService.syncAppCredentials(appId, app);
    return;
  }

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
}

export const credentialsCommand = withCommandHandler(
  async (options: { appId?: string; revealSecret?: boolean; json?: boolean }): Promise<void> => {
    const appId = options.appId ?? (await appService.pickApp(messages.APP_CREDENTIALS_SELECT));

    const spinner = createSpinner('Fetching credentials...', { silent: options.json });
    const result = await appService.resolveAppCredentials(appId);
    spinner.stop();
    if (!result) {
      throw new CliError(`App ${appId} not found.`);
    }
    const { app, diffs } = result;

    if (app.name) saveAppName(appId, app.name);

    const { display: secretDisplay, revealed: revealConfirmed } = await resolveSecretReveal(
      options.revealSecret,
      app,
    );

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
      printCredentialsHuman(app, appId, secretDisplay);
    }

    await reconcileLocalCache(appId, app, diffs, options.json);
  },
);
