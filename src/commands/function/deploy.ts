import inquirer from 'inquirer';
import { logInfo, color } from '../../lib/logger';
import { messages } from '../../lang/en';
import { functionService } from '../../container';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { createSpinner, indentChoices, printBox } from '../../lib/ui';
import { ApiError, CliError } from '../../lib/errors';
import { deriveAttributeId, hasPreviewErrors, printResultsTable } from './preview-table';
import { selectFunctionApp, tryLinkFunctionToApp } from './select-app';
import type { DpDraftFunction } from '../../types';

/** Refuse the draft picker when there is no terminal to draw it on. */
function assertInteractiveTerminal(): void {
  if (!process.stdin.isTTY) {
    throw new CliError(messages.FUNCTION_DEPLOY_NON_INTERACTIVE);
  }
}

/** Fetch the draft list and prompt the user to pick one. */
async function promptDraftFunctionSelection(): Promise<DpDraftFunction> {
  const spinner = createSpinner('Fetching drafts...');
  let list;
  try {
    list = await functionService.fetchDraftFunctionList();
  } finally {
    spinner.stop();
  }

  const drafts = list.drafts || [];
  if (drafts.length === 0) {
    throw new CliError(messages.FUNCTION_DEPLOY_NO_DRAFTS);
  }

  const { selected } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selected',
      message: messages.FUNCTION_DEPLOY_SELECT,
      pageSize: 15,
      choices: indentChoices(
        drafts.map((d) => ({
          name: `${d.id}  —  ${d.description || '(no description)'}`,
          value: d.id,
        })),
      ),
    },
  ]);

  return drafts.find((d) => d.id === selected)!;
}

/** Fetch a single draft by ID from the list endpoint. */
async function fetchDraftById(id: string): Promise<DpDraftFunction> {
  const list = await functionService.fetchDraftFunctionList();
  const draft = (list.drafts || []).find((d) => d.id === id);
  if (!draft) {
    throw new CliError(messages.FUNCTION_DEPLOY_NOT_FOUND(id));
  }
  return draft;
}

/** Fetch sample contacts and execute a preview, printing a results table. Non-fatal. */
async function executePreview(draftId: string): Promise<void> {
  const contactSpinner = createSpinner(messages.FUNCTION_DEPLOY_FETCHING_CONTACTS);
  let contactData;
  try {
    contactData = await functionService.fetchContacts();
  } finally {
    contactSpinner.stop();
  }

  const previewSpinner = createSpinner(messages.FUNCTION_DEPLOY_EXECUTING_PREVIEW);
  let executeResponse;
  try {
    executeResponse = await functionService.executeTemplate({
      draft_id: draftId,
      contact_data: contactData.contacts,
    });
  } finally {
    previewSpinner.stop();
  }

  const results = executeResponse.result || [];
  if (hasPreviewErrors(results)) {
    throw new CliError(messages.FUNCTION_PREVIEW_EXECUTE_FAILED);
  }
  logInfo(`\n  ${messages.FUNCTION_DEPLOY_PREVIEW_HEADER}`);
  printResultsTable(results);
}

function isDuplicateNameError(err: unknown): boolean {
  return err instanceof ApiError && err.statusCode === 409;
}

/** Derive a function name from a draft's description for --json mode. */
function deriveNameFromDescription(description: string): string {
  const trimmed = description.trim();
  if (!trimmed) return 'Untitled Function';
  if (trimmed.length <= 50) return trimmed;
  // Cut at last space within 50 chars to land on a word boundary
  const lastSpace = trimmed.lastIndexOf(' ', 50);
  return lastSpace > 0 ? trimmed.slice(0, lastSpace) : trimmed.slice(0, 50);
}

