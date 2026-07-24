import inquirer from 'inquirer';
import { logSuccess, logInfo } from '../../lib/logger';
import { messages } from '../../lang/en';
import { CLI } from '../../lib/constants';
import { ApiError, CliError } from '../../lib/errors';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { appService } from '../../container';
import { createSpinner } from '../../lib/ui';
import { readProjectConfig } from '../../lib/config';

// We need the full apps list to show a label in the confirmation prompt.
async function promptAppSelection(): Promise<{ appId: string; appLabel: string }> {
  const listSpinner = createSpinner('Fetching apps...');
  let apps;
  try {
    apps = await appService.fetchAppsList();
  } finally {
    listSpinner.stop();
  }
  if (apps.length === 0) {
    logInfo(`\n  ${messages.APP_LIST_EMPTY}\n`);
    throw new CliError(messages.APP_LIST_EMPTY);
  }

  const { selectedApp } = await inquirer.prompt([
    {
      type: 'rawlist',
      name: 'selectedApp',
      message: 'Select an app to withdraw:',
      choices: apps.map((a) => ({
        name: `${a.name || 'App ' + a.app_id}  (App ID: ${a.app_id}, Client ID: ${a.client_id})`,
        value: a.app_id,
      })),
    },
  ]);
  const appId = selectedApp as string;
  const matched = apps.find((a) => a.app_id === appId);
  return { appId, appLabel: matched?.name || matched?.client_id || appId };
}

async function confirmWithdrawal(appLabel: string, appId: string): Promise<boolean> {
  const { confirmed } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmed',
      message: messages.APP_WITHDRAW_CONFIRM(appLabel, appId),
      default: false,
    },
  ]);

  if (!confirmed) {
    logInfo(`\n  ${messages.APP_WITHDRAW_CANCELLED}\n`);
    return false;
  }
  return true;
}

// The app was never submitted (HTTP 422). This is informational, not a failure:
// print a nudge to submit first and return normally so the process exits 0.
function reportNotSubmitted(appId: string, json?: boolean): void {
  if (json) {
    jsonOutput({
      withdrawn: false,
      appId,
      reason: 'NOT_SUBMITTED',
      message: messages.APP_WITHDRAW_NOT_SUBMITTED(appId),
      submitCommand: CLI.APP_SUBMIT(appId),
    });
    return;
  }
  logInfo(`\n  ${messages.APP_WITHDRAW_NOT_SUBMITTED(appId)}`);
  logInfo(`  ${messages.APP_WITHDRAW_SUBMIT_HINT(appId)}\n`);
}

export const withdrawCommand = withCommandHandler(
  async (options: { appId?: string; force?: boolean; json?: boolean }): Promise<void> => {
    let appId = options.appId;
    let appLabel = '';

    if (!appId) {
      // Resolve the target app: explicit flag > linked app-config.json > picker.
      // When run inside a scaffolded project directory, pin the app from
      // app-config.json automatically (matches `brevo app update` / `app start`).
      const projectConfig = readProjectConfig();
      if (projectConfig) {
        appId = projectConfig.appId;
        appLabel = projectConfig.appName || projectConfig.appId;
      } else {
        const selection = await promptAppSelection();
        appId = selection.appId;
        appLabel = selection.appLabel;
      }
    }

    if (!options.force && !(await confirmWithdrawal(appLabel || appId, appId))) {
      return;
    }

    const spinner = createSpinner('Withdrawing app...', { silent: options.json });
    try {
      await appService.withdrawApp(appId);
    } catch (err) {
      spinner.stop();
      if (err instanceof ApiError && err.statusCode === 422) {
        reportNotSubmitted(appId, options.json);
        return;
      }
      throw err;
    }
    spinner.stop();

    if (options.json) {
      jsonOutput({ withdrawn: true, appId });
      return;
    }

    logSuccess(messages.APP_WITHDRAW_SUCCESS(appId));
  },
);
