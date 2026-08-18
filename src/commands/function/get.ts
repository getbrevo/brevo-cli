import { logInfo, logWarn } from '../../lib/logger';
import { messages } from '../../lang/en';
import { functionService } from '../../container';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { createSpinner } from '../../lib/ui';
import { ApiError } from '../../lib/errors';

export const getFunctionCommand = withCommandHandler(
  async (options: { id: string; json?: boolean }): Promise<void> => {
    const spinner = createSpinner('Fetching Brevo Function...', { silent: options.json });
    let fn;
    try {
      fn = await functionService.fetchFunction(options.id);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 404) {
        spinner.stop();
        if (options.json) {
          jsonOutput({ error: 'not_found', message: messages.FUNCTION_GET_NOT_FOUND(options.id) });
          return;
        }
        logWarn(`\n  ${messages.FUNCTION_GET_NOT_FOUND(options.id)}\n`);
        return;
      }
      throw err;
    } finally {
      spinner.stop();
    }

    if (options.json) {
      jsonOutput(fn);
      return;
    }

    logInfo(`\n  ${messages.FUNCTION_GET_HEADER}\n`);
    process.stdout.write(`  Name:          ${fn.name}\n`);
    process.stdout.write(`  ID:            ${fn.id}\n`);
    process.stdout.write(`  Status:        ${fn.is_active ? 'active' : 'inactive'}\n`);
    process.stdout.write(`  Description:   ${fn.description}\n`);
    process.stdout.write(`  Explanation:   ${fn.explanation}\n`);
    process.stdout.write(`  Formula:       ${fn.formula}\n`);
    if (fn.category) {
      process.stdout.write(`  Category:      ${fn.category}\n`);
    }
    process.stdout.write(`  Version:       ${fn.version}\n`);
    process.stdout.write(`  Global:        ${fn.is_global ? 'yes' : 'no'}\n`);
    process.stdout.write(`  Created:       ${fn.created_at}\n`);
    process.stdout.write(`  Updated:       ${fn.updated_at}\n`);
    if (fn.last_recalculated_at) {
      process.stdout.write(`  Recalculated:  ${fn.last_recalculated_at}\n`);
    }
    process.stdout.write('\n');
  },
);
