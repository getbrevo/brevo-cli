import * as fs from 'node:fs';
import * as path from 'node:path';
import inquirer from 'inquirer';
import { withCommandHandler } from '../../lib/command-handler';
import { createSpinner } from '../../lib/ui';
import { logSuccess, logInfo, logWarn } from '../../lib/logger';
import { jsonOutput } from '../../lib/json-output';
import { CliError } from '../../lib/errors';
import { messages } from '../../lang/en';
import { dpFunctionsService } from '../../container';
import type { GenerateCallbacks } from '../../api/dp-functions-client';
import type {
  GenerateRequest,
  GenerateResponse,
  ChatMessage,
  PlanningTurnResult,
} from '../../types';

const DEFAULT_OUTPUT_FILE = 'dp-generated.js';

function buildCallbacks(
  spinner: { update(text: string): void; stop(text?: string): void },
  noQuestions: boolean,
): GenerateCallbacks {
  return {
    onProgress(stage: string, message: string) {
      spinner.update(`[${stage}] ${message}`);
    },

    async onQuestion(turn: PlanningTurnResult): Promise<string> {
      if (noQuestions) return '';

      spinner.stop();
      logInfo('');

      const question = turn.question;
      if (!question) return '';

      if (question.options?.length) {
        const { answer } = await inquirer.prompt([
          {
            type: 'list',
            name: 'answer',
            message: question.question,
            choices: question.options.map((opt, i) => ({
              name: `${i + 1}) ${opt}`,
              value: opt,
            })),
          },
        ]);
        logInfo('');
        spinner.update(messages.DP_GENERATING);
        return answer as string;
      }

      const { answer } = await inquirer.prompt([
        {
          type: 'input',
          name: 'answer',
          message: question.question,
        },
      ]);
      logInfo('');
      spinner.update(messages.DP_GENERATING);
      return answer as string;
    },
  };
}

function writeCodeToFile(filePath: string, code: string): void {
  fs.writeFileSync(filePath, code, 'utf-8');
}

function displayResult(response: GenerateResponse, outputFile: string): void {
  if (response.valid) {
    logSuccess('Generated valid ES5 function.');
  } else {
    logWarn(messages.DP_GENERATE_INVALID);
    for (const err of response.errors || []) {
      logInfo(`    ${err}`);
    }
  }

  if (response.description) {
    logInfo(`  ${response.description}`);
  }

  writeCodeToFile(outputFile, response.code);
  logInfo(`\n  Code written to: ${path.resolve(outputFile)}`);
  logInfo(`  Open the file to review, then come back here to refine, save, or quit.\n`);
}

