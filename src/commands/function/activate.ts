import { messages } from '../../lang/en';
import { CLI } from '../../lib/constants';
import { functionService } from '../../container';
import { buildFunctionActionCommand } from './function-action';

export const activateFunctionCommand = buildFunctionActionCommand({
  commandName: CLI.FUNCTION_ACTIVATE,
  jsonSuccessKey: 'activated',
  cardTone: 'success',
  execute: (id) => functionService.activateFunction(id),
  messages: {
    selectPrompt: messages.FUNCTION_ACTIVATE_SELECT,
    notFound: messages.FUNCTION_ACTIVATE_NOT_FOUND,
    spinnerText: 'Activating Brevo Function...',
    cardTitle: messages.FUNCTION_ACTIVATE_CARD_TITLE,
    cardLabel: messages.FUNCTION_ACTIVATE_CARD_LABEL,
    cardMessage: messages.FUNCTION_ACTIVATE_CARD_MESSAGE,
  },
});
