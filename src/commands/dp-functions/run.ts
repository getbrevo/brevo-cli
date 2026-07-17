import * as fs from 'node:fs';
import { withCommandHandler } from '../../lib/command-handler';
import { createSpinner } from '../../lib/ui';
import { logSuccess, logInfo } from '../../lib/logger';
import { jsonOutput } from '../../lib/json-output';
import { CliError } from '../../lib/errors';
import { messages } from '../../lang/en';
import { dpFunctionsService } from '../../container';

function parseContactData(data?: string, dataFile?: string): unknown {
  if (data && dataFile) {
    throw new CliError('Provide either --data or --data-file, not both.');
  }

  let raw: string;
  if (data) {
    raw = data;
  } else if (dataFile) {
    if (!fs.existsSync(dataFile)) {
      throw new CliError(messages.DP_FILE_NOT_FOUND(dataFile));
    }
    raw = fs.readFileSync(dataFile, 'utf-8');
  } else {
    throw new CliError(messages.DP_RUN_MISSING_DATA);
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new CliError(messages.DP_INVALID_JSON('contact data is not valid JSON'));
  }
}

export const dpRunCommand = withCommandHandler(
  async (options: {
    file?: string;
    id?: string;
    data?: string;
    dataFile?: string;
    json?: boolean;
  }): Promise<void> => {
    if (options.file && options.id) {
      throw new CliError(messages.DP_RUN_MUTUALLY_EXCLUSIVE);
    }
    if (!options.file && !options.id) {
      throw new CliError(messages.DP_RUN_MISSING_SOURCE);
    }

    const contactData = parseContactData(options.data, options.dataFile);
    const spinner = createSpinner('Executing function...', { silent: options.json });

    let result;
    if (options.file) {
      if (!fs.existsSync(options.file)) {
        throw new CliError(messages.DP_FILE_NOT_FOUND(options.file));
      }
      const code = fs.readFileSync(options.file, 'utf-8');
      result = await dpFunctionsService.execute(code, contactData);
    } else {
      result = await dpFunctionsService.executeStored(options.id!, contactData);
    }

    spinner.stop();

    if (options.json) {
      jsonOutput(result);
      return;
    }

    if (result.success) {
      logSuccess('Execution succeeded.');
      logInfo(`\n  Result:\n${JSON.stringify(result.result, null, 2)}\n`);
    } else {
      logInfo(`\n  ${messages.DP_EXECUTE_FAILED(result.error || 'unknown error')}\n`);
    }
  },
);
