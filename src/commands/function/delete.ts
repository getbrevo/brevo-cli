import inquirer from 'inquirer';
import { logInfo } from '../../lib/logger';
import { messages } from '../../lang/en';
import { CLI } from '../../lib/constants';
import { functionService } from '../../container';
import { withCommandHandler } from '../../lib/command-handler';
import { assertFunctionSelectionAllowed, promptFunctionSelection } from './select-function';
import { executeFunctionAction } from './function-action';

const DELETE_ACTION_CONFIG = {
  commandName: CLI.FUNCTION_DELETE,
  jsonSuccessKey: 'deleted',
  cardTone: 'error' as const,
  execute: (id: string) => functionService.deleteFunction(id),
  messages: {
    selectPrompt: messages.FUNCTION_DELETE_SELECT,
    notFound: messages.FUNCTION_DELETE_NOT_FOUND,
    spinnerText: 'Deleting Brevo Function...',
    cardTitle: messages.FUNCTION_DELETE_CARD_TITLE,
    cardLabel: messages.FUNCTION_DELETE_CARD_LABEL,
    cardMessage: messages.FUNCTION_DELETE_CARD_MESSAGE,
  },
};

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

    await executeFunctionAction(DELETE_ACTION_CONFIG, { id: functionId, json: options.json });
  },
);
