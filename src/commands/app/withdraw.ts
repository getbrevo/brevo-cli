import inquirer from 'inquirer';
import { logSuccess, logInfo } from '../../lib/logger';
import { messages } from '../../lang/en';
import { CLI } from '../../lib/constants';
import { ApiError } from '../../lib/errors';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { appService } from '../../container';
import { createSpinner } from '../../lib/ui';
import { readProjectConfig } from '../../lib/config';
import { assertAppSelectionAllowed, promptAppSelection } from './select-app';

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
        assertAppSelectionAllowed(CLI.APP_WITHDRAW(), options.json);
        const selection = await promptAppSelection(messages.APP_WITHDRAW_SELECT);
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
