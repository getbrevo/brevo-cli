import inquirer from 'inquirer';
import { logInfo, color } from '../../lib/logger';
import { messages } from '../../lang/en';
import { functionService, sseDeps } from '../../container';
import { withCommandHandler } from '../../lib/command-handler';
import { createSpinner, indentChoices } from '../../lib/ui';
import { ApiError, CliError } from '../../lib/errors';
import { deriveAttributeId } from './preview-table';
import { selectFunctionApp } from './select-app';
import { executePreview, tryPreview, nameConfirmDeployLoop } from './deploy-helpers';
import type { SSEEvent } from '../../api/sse-stream';
import type { ChatHistoryEntry, FunctionGenerateSSEEvent } from '../../types';

interface GenerateResult {
  code: string;
  name?: string;
  draftId?: string;
  sessionId?: string;
  category?: string;
  description?: string;
  explanation?: string;
}

/** Stage -> colored spinner message. ANSI codes: 36=cyan, 33=yellow, 35=magenta, 32=green. */
const STAGE_LABELS: Record<string, { label: string; colorCode: string }> = {
  enriching: { label: messages.FUNCTION_INIT_STAGE_ENRICHING, colorCode: '36' },
  planning_agent: { label: messages.FUNCTION_INIT_STAGE_PLANNING, colorCode: '33' },
  executing_agent: { label: messages.FUNCTION_INIT_STAGE_GENERATING, colorCode: '35' },
  validating: { label: messages.FUNCTION_INIT_STAGE_VALIDATING, colorCode: '32' },
};

/** Update the spinner based on a progress event's stage or message. */
function updateSpinnerFromEvent(
  parsed: FunctionGenerateSSEEvent,
  spinner: ReturnType<typeof createSpinner>,
): void {
  const stage = parsed.value?.stage;
  const info = stage ? STAGE_LABELS[stage] : undefined;
  if (info) {
    spinner.update(color(info.colorCode, info.label));
  } else if (parsed.value?.message) {
    spinner.update(parsed.value.message);
  }
}

/** Copy result fields from a parsed SSE event into the accumulator. */
function accumulateResult(
  result: GenerateResult,
  r: NonNullable<FunctionGenerateSSEEvent['result']>,
): void {
  if (r.code) result.code = r.code;
  if (r.name) result.name = r.name;
  if (r.draft_id) result.draftId = r.draft_id;
  if (r.session_id) result.sessionId = r.session_id;
  if (r.category) result.category = r.category;
  if (r.description) result.description = r.description;
  if (r.explanation) result.explanation = r.explanation;
}

/**
 * Consume an SSE stream from the AI generation endpoint, updating the spinner
 * per stage, and return the accumulated result.
 *
 * The API sends several event types:
 *  - CUSTOM (generation_progress): `{ value: { message, stage } }` -- progress
 *  - RUN_STARTED:  generation began (no-op)
 *  - RUN_FINISHED: `{ result: { code, name, ... } }` -- final result
 *  - RUN_ERROR:    `{ error: "..." }` -- failure
 */
async function processGenerateStream(
  stream: AsyncGenerator<SSEEvent>,
  spinner: ReturnType<typeof createSpinner>,
): Promise<GenerateResult> {
  const result: GenerateResult = { code: '' };

  for await (const event of stream) {
    let parsed: FunctionGenerateSSEEvent;
    try {
      parsed = JSON.parse(event.data) as FunctionGenerateSSEEvent;
    } catch {
      continue;
    }

    if (parsed.error) {
      throw new CliError(parsed.error);
    }

    updateSpinnerFromEvent(parsed, spinner);

    if (parsed.result) {
      accumulateResult(result, parsed.result);
    }
  }

  if (!result.code) {
    throw new CliError(messages.FUNCTION_INIT_GENERATION_FAILED);
  }

  return result;
}

/** Merge an iterate result into the current state, keeping existing values when the update is absent. */
function mergeGenerateResult(base: GenerateResult, update: GenerateResult): GenerateResult {
  return {
    code: update.code || base.code,
    name: update.name || base.name,
    draftId: update.draftId || base.draftId,
    sessionId: update.sessionId || base.sessionId,
    category: update.category || base.category,
    description: update.description || base.description,
    explanation: update.explanation || base.explanation,
  };
}

