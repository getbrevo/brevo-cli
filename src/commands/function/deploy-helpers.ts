import inquirer from 'inquirer';
import { logInfo, color } from '../../lib/logger';
import { functionService } from '../../container';
import { ApiError, CliError } from '../../lib/errors';
import { createSpinner, printBox } from '../../lib/ui';
import { hasPreviewErrors, printResultsTable } from './preview-table';
import { tryLinkFunctionToApp } from './select-app';

/** Check whether an error is a 409 duplicate-name response. */
export function isDuplicateNameError(err: unknown): boolean {
  return err instanceof ApiError && err.statusCode === 409;
}

export interface PreviewMessages {
  fetchingContacts: string;
  executingPreview: string;
  previewHeader: string;
  previewError: string;
  previewFailed: string;
  /** Optional extra line printed between the header and the results table. */
  afterHeader?: string;
}

/** Args forwarded to `functionService.executeTemplate` (minus `contact_data`). */
export interface PreviewTemplateArgs {
  draft_id?: string;
  template_id?: string;
}

/**
 * Fetch sample contacts, execute a preview, and print the results table.
 * Throws `CliError` on data errors (`__error` in results).
 */
export async function executePreview(
  templateArgs: PreviewTemplateArgs,
  msgs: PreviewMessages,
): Promise<void> {
  const contactSpinner = createSpinner(msgs.fetchingContacts);
  let contactData;
  try {
    contactData = await functionService.fetchContacts();
  } finally {
    contactSpinner.stop();
  }

  const previewSpinner = createSpinner(msgs.executingPreview);
  let executeResponse;
  try {
    executeResponse = await functionService.executeTemplate({
      ...templateArgs,
      contact_data: contactData.contacts,
    });
  } finally {
    previewSpinner.stop();
  }

  const results = executeResponse.result || [];
  if (hasPreviewErrors(results)) {
    throw new CliError(msgs.previewFailed);
  }
  logInfo(`\n  ${msgs.previewHeader}`);
  if (msgs.afterHeader) {
    process.stdout.write(msgs.afterHeader);
  }
  printResultsTable(results);
}

/**
 * Try running a preview — fatal on data errors (__error), non-fatal on network issues.
 * Returns without error if no template args are provided.
 */
export async function tryPreview(
  templateArgs: PreviewTemplateArgs,
  msgs: PreviewMessages,
): Promise<void> {
  if (!templateArgs.draft_id && !templateArgs.template_id) return;
  try {
    await executePreview(templateArgs, msgs);
  } catch (err) {
    if (err instanceof CliError) throw err;
    logInfo(`  ${color('33', msgs.previewError)}`);
  }
}

export interface NameConfirmDeployMessages {
  namePrompt: string;
  nameRequired: string;
  warning: string;
  confirmPrompt: string;
  cancelled: string;
  spinner: string;
  nameExists: string;
  boxTitle: string;
  boxId: (id: string) => string;
}

interface NameConfirmDeployArgs {
  appId: string;
  msgs: NameConfirmDeployMessages;
  defaultName?: string;
  createFn: (name: string) => Promise<{ id: string; name: string }>;
}

/**
 * Name -> confirm -> deploy loop, shared by `deploy` (interactive) and `init` (save).
 * Retries on duplicate name (409). Calls `tryLinkFunctionToApp` on success.
 */
export async function nameConfirmDeployLoop(args: NameConfirmDeployArgs): Promise<void> {
  let defaultName = args.defaultName || '';
  const { msgs } = args;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { functionName } = await inquirer.prompt([
      {
        type: 'input',
        name: 'functionName',
        message: msgs.namePrompt,
        default: defaultName || undefined,
        validate: (v: string) => (v.trim() ? true : msgs.nameRequired),
      },
    ]);

    logInfo(`\n  ${msgs.warning}\n`);
    const { confirmDeploy } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmDeploy',
        message: msgs.confirmPrompt,
        default: false,
      },
    ]);

    if (!confirmDeploy) {
      logInfo(msgs.cancelled);
      return;
    }

    const spinner = createSpinner(msgs.spinner);
    try {
      const created = await args.createFn(functionName.trim());
      spinner.stop();

      await tryLinkFunctionToApp(args.appId, created.id);

      printBox(msgs.boxTitle, [`Name: ${created.name}`, msgs.boxId(created.id)]);
      return;
    } catch (err) {
      spinner.stop();
      if (isDuplicateNameError(err)) {
        logInfo(msgs.nameExists);
        defaultName = functionName.trim();
        continue;
      }
      throw err;
    }
  }
}
