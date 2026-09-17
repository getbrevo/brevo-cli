import inquirer from 'inquirer';
import { color } from '../../lib/logger';
import { functionService } from '../../container';
import { createSpinner, indentChoices } from '../../lib/ui';
import { CliError } from '../../lib/errors';
import { messages } from '../../lang/en';

/**
 * Refuse a function picker when there is no terminal to draw it on.
 * Call BEFORE any picker on a command whose function can also be named with `--id`.
 */
export function assertFunctionSelectionAllowed(command: string, jsonMode?: boolean): void {
  if (jsonMode || !process.stdin.isTTY) {
    throw new CliError(messages.FUNCTION_SELECT_NON_INTERACTIVE(command));
  }
}

/**
 * Fetch the function list and prompt the user to pick one.
 * Returns the selected function's ID.
 */
export async function promptFunctionSelection(
  promptMessage: string,
): Promise<{ functionId: string; functionName: string }> {
  const spinner = createSpinner('Fetching functions...');
  let list;
  try {
    list = await functionService.fetchFunctionList();
  } finally {
    spinner.stop();
  }

  const functions = list.functions || [];
  if (functions.length === 0) {
    throw new CliError(messages.FUNCTION_LIST_EMPTY);
  }

  const { selected } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selected',
      message: promptMessage,
      pageSize: 15,
      choices: indentChoices(
        functions.map((fn) => {
          const status = fn.is_active ? color('32', '● active') : color('90', '○ inactive');
          return {
            name: `${fn.name}  ${status}`,
            value: fn.id,
          };
        }),
      ),
    },
  ]);

  const matched = functions.find((fn) => fn.id === selected);
  return { functionId: selected as string, functionName: matched?.name || (selected as string) };
}
