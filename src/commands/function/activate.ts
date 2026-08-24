import { logWarn } from '../../lib/logger';
import { messages } from '../../lang/en';
import { CLI } from '../../lib/constants';
import { functionService } from '../../container';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { createSpinner, printStatusCard } from '../../lib/ui';
import { ApiError } from '../../lib/errors';
import { assertFunctionSelectionAllowed, promptFunctionSelection } from './select-function';

export const activateFunctionCommand = withCommandHandler(
  async (options: { id?: string; json?: boolean }): Promise<void> => {
    let functionId = options.id;
    if (!functionId) {
      assertFunctionSelectionAllowed(CLI.FUNCTION_ACTIVATE, options.json);
      const selection = await promptFunctionSelection(messages.FUNCTION_ACTIVATE_SELECT);
      functionId = selection.functionId;
    }

    const spinner = createSpinner('Activating Brevo Function...', { silent: options.json });
    try {
      await functionService.activateFunction(functionId);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 404) {
        spinner.stop();
        if (options.json) {
          jsonOutput({
            error: 'not_found',
            message: messages.FUNCTION_ACTIVATE_NOT_FOUND(functionId),
          });
          return;
        }
        logWarn(`\n  ${messages.FUNCTION_ACTIVATE_NOT_FOUND(functionId)}\n`);
        return;
      }
      throw err;
    } finally {
      spinner.stop();
    }

    if (options.json) {
      jsonOutput({ activated: true, id: functionId });
      return;
    }
    printStatusCard(
      messages.FUNCTION_ACTIVATE_CARD_TITLE,
      messages.FUNCTION_ACTIVATE_CARD_LABEL,
      messages.FUNCTION_ACTIVATE_CARD_MESSAGE(functionId),
      'success',
    );
  },
);
