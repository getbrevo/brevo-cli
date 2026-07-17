import * as fs from 'node:fs';
import inquirer from 'inquirer';
import { withCommandHandler } from '../../lib/command-handler';
import { createSpinner } from '../../lib/ui';
import { logSuccess, logInfo } from '../../lib/logger';
import { jsonOutput } from '../../lib/json-output';
import { CliError } from '../../lib/errors';
import { messages } from '../../lang/en';
import { dpFunctionsService } from '../../container';

export const dpPublishCommand = withCommandHandler(
  async (options: {
    file?: string;
    name?: string;
    description?: string;
    category?: string;
    attributeId?: string;
    scope?: string[];
    data?: string;
    dataFile?: string;
    id?: string;
    json?: boolean;
  }): Promise<void> => {
    if (!options.file) {
      throw new CliError(messages.DP_PUBLISH_FILE_REQUIRED);
    }
    if (!fs.existsSync(options.file)) {
      throw new CliError(messages.DP_FILE_NOT_FOUND(options.file));
    }

    // Resolve name — prompt if not provided via flag
    let name = options.name;
    if (!name && !options.json) {
      const answer = await inquirer.prompt([
        {
          type: 'input',
          name: 'name',
          message: messages.DP_PUBLISH_NAME_PROMPT,
          validate: (v: string) => (v.trim().length > 0 ? true : 'Name cannot be empty.'),
        },
      ]);
      name = answer.name as string;
    }
    if (!name) {
      throw new CliError('--name is required in non-interactive mode.');
    }

    // Resolve category — prompt if not provided via flag (only for new functions)
    let category = options.category;
    if (!category && !options.id && !options.json) {
      const answer = await inquirer.prompt([
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
      ]);
      category = answer.category as string;
    }

    // Resolve attribute ID — prompt if not provided via flag (only for new functions)
    let attributeId = options.attributeId;
    if (!attributeId && !options.id && !options.json) {
      const answer = await inquirer.prompt([
        {
          type: 'input',
          name: 'attributeId',
          message: messages.DP_PUBLISH_ATTRIBUTE_PROMPT,
          validate: (v: string) => (v.trim().length > 0 ? true : 'Attribute ID cannot be empty.'),
        },
      ]);
      attributeId = answer.attributeId as string;
    }

    // Resolve description — prompt if not provided via flag
    let description = options.description;
    if (!description && !options.json) {
      const answer = await inquirer.prompt([
        {
          type: 'input',
          name: 'description',
          message: messages.DP_PUBLISH_DESCRIPTION_PROMPT,
          validate: (v: string) => (v.trim().length > 0 ? true : 'Description cannot be empty.'),
        },
      ]);
      description = answer.description as string;
    }

    // Resolve test data
    let testData: unknown;
    if (options.data) {
      try {
        testData = JSON.parse(options.data);
      } catch {
        throw new CliError(messages.DP_INVALID_JSON('--data is not valid JSON'));
      }
    } else if (options.dataFile) {
      if (!fs.existsSync(options.dataFile)) {
        throw new CliError(messages.DP_FILE_NOT_FOUND(options.dataFile));
      }
      try {
        testData = JSON.parse(fs.readFileSync(options.dataFile, 'utf-8'));
      } catch {
        throw new CliError(messages.DP_INVALID_JSON('--data-file contains invalid JSON'));
      }
    }

    // Step 1: Validate
    const validateSpinner = createSpinner(messages.DP_PUBLISH_VALIDATE, { silent: options.json });
    const code = fs.readFileSync(options.file, 'utf-8');
    const validation = await dpFunctionsService.validate(code);
    validateSpinner.stop();
    if (!validation.valid) {
      const errs = (validation.errors || []).join('\n  ');
      throw new CliError(`${messages.DP_VALIDATE_FAILED}\n  ${errs}`);
    }
    if (!options.json) logInfo(`  Validation passed.`);

    // Step 2: Test execute (if test data provided)
    if (testData !== undefined) {
      const testSpinner = createSpinner(messages.DP_PUBLISH_TEST, { silent: options.json });
      const result = await dpFunctionsService.execute(code, testData);
      testSpinner.stop();
      if (!result.success) {
        throw new CliError(messages.DP_EXECUTE_FAILED(result.error || 'unknown error'));
      }
      if (!options.json) logInfo(`  Test execution passed.`);
    }

    // Step 3: Save or update
    const saveSpinner = createSpinner(messages.DP_PUBLISH_SAVE, { silent: options.json });
    const fn = await dpFunctionsService.publish({
      file: options.file,
      name,
      description,
      category,
      attributeId,
      data: testData,
      id: options.id,
    });
    saveSpinner.stop();

    if (options.json) {
      jsonOutput(fn);
    } else if (options.id) {
      logSuccess(messages.DP_PUBLISH_UPDATED(fn.id));
    } else {
      logSuccess(messages.DP_PUBLISH_SUCCESS(fn.id));
    }
  },
);
