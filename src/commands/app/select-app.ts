import inquirer from 'inquirer';
import { appService } from '../../container';
import { createSpinner } from '../../lib/ui';
import { logInfo } from '../../lib/logger';
import { CliError } from '../../lib/errors';
import { messages } from '../../lang/en';
import type { OAuthApp } from '../../types';

/**
 * Refuse an app picker there is no terminal to draw. Call this before any
 * picker — `promptAppSelection` here or `appService.pickApp` — on a command
 * whose app can also be named with `--app-id`.
 *
 * Both pickers render their choice list to stdout, which under `--json` breaks
 * the "stdout is exactly one parseable document" contract the agent docs
 * promise, and leaks app ids and client ids into what a script is trying to
 * parse. Off a TTY inquirer then aborts with a raw ERR_USE_AFTER_CLOSE readline
 * stack rather than anything a caller can act on. Refusing up front also avoids
 * the apps-list round trip, so this must run *before* the fetch.
 *
 * `command` names the caller in the message so the fix is copy-pasteable.
 */
export function assertAppSelectionAllowed(command: string, jsonMode?: boolean): void {
  if (jsonMode || !process.stdin.isTTY) {
    throw new CliError(messages.APP_SELECT_NON_INTERACTIVE(command));
  }
}

/**
 * Fetch the full apps list and prompt the user to pick one, returning both the
 * app id and a human label (name → client_id → id) for use in confirmation
 * copy. Shared by `app delete`, `app withdraw` and (filtered) `app install` /
 * `app uninstall`.
 *
 * `filter` narrows the list to the apps the caller can act on — install passes
 * a UI-app test so the picker never offers a choice whose only outcome is the
 * type-gate refusal one step later. When the filter empties a non-empty list,
 * `emptyMessage` names the caller's way forward; an already-empty list keeps
 * the generic APP_LIST_EMPTY either way, because "you have no apps at all" is
 * the more actionable fact.
 */
export async function promptAppSelection(
  promptMessage: string,
  opts?: { filter?: (app: OAuthApp) => boolean; emptyMessage?: string },
): Promise<{ appId: string; appLabel: string }> {
  const listSpinner = createSpinner('Fetching apps...');
  let apps;
  try {
    apps = await appService.fetchAppsList();
  } finally {
    listSpinner.stop();
  }
  if (apps.length === 0) {
    logInfo(`\n  ${messages.APP_LIST_EMPTY}\n`);
    throw new CliError(messages.APP_LIST_EMPTY);
  }
  if (opts?.filter) {
    apps = apps.filter(opts.filter);
    if (apps.length === 0) {
      throw new CliError(opts.emptyMessage ?? messages.APP_LIST_EMPTY);
    }
  }

  const { selectedApp } = await inquirer.prompt([
    {
      type: 'rawlist',
      name: 'selectedApp',
      message: promptMessage,
      // A UI app has no client_id (the list echoes it empty), so the row only
      // carries the parenthetical the app can actually be identified by.
      choices: apps.map((a) => ({
        name: a.client_id
          ? `${a.name || 'App ' + a.app_id}  (App ID: ${a.app_id}, Client ID: ${a.client_id})`
          : `${a.name || 'App ' + a.app_id}  (App ID: ${a.app_id})`,
        value: a.app_id,
      })),
    },
  ]);
  const appId = selectedApp as string;
  const matched = apps.find((a) => a.app_id === appId);
  return { appId, appLabel: matched?.name || matched?.client_id || appId };
}
