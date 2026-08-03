import { logSuccess } from '../../lib/logger';
import { messages } from '../../lang/en';
import { ApiError, CliError } from '../../lib/errors';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { appService } from '../../container';
import { createSpinner } from '../../lib/ui';
import {
  assertUploadedBeforeDeploy,
  confirmDeployment,
  resolveDeploymentTarget,
} from './account-deployment';

interface DeployOptions {
  /** The `<account-id>` positional, folded in by the command definition. */
  accountId?: string;
  appId?: string;
  force?: boolean;
  json?: boolean;
}

/**
 * `brevo app deploy <account-id>` — make an app available in one Brevo account.
 *
 * Until an in-product enable/disable surface ships, this (with
 * `app undeploy`) is the only way a UI app becomes visible in an account.
 */
export const deployCommand = withCommandHandler(async (options: DeployOptions): Promise<void> => {
  const { appId, appLabel, accountId } = await resolveDeploymentTarget(
    options.accountId,
    options,
    messages.APP_DEPLOY_SELECT,
    messages.APP_DEPLOY_MISSING_ACCOUNT_ID,
  );

  assertUploadedBeforeDeploy();

  const proceed = await confirmDeployment(
    messages.APP_DEPLOY_CONFIRM(appLabel, appId, accountId),
    messages.APP_DEPLOY_CANCELLED,
    options,
  );
  if (!proceed) return;

  const spinner = createSpinner('Deploying app...', { silent: options.json });
  try {
    await appService.deployApp(appId, accountId);
  } catch (err) {
    spinner.stop();
    // The server is the authority on whether the config was validated. 422 is
    // its "not uploaded yet" rejection — surface the same actionable message
    // the local pre-flight uses rather than a raw API error.
    if (err instanceof ApiError && err.statusCode === 422) {
      throw new CliError(messages.APP_DEPLOY_NOT_UPLOADED, err.exitCode);
    }
    throw err;
  }
  spinner.stop();

  if (options.json) {
    jsonOutput({ deployed: true, appId, accountId });
    return;
  }

  logSuccess(messages.APP_DEPLOY_SUCCESS(appId, accountId));
});
