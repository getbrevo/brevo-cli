import { logSuccess, logWarn } from '../../lib/logger';
import { messages } from '../../lang/en';
import { functionService } from '../../container';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { createSpinner } from '../../lib/ui';
import { ApiError } from '../../lib/errors';

export const deactivateFunctionCommand = withCommandHandler(
  async (options: { id: string; json?: boolean }): Promise<void> => {
    const spinner = createSpinner('Deactivating Brevo Function...', { silent: options.json });
    try {
      await functionService.deactivateFunction(options.id);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 404) {
        spinner.stop();
        if (options.json) {
          jsonOutput({
            error: 'not_found',
            message: messages.FUNCTION_DEACTIVATE_NOT_FOUND(options.id),
          });
          return;
        }
        logWarn(`\n  ${messages.FUNCTION_DEACTIVATE_NOT_FOUND(options.id)}\n`);
        return;
      }
      throw err;
    } finally {
      spinner.stop();
    }

    if (options.json) {
      jsonOutput({ deactivated: true, id: options.id });
      return;
    }
    logSuccess(messages.FUNCTION_DEACTIVATE_SUCCESS(options.id));
  },
);
