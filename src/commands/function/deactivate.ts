import { messages } from '../../lang/en';
import { CLI } from '../../lib/constants';
import { functionService } from '../../container';
import { buildFunctionActionCommand } from './function-action';

export const deactivateFunctionCommand = buildFunctionActionCommand({
  commandName: CLI.FUNCTION_DEACTIVATE,
  jsonSuccessKey: 'deactivated',
  cardTone: 'warn',
  execute: (id) => functionService.deactivateFunction(id),
  messages: {
    selectPrompt: messages.FUNCTION_DEACTIVATE_SELECT,
    notFound: messages.FUNCTION_DEACTIVATE_NOT_FOUND,
    spinnerText: 'Deactivating Brevo Function...',
    cardTitle: messages.FUNCTION_DEACTIVATE_CARD_TITLE,
    cardLabel: messages.FUNCTION_DEACTIVATE_CARD_LABEL,
    cardMessage: messages.FUNCTION_DEACTIVATE_CARD_MESSAGE,
  },
});
