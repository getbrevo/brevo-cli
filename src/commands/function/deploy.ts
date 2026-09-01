import inquirer from 'inquirer';
import { logInfo, color } from '../../lib/logger';
import { messages } from '../../lang/en';
import { appService, functionService } from '../../container';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { createSpinner, indentChoices, printBox } from '../../lib/ui';
import { ApiError, CliError } from '../../lib/errors';
import { deriveAttributeId, hasPreviewErrors, printResultsTable } from './preview-table';
import type { DpDraftFunction, OAuthApp } from '../../types';

/** Refuse the draft picker when there is no terminal to draw it on. */
function assertInteractiveTerminal(): void {
  if (!process.stdin.isTTY) {
    throw new CliError(messages.FUNCTION_DEPLOY_NON_INTERACTIVE);
  }
}

/** Fetch brevo_function apps and prompt the user to pick one. */
async function selectApp(): Promise<OAuthApp> {
  const spinner = createSpinner('Fetching apps...');
  let apps: OAuthApp[];
  try {
    apps = await appService.fetchAppsList({ type: 'brevo_function' });
  } finally {
    spinner.stop();
  }

  if (apps.length === 0) {
    throw new CliError(messages.FUNCTION_DEPLOY_NO_APPS);
  }

  const { selected } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selected',
      message: messages.FUNCTION_DEPLOY_SELECT_APP,
      pageSize: 15,
      choices: indentChoices(
        apps.map((a) => ({
          name: `${a.name || 'App ' + a.app_id}  (ID: ${a.app_id})`,
          value: a.app_id,
        })),
      ),
    },
  ]);

  return apps.find((a) => a.app_id === selected)!;
}

/** Link a deployed function to an app. Non-fatal — logs a warning on failure. */
async function tryLinkFunctionToApp(appId: string, functionId: string): Promise<void> {
  const spinner = createSpinner(messages.FUNCTION_DEPLOY_LINKING);
  try {
    await functionService.linkFunctionToApp({ app_id: appId, function_id: functionId });
  } catch {
    logInfo(`  ${color('33', messages.FUNCTION_DEPLOY_LINK_ERROR)}`);
  } finally {
    spinner.stop();
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

    if (appId) {
      await tryLinkFunctionToApp(appId, created.id);
    }

    jsonOutput({
      deployed: true,
      id: created.id,
      name: created.name,
      version: created.version,
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

    // Step 2: Resolve app to link the function to
    let appId: string | undefined = options.appId;
    if (!appId && !options.json) {
      const app = await selectApp();
      appId = app.app_id;
    }

    // Step 3: Preview — fatal on data errors (__error), non-fatal on network issues
    if (!options.json) {
      await tryPreview(draft.id);
    }

    // Step 4-5: Name + confirm (interactive) or derive name (--json)
    if (options.json) {
      await deployJsonMode(draft, appId);
    } else {
      await deployInteractive(draft, appId!);
    }
  },
);
