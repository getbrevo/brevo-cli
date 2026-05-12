import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import inquirer from 'inquirer';
import { logSuccess, logInfo, logWarn } from '../../lib/logger';
import { messages } from '../../lang/en';
import { CliError } from '../../lib/errors';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { appService } from '../../container';
import { createSpinner } from '../../lib/ui';
import { deleteAppCredentials, deleteAppName, readProjectConfig } from '../../lib/config';

function isSafeToDelete(dir: string): boolean {
  const resolved = path.resolve(dir);
  const home = os.homedir();
  const { root } = path.parse(resolved);
  // Never delete filesystem root or home directory
  if (resolved === root || resolved === home) return false;
  // Never delete direct children of root (e.g. /usr, /etc, C:\Windows)
  if (path.dirname(resolved) === root) return false;
  // Must contain app-config.json (scaffold marker)
  if (!fs.existsSync(path.join(resolved, 'app-config.json'))) return false;
  return true;
}

export const deleteCommand = withCommandHandler(
  async (options: { appId?: string; force?: boolean; json?: boolean }): Promise<void> => {
    let appId = options.appId;
    let appLabel = '';

    if (!appId) {
      // We need the full apps list to get appLabel for the confirmation prompt
      const listSpinner = createSpinner('Fetching apps...');
      const apps = await appService.fetchAppsList();
      listSpinner.stop();
      if (apps.length === 0) {
        logInfo(`\n  ${messages.APP_LIST_EMPTY}\n`);
        throw new CliError(messages.APP_LIST_EMPTY);
      }

      const { selectedApp } = await inquirer.prompt([
        {
          type: 'rawlist',
          name: 'selectedApp',
          message: 'Select an app to delete:',
          choices: apps.map((a) => ({
            name: `${a.name || 'App ' + a.app_id}  (App ID: ${a.app_id}, Client ID: ${a.client_id})`,
            value: a.app_id,
          })),
        },
      ]);
      appId = selectedApp as string;
      const matched = apps.find((a) => a.app_id === appId);
      appLabel = matched?.name || matched?.client_id || appId;
    }

    if (!options.force) {
      const { confirmed } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmed',
          message: messages.APP_DELETE_CONFIRM(appLabel || appId, appId),
          default: false,
        },
      ]);

      if (!confirmed) {
        logInfo(`\n  ${messages.APP_DELETE_CANCELLED}\n`);
        return;
      }
    }

    const deleteSpinner = createSpinner('Deleting app...', { silent: options.json });
    await appService.deleteApp(appId);
    deleteSpinner.stop();

    deleteAppName(appId);
    deleteAppCredentials(appId);

    if (options.json) {
      jsonOutput({ deleted: true, appId });
      return;
    }

    logSuccess(messages.APP_DELETE_SUCCESS(appId));

    // Offer to delete the local scaffolded project folder if it matches the deleted app
    if (!options.force) {
      const projectConfig = readProjectConfig();
      if (projectConfig && projectConfig.appId === appId) {
        const cwd = process.cwd();
        const { deleteFolder } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'deleteFolder',
            message: messages.APP_DELETE_FOLDER_CONFIRM(cwd),
            default: false,
          },
        ]);

        if (deleteFolder) {
          if (!isSafeToDelete(cwd)) {
            logWarn(messages.APP_DELETE_FOLDER_FAILED(cwd));
          } else {
            try {
              fs.rmSync(cwd, { recursive: true, force: true });
              logSuccess(messages.APP_DELETE_FOLDER_SUCCESS(cwd));
            } catch {
              logWarn(messages.APP_DELETE_FOLDER_FAILED(cwd));
            }
          }
        }
      }
    }
  },
);
