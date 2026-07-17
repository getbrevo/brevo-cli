import * as fs from 'node:fs';
import { withCommandHandler } from '../../lib/command-handler';
import { createSpinner } from '../../lib/ui';
import { logSuccess, logError, logInfo } from '../../lib/logger';
import { jsonOutput } from '../../lib/json-output';
import { CliError } from '../../lib/errors';
import { messages } from '../../lang/en';
import { dpFunctionsService } from '../../container';

export const dpValidateCommand = withCommandHandler(
  async (options: { file: string; json?: boolean }): Promise<void> => {
    if (!fs.existsSync(options.file)) {
      throw new CliError(messages.DP_FILE_NOT_FOUND(options.file));
    }

    const code = fs.readFileSync(options.file, 'utf-8');
    const spinner = createSpinner('Validating...', { silent: options.json });
    const result = await dpFunctionsService.validate(code);
    spinner.stop();

    if (options.json) {
      jsonOutput(result);
      return;
    }

    if (result.valid) {
      logSuccess(messages.DP_VALIDATE_PASSED);
    } else {
      logError(messages.DP_VALIDATE_FAILED);
      for (const err of result.errors || []) {
        logInfo(`    ${err}`);
      }
      logInfo('');
    }
  },
);
