import inquirer from 'inquirer';
import { appService, functionService } from '../../container';
import { CliError } from '../../lib/errors';
import { logDebug, logInfo, color } from '../../lib/logger';
import { createSpinner, indentChoices } from '../../lib/ui';
import { messages } from '../../lang/en';

/** Fetch brevo_function apps and prompt the user to pick one. Returns the selected app_id. */
export async function selectFunctionApp(
  promptMessage: string,
  emptyMessage: string,
): Promise<string> {
  const spinner = createSpinner('Fetching apps...');
  let apps;
  try {
    apps = await appService.fetchAppsList({ type: 'brevo_function' });
  } finally {
    spinner.stop();
  }

  if (apps.length === 0) {
    throw new CliError(emptyMessage);
  }

  const { selected } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selected',
      message: promptMessage,
      pageSize: 15,
      choices: indentChoices(
        apps.map((a) => ({
          name: `${a.name || `App ${a.app_id}`}  (ID: ${a.app_id})`,
          value: a.app_id,
        })),
      ),
    },
  ]);

  return selected as string;
}

/** Link a deployed function to an app. Non-fatal — logs a warning on failure. */
export async function tryLinkFunctionToApp(
  appId: string,
  functionId: string,
  opts?: { silent?: boolean },
): Promise<boolean> {
  const spinner = createSpinner(messages.FUNCTION_DEPLOY_LINKING, { silent: opts?.silent });
  try {
    await functionService.linkFunctionToApp({ app_id: appId, function_id: functionId });
    return true;
  } catch (err) {
    logDebug('linkFunctionToApp', err);
    if (!opts?.silent) {
      logInfo(`  ${color('33', messages.FUNCTION_DEPLOY_LINK_ERROR)}`);
    }
    return false;
  } finally {
    spinner.stop();
  }
}
