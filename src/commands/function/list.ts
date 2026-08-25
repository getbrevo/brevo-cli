import { color, logInfo } from '../../lib/logger';
import { messages } from '../../lang/en';
import { functionService } from '../../container';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { createSpinner } from '../../lib/ui';

/** Colored status badge: evaluated at call time so TTY/NO_COLOR is respected. */
function statusBadge(isActive: boolean): string {
  return isActive ? color('32', '● active') : color('90', '○ inactive');
}

/** Truncate a string to `max` columns, appending … if clipped. */
function truncate(text: string, max: number): string {
  if (!text || text.length <= max) return text || '';
  return text.slice(0, max - 1) + '…';
}

export const listFunctionCommand = withCommandHandler(
  async (options: { json?: boolean; draft?: boolean }): Promise<void> => {
    if (options.draft) {
      return listDraftFunctions(options);
    }
    return listPublishedFunctions(options);
  },
);

async function listPublishedFunctions(options: { json?: boolean }): Promise<void> {
  const spinner = createSpinner('Fetching Brevo Functions...', { silent: options.json });
  let response;
  try {
    response = await functionService.fetchFunctionList();
  } finally {
    spinner.stop();
  }

  const functions = response.functions ?? [];

  if (options.json) {
    jsonOutput(response);
    return;
  }

  if (functions.length === 0) {
    logInfo(`\n  ${messages.FUNCTION_LIST_EMPTY}\n`);
    return;
  }

  logInfo(`\n  ${messages.FUNCTION_LIST_HEADER}`);
  process.stdout.write(`  ${color('90', '──────────────────────────────────────')}\n\n`);

  for (const fn of functions) {
    const idLabel = `(${fn.id})`;
    process.stdout.write(`  ${color('1', fn.name)}  ${color('90', idLabel)}\n`);
    process.stdout.write(`    Status:      ${statusBadge(fn.is_active)}\n`);
    if (fn.description) {
      process.stdout.write(`    Description: ${color('90', truncate(fn.description, 60))}\n`);
    }
    process.stdout.write(`    Formula:     ${fn.formula}\n`);
    process.stdout.write('\n');
  }

  const usageLabel = `${response.total} of ${response.max} functions used`;
  process.stdout.write(`  ${color('90', usageLabel)}\n\n`);
}

async function listDraftFunctions(options: { json?: boolean }): Promise<void> {
  const spinner = createSpinner('Fetching draft Brevo Functions...', { silent: options.json });
  let response;
  try {
    response = await functionService.fetchDraftFunctionList();
  } finally {
    spinner.stop();
  }

  const drafts = response.drafts ?? [];

  if (options.json) {
    jsonOutput(response);
    return;
  }

  if (drafts.length === 0) {
    logInfo(`\n  ${messages.FUNCTION_LIST_DRAFT_EMPTY}\n`);
    return;
  }

  logInfo(`\n  ${messages.FUNCTION_LIST_DRAFT_HEADER}\n`);

  for (const fn of drafts) {
    process.stdout.write(`  ${fn.id}\n`);
    process.stdout.write(`    Description: ${fn.description}\n`);
    process.stdout.write(`    Formula:     ${fn.formula}\n`);
    process.stdout.write(`    Created:     ${fn.created_at}\n`);
    process.stdout.write(`    Expires:     ${fn.expires_at}\n`);
    process.stdout.write('\n');
  }

  process.stdout.write(`  Total: ${response.total}\n\n`);
}
