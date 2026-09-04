import { color, logInfo } from '../../lib/logger';
import { messages } from '../../lang/en';
import { CLI } from '../../lib/constants';
import { functionService } from '../../container';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { resolveFunctionId, withNotFoundHandling } from './function-action';

export const getFunctionCommand = withCommandHandler(
  async (options: { id?: string; json?: boolean }): Promise<void> => {
    const functionId = await resolveFunctionId(
      CLI.FUNCTION_GET,
      messages.FUNCTION_GET_SELECT,
      options,
    );

    const fn = await withNotFoundHandling(() => functionService.fetchFunction(functionId), {
      spinnerText: 'Fetching Brevo Function...',
      json: options.json,
      notFoundMessage: messages.FUNCTION_GET_NOT_FOUND(functionId),
    });

    if (!fn) return;

    if (options.json) {
      jsonOutput(fn);
      return;
    }

    const statusText = fn.is_active ? color('32', '● active') : color('90', '○ inactive');

    logInfo(`\n  ${messages.FUNCTION_GET_HEADER}`);
    process.stdout.write(`  ${color('90', '──────────────────────────────────────')}\n\n`);
    process.stdout.write(`  Name:          ${color('1', fn.name)}\n`);
    process.stdout.write(`  ID:            ${fn.id}\n`);
    process.stdout.write(`  Status:        ${statusText}\n`);
    process.stdout.write(`  Description:   ${fn.description}\n`);
    process.stdout.write(`  Explanation:   ${fn.explanation}\n`);
    process.stdout.write(`  Formula:       ${fn.formula}\n`);
    if (fn.category) {
      process.stdout.write(`  Category:      ${fn.category}\n`);
    }
    process.stdout.write(`  Version:       ${fn.version}\n`);
    process.stdout.write(`  Created:       ${color('90', fn.created_at)}\n`);
    process.stdout.write(`  Updated:       ${color('90', fn.updated_at)}\n`);
    if (fn.last_recalculated_at) {
      process.stdout.write(`  Recalculated:  ${color('90', fn.last_recalculated_at)}\n`);
    }
    process.stdout.write('\n');
  },
);