/** Preview messages for the init flow. */
const PREVIEW_MSGS = {
  fetchingContacts: messages.FUNCTION_INIT_FETCHING_CONTACTS,
  executingPreview: messages.FUNCTION_INIT_EXECUTING_PREVIEW,
  previewHeader: messages.FUNCTION_INIT_PREVIEW_HEADER,
  previewError: messages.FUNCTION_INIT_PREVIEW_ERROR,
  previewFailed: messages.FUNCTION_PREVIEW_EXECUTE_FAILED,
} as const;

/** Name-confirm-deploy messages for the init flow. */
const DEPLOY_MSGS = {
  namePrompt: messages.FUNCTION_INIT_NAME_PROMPT,
  nameRequired: messages.FUNCTION_INIT_NAME_REQUIRED,
  warning: messages.FUNCTION_INIT_DEPLOY_WARNING,
  confirmPrompt: messages.FUNCTION_INIT_DEPLOY_PROMPT,
  cancelled: messages.FUNCTION_INIT_DEPLOY_CANCELLED,
  spinner: messages.FUNCTION_INIT_SAVE_SPINNER,
  nameExists: messages.FUNCTION_INIT_NAME_EXISTS,
  boxTitle: messages.FUNCTION_INIT_BOX_TITLE,
  boxId: messages.FUNCTION_INIT_BOX_ID,
} as const;

interface SaveFunctionArgs {
  appId: string;
  code: string;
  draftId?: string;
  name?: string;
  category?: string;
  description?: string;
  explanation?: string;
}

/** Save a generated function via the shared name-confirm-deploy loop. */
async function saveGeneratedFunction(args: SaveFunctionArgs): Promise<void> {
  await nameConfirmDeployLoop({
    appId: args.appId,
    defaultName: args.name,
    msgs: DEPLOY_MSGS,
    createFn: (name) =>
      functionService.createFunction({
        source: 'cli',
        name,
        code: args.code,
        category: args.category,
        description: args.description,
        explanation: args.explanation,
        app_id: args.appId,
        draft_id: args.draftId,
        attribute_id: deriveAttributeId(name),
      }),
  });
}

/** Run one iterate round: prompt, stream, merge, preview. Returns the updated result or null on failure. */
async function runIterateRound(
  current: GenerateResult,
  chatHistory: ChatHistoryEntry[],
): Promise<GenerateResult | null> {
  const { iterateDescription } = await inquirer.prompt([
    {
      type: 'input',
      name: 'iterateDescription',
      message: messages.FUNCTION_INIT_ITERATE_DESCRIPTION,
      validate: (v: string) => (v.trim() ? true : messages.FUNCTION_INIT_DESCRIPTION_REQUIRED),
    },
  ]);

  if (!current.draftId) {
    throw new CliError(messages.FUNCTION_INIT_GENERATION_FAILED);
  }

  const iterateSpinner = createSpinner(messages.FUNCTION_INIT_ITERATING);
  try {
    const iterateStream = functionService.iterateStream(sseDeps, {
      draft_function_id: current.draftId,
      user_prompt: iterateDescription.trim(),
      previous_code: current.code,
      chat_history: chatHistory,
      source: 'cli',
    });
    const iterateResult = await processGenerateStream(iterateStream, iterateSpinner);
    iterateSpinner.stop();

    chatHistory.push(
      { role: 'user', content: iterateDescription.trim() },
      { role: 'assistant', content: iterateResult.code },
    );

    return mergeGenerateResult(current, iterateResult);
  } catch (err) {
    iterateSpinner.stop();
    if (err instanceof ApiError || err instanceof CliError) throw err;
    logInfo(`  ${color('31', messages.FUNCTION_INIT_ITERATE_ERROR)}`);
    return null;
  }
}

