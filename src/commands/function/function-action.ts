import { logWarn } from '../../lib/logger';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { createSpinner, printStatusCard } from '../../lib/ui';
import { ApiError } from '../../lib/errors';
import { assertFunctionSelectionAllowed, promptFunctionSelection } from './select-function';
import type { StatusTone } from '../../lib/ui';

export interface FunctionActionMessages {
  selectPrompt: string;
  notFound: (id: string) => string;
  spinnerText: string;
  cardTitle: string;
  cardLabel: string;
  cardMessage: (id: string) => string;
}

export interface FunctionActionConfig {
  commandName: string;
  messages: FunctionActionMessages;
  /** The key used in the JSON success output (e.g. "activated", "deactivated"). */
  jsonSuccessKey: string;
  cardTone: StatusTone;
  execute: (id: string) => Promise<void>;
}

/**
 * Resolve the function ID from options or interactive prompt, then execute the
 * service call with spinner, 404 handling, and JSON/card output.
 *
 * Exported separately from the command builder so callers that already own the
 * `withCommandHandler` wrapper (e.g. `delete`, which adds a confirmation step)
 * can call this without double-wrapping.
 */
export async function executeFunctionAction(
  config: FunctionActionConfig,
  options: { id?: string; json?: boolean },
): Promise<void> {
  let functionId = options.id;
  if (!functionId) {
    assertFunctionSelectionAllowed(config.commandName, options.json);
    const selection = await promptFunctionSelection(config.messages.selectPrompt);
    functionId = selection.functionId;
  }

  const spinner = createSpinner(config.messages.spinnerText, { silent: options.json });
  try {
    await config.execute(functionId);
  } catch (err) {
    if (err instanceof ApiError && err.statusCode === 404) {
      spinner.stop();
      if (options.json) {
        jsonOutput({
          error: 'not_found',
          message: config.messages.notFound(functionId),
        });
        return;
      }
      logWarn(`\n  ${config.messages.notFound(functionId)}\n`);
      return;
    }
    throw err;
  } finally {
    spinner.stop();
  }

  if (options.json) {
    jsonOutput({ [config.jsonSuccessKey]: true, id: functionId });
    return;
  }
  printStatusCard(
    config.messages.cardTitle,
    config.messages.cardLabel,
    config.messages.cardMessage(functionId),
    config.cardTone,
  );
}

/**
 * Build a function state-change command (activate, deactivate).
 * Wraps `executeFunctionAction` in `withCommandHandler`.
 */
export function buildFunctionActionCommand(config: FunctionActionConfig) {
  return withCommandHandler(async (options: { id?: string; json?: boolean }): Promise<void> => {
    await executeFunctionAction(config, options);
  });
}
