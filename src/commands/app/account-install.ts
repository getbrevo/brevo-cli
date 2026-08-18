import inquirer from 'inquirer';
import { logInfo } from '../../lib/logger';
import { messages } from '../../lang/en';
import { CliError } from '../../lib/errors';
import { readProjectConfig } from '../../lib/config';
import { parseAccountId } from '../../lib/validators';
import {
  assertCapability,
  resolveFromConfig,
  resolveFromRecord,
  type Distribution,
} from '../../app-types';
import { accountService, appService } from '../../container';
import { getCallerAccountId } from '../../services/app';
import { createSpinner } from '../../lib/ui';
import { SubAccount } from '../../types';
import { promptAppSelection } from './select-app';

/**
 * Shared resolution for `app install` and `app uninstall` (BEX-290).
 *
 * The two commands are mirror operations on the same target — an (app, account)
 * pair — so target resolution, the upload gate, and confirmation live here rather
 * than being duplicated (and drifting) across both files.
 */

export interface InstallTarget {
  appId: string;
  appLabel: string;
  accountId: string;
  /**
   * How the account is named in the confirmation and the result line — the company name
   * plus the identifier, when the company name is known. See
   * `messages.APP_INSTALL_ACCOUNT_LABEL` for why the ID alone was not enough.
   */
  accountLabel: string;
  /**
   * The account's company name, when the CLI resolved the account itself. Absent for an
   * explicit `[account-id]`, which is not looked up. Surfaced in `--json` so a script
   * gets the same identification a human does, without having to parse `accountLabel`.
   */
  accountName?: string;
  /**
   * Whether `appId` came from the linked project's `app-config.json` rather than from
   * `--app-id` or the picker.
   *
   * Read by `assertInstallable` and load-bearing there: the local config may only answer
   * *for the app it describes*. `--app-id <other>` inside a linked project names a
   * different app, so the config is the wrong source for both of that gate's questions.
   */
  appFromLinkedConfig: boolean;
}

/** An account the command resolved on the user's behalf, with whatever names it learned. */
interface ResolvedAccount {
  accountId: string;
  companyName?: string;
  /** The caller's own account, whose identifier is an `organization_id` and may be a UUID. */
  self: boolean;
}

/** The `type` value on `/v3/account/info` that marks a master account. */
const CORPORATE_ACCOUNT_TYPE = 'corporate';

/**
 * List the master account's sub-accounts and ask which one to act on.
 *
 * Only sub-accounts that are not explicitly deactivated are offered — installing into
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
async function promptSubAccountSelection(): Promise<ResolvedAccount> {
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
    throw new CliError(messages.APP_INSTALL_NO_SUB_ACCOUNTS);
  }

  const { selectedSubAccount } = await inquirer.prompt([
    {
      type: 'rawlist',
      name: 'selectedSubAccount',
      message: messages.APP_INSTALL_SELECT_ACCOUNT,
      // "Account ID", deliberately not "User ID": `whoami` already prints an
      // unrelated `user_id` under that name, and reusing it here would put two
      // different numbers behind one label.
      choices: selectable.map((sub) => ({
        name: `${sub.companyName || 'Account ' + sub.id}  (Account ID: ${sub.id})`,
        value: sub.id,
      })),
    },
  ]);
  const accountId = String(selectedSubAccount);
  // Carry the picked row's company name back out, so the confirmation names the account
  // the same way the list the user just chose from did. Matched against the offered rows
  // rather than trusting the answer, so a stubbed prompt can't invent a name.
  const picked = selectable.find((sub) => String(sub.id) === accountId);
  return { accountId, companyName: picked?.companyName, self: false };
}

/**
 * Resolve the account to install into when the positional was omitted.
 *
 * A plain account has exactly one answer — itself — so it resolves with no prompt and
 * stays usable non-interactively (piped stdin, `--json`, CI). Only a master account
 * has a real choice to make, and that is the one branch that needs a terminal.
 */
