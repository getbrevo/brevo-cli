import { logWarn } from '../../lib/logger';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { createSpinner, printStatusCard } from '../../lib/ui';
import { ApiError } from '../../lib/errors';
import { assertFunctionSelectionAllowed, promptFunctionSelection } from './select-function';
import type { StatusTone } from '../../lib/ui';

/**
 * Resolve the function ID from `--id` or an interactive prompt.
 * Shared by every function command that accepts an optional `--id`.
 */
export async function resolveFunctionId(
  commandName: string,
  selectPrompt: string,
  options: { id?: string; json?: boolean },
): Promise<string> {
  if (options.id) return options.id;
  assertFunctionSelectionAllowed(commandName, options.json);
  const selection = await promptFunctionSelection(selectPrompt);
  return selection.functionId;
}

/**
 * Run `fn` inside a spinner. On a 404 `ApiError`, emit a not-found message
 * (JSON or human) and return `undefined`; on any other error, rethrow.
 */
export async function withNotFoundHandling<T>(
  fn: () => Promise<T>,
  opts: {
    spinnerText: string;
    json?: boolean;
    notFoundMessage: string;
  },
): Promise<T | undefined> {
  const spinner = createSpinner(opts.spinnerText, { silent: opts.json });
  try {
    const result = await fn();
    return result;
  } catch (err) {
    if (err instanceof ApiError && err.statusCode === 404) {
      spinner.stop();
      if (opts.json) {
        jsonOutput({ error: 'not_found', message: opts.notFoundMessage });
        return undefined;
      }
      logWarn(`\n  ${opts.notFoundMessage}\n`);
      return undefined;
    }
    throw err;
  } finally {
    spinner.stop();
  }
}

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
 * Resolve the function ID, then execute the service call with spinner,
 * 404 handling, and JSON/card output.
 *
 * Uses `withNotFoundHandling` with a sentinel return so we can distinguish
 * a successful void execute from a 404 (both would be `undefined` for a
 * `() => Promise<void>`).
 */
export async function executeFunctionAction(
  config: FunctionActionConfig,
  options: { id?: string; json?: boolean },
): Promise<void> {
  const functionId = await resolveFunctionId(
    config.commandName,
    config.messages.selectPrompt,
    options,
  );

  const SUCCESS = Symbol('success');
  const result = await withNotFoundHandling(
    async () => {
      await config.execute(functionId);
      return SUCCESS;
    },
    {
      spinnerText: config.messages.spinnerText,
      json: options.json,
      notFoundMessage: config.messages.notFound(functionId),
    },
  );

  // `undefined` means 404 was already handled (logged or JSON-emitted).
  if (result === undefined) return;

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
