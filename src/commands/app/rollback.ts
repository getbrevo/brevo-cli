import { logSuccess, logInfo } from '../../lib/logger';
import { messages } from '../../lang/en';
import { ApiError } from '../../lib/errors';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { appService } from '../../container';
import { createSpinner } from '../../lib/ui';
import { confirmDeployment, resolveDeploymentTarget } from './account-deployment';

interface RollbackOptions {
  /**
   * The `[account-id]` positional, folded in by the command definition. Optional —
   * omitted, `resolveDeploymentTarget` derives the target from the logged-in account.
   */
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
      rolledBack: false,
      appId,
      accountId,
      reason: 'NOT_DEPLOYED',
      message: messages.APP_ROLLBACK_NOT_DEPLOYED(appId, accountId),
    });
    return;
  }
  logInfo(`\n  ${messages.APP_ROLLBACK_NOT_DEPLOYED(appId, accountId)}\n`);
}

/**
 * `brevo app rollback [account-id]` — withdraw an app's availability from one
 * Brevo account. Counterpart to `app deploy`.
 */
export const rollbackCommand = withCommandHandler(
  async (options: RollbackOptions): Promise<void> => {
    const { appId, appLabel, accountId } = await resolveDeploymentTarget(
      options.accountId,
      options,
      messages.APP_ROLLBACK_SELECT,
    );

    // Deliberately no upload gate here: rolling back is always safe, and blocking it
    // on an upload would strand an app deployed by an earlier CLI version.
    const proceed = await confirmDeployment(
      messages.APP_ROLLBACK_CONFIRM(appLabel, appId, accountId),
      messages.APP_ROLLBACK_CANCELLED,
      options,
    );
    if (!proceed) return;

    const spinner = createSpinner('Rolling back app...', { silent: options.json });
    try {
      await appService.rollbackApp(appId, accountId, appLabel);
    } catch (err) {
      spinner.stop();
      // Any 404 is the not-deployed path. The developer uninstall route resolves the
      // install from the request body rather than an installation ID, so it answers 404
      // for both "app doesn't exist" and "no such install" — and the CLI can only tell
      // them apart by matching the server's error copy, which it deliberately doesn't.
      // Reporting a bad app ID as "not deployed" is the cheaper wrong answer: the
      // alternative fails an idempotent teardown that had nothing left to do.
      if (err instanceof ApiError && err.statusCode === 404) {
        reportNotDeployed(appId, accountId, options.json);
        return;
      }
      throw err;
    }
    spinner.stop();

    if (options.json) {
      jsonOutput({ rolledBack: true, appId, accountId });
      return;
    }

    logSuccess(messages.APP_ROLLBACK_SUCCESS(appId, accountId));
  },
);
