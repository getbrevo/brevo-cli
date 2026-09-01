import inquirer from 'inquirer';
import { messages } from '../../lang/en';
import { functionService } from '../../container';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { createSpinner, indentChoices } from '../../lib/ui';
import { CliError } from '../../lib/errors';
import { deriveAttributeId } from './preview-table';
import { selectFunctionApp, tryLinkFunctionToApp } from './select-app';
import { tryPreview, nameConfirmDeployLoop } from './deploy-helpers';
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

/** Preview messages for the deploy flow. */
const PREVIEW_MSGS = {
  fetchingContacts: messages.FUNCTION_DEPLOY_FETCHING_CONTACTS,
  executingPreview: messages.FUNCTION_DEPLOY_EXECUTING_PREVIEW,
  previewHeader: messages.FUNCTION_DEPLOY_PREVIEW_HEADER,
  previewError: messages.FUNCTION_DEPLOY_PREVIEW_ERROR,
  previewFailed: messages.FUNCTION_PREVIEW_EXECUTE_FAILED,
} as const;

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
    if (!options.json) {
      await tryPreview(draft.id, PREVIEW_MSGS);
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
      await nameConfirmDeployLoop({
        appId: appId as string,
        msgs: {
          namePrompt: messages.FUNCTION_DEPLOY_NAME_PROMPT,
          nameRequired: messages.FUNCTION_DEPLOY_NAME_REQUIRED,
          warning: messages.FUNCTION_DEPLOY_WARNING,
          confirmPrompt: messages.FUNCTION_DEPLOY_CONFIRM,
          cancelled: messages.FUNCTION_DEPLOY_CANCELLED,
          spinner: messages.FUNCTION_DEPLOY_SPINNER,
          nameExists: messages.FUNCTION_DEPLOY_NAME_EXISTS,
          boxTitle: messages.FUNCTION_DEPLOY_BOX_TITLE,
          boxId: messages.FUNCTION_DEPLOY_BOX_ID,
        },
        createFn: (name) =>
          functionService.createFunction({
            source: 'cli',
            name,
            code: draft.formula,
            description: draft.description,
            explanation: draft.explanation,
            draft_id: draft.id,
            attribute_id: deriveAttributeId(name),
          }),
      });
    }
  },
);
