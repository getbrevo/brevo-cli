import inquirer from 'inquirer';
import { logInfo } from '../../lib/logger';
import { messages } from '../../lang/en';
import { CliError } from '../../lib/errors';
import { readProjectConfig } from '../../lib/config';
import { parseAccountId } from '../../lib/validators';
import { promptAppSelection } from './select-app';

/**
 * Shared resolution for `app deploy` and `app rollback` (BEX-290).
 *
 * The two commands are mirror operations on the same target — an (app, account)
 * pair — so target resolution, the upload gate, and confirmation live here rather
 * than being duplicated (and drifting) across both files.
 */

export interface DeploymentTarget {
  appId: string;
  appLabel: string;
  accountId: string;
}

/**
 * Resolve which app + account the command acts on.
 *
 * App resolution follows the same precedence as `app withdraw`: explicit
 * `--app-id` flag > the app linked in this directory's app-config.json > an
 * interactive picker.
 */
export async function resolveDeploymentTarget(
  accountIdArg: string | undefined,
  options: { appId?: string },
  selectPrompt: string,
  missingAccountIdMessage: string,
): Promise<DeploymentTarget> {
  if (!accountIdArg) {
    throw new CliError(missingAccountIdMessage);
  }
  const accountId = parseAccountId(accountIdArg);

  if (options.appId) {
    return { appId: options.appId, appLabel: options.appId, accountId };
  }

  const projectConfig = readProjectConfig();
  if (projectConfig) {
    return {
      appId: projectConfig.appId,
      appLabel: projectConfig.appName || projectConfig.appId,
      accountId,
    };
  }

  const selection = await promptAppSelection(selectPrompt);
  return { appId: selection.appId, appLabel: selection.appLabel, accountId };
}

/**
 * Enforce the spec's installation-flow gate: an app must be validated by
 * `brevo app upload` before it can be deployed.
 *
 * `version` in app-config.json is only ever written by a successful upload, so
 * its absence is a reliable local signal — and catching it here avoids a wasted
 * round-trip. This is a pre-flight only: when the command runs outside a project
 * directory there is no local config to check, and the server's own rejection is
 * the authority.
 */
export function assertUploadedBeforeDeploy(): void {
  const projectConfig = readProjectConfig();
  if (!projectConfig) return;
  if (!projectConfig.version?.trim()) {
    throw new CliError(messages.APP_DEPLOY_NOT_UPLOADED);
  }
}

/**
 * Confirm a deploy/remove unless `--force` was passed. Returns false when the
 * user declines, in which case the caller returns without acting (exit 0).
 */
export async function confirmDeployment(
  confirmMessage: string,
  cancelledMessage: string,
  options: { force?: boolean; json?: boolean },
): Promise<boolean> {
  if (options.force || options.json) return true;

  if (!process.stdin.isTTY) {
    throw new CliError(messages.APP_DEPLOY_NON_INTERACTIVE);
  }

  const { confirmed } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmed',
      message: confirmMessage,
      default: false,
    },
  ]);
  if (!confirmed) {
    logInfo(`\n  ${cancelledMessage}\n`);
    return false;
  }
  return true;
}
