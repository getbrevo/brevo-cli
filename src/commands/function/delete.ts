import inquirer from 'inquirer';
import { logSuccess, logInfo, logWarn } from '../../lib/logger';
import { messages } from '../../lang/en';
import { functionService } from '../../container';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { createSpinner } from '../../lib/ui';
import { ApiError } from '../../lib/errors';

export const deleteFunctionCommand = withCommandHandler(
  async (options: { id: string; force?: boolean; json?: boolean }): Promise<void> => {
    if (!options.force && !options.json) {
      const { confirmed } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmed',
          message: messages.FUNCTION_DELETE_CONFIRM(options.id),
          default: false,
        },
      ]);
      if (!confirmed) {
        logInfo(`\n  ${messages.FUNCTION_DELETE_CANCELLED}\n`);
        return;
      }
    }

    const spinner = createSpinner('Deleting Brevo Function...', { silent: options.json });
    try {
      await functionService.deleteFunction(options.id);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 404) {
        spinner.stop();
        if (options.json) {
          jsonOutput({
            error: 'not_found',
            message: messages.FUNCTION_DELETE_NOT_FOUND(options.id),
          });
          return;
        }
        logWarn(`\n  ${messages.FUNCTION_DELETE_NOT_FOUND(options.id)}\n`);
        return;
      }
      throw err;
    } finally {
      spinner.stop();
    }

    if (options.json) {
      jsonOutput({ deleted: true, id: options.id });
      return;
    }
    logSuccess(messages.FUNCTION_DELETE_SUCCESS(options.id));
  },
);