/** Deploy in --json mode: derive name from description, skip prompts. */
async function deployJsonMode(draft: DpDraftFunction, appId?: string): Promise<void> {
  const name = deriveNameFromDescription(draft.description || '');
  const deploySpinner = createSpinner(messages.FUNCTION_DEPLOY_SPINNER, { silent: true });
  try {
    const created = await functionService.createFunction({
      source: 'cli',
      name,
      code: draft.formula,
      description: draft.description,
      explanation: draft.explanation,
      draft_id: draft.id,
      attribute_id: deriveAttributeId(name),
    });
    deploySpinner.stop();

    // Point 1 & 2: link silently in JSON mode, report status in the payload
    let linked = false;
    if (appId) {
      linked = await tryLinkFunctionToApp(appId, created.id, { silent: true });
    }

    jsonOutput({
      deployed: true,
      id: created.id,
      name: created.name,
      version: created.version,
      linked,
      ...(appId ? { app_id: appId } : {}),
    });
  } catch (err) {
    deploySpinner.stop();
    throw err;
  }
}

/** Interactive deploy: name prompt -> confirm -> deploy, retrying on duplicate name (409). */
async function deployInteractive(draft: DpDraftFunction, appId: string): Promise<void> {
  let defaultName = '';
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { functionName } = await inquirer.prompt([
      {
        type: 'input',
        name: 'functionName',
        message: messages.FUNCTION_DEPLOY_NAME_PROMPT,
        default: defaultName || undefined,
        validate: (v: string) => (v.trim() ? true : messages.FUNCTION_DEPLOY_NAME_REQUIRED),
      },
    ]);

    logInfo(`\n  ${messages.FUNCTION_DEPLOY_WARNING}\n`);
    const { confirmDeploy } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmDeploy',
        message: messages.FUNCTION_DEPLOY_CONFIRM,
        default: false,
      },
    ]);

    if (!confirmDeploy) {
      logInfo(messages.FUNCTION_DEPLOY_CANCELLED);
      return;
    }

    const deploySpinner = createSpinner(messages.FUNCTION_DEPLOY_SPINNER);
    try {
      const created = await functionService.createFunction({
        source: 'cli',
        name: functionName.trim(),
        code: draft.formula,
        description: draft.description,
        explanation: draft.explanation,
        draft_id: draft.id,
        attribute_id: deriveAttributeId(functionName.trim()),
      });
      deploySpinner.stop();

      await tryLinkFunctionToApp(appId, created.id);

      printBox(messages.FUNCTION_DEPLOY_BOX_TITLE, [
        `Name: ${created.name}`,
        messages.FUNCTION_DEPLOY_BOX_ID(created.id),
      ]);
      return;
    } catch (err) {
      deploySpinner.stop();
      if (isDuplicateNameError(err)) {
        logInfo(messages.FUNCTION_DEPLOY_NAME_EXISTS);
        defaultName = functionName.trim();
        continue;
      }
      throw err;
    }
  }
}

/** Try running a preview, logging a warning on network failure. Fatal on data errors. */
async function tryPreview(draftId: string): Promise<void> {
  try {
    await executePreview(draftId);
  } catch (err) {
    if (err instanceof CliError) throw err;
    logInfo(`  ${color('33', messages.FUNCTION_DEPLOY_PREVIEW_ERROR)}`);
  }
}

export const deployFunctionCommand = withCommandHandler(
  async (options: { id?: string; json?: boolean; appId?: string }): Promise<void> => {
    // Step 1: Resolve draft
    let draft: DpDraftFunction;
    if (options.id) {
      const spinner = createSpinner('Fetching draft...', { silent: options.json });
      try {
        draft = await fetchDraftById(options.id);
      } finally {
        spinner.stop();
      }
    } else {
      assertInteractiveTerminal();
      draft = await promptDraftFunctionSelection();
    }

    // Step 2: Preview — fatal on data errors (__error), non-fatal on network issues
    // Point 4: moved before app selection so a preview failure doesn't waste a round-trip
    if (!options.json) {
      await tryPreview(draft.id);
    }

    // Step 3: Resolve app to link the function to
    // Point 5: narrowed appId type so the non-null assertion is unnecessary
    let appId: string | undefined = options.appId;
    if (!appId && !options.json) {
      appId = await selectFunctionApp(
        messages.FUNCTION_DEPLOY_SELECT_APP,
        messages.FUNCTION_DEPLOY_NO_APPS,
      );
    }

    // Step 4-5: Name + confirm (interactive) or derive name (--json)
    if (options.json) {
      await deployJsonMode(draft, appId);
    } else {
      // appId is always defined here: either from --app-id or from the picker above
      await deployInteractive(draft, appId as string);
    }
  },
);
