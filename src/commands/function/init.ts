import inquirer from 'inquirer';
import { logInfo, color } from '../../lib/logger';
import { messages } from '../../lang/en';
import { appService, client, sseDeps } from '../../container';
import { createFunctionService } from '../../services/function';

const functionService = createFunctionService(client);
import { withCommandHandler } from '../../lib/command-handler';
import { createSpinner, indentChoices, printBox } from '../../lib/ui';
import { ApiError, CliError } from '../../lib/errors';
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

/** Stage → colored spinner message. ANSI codes: 36=cyan, 33=yellow, 35=magenta, 32=green. */
const STAGE_LABELS: Record<string, { label: string; colorCode: string }> = {
  enriching: { label: 'Analyzing the request', colorCode: '36' },
  planning_agent: { label: 'Contacting databases', colorCode: '33' },
  executing_agent: { label: 'Creating the function', colorCode: '35' },
  validating: { label: 'Testing the function', colorCode: '32' },
};

/**
 * Consume an SSE stream from the AI generation endpoint, updating the spinner
 * per stage, and return the accumulated result.
 *
 * The API sends several event types:
 *  - CUSTOM (generation_progress): `{ value: { message, stage } }` — progress
 *  - RUN_STARTED:  generation began (no-op)
 *  - RUN_FINISHED: `{ result: { code, name, … } }` — final result
 *  - RUN_ERROR:    `{ error: "…" }` — failure
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

    // Progress events — map stage to a colored label, fall back to the API message.
    if (parsed.value?.stage || parsed.value?.message) {
      const stage = parsed.value.stage;
      const info = stage ? STAGE_LABELS[stage] : undefined;
      if (info) {
        spinner.update(color(info.colorCode, info.label));
      } else if (parsed.value.message) {
        spinner.update(parsed.value.message);
      }
    }

    // Result event — may arrive across multiple SSE events (code in one,
    // metadata + draft_id in the final RUN_FINISHED event).
    const r = parsed.result;
    if (r) {
      if (r.code) result.code = r.code;
      if (r.name) result.name = r.name;
      if (r.draft_id) result.draftId = r.draft_id;
      if (r.session_id) result.sessionId = r.session_id;
      if (r.category) result.category = r.category;
      if (r.description) result.description = r.description;
      if (r.explanation) result.explanation = r.explanation;
    }
  }

  if (!result.code) {
    throw new CliError(messages.FUNCTION_INIT_GENERATION_FAILED);
  }

  return result;
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
  } catch {
    genSpinner.stop();
    throw new CliError(messages.FUNCTION_INIT_GENERATION_ERROR);
  }
  genSpinner.stop();

  chatHistory.push({ role: 'user', content: description.trim() });
  chatHistory.push({ role: 'assistant', content: result.code });

  // Fetch contacts and execute preview using the draft_id
  if (result.draftId) {
    try {
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
          draft_id: result.draftId,
          contact_data: contactData.contacts,
        });
      } finally {
        previewSpinner.stop();
      }

      logInfo(`\n  ${messages.FUNCTION_INIT_PREVIEW_HEADER}`);
      printResultsTable(executeResponse.result || []);
    } catch {
      logInfo(`  ${color('33', messages.FUNCTION_INIT_PREVIEW_ERROR)}`);
    }
  }

  // Iteration loop
  let currentCode = result.code;
  let currentDraftId = result.draftId;
  let currentName = result.name;
  let currentCategory = result.category;
  let currentDescription = result.description;
  let currentExplanation = result.explanation;

  let iterating = true;
  while (iterating) {
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
      // Name → confirm → deploy, retrying on duplicate name.
      let defaultName = currentName || '';
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
          iterating = false;
          break;
        }

        const saveSpinner = createSpinner(messages.FUNCTION_INIT_SAVE_SPINNER);
        try {
          const created = await functionService.createFunction({
            source: 'cli',
            name: functionName.trim(),
            code: currentCode,
            category: currentCategory,
            description: currentDescription,
            explanation: currentExplanation,
            app_id: app.app_id,
            draft_id: currentDraftId,
            attribute_id: deriveAttributeId(functionName.trim()),
          });
          saveSpinner.stop();
          printBox(messages.FUNCTION_INIT_BOX_TITLE, [
            `Name: ${created.name}`,
            messages.FUNCTION_INIT_BOX_ID(created.id),
          ]);
          iterating = false;
          break;
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
      continue;
    }

    // Update / iterate
    const { iterateDescription } = await inquirer.prompt([
      {
        type: 'input',
        name: 'iterateDescription',
        message: messages.FUNCTION_INIT_ITERATE_DESCRIPTION,
        validate: (v: string) => (v.trim() ? true : messages.FUNCTION_INIT_DESCRIPTION_REQUIRED),
      },
    ]);

    const iterateSpinner = createSpinner(messages.FUNCTION_INIT_ITERATING);
    try {
      const iterateStream = functionService.iterateStream(sseDeps, {
        draft_function_id: currentDraftId || '',
        user_prompt: iterateDescription.trim(),
        previous_code: currentCode,
        chat_history: chatHistory,
        source: 'cli',
      });
      const iterateResult = await processGenerateStream(iterateStream, iterateSpinner);
      iterateSpinner.stop();

      chatHistory.push({ role: 'user', content: iterateDescription.trim() });
      chatHistory.push({ role: 'assistant', content: iterateResult.code });

      currentCode = iterateResult.code;
      if (iterateResult.draftId) currentDraftId = iterateResult.draftId;
      if (iterateResult.name) currentName = iterateResult.name;
      if (iterateResult.category) currentCategory = iterateResult.category;
      if (iterateResult.description) currentDescription = iterateResult.description;
      if (iterateResult.explanation) currentExplanation = iterateResult.explanation;
    } catch {
      iterateSpinner.stop();
      logInfo(`  ${color('31', messages.FUNCTION_INIT_ITERATE_ERROR)}`);
      continue;
    }

    // Execute preview with the updated code
    if (currentCode) {
      try {
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
            code: currentCode,
            contact_data: contactData.contacts,
          });
        } finally {
          previewSpinner.stop();
        }

        logInfo(`\n  ${messages.FUNCTION_INIT_PREVIEW_HEADER}`);
        printResultsTable(executeResponse.result || []);
      } catch {
        logInfo(`  ${color('33', messages.FUNCTION_INIT_PREVIEW_ERROR)}`);
      }
    }
  }
}

/**
 * Derive an `attribute_id` from a function name by converting to
 * SCREAMING_SNAKE_CASE: "sample test" → "SAMPLE_TEST".
 */
