import { logSuccess, logWarn } from '../../lib/logger';
import { messages } from '../../lang/en';
import { functionService } from '../../container';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { createSpinner } from '../../lib/ui';
import { ApiError } from '../../lib/errors';

export const activateFunctionCommand = withCommandHandler(
  async (options: { id: string; json?: boolean }): Promise<void> => {
    const spinner = createSpinner('Activating Brevo Function...', { silent: options.json });
    try {
      await functionService.activateFunction(options.id);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 404) {
        spinner.stop();
        if (options.json) {
          jsonOutput({
            error: 'not_found',
            message: messages.FUNCTION_ACTIVATE_NOT_FOUND(options.id),
          });
          return;
        }
        logWarn(`\n  ${messages.FUNCTION_ACTIVATE_NOT_FOUND(options.id)}\n`);
        return;
      }
      throw err;
    } finally {
      spinner.stop();
    }

    if (options.json) {
      jsonOutput({ activated: true, id: options.id });
      return;
    }
    logSuccess(messages.FUNCTION_ACTIVATE_SUCCESS(options.id));
  },
);
