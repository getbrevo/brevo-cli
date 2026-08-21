import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import inquirer from 'inquirer';
import { logSuccess, logInfo, logWarn } from '../../lib/logger';
import { messages } from '../../lang/en';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { appService } from '../../container';
import { createSpinner } from '../../lib/ui';
import { deleteAppCredentials, deleteAppName, readProjectConfig } from '../../lib/config';
import { assertAppSelectionAllowed, promptAppSelection } from './select-app';
import { CLI } from '../../lib/constants';

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

async function confirmDeletion(appLabel: string, appId: string): Promise<boolean> {
  logWarn(`\n  ${messages.APP_DELETE_WARNING(appLabel, appId)}\n`);
  const { confirmed } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmed',
      message: messages.APP_DELETE_CONFIRM(appLabel, appId),
      default: false,
    },
  ]);

  if (!confirmed) {
    logInfo(`\n  ${messages.APP_DELETE_CANCELLED}\n`);
    return false;
  }
  return true;
}

function removeProjectFolder(cwd: string): void {
  if (!isSafeToDelete(cwd)) {
    logWarn(messages.APP_DELETE_FOLDER_FAILED(cwd));
    return;
  }
  try {
    fs.rmSync(cwd, { recursive: true, force: true });
    logSuccess(messages.APP_DELETE_FOLDER_SUCCESS(cwd));
  } catch {
    logWarn(messages.APP_DELETE_FOLDER_FAILED(cwd));
  }
}

// Offer to delete the local scaffolded project folder if it matches the deleted app
async function offerLocalFolderCleanup(appId: string): Promise<void> {
  const projectConfig = readProjectConfig();
  if (projectConfig?.appId !== appId) return;

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
    removeProjectFolder(cwd);
  }
}

export const deleteCommand = withCommandHandler(
  async (options: { appId?: string; force?: boolean; json?: boolean }): Promise<void> => {
    let appId = options.appId;
    let appLabel = '';

    if (!appId) {
      assertAppSelectionAllowed(CLI.APP_DELETE_APP_ID(), options.json);
      const selection = await promptAppSelection(messages.APP_DELETE_SELECT);
      appId = selection.appId;
      appLabel = selection.appLabel;
    }

    if (!options.force && !(await confirmDeletion(appLabel || appId, appId))) {
      return;
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

    if (!options.force) {
      await offerLocalFolderCleanup(appId);
    }
  },
);
