import { withCommandHandler } from '../../lib/command-handler';
import { createSpinner } from '../../lib/ui';
import { logInfo } from '../../lib/logger';
import { jsonOutput } from '../../lib/json-output';
import { messages } from '../../lang/en';
import { dpFunctionsService } from '../../container';

export const dpListCommand = withCommandHandler(
  async (options: { json?: boolean }): Promise<void> => {
    const spinner = createSpinner('Fetching functions...', { silent: options.json });
    const functions = await dpFunctionsService.fetchFunctions();
    spinner.stop();

    if (options.json) {
      jsonOutput(functions);
      return;
    }

    if (functions.length === 0) {
      logInfo(`\n  ${messages.DP_LIST_EMPTY}\n`);
      return;
    }

    logInfo(`\n  Functions (${functions.length}):\n`);
    const nameWidth = Math.max(4, ...functions.map((f) => f.name.length));
    const idWidth = Math.max(2, ...functions.map((f) => f.id.length));

    logInfo(`  ${'NAME'.padEnd(nameWidth)}  ${'ID'.padEnd(idWidth)}  ${'VER'}  CREATED`);
    logInfo(`  ${'─'.repeat(nameWidth)}  ${'─'.repeat(idWidth)}  ${'───'}  ${'──────────'}`);

    for (const fn of functions) {
      const created = fn.created_at.slice(0, 10);
      logInfo(
        `  ${fn.name.padEnd(nameWidth)}  ${fn.id.padEnd(idWidth)}  v${String(fn.version).padEnd(2)}  ${created}`,
      );
    }
    logInfo('');
  },
);