function deriveAttributeId(name: string): string {
  return name
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .toUpperCase();
}

function isDuplicateNameError(err: unknown): boolean {
  if (err instanceof ApiError && err.message.toLowerCase().includes('already exists')) {
    return true;
  }
  return false;
}

/** Keys excluded from the execute-result preview table (internal identifiers). */
const PREVIEW_EXCLUDED_KEYS = new Set(['organization_id']);

function printResultsTable(rows: Record<string, unknown>[]): void {
  if (rows.length === 0) return;
  const cols = Object.keys(rows[0]!).filter((k) => !PREVIEW_EXCLUDED_KEYS.has(k));
  if (cols.length === 0) return;

  const widths = cols.map((col) =>
    Math.max(col.length, ...rows.map((r) => String(r[col] ?? '').length)),
  );
  const gutter = '  ';

  process.stdout.write(`\n  ${cols.map((c, i) => c.padEnd(widths[i]!)).join(gutter)}\n`);
  process.stdout.write(`  ${widths.map((w) => '-'.repeat(w)).join(gutter)}\n`);
  for (const row of rows) {
    process.stdout.write(
      `  ${cols.map((c, i) => String(row[c] ?? '').padEnd(widths[i]!)).join(gutter)}\n`,
    );
  }
  process.stdout.write('\n');
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

  // Step 4: Print preview — template info + execute results
  logInfo(`\n  ${messages.FUNCTION_INIT_PREVIEW_HEADER}`);
  process.stdout.write(`\n  Attribute ID:  ${template.attribute_id || ''}\n`);
  process.stdout.write(`  Description:   ${template.description}\n`);
  printResultsTable(executeResponse.result || []);

  // Steps 5–7: Name → confirm → deploy, retrying on duplicate name.
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
