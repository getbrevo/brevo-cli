import { logSuccess } from '../../lib/logger';
import { messages } from '../../lang/en';
import { ApiError, CliError } from '../../lib/errors';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { appService } from '../../container';
import { createSpinner } from '../../lib/ui';
import { assertInstallable, confirmInstallAction, resolveInstallTarget } from './account-install';

interface InstallOptions {
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
 * `brevo app install [account-id]` — make an app available in one Brevo account.
 *
 * Until an in-product enable/disable surface ships, this (with
 * `app uninstall`) is the only way a UI app becomes visible in an account.
 */
export const appInstallCommand = withCommandHandler(
  async (options: InstallOptions): Promise<void> => {
    const { appId, appLabel, accountId, accountLabel, accountName, appFromLinkedConfig } =
      await resolveInstallTarget(
        options.accountId,
        options,
        messages.APP_INSTALL_SELECT,
        messages.APP_INSTALL_SELECT_ACCOUNT,
      );

    await assertInstallable(appId, {
      requireUploaded: true,
      notUiAppMessage: messages.APP_INSTALL_NOT_UI_APP(appId),
      fromLinkedConfig: appFromLinkedConfig,
    });

    const proceed = await confirmInstallAction(
      messages.APP_INSTALL_CONFIRM(appLabel, appId, accountLabel),
      messages.APP_INSTALL_CANCELLED,
      options,
    );
    if (!proceed) return;

    const spinner = createSpinner('Installing app...', { silent: options.json });
    try {
      // The install's `name` is the app's own name — no prompt, no flag, so
      // `app install` stays scriptable. `appLabel` falls back to the app ID when
      // there is no linked project config to read a name from.
      await appService.installApp(appId, accountId, appLabel);
    } catch (err) {
      spinner.stop();
      // Defensive, not load-bearing. This branch was written believing the server
      // rejected an unconfigured app with a 422 and was therefore the authority on
      // the upload gate. It is not: the installs handler has no configured/uploaded
      // check at all (verified against app-store-backend `origin/main`), so this can
      // never fire today — `assertUploadedBeforeInstall` above is the real gate.
      // Kept so that if the check is ever added server-side with the status the
      // design specified, its rejection still reads as the actionable message rather
      // than a raw API error.
      if (err instanceof ApiError && err.statusCode === 422) {
        throw new CliError(messages.APP_INSTALL_NOT_UPLOADED, err.exitCode);
      }
      throw err;
    }
    spinner.stop();

    if (options.json) {
      // `accountId` stays the raw identifier a script matches on; `accountName` is added
      // only when the CLI learned one, so the shape a caller already parses is unchanged.
      jsonOutput({ installed: true, appId, accountId, ...(accountName ? { accountName } : {}) });
      return;
    }

    logSuccess(messages.APP_INSTALL_SUCCESS(appId, accountLabel));
  },
);
