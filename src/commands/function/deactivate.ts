import { logWarn } from '../../lib/logger';
import { messages } from '../../lang/en';
import { CLI } from '../../lib/constants';
import { functionService } from '../../container';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { createSpinner, printStatusCard } from '../../lib/ui';
import { ApiError } from '../../lib/errors';
import { assertFunctionSelectionAllowed, promptFunctionSelection } from './select-function';

export const deactivateFunctionCommand = withCommandHandler(
  async (options: { id?: string; json?: boolean }): Promise<void> => {
    let functionId = options.id;
    if (!functionId) {
      assertFunctionSelectionAllowed(CLI.FUNCTION_DEACTIVATE, options.json);
      const selection = await promptFunctionSelection(messages.FUNCTION_DEACTIVATE_SELECT);
      functionId = selection.functionId;
    }

    const spinner = createSpinner('Deactivating Brevo Function...', { silent: options.json });
    try {
      await functionService.deactivateFunction(functionId);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 404) {
        spinner.stop();
        if (options.json) {
          jsonOutput({
            error: 'not_found',
            message: messages.FUNCTION_DEACTIVATE_NOT_FOUND(functionId),
          });
          return;
        }
        logWarn(`\n  ${messages.FUNCTION_DEACTIVATE_NOT_FOUND(functionId)}\n`);
        return;
      }
      throw err;
    } finally {
      spinner.stop();
    }

    if (options.json) {
      jsonOutput({ deactivated: true, id: functionId });
      return;
    }
    printStatusCard(
      messages.FUNCTION_DEACTIVATE_CARD_TITLE,
      messages.FUNCTION_DEACTIVATE_CARD_LABEL,
      messages.FUNCTION_DEACTIVATE_CARD_MESSAGE(functionId),
      'warn',
    );
  },
);
