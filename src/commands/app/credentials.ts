import inquirer from 'inquirer';
import { logInfo, logWarn } from '../../lib/logger';
import { messages } from '../../lang/en';
import { CliError } from '../../lib/errors';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { appService } from '../../container';
import { createSpinner } from '../../lib/ui';
import { saveAppName, backfillProjectConfigFromServer } from '../../lib/config';
import { assertAppSelectionAllowed } from './select-app';
import { CLI } from '../../lib/constants';
import { assertCapability, resolveFromRecord, type Distribution } from '../../app-types';

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
  if (confirmed) {
    return {
      display: app.client_secret || messages.CLIENT_SECRET_NOT_AVAILABLE,
      revealed: true,
    };
  }
  return { display: messages.CLIENT_SECRET_HIDDEN_HUMAN, revealed: false };
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
  // Null, not [], on any app with no OAuth block — never iterate it directly.
  const redirectUris = app.redirect_uris ?? [];
  if (redirectUris.length > 0) {
    redirectUris.forEach((uri, i) => {
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
    if (!options.appId) {
      assertAppSelectionAllowed(CLI.APP_CREDENTIALS(), options.json);
    }
    const appId = options.appId ?? (await appService.pickApp(messages.APP_CREDENTIALS_SELECT));

    const spinner = createSpinner('Fetching credentials...', { silent: options.json });
    const result = await appService.resolveAppCredentials(appId);
    spinner.stop();
    if (!result) {
      throw new CliError(`App ${appId} not found.`);
    }
    const { app, diffs } = result;

    // A UI app has no OAuth material, so there is nothing to show — refuse
    // before any side effect (name cache, credential cache, config backfill)
    // rather than printing a blank credential form. The classifier's bias
    // (a record with no OAuth material reads as UI even without the ui_app
    // block) is right here for the same reason it is on install's gate: a
    // record with neither client_id nor callbacks has no credentials either way.
    const distribution: Distribution = app.distribution_type === 'public' ? 'public' : 'private';
    assertCapability(
      resolveFromRecord(app).id,
      distribution,
      'oauth-flow',
      messages.APP_CREDENTIALS_UI_APP(appId),
    );

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

    // Converge a legacy app-config.json toward the current shape: backfill any
    // version/distribution_type it was scaffolded without. Only touches the
    // file when it exists in cwd and its appId matches. Silent in every mode;
    // a one-line note is printed in human mode when something was written.
    const backfilled = backfillProjectConfigFromServer(appId, {
      version: app.version,
      distribution_type: app.distribution_type,
    });
    if (backfilled.length > 0 && !options.json) {
      logInfo(`  ${messages.APP_CREDENTIALS_CONFIG_BACKFILLED(backfilled)}\n`);
    }
  },
);
