import * as fs from 'node:fs';
import { withCommandHandler } from '../../lib/command-handler';
import { createSpinner } from '../../lib/ui';
import { logInfo, logSuccess } from '../../lib/logger';
import { jsonOutput } from '../../lib/json-output';
import { messages } from '../../lang/en';
import { dpFunctionsService } from '../../container';

export const dpGetCommand = withCommandHandler(
  async (options: { id: string; output?: string; json?: boolean }): Promise<void> => {
    const spinner = createSpinner('Fetching function...', { silent: options.json });
    const fn = await dpFunctionsService.fetchFunction(options.id);
    spinner.stop();

    if (options.json) {
      jsonOutput(fn);
      return;
    }

    logInfo(`\n  Name:        ${fn.name}`);
    logInfo(`  ID:          ${fn.id}`);
    logInfo(`  Version:     ${fn.version}`);
    logInfo(`  Active:      ${fn.is_active}`);
    if (fn.description) logInfo(`  Description: ${fn.description}`);
    if (fn.scopes?.length) logInfo(`  Scopes:      ${fn.scopes.join(', ')}`);
    logInfo(`  Created:     ${fn.created_at.slice(0, 19).replace('T', ' ')}`);
    logInfo(`  Updated:     ${fn.updated_at.slice(0, 19).replace('T', ' ')}`);
    logInfo('');
    logInfo('  ── Code ──\n');
    logInfo(fn.code);
    logInfo('');

    if (options.output) {
      fs.writeFileSync(options.output, fn.code, 'utf-8');
      logSuccess(messages.DP_GENERATE_SUCCESS(options.output));
    }
  },
);
