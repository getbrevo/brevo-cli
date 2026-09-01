import inquirer from 'inquirer';
import { logInfo, color } from '../../lib/logger';
import { messages } from '../../lang/en';
import { appService, functionService, sseDeps } from '../../container';
import { withCommandHandler } from '../../lib/command-handler';
import { createSpinner, indentChoices, printBox } from '../../lib/ui';
import { ApiError, CliError } from '../../lib/errors';
import { deriveAttributeId, hasPreviewErrors, printResultsTable } from './preview-table';
import type { SSEEvent } from '../../api/sse-stream';
import type { ChatHistoryEntry, FunctionGenerateSSEEvent, OAuthApp } from '../../types';

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

async function selectApp(): Promise<OAuthApp> {
  const spinner = createSpinner('Fetching apps...');
  let apps: OAuthApp[];
  try {
    apps = await appService.fetchAppsList({ type: 'brevo_function' });
  } finally {
    spinner.stop();
  }

  if (apps.length === 0) {
    throw new CliError(messages.FUNCTION_INIT_NO_APPS);
  }

  const { selected } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selected',
      message: messages.FUNCTION_INIT_SELECT_APP,
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

/** Fetch sample contacts and execute a preview, printing a results table. */
async function executePreview(draftId: string | undefined): Promise<void> {
  const contactSpinner = createSpinner(messages.FUNCTION_INIT_FETCHING_CONTACTS);
  let contactData;
  try {
    contactData = await functionService.fetchContacts();
  } finally {
    contactSpinner.stop();
  }

  const previewSpinner = createSpinner(messages.FUNCTION_INIT_EXECUTING_PREVIEW);
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
  logInfo(`\n  ${messages.FUNCTION_INIT_PREVIEW_HEADER}`);
  printResultsTable(results);
}

/** Link a deployed function to an app. Non-fatal — logs a warning on failure. */
async function tryLinkFunctionToApp(appId: string, functionId: string): Promise<void> {
  const linkSpinner = createSpinner(messages.FUNCTION_DEPLOY_LINKING);
  try {
    await functionService.linkFunctionToApp({ app_id: appId, function_id: functionId });
  } catch {
    logInfo(`  ${color('33', messages.FUNCTION_DEPLOY_LINK_ERROR)}`);
  } finally {
    linkSpinner.stop();
  }
}

interface SaveFunctionArgs {
  app: OAuthApp;
  code: string;
  draftId?: string;
  name?: string;
  category?: string;
  description?: string;
  explanation?: string;
}

/**
 * Name -> confirm -> deploy loop. Retries on duplicate name.
 * The function exits when the user saves successfully or cancels.
 */
async function saveGeneratedFunction(args: SaveFunctionArgs): Promise<void> {
  let defaultName = args.name || '';
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { functionName } = await inquirer.prompt([
      {
        type: 'input',
        name: 'functionName',
        message: messages.FUNCTION_INIT_NAME_PROMPT,
        default: defaultName,
        validate: (v: string) => (v.trim() ? true : messages.FUNCTION_INIT_NAME_REQUIRED),
      },
    ]);

    logInfo(`\n  ${messages.FUNCTION_INIT_DEPLOY_WARNING}\n`);
    const { confirmDeploy } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmDeploy',
        message: messages.FUNCTION_INIT_DEPLOY_PROMPT,
        default: false,
      },
    ]);

    if (!confirmDeploy) {
      logInfo(messages.FUNCTION_INIT_DEPLOY_CANCELLED);
      return;
    }

    const saveSpinner = createSpinner(messages.FUNCTION_INIT_SAVE_SPINNER);
    try {
      const created = await functionService.createFunction({
        source: 'cli',
        name: functionName.trim(),
        code: args.code,
        category: args.category,
        description: args.description,
        explanation: args.explanation,
        app_id: args.app.app_id,
        draft_id: args.draftId,
        attribute_id: deriveAttributeId(functionName.trim()),
      });
      saveSpinner.stop();

      await tryLinkFunctionToApp(args.app.app_id, created.id);

      printBox(messages.FUNCTION_INIT_BOX_TITLE, [
        `Name: ${created.name}`,
        messages.FUNCTION_INIT_BOX_ID(created.id),
      ]);
      return;
    } catch (err) {
      saveSpinner.stop();
      if (isDuplicateNameError(err)) {
        logInfo(messages.FUNCTION_INIT_NAME_EXISTS);
        defaultName = functionName.trim();
        continue;
      }
      throw err;
    }
  }
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