async function aiGenerationFlow(appId: string): Promise<void> {
  const { description } = await inquirer.prompt([
    {
      type: 'input',
      name: 'description',
      message: messages.FUNCTION_INIT_DESCRIPTION_PROMPT,
      validate: (v: string) => (v.trim() ? true : messages.FUNCTION_INIT_DESCRIPTION_REQUIRED),
    },
  ]);

  const chatHistory: ChatHistoryEntry[] = [];

  // Initial generation
  const genSpinner = createSpinner(messages.FUNCTION_INIT_GENERATING);
  let result: GenerateResult;
  try {
    const stream = functionService.generateStream(sseDeps, {
      user_prompt: description.trim(),
      source: 'cli',
    });
    result = await processGenerateStream(stream, genSpinner);
  } catch (err) {
    genSpinner.stop();
    if (err instanceof ApiError || err instanceof CliError) throw err;
    throw new CliError(messages.FUNCTION_INIT_GENERATION_ERROR);
  }
  genSpinner.stop();

  chatHistory.push(
    { role: 'user', content: description.trim() },
    { role: 'assistant', content: result.code },
  );

  await tryPreview({ draft_id: result.draftId }, PREVIEW_MSGS);

  // Iteration loop
  let current = { ...result };

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: messages.FUNCTION_INIT_ITERATE_PROMPT,
        choices: indentChoices([
          { name: messages.FUNCTION_INIT_ITERATE_UPDATE, value: 'update' },
          { name: messages.FUNCTION_INIT_ITERATE_SAVE, value: 'save' },
        ]),
      },
    ]);

    if (action === 'save') {
      await saveGeneratedFunction({
        appId,
        code: current.code,
        draftId: current.draftId,
        name: current.name,
        category: current.category,
        description: current.description,
        explanation: current.explanation,
      });
      break;
    }

    const updated = await runIterateRound(current, chatHistory);
    if (updated) {
      current = updated;
      await tryPreview({ draft_id: current.draftId }, PREVIEW_MSGS);
    }
  }
}

async function templateFlow(appId: string): Promise<void> {
  // Step 1: Fetch and select template
  const templateSpinner = createSpinner('Fetching templates...');
  let templates;
  try {
    templates = await functionService.fetchTemplates();
  } finally {
    templateSpinner.stop();
  }

  if (!templates || templates.length === 0) {
    throw new CliError(messages.FUNCTION_INIT_NO_TEMPLATES);
  }

  const { templateId } = await inquirer.prompt([
    {
      type: 'list',
      name: 'templateId',
      message: messages.FUNCTION_INIT_TEMPLATE_PROMPT,
      pageSize: 15,
      choices: indentChoices(
        templates.map((t) => ({
          name: `${t.name}  —  ${t.description}`,
          value: t.id,
        })),
      ),
    },
  ]);

  const template = templates.find((t) => t.id === templateId)!;

  // Steps 2-4: Fetch contacts, execute template preview, print results
  await executePreview(
    { template_id: template.id },
    { ...PREVIEW_MSGS, afterHeader: `\n  Description:   ${template.description}\n` },
  );

  // Steps 5-7: Name -> confirm -> deploy, retrying on duplicate name.
  await nameConfirmDeployLoop({
    appId,
    defaultName: template.name,
    msgs: { ...DEPLOY_MSGS, spinner: messages.FUNCTION_INIT_CREATING_FROM_TEMPLATE },
    createFn: (name) =>
      functionService.createFromTemplate({
        global_function_id: template.id,
        name,
        description: template.description,
        category: template.category || '',
        attribute_id: deriveAttributeId(name),
        source: 'cli',
      }),
  });
}

export const initFunctionCommand = withCommandHandler(
  async (options: { json?: boolean }): Promise<void> => {
    // Guard: interactive-only
    if (options.json || !process.stdin.isTTY) {
      throw new CliError(messages.FUNCTION_INIT_NON_INTERACTIVE);
    }

    // Step 1: App selection
    const appId = await selectFunctionApp(
      messages.FUNCTION_INIT_SELECT_APP,
      messages.FUNCTION_INIT_NO_APPS,
    );

    // Step 2: Method selection
    const { method } = await inquirer.prompt([
      {
        type: 'list',
        name: 'method',
        message: messages.FUNCTION_INIT_METHOD_PROMPT,
        choices: indentChoices([
          { name: messages.FUNCTION_INIT_METHOD_AI, value: 'ai' },
          { name: messages.FUNCTION_INIT_METHOD_TEMPLATE, value: 'template' },
        ]),
      },
    ]);

    if (method === 'ai') {
      await aiGenerationFlow(appId);
    } else {
      await templateFlow(appId);
    }
  },
);
