import inquirer from 'inquirer';
import { withCommandHandler } from '../../lib/command-handler';
import { createSpinner } from '../../lib/ui';
import { logSuccess, logInfo } from '../../lib/logger';
import { jsonOutput } from '../../lib/json-output';
import { messages } from '../../lang/en';
import { dpFunctionsService } from '../../container';

export const dpDeleteCommand = withCommandHandler(
  async (options: { id: string; force?: boolean; json?: boolean }): Promise<void> => {
    if (!options.force && !options.json) {
      const { confirmed } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmed',
          message: messages.DP_DELETE_CONFIRM(options.id),
          default: false,
        },
      ]);
      if (!confirmed) {
        logInfo(`\n  ${messages.DP_DELETE_CANCELLED}\n`);
        return;
      }
    }

    const spinner = createSpinner('Deleting function...', { silent: options.json });
    await dpFunctionsService.removeFunction(options.id);
    spinner.stop();

    if (options.json) {
      jsonOutput({ deleted: true, id: options.id });
    } else {
      logSuccess(messages.DP_DELETED(options.id));
    }
  },
);
