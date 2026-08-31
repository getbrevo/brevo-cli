import { logSuccess, logInfo, logWarn } from '../../lib/logger';
import { messages } from '../../lang/en';
import { ApiError, CliError } from '../../lib/errors';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { appService } from '../../container';
import { createSpinner } from '../../lib/ui';
import {
  assertInstallable,
  confirmInstallAction,
  fetchInstallSnapshot,
  resolveInstallTarget,
} from './account-install';
import { CLI } from '../../lib/constants';
import { readProjectConfig } from '../../lib/config';
import { OAuthApp } from '../../types';
import { formatPlacementLines } from '../../app-types/ui/fields';
import { uiAppEquals } from '../../app-types/ui/compare';

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
        CLI.APP_INSTALL_APP_ID(),
      );

    // One read, two uses: the gate below and the summary the confirmation is made
    // against. Read even in a linked project, where the gate alone would have answered
    // from `app-config.json` — the summary has to show what the SERVER stores, because
    // that is what the install makes visible, and a local file that has drifted from it
    // would describe an install that isn't the one about to happen.
    const serverApp = await fetchInstallSnapshot(appId, { silent: options.json });

    await assertInstallable(appId, {
      requireUploaded: true,
      notUiAppMessage: messages.APP_INSTALL_NOT_UI_APP(appId),
      fromLinkedConfig: appFromLinkedConfig,
      serverApp,
    });

    if (!options.json) {
      renderInstallSummary(appId, appLabel, serverApp, appFromLinkedConfig);
    }

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
      // `version` and `ui_app` are the machine-readable half of the summary a human sees
      // above — the configuration that was installed, as the server had it — and are
      // likewise added only when the read produced them.
      jsonOutput({
        installed: true,
        appId,
        accountId,
        ...(accountName ? { accountName } : {}),
        ...(serverApp?.version ? { version: serverApp.version } : {}),
        ...(serverApp?.ui_app ? { ui_app: serverApp.ui_app } : {}),
      });
      return;
    }

    logSuccess(messages.APP_INSTALL_SUCCESS(appId, accountLabel));
  },
);

/**
 * Print the configuration this install makes visible, before asking to confirm it.
 *
 * Installing is the moment a UI app's stored configuration starts rendering inside an
 * account, and the confirmation used to name only the app and the target — so the one
 * question a partner actually has at that point ("which version, and what does it put on
 * the record page?") had no answer on screen. It is the SERVER's copy that is shown, and
 * deliberately: the install serves whatever the last successful `app upload` stored, which
 * is not necessarily what the local `app-config.json` now says.
 *
 * Whatever the read produced is printed, and nothing is substituted from local state: a
 * null record (an unavailable GET, an app the read couldn't resolve) prints nothing, because
 * a summary sourced from the local file would be a claim about the server that the CLI never
 * verified. Same reason the block is skipped when the record carries none.
 */
function renderInstallSummary(
  appId: string,
  appLabel: string,
  serverApp: OAuthApp | null,
  appFromLinkedConfig: boolean,
): void {
  if (!serverApp) return;

  logInfo('');
  logInfo(`  ${messages.APP_INSTALL_SUMMARY}`);
  logInfo(`  App ID:        ${appId}`);
  logInfo(`  Name:          ${serverApp.name || appLabel}`);
  logInfo(`  Version:       ${serverApp.version || messages.APP_INSTALL_SUMMARY_NO_VERSION}`);
  if (serverApp.ui_app) {
    // Same rows, same labels, same widths as `app upload`'s summary — the two are read one
    // after the other (upload, then install), and a field that changed name or column
    // between them would read as a different field.
    logInfo(`  ${messages.APP_UPLOAD_UI_APP_SUMMARY}`);
    logInfo(`    Extension type: ${serverApp.ui_app.extension_type}`);
    formatPlacementLines(serverApp.ui_app).forEach((line, i) => {
      logInfo(`    ${i === 0 ? 'Placement:      ' : '                '}${line}`);
    });
  }
  logInfo('');

  // Drift is only worth reporting when there is a local file to have drifted: the app ID
  // came from `app-config.json`, so the partner is standing in the project and may well
  // believe they are installing what they last edited. Compared through the same
  // normalization the upload diff uses, so key order, placement order and the
  // server-managed keys don't register as a difference.
  const localConfig = appFromLinkedConfig ? readProjectConfig() : null;
  if (localConfig?.ui_app && !uiAppEquals(localConfig.ui_app, serverApp.ui_app)) {
    logWarn(`  ${messages.APP_INSTALL_CONFIG_DRIFT}\n`);
  }
}