/** Try running a preview — fatal on data errors (__error), non-fatal on network issues. */
async function tryPreview(draftId: string | undefined): Promise<void> {
  if (!draftId) return;
  try {
    await executePreview(draftId);
  } catch (err) {
    if (err instanceof CliError) throw err;
    logInfo(`  ${color('33', messages.FUNCTION_INIT_PREVIEW_ERROR)}`);
  }
}

async function aiGenerationFlow(app: OAuthApp): Promise<void> {
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

  await tryPreview(result.draftId);

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
        app,
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
      await tryPreview(current.draftId);
    }
  }
}

function isDuplicateNameError(err: unknown): boolean {
  if (err instanceof ApiError && err.statusCode === 409) {
    return true;
  }
  return false;
}

async function templateFlow(app: OAuthApp): Promise<void> {
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

  // Step 2: Fetch sample contacts
  const contactSpinner = createSpinner(messages.FUNCTION_INIT_FETCHING_CONTACTS);
  let contactData;
  try {
    contactData = await functionService.fetchContacts();
  } finally {
    contactSpinner.stop();
  }

  // Step 3: Execute template preview
  const previewSpinner = createSpinner(messages.FUNCTION_INIT_EXECUTING_PREVIEW);
  let executeResponse;
  try {
    executeResponse = await functionService.executeTemplate({
      template_id: template.id,
      contact_data: contactData.contacts,
    });
  } finally {
    previewSpinner.stop();
  }

  // Step 4: Print preview -- template info + execute results
  const results = executeResponse.result || [];
  if (hasPreviewErrors(results)) {
    throw new CliError(messages.FUNCTION_PREVIEW_EXECUTE_FAILED);
  }
  logInfo(`\n  ${messages.FUNCTION_INIT_PREVIEW_HEADER}`);
  process.stdout.write(`\n  Description:   ${template.description}\n`);
  printResultsTable(results);

  // Steps 5-7: Name -> confirm -> deploy, retrying on duplicate name.
  let defaultName = template.name;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // Step 5: Ask for a name
    const { functionName } = await inquirer.prompt([
      {
        type: 'input',
        name: 'functionName',
        message: messages.FUNCTION_INIT_NAME_PROMPT,
        default: defaultName,
        validate: (v: string) => (v.trim() ? true : messages.FUNCTION_INIT_NAME_REQUIRED),
      },
    ]);

    // Step 6: Confirm deploy
    logInfo(`\n  ${messages.FUNCTION_INIT_DEPLOY_WARNING}\n`);
    const { confirmDeploy } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmDeploy',
        message: messages.FUNCTION_INIT_DEPLOY_PROMPT,
        default: false,
      },
    ]);

    if (!confirmDeploy) {
      logInfo(messages.FUNCTION_INIT_DEPLOY_CANCELLED);
      return;
    }

    // Step 7: Create function from template
    const createSpinnerInstance = createSpinner(messages.FUNCTION_INIT_CREATING_FROM_TEMPLATE);
    try {
      const created = await functionService.createFromTemplate({
        global_function_id: template.id,
        name: functionName.trim(),
        description: template.description,
        category: template.category || '',
        attribute_id: deriveAttributeId(functionName.trim()),
        source: 'cli',
      });
      createSpinnerInstance.stop();

      await tryLinkFunctionToApp(app.app_id, created.id);

      printBox(messages.FUNCTION_INIT_BOX_TITLE, [
        `Name: ${created.name}`,
        messages.FUNCTION_INIT_BOX_ID(created.id),
      ]);
      return;
    } catch (err) {
      createSpinnerInstance.stop();
      if (isDuplicateNameError(err)) {
        logInfo(messages.FUNCTION_INIT_NAME_EXISTS);
        defaultName = functionName.trim();
        continue;
      }
      throw err;
    }
  }
}

export const initFunctionCommand = withCommandHandler(
  async (options: { json?: boolean }): Promise<void> => {
    // Guard: interactive-only
    if (options.json || !process.stdin.isTTY) {
      throw new CliError(messages.FUNCTION_INIT_NON_INTERACTIVE);
    }

    // Step 1: App selection
    const app = await selectApp();

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
      await aiGenerationFlow(app);
    } else {
      await templateFlow(app);
    }
  },
);
