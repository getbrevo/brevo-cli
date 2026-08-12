import inquirer from 'inquirer';
import { logInfo } from '../../lib/logger';
import { messages } from '../../lang/en';
import { CliError } from '../../lib/errors';
import { readProjectConfig } from '../../lib/config';
import { parseAccountId } from '../../lib/validators';
import { accountService } from '../../container';
import { getCallerAccountId } from '../../services/app';
import { createSpinner } from '../../lib/ui';
import { SubAccount } from '../../types';
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

/** The `type` value on `/v3/account/info` that marks a master account. */
const CORPORATE_ACCOUNT_TYPE = 'corporate';

/**
 * List the master account's sub-accounts and ask which one to act on.
 *
 * Only sub-accounts that are not explicitly deactivated are offered — deploying into
 * a deactivated account is almost certainly a mistake, and the explicit `[account-id]`
 * positional stays available for the rare case where it isn't. The test is
 * `active !== false` rather than `active === true` so a response that omits the field
 * still yields a usable picker; an over-strict filter would empty it entirely and
 * block the command, which is the worse failure.
 *
 * `count` is therefore *not* the number of choices shown: a master account can page
 * through every entry and still end up with nothing to offer. That gets the
 * `promptAppSelection` treatment — a CliError naming the way forward, never an empty
 * prompt.
 */
async function promptSubAccountSelection(): Promise<string> {
  const spinner = createSpinner('Fetching sub-accounts...');
  let subAccounts: SubAccount[];
  try {
    subAccounts = await accountService.fetchSubAccounts();
  } finally {
    spinner.stop();
  }

  const selectable = subAccounts.filter(
    (sub) => sub.active !== false && Number.isInteger(sub.id) && sub.id > 0,
  );
  if (selectable.length === 0) {
    throw new CliError(messages.APP_DEPLOY_NO_SUB_ACCOUNTS);
  }

  const { selectedSubAccount } = await inquirer.prompt([
    {
      type: 'rawlist',
      name: 'selectedSubAccount',
      message: messages.APP_DEPLOY_SELECT_ACCOUNT,
      // "Account ID", deliberately not "User ID": `whoami` already prints an
      // unrelated `user_id` under that name, and reusing it here would put two
      // different numbers behind one label.
      choices: selectable.map((sub) => ({
        name: `${sub.companyName || 'Account ' + sub.id}  (Account ID: ${sub.id})`,
        value: sub.id,
      })),
    },
  ]);
  return String(selectedSubAccount);
}

/**
 * Resolve the account to deploy into when the positional was omitted.
 *
 * A plain account has exactly one answer — itself — so it resolves with no prompt and
 * stays usable non-interactively (piped stdin, `--json`, CI). Only a master account
 * has a real choice to make, and that is the one branch that needs a terminal.
 */
async function resolveTargetAccountId(json?: boolean): Promise<string> {
  const spinner = createSpinner('Resolving target account...', { silent: json });
  let accountType: string | undefined;
  try {
    accountType = (await accountService.getAccount()).type;
  } finally {
    spinner.stop();
  }

  if (accountType?.trim().toLowerCase() !== CORPORATE_ACCOUNT_TYPE) {
    // The authenticated account *is* the target. Read from the same credentials the
    // payload's `client_id` comes from, so the two can never disagree about who the
    // caller is. A UUID survives here for display; the payload drops it and lets the
    // server default the target to the caller, which resolves to this same account.
    return getCallerAccountId();
  }

  if (json || !process.stdin.isTTY) {
    throw new CliError(messages.APP_DEPLOY_ACCOUNT_ID_REQUIRED);
  }
  return promptSubAccountSelection();
}

/**
 * Resolve which app + account the command acts on.
 *
 * App resolution follows the same precedence as `app withdraw`: explicit
 * `--app-id` flag > the app linked in this directory's app-config.json > an
 * interactive picker.
 *
 * Account resolution mirrors it: explicit `[account-id]` positional > the
 * authenticated account itself (plain accounts) > a sub-account picker (master
 * accounts). The positional is checked first so CI keeps working unchanged and so
 * there is always an escape hatch for an account the listing won't show — notably a
 * deactivated sub-account.
 */
export async function resolveDeploymentTarget(
  accountIdArg: string | undefined,
  options: { appId?: string; json?: boolean },
  selectPrompt: string,
): Promise<DeploymentTarget> {
  const accountId = accountIdArg
    ? parseAccountId(accountIdArg)
    : await resolveTargetAccountId(options.json);

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
