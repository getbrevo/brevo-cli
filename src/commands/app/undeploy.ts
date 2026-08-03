import { logSuccess, logInfo } from '../../lib/logger';
import { messages } from '../../lang/en';
import { ApiError } from '../../lib/errors';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { appService } from '../../container';
import { createSpinner } from '../../lib/ui';
import { confirmDeployment, resolveDeploymentTarget } from './account-deployment';

interface UndeployOptions {
  /** The `<account-id>` positional, folded in by the command definition. */
  accountId?: string;
  appId?: string;
  force?: boolean;
  json?: boolean;
}

/**
 * "Not deployed to this account" is informational, not a failure: the caller's
 * intent (the app is not in that account) already holds. Mirrors how
 * `app withdraw` treats a never-submitted app — report and exit 0 so
 * teardown scripts stay idempotent.
 */
function reportNotDeployed(appId: string, accountId: string, json?: boolean): void {
  if (json) {
    jsonOutput({
      undeployed: false,
      appId,
      accountId,
      reason: 'NOT_DEPLOYED',
      message: messages.APP_UNDEPLOY_NOT_DEPLOYED(appId, accountId),
    });
    return;
  }
  logInfo(`\n  ${messages.APP_UNDEPLOY_NOT_DEPLOYED(appId, accountId)}\n`);
}

/**
 * `brevo app undeploy <account-id>` — withdraw an app's availability from one
 * Brevo account. Counterpart to `app deploy`.
 */
export const undeployCommand = withCommandHandler(
  async (options: UndeployOptions): Promise<void> => {
    const { appId, appLabel, accountId } = await resolveDeploymentTarget(
      options.accountId,
      options,
      messages.APP_UNDEPLOY_SELECT,
      messages.APP_UNDEPLOY_MISSING_ACCOUNT_ID,
    );

    // Deliberately no upload gate here: undeploying is always safe, and blocking it
    // on an upload would strand an app deployed by an earlier CLI version.
    const proceed = await confirmDeployment(
      messages.APP_UNDEPLOY_CONFIRM(appLabel, appId, accountId),
      messages.APP_UNDEPLOY_CANCELLED,
      options,
    );
    if (!proceed) return;

    const spinner = createSpinner('Undeploying app...', { silent: options.json });
    try {
      await appService.undeployApp(appId, accountId);
    } catch (err) {
      spinner.stop();
      if (err instanceof ApiError && err.statusCode === 422) {
        reportNotDeployed(appId, accountId, options.json);
        return;
      }
      throw err;
    }
    spinner.stop();

    if (options.json) {
      jsonOutput({ undeployed: true, appId, accountId });
      return;
    }

    logSuccess(messages.APP_UNDEPLOY_SUCCESS(appId, accountId));
  },
);
