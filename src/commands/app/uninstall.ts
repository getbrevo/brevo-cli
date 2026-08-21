import { logSuccess, logInfo } from '../../lib/logger';
import { messages } from '../../lang/en';
import { ApiError } from '../../lib/errors';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { appService } from '../../container';
import { createSpinner } from '../../lib/ui';
import { assertInstallable, confirmInstallAction, resolveInstallTarget } from './account-install';

interface UninstallOptions {
  /**
   * The `[account-id]` positional, folded in by the command definition. Optional —
   * omitted, `resolveInstallTarget` derives the target from the logged-in account.
   */
  accountId?: string;
  appId?: string;
  force?: boolean;
  json?: boolean;
}

/**
 * "Not installed in this account" is informational, not a failure: the caller's
 * intent (the app is not in that account) already holds. Mirrors how
 * `app withdraw` treats a never-submitted app — report and exit 0 so
 * teardown scripts stay idempotent.
 */
function reportNotInstalled(
  appId: string,
  account: { accountId: string; accountLabel: string; accountName?: string },
  json?: boolean,
): void {
  if (json) {
    jsonOutput({
      uninstalled: false,
      appId,
      accountId: account.accountId,
      ...(account.accountName ? { accountName: account.accountName } : {}),
      reason: 'NOT_INSTALLED',
      message: messages.APP_UNINSTALL_NOT_INSTALLED(appId, account.accountLabel),
    });
    return;
  }
  logInfo(`\n  ${messages.APP_UNINSTALL_NOT_INSTALLED(appId, account.accountLabel)}\n`);
}

/**
 * `brevo app uninstall [account-id]` — withdraw an app's availability from one
 * Brevo account. Counterpart to `app install`.
 */
export const appUninstallCommand = withCommandHandler(
  async (options: UninstallOptions): Promise<void> => {
    const target = await resolveInstallTarget(
      options.accountId,
      options,
      messages.APP_UNINSTALL_SELECT,
      messages.APP_UNINSTALL_SELECT_ACCOUNT,
    );
    const { appId, appLabel, accountId, accountLabel } = target;

    // The app-type check applies, the upload check does not, and the split is the point:
    // an app installed by an earlier CLI version must stay removable whatever its
    // `version` says, while an OAuth app never had an install to remove. See
    // `assertInstallable`.
    await assertInstallable(appId, {
      requireUploaded: false,
      notUiAppMessage: messages.APP_UNINSTALL_NOT_UI_APP(appId),
      fromLinkedConfig: target.appFromLinkedConfig,
    });

    const proceed = await confirmInstallAction(
      messages.APP_UNINSTALL_CONFIRM(appLabel, appId, accountLabel),
      messages.APP_UNINSTALL_CANCELLED,
      options,
    );
    if (!proceed) return;

    const spinner = createSpinner('Uninstalling app...', { silent: options.json });
    try {
      await appService.uninstallApp(appId, accountId, appLabel);
    } catch (err) {
      spinner.stop();
      // Any 404 is the not-installed path. The developer uninstall route resolves the
      // install from the request body rather than an installation ID, so it answers 404
      // for both "app doesn't exist" and "no such install" — and the CLI can only tell
      // them apart by matching the server's error copy, which it deliberately doesn't.
      // Reporting a bad app ID as "not installed" is the cheaper wrong answer: the
      // alternative fails an idempotent teardown that had nothing left to do.
      if (err instanceof ApiError && err.statusCode === 404) {
        reportNotInstalled(appId, target, options.json);
        return;
      }
      throw err;
    }
    spinner.stop();

    if (options.json) {
      jsonOutput({
        uninstalled: true,
        appId,
        accountId,
        ...(target.accountName ? { accountName: target.accountName } : {}),
      });
      return;
    }

    logSuccess(messages.APP_UNINSTALL_SUCCESS(appId, accountLabel));
  },
);
