import inquirer from 'inquirer';
import { logInfo, logWarn } from '../../lib/logger';
import { messages } from '../../lang/en';
import { CLI } from '../../lib/constants';
import { functionService } from '../../container';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { createSpinner, printStatusCard } from '../../lib/ui';
import { ApiError } from '../../lib/errors';
import { assertFunctionSelectionAllowed, promptFunctionSelection } from './select-function';

export const deleteFunctionCommand = withCommandHandler(
  async (options: { id?: string; force?: boolean; json?: boolean }): Promise<void> => {
    let functionId = options.id;
    if (!functionId) {
      assertFunctionSelectionAllowed(CLI.FUNCTION_DELETE, options.json);
      const selection = await promptFunctionSelection(messages.FUNCTION_DELETE_SELECT);
      functionId = selection.functionId;
    }

    if (!options.force && !options.json) {
      const { confirmed } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmed',
          message: messages.FUNCTION_DELETE_CONFIRM(functionId),
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
      await functionService.deleteFunction(functionId);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 404) {
        spinner.stop();
        if (options.json) {
          jsonOutput({
            error: 'not_found',
            message: messages.FUNCTION_DELETE_NOT_FOUND(functionId),
          });
          return;
        }
        logWarn(`\n  ${messages.FUNCTION_DELETE_NOT_FOUND(functionId)}\n`);
        return;
      }
      throw err;
    } finally {
      spinner.stop();
    }

    if (options.json) {
      jsonOutput({ deleted: true, id: functionId });
      return;
    }
    printStatusCard(
      messages.FUNCTION_DELETE_CARD_TITLE,
      messages.FUNCTION_DELETE_CARD_LABEL,
      messages.FUNCTION_DELETE_CARD_MESSAGE(functionId),
      'error',
    );
  },
);