async function resolveTargetAccountId(json?: boolean): Promise<ResolvedAccount> {
  const spinner = createSpinner('Resolving target account...', { silent: json });
  let account;
  try {
    account = await accountService.getAccount();
  } finally {
    spinner.stop();
  }

  if (account?.type?.trim().toLowerCase() !== CORPORATE_ACCOUNT_TYPE) {
    // The authenticated account *is* the target. Read from the same credentials the
    // payload's `client_id` comes from, so the two can never disagree about who the
    // caller is. A UUID survives here for display; the payload drops it and lets the
    // server default the target to the caller, which resolves to this same account.
    //
    // The company name comes off the response this branch already had to read for
    // `type`, so naming the account costs no extra request — which matters, because this
    // is the one path where the identifier can be a UUID the user has never seen.
    return { accountId: getCallerAccountId(), companyName: account?.companyName, self: true };
  }

  if (json || !process.stdin.isTTY) {
    throw new CliError(messages.APP_INSTALL_ACCOUNT_ID_REQUIRED);
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
export async function resolveInstallTarget(
  accountIdArg: string | undefined,
  options: { appId?: string; json?: boolean },
  selectPrompt: string,
): Promise<InstallTarget> {
  // An explicit positional is taken at face value and deliberately NOT looked up: the
  // whole point of it is reaching an account the sub-account listing won't show (a
  // deactivated one), and a lookup that has to fail for that case would cost a request on
  // every CI run to sometimes add a name. The user typed the ID, so they know which
  // account it is — the two paths that need naming are the two that choose for them.
  const account: ResolvedAccount = accountIdArg
    ? { accountId: parseAccountId(accountIdArg), self: false }
    : await resolveTargetAccountId(options.json);

  const accountFields = {
    accountId: account.accountId,
    accountLabel: messages.APP_INSTALL_ACCOUNT_LABEL(
      account.accountId,
      account.companyName,
      account.self,
    ),
    ...(account.companyName?.trim() ? { accountName: account.companyName.trim() } : {}),
  };

  if (options.appId) {
    return {
      appId: options.appId,
      appLabel: options.appId,
      appFromLinkedConfig: false,
      ...accountFields,
    };
  }

  const projectConfig = readProjectConfig();
  if (projectConfig) {
    return {
      appId: projectConfig.appId,
      appLabel: projectConfig.appName || projectConfig.appId,
      appFromLinkedConfig: true,
      ...accountFields,
    };
  }

  const selection = await promptAppSelection(selectPrompt);
  return {
    appId: selection.appId,
    appLabel: selection.appLabel,
    appFromLinkedConfig: false,
    ...accountFields,
  };
}

/**
 * Both pre-flight checks that stand between the resolved target and the request: the app
 * is the right *type* to be installed at all, and — for install only — it has been
 * through a successful `brevo app upload`.

 * One function because both answers come from the same place. In a linked project that is
 * `app-config.json`, so the common path still costs no round trip; outside one it is a
 * single `GET /cli/apps/{id}` that used to be read twice once the type check existed.
 *
 * **The app-type check.** Only a UI app is installed into an account — the rule the
 * capability matrix has encoded since it was written (`src/app-types/capabilities.ts`
 * names `account-install` as its example of a type-driven capability) and that nothing on
 * this path consulted. The installs endpoint has no app-type check either, so an OAuth app
 * installed successfully and rendered nothing: a `201` and no visible effect, the same
 * class of silent no-op as the upload gate below. Routed through `assertCapability` rather
 * than a local `resolveFrom*(…).id !== 'ui'` so a third app type answers the question by
 * appearing in the table, and each command keeps its own wording.
 *
 * **The upload check.** It was written as a pre-flight, assuming the server would reject
 * an unconfigured app with a 422 and was therefore the real authority. That assumption is
 * false: the installs handler (`POST /apps/{id}/installs`, app-store-backend
 * `http_create_integration_details.go`) resolves the app by UUID, checks the plan, and
 * inserts — there is no configured/uploaded check anywhere on the path, so installing a
 * never-uploaded app answers `201` and renders nothing. Verified against `origin/main`
 * (prod image 1.5.0). So the gate has to hold for every resolution path, not just the
 * linked-project one it originally covered: `version` in app-config.json is only ever
 * written by a successful upload, and `--app-id` / the picker fall back to the app's
 * server-side `version`, which the same upload is what creates.
 *
 * `uninstall` opts out of the upload check and keeps the type one. That asymmetry is
 * deliberate: an app installed by an older CLI must stay removable whatever its `version`
 * says, whereas an OAuth app has no install to remove in the first place.
 *
 * A read failure is deliberately NOT fatal for either check: these guard against a silent
 * no-op, and refusing to act because a GET was unavailable would be a worse failure than
 * the one being prevented.
 *
 * **The local config answers only for the app it describes.** `fromLinkedConfig` is what
 * says it does — it comes from `resolveInstallTarget`, which knows whether the app ID was
 * read from `app-config.json` or given by `--app-id` / the picker. While the upload gate
 * stood alone this distinction was missing and the config answered unconditionally, so
 * `--app-id <other-app>` run inside a linked project was gated against *the directory's*
 * app: an OAuth app named explicitly from inside a UI-app project passed both checks on
 * the strength of a config that was not about it. Naming an app costs a read now, which is
 * the point — there is nothing local to answer with.
 */
export async function assertInstallable(
  appId: string | undefined,
  opts: { requireUploaded: boolean; notUiAppMessage: string; fromLinkedConfig: boolean },
): Promise<void> {
  const distributionOf = (value: string | undefined): Distribution =>
    value === 'public' ? 'public' : 'private';

  const projectConfig = opts.fromLinkedConfig ? readProjectConfig() : null;
  if (projectConfig) {
    assertCapability(
      resolveFromConfig(projectConfig).id,
      distributionOf(projectConfig.distribution_type),
      'account-install',
      opts.notUiAppMessage,
    );
    if (opts.requireUploaded && !projectConfig.version?.trim()) {
      throw new CliError(messages.APP_INSTALL_NOT_UPLOADED);
    }
    return;
  }
  if (!appId) return;

  let app;
  try {
    app = await appService.fetchApp(appId);
  } catch {
    return;
  }
  if (!app) return;

  // `resolveFromRecord` is weaker than the config path and biased the safe way for this
  // check: a record carrying OAuth material is definitely an OAuth app and is refused,
  // while one carrying none is treated as a UI app and allowed through. So the failure
  // mode is a missed refusal, never a wrongly refused UI app — which matters because the
  // list endpoint echoes no `ui_app` block today (see `isUiAppRecordShape`).
  assertCapability(
    resolveFromRecord(app).id,
    distributionOf(app.distribution_type),
    'account-install',
    opts.notUiAppMessage,
  );
  if (opts.requireUploaded && !app.version?.trim()) {
    throw new CliError(messages.APP_INSTALL_NOT_UPLOADED);
  }
}

/**
 * Confirm an install/uninstall unless `--force` was passed. Returns false when the
 * user declines, in which case the caller returns without acting (exit 0).
 */
export async function confirmInstallAction(
  confirmMessage: string,
  cancelledMessage: string,
  options: { force?: boolean; json?: boolean },
): Promise<boolean> {
  if (options.force || options.json) return true;

  if (!process.stdin.isTTY) {
    throw new CliError(messages.APP_INSTALL_NON_INTERACTIVE);
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
