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
 * `brevo app deploy [account-id]` — make an app available in one Brevo account.
 *
 * Until an in-product enable/disable surface ships, this (with
 * `app rollback`) is the only way a UI app becomes visible in an account.
 */
export const deployCommand = withCommandHandler(async (options: DeployOptions): Promise<void> => {
  const { appId, appLabel, accountId } = await resolveDeploymentTarget(
    options.accountId,
    options,
    messages.APP_DEPLOY_SELECT,
  );

  await assertUploadedBeforeDeploy(appId);

  const proceed = await confirmDeployment(
    messages.APP_DEPLOY_CONFIRM(appLabel, appId, accountId),
    messages.APP_DEPLOY_CANCELLED,
    options,
  );
  if (!proceed) return;

  const spinner = createSpinner('Deploying app...', { silent: options.json });
  try {
    // The install's `name` is the app's own name — no prompt, no flag, so
    // `app deploy` stays scriptable. `appLabel` falls back to the app ID when
    // there is no linked project config to read a name from.
    await appService.deployApp(appId, accountId, appLabel);
  } catch (err) {
    spinner.stop();
    // Defensive, not load-bearing. This branch was written believing the server
    // rejected an unconfigured app with a 422 and was therefore the authority on
    // the upload gate. It is not: the installs handler has no configured/uploaded
    // check at all (verified against app-store-backend `origin/main`), so this can
    // never fire today — `assertUploadedBeforeDeploy` above is the real gate.
    // Kept so that if the check is ever added server-side with the status the
    // design specified, its rejection still reads as the actionable message rather
    // than a raw API error.
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