export const dpGenerateCommand = withCommandHandler(
  async (options: {
    prompt: string;
    contextFile?: string;
    output?: string;
    sessionId?: string;
    previousCode?: string;
    noQuestions?: boolean;
    json?: boolean;
  }): Promise<void> => {
    if (!options.prompt) {
      throw new CliError(messages.DP_GENERATE_PROMPT_REQUIRED);
    }

    // Output file — explicit flag or default
    const outputFile = options.output || DEFAULT_OUTPUT_FILE;

    // Read context file if provided
    let contextJson: unknown;
    if (options.contextFile) {
      if (!fs.existsSync(options.contextFile)) {
        throw new CliError(messages.DP_FILE_NOT_FOUND(options.contextFile));
      }
      try {
        contextJson = JSON.parse(fs.readFileSync(options.contextFile, 'utf-8'));
      } catch {
        throw new CliError(messages.DP_INVALID_JSON('--context-file contains invalid JSON'));
      }
    }

    // Read previous code if provided
    let previousCode: string | undefined;
    if (options.previousCode) {
      if (!fs.existsSync(options.previousCode)) {
        throw new CliError(messages.DP_FILE_NOT_FOUND(options.previousCode));
      }
      previousCode = fs.readFileSync(options.previousCode, 'utf-8');
    }

    // Build initial request
    const req: GenerateRequest = {
      user_prompt: options.prompt,
      context_json: contextJson,
      session_id: options.sessionId,
      previous_code: previousCode,
    };

    // Track chat history across iterations
    const chatHistory: ChatMessage[] = [];

    let currentResponse = await runGeneration(req, options.noQuestions, options.json);

    if (options.json) {
      jsonOutput(currentResponse);
      return;
    }

    displayResult(currentResponse, outputFile);

    // Interactive iteration loop — only in TTY mode
    if (!process.stdin.isTTY) return;

    let iterating = true;
    while (iterating) {
      const { action } = await inquirer.prompt([
        {
          type: 'expand',
          name: 'action',
          message: messages.DP_ITERATION_PROMPT,
          choices: [
            { key: 'r', name: 'Refine', value: 'refine' },
            { key: 's', name: 'Save', value: 'save' },
            { key: 'q', name: 'Quit', value: 'quit' },
          ],
        },
      ]);

      if (action === 'quit') {
        iterating = false;
        continue;
      }

      if (action === 'save') {
        const saveAnswers = await inquirer.prompt([
          {
            type: 'input',
            name: 'name',
            message: messages.DP_PUBLISH_NAME_PROMPT,
            validate: (v: string) => (v.trim().length > 0 ? true : 'Name cannot be empty.'),
          },
          {
            type: 'list',
            name: 'category',
            message: messages.DP_PUBLISH_CATEGORY_PROMPT,
            choices: [
              { name: 'Contact', value: 'contact' },
              { name: 'E-commerce', value: 'ecommerce' },
              { name: 'Engagement', value: 'engagement' },
              { name: 'Revenue', value: 'revenue' },
            ],
          },
          {
            type: 'input',
            name: 'attributeId',
            message: messages.DP_PUBLISH_ATTRIBUTE_PROMPT,
            validate: (v: string) => (v.trim().length > 0 ? true : 'Attribute ID cannot be empty.'),
          },
          {
            type: 'input',
            name: 'description',
            message: messages.DP_PUBLISH_DESCRIPTION_PROMPT,
            default: currentResponse.description || '',
            validate: (v: string) => (v.trim().length > 0 ? true : 'Description cannot be empty.'),
          },
        ]);

        // Re-read the file in case the user edited it externally
        const finalCode = fs.existsSync(outputFile)
          ? fs.readFileSync(outputFile, 'utf-8')
          : currentResponse.code;

        const saveSpinner = createSpinner(messages.DP_PUBLISH_SAVE);
        try {
          // Save directly via client — validate + save
          const validation = await dpFunctionsService.validate(finalCode);
          if (!validation.valid) {
            saveSpinner.stop();
            logWarn('Code has validation errors. Fix the file and try again:');
            for (const err of validation.errors || []) {
              logInfo(`    ${err}`);
            }
            continue;
          }

          const fn = await dpFunctionsService.publish({
            file: outputFile,
            name: saveAnswers.name as string,
            description: saveAnswers.description as string,
            category: saveAnswers.category as string,
            attributeId: saveAnswers.attributeId as string,
          });
          saveSpinner.stop();
          logSuccess(messages.DP_PUBLISH_SUCCESS(fn.id));
        } catch (err) {
          saveSpinner.stop();
          throw err;
        }
        iterating = false;
        continue;
      }

      if (action === 'refine') {
        const { refinement } = await inquirer.prompt([
          {
            type: 'input',
            name: 'refinement',
            message: 'Refinement:',
          },
        ]);

        // Build chat history entry
        chatHistory.push(
          { role: 'assistant', content: currentResponse.code },
          { role: 'user', content: refinement as string },
        );

        const refineReq: GenerateRequest = {
          user_prompt: refinement as string,
          context_json: contextJson,
          session_id: currentResponse.session_id,
          previous_code: currentResponse.code,
          chat_history: chatHistory,
        };

        currentResponse = await runGeneration(refineReq, false, false);
        displayResult(currentResponse, outputFile);
      }
    }
  },
);

async function runGeneration(
  req: GenerateRequest,
  noQuestions?: boolean,
  json?: boolean,
): Promise<GenerateResponse> {
  const spinner = createSpinner(messages.DP_CONNECTING_WS, { silent: json });
  const callbacks = buildCallbacks(spinner, Boolean(noQuestions));

  try {
    const response = await dpFunctionsService.generateWs(req, callbacks);
    spinner.stop();
    return response;
  } catch (err) {
    spinner.stop();
    throw err;
  }
}
