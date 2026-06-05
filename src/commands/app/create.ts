import inquirer from 'inquirer';
import { CLI, DEFAULT_PORT, DEFAULT_REDIRECT_URI, DEFAULT_SCOPES } from '../../lib/constants';
import { findAvailablePort } from '../../lib/port';
import { logInfo, logError } from '../../lib/logger';
import { messages } from '../../lang/en';
import { ApiError, CliError, ErrorCode } from '../../lib/errors';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { validateEnum, validateAppName } from '../../lib/validators';
import { printBox, createSpinner } from '../../lib/ui';
import { saveAppCredentials, saveAppName, hasLocalApp, readProjectConfig } from '../../lib/config';
import { scaffoldCommand } from './scaffold';
import { appService } from '../../container';
import { CreateAppResponse } from '../../types';

function validateHttpUrl(trimmed: string, invalidMessage: string): true | string {
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return invalidMessage;
    }
    return true;
  } catch {
    return invalidMessage;
  }
}

const validateRedirectUrl = (input: string): true | string => {
  const trimmed = input.trim();
  if (!trimmed) return messages.APP_CREATE_REDIRECT_EMPTY;
  return validateHttpUrl(trimmed, messages.APP_CREATE_REDIRECT_INVALID);
};

const validateLogoUrl = (input: string): true | string => {
  const trimmed = input.trim();
  if (!trimmed) return true;
  return validateHttpUrl(trimmed, messages.APP_CREATE_LOGO_INVALID);
};

// 0. Check for existing app-config.json in current directory.
//    Returns true when it is OK to proceed with creation.
async function confirmCreateOverLinkedApp(): Promise<boolean> {
  if (!hasLocalApp()) return true;
  if (!process.stdin.isTTY) {
    throw new CliError(
      'An app is already linked in this directory (app-config.json). Use --force or run interactively.',
    );
  }
  const projectConfig = readProjectConfig();
  const linkedName = projectConfig?.appName || String(projectConfig?.appId);
  logInfo(`  App "${linkedName}" is already linked in this directory (app-config.json).`);

  const { proceed } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'proceed',
      message: 'Create a new app anyway?',
      default: false,
    },
  ]);

  if (!proceed) {
    logInfo(`\n  Use \`${CLI.APP_UPDATE}\` to modify the existing app.\n`);
    return false;
  }
  return true;
}

// 1. App name
async function resolveAppName(nameFlag: string | undefined): Promise<string> {
  if (nameFlag) {
    const nameCheck = validateAppName(nameFlag);
    if (nameCheck !== true) throw new CliError(nameCheck);
    return nameFlag;
  }
  const answer = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: messages.APP_CREATE_NAME_PROMPT,
      validate: validateAppName,
    },
  ]);
  return answer.name;
}

// 2. Distribution type
async function resolveDistribution(distributionFlag: string | undefined): Promise<string> {
  const VALID_DISTRIBUTIONS = ['private', 'public'] as const;
  validateEnum(distributionFlag, VALID_DISTRIBUTIONS, '--distribution');
  if (distributionFlag === 'public') {
    throw new CliError(messages.APP_CREATE_PUBLIC_UNAVAILABLE);
  }
  if (distributionFlag) {
    return distributionFlag;
  }
  const answer = await inquirer.prompt([
    {
      type: 'list',
      name: 'distribution',
      message: messages.APP_CREATE_TYPE_PROMPT,
      choices: [
        {
          name: 'Private  (Used exclusively by your organisation)',
          value: 'private',
        },
        {
          name: 'Public   (Distributed to end users or marketplace listings)',
          value: 'public',
          disabled: 'coming soon',
        },
      ],
    },
  ]);
  return answer.distribution;
}

const validateYesNo = (input: string): true | string => {
  const val = String(input).toLowerCase().trim();
  if (val === 'y' || val === 'yes' || val === 'n' || val === 'no' || val === '') {
    return true;
  }
  return 'Please enter y or n';
};

async function promptAddAnotherRedirect(): Promise<boolean> {
  const { anotherRaw } = await inquirer.prompt([
    {
      type: 'input',
      name: 'anotherRaw',
      message: messages.APP_CREATE_REDIRECT_ANOTHER + ' (y/N)',
      default: 'n',
      validate: validateYesNo,
    },
  ]);
  return String(anotherRaw).toLowerCase().trim().startsWith('y');
}

async function promptRedirectUrls(quiet: boolean): Promise<string[]> {
  // Find an available port for the default redirect URL
  const availablePort = await findAvailablePort(DEFAULT_PORT);
  const defaultRedirect =
    availablePort == null || availablePort === DEFAULT_PORT
      ? DEFAULT_REDIRECT_URI
      : `http://localhost:${availablePort}/auth/callback`;
  if (!quiet) {
    if (availablePort == null) {
      logInfo(messages.APP_CREATE_PORT_SCAN_FAILED(DEFAULT_PORT));
    } else if (availablePort !== DEFAULT_PORT) {
      logInfo(messages.APP_CREATE_PORT_IN_USE(DEFAULT_PORT, availablePort));
    }
    logInfo(messages.APP_CREATE_REDIRECT_HINT(CLI.APP_START('oauth')));
  }

  const redirectUrls: string[] = [];
  const { redirectUrl: firstUrl } = await inquirer.prompt([
    {
      type: 'input',
      name: 'redirectUrl',
      message: messages.APP_CREATE_REDIRECT_PROMPT,
      default: defaultRedirect,
      validate: validateRedirectUrl,
    },
  ]);
  redirectUrls.push((firstUrl as string).trim());

  while (await promptAddAnotherRedirect()) {
    const { nextUrl } = await inquirer.prompt([
      {
        type: 'input',
        name: 'nextUrl',
        message: messages.APP_CREATE_REDIRECT_PROMPT,
        validate: validateRedirectUrl,
      },
    ]);
    redirectUrls.push((nextUrl as string).trim());
  }
  return redirectUrls;
}

// 3. Redirect URI(s) — already validated by collectUrls parser when passed via flag
async function resolveRedirectUrls(
  redirectUriFlag: string[] | undefined,
  quiet: boolean,
): Promise<string[]> {
  const flagUrls = redirectUriFlag ?? [];
  if (flagUrls.length > 0) {
    return flagUrls;
  }
  if (process.stdin.isTTY) {
    return promptRedirectUrls(quiet);
  }
  return [DEFAULT_REDIRECT_URI];
}

// 4. Logo URL (optional) — prompt interactively when no --logo-uri flag.
//    Skipped under --json since the field is optional and --json implies scripting.
async function resolveLogoUri(
  logoUriFlag: string | undefined,
  jsonMode: boolean,
): Promise<string | undefined> {
  if (logoUriFlag || !process.stdin.isTTY || jsonMode) {
    return logoUriFlag;
  }
  const { logoUrl } = await inquirer.prompt([
    {
      type: 'input',
      name: 'logoUrl',
      message: messages.APP_CREATE_LOGO_PROMPT,
      validate: validateLogoUrl,
    },
  ]);
  const trimmed = String(logoUrl ?? '').trim();
  return trimmed || undefined;
}

interface CreateAppInputs {
  appName: string;
  distribution: string;
  redirectUrls: string[];
  logoUri?: string;
}

interface CreatedApp {
  result: CreateAppResponse;
  appName: string;
}

function buildCreatePayload(inputs: CreateAppInputs) {
  return {
    name: inputs.appName,
    public: inputs.distribution === 'public',
    redirect_uris: inputs.redirectUrls,
    scopes: [...DEFAULT_SCOPES],
    ...(inputs.logoUri ? { logo_uri: inputs.logoUri } : {}),
  };
}

async function retryCreateWithNewName(inputs: CreateAppInputs): Promise<CreatedApp> {
  logError(messages.APP_CREATE_NAME_TAKEN);
  const retry = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: messages.APP_CREATE_NAME_PROMPT,
      validate: validateAppName,
    },
  ]);
  const retrySpinner = createSpinner('Creating app...');
  try {
    const result = await appService.createApp(
      buildCreatePayload({ ...inputs, appName: retry.name }),
    );
    retrySpinner.stop();
    // Use the retried name for cache, JSON output, display, and scaffold prompt
    return { result, appName: retry.name };
  } catch (retryErr) {
    retrySpinner.stop();
    throw retryErr;
  }
}

// 5. Create the app
async function createAppWithRetry(inputs: CreateAppInputs, jsonMode: boolean): Promise<CreatedApp> {
  const spinner = createSpinner('Creating app...', { silent: jsonMode });
  try {
    const result = await appService.createApp(buildCreatePayload(inputs));
    spinner.stop();
    return { result, appName: inputs.appName };
  } catch (err) {
    spinner.stop();
    if (err instanceof ApiError && err.errorCode === ErrorCode.APP_LIMIT_REACHED) {
      if (jsonMode) {
        jsonOutput({ error: 'APP_LIMIT_REACHED', message: messages.APP_CREATE_LIMIT_REACHED });
      }
      throw new CliError(messages.APP_CREATE_LIMIT_REACHED);
    }
    if (err instanceof ApiError && err.statusCode === 409) {
      return retryCreateWithNewName(inputs);
    }
    throw err;
  }
}

function renderCreatedApp(result: CreateAppResponse, appName: string, logoUri?: string): void {
  const boxLines = [
    `App name:       ${appName}`,
    `App ID:         ${result.app_id}`,
    `Client ID:      ${result.client_id}`,
    `Client secret:  ${messages.CLIENT_SECRET_HIDDEN_HUMAN}`,
    ...result.redirect_uris.map((uri, i) => `Redirect URL ${i + 1}: ${uri}`),
    ...(logoUri ? [`Logo URL:       ${logoUri}`] : []),
    `${messages.APP_CREATE_BOX_SCOPES_LABEL} ${[...DEFAULT_SCOPES].join(', ')}`,
    '',
    messages.APP_CREATE_BOX_SCOPE_HINT,
  ];
  printBox(messages.APP_CREATE_BOX_TITLE, boxLines);
}

// Smart hand-off → scaffold
async function offerScaffoldHandoff(result: CreateAppResponse, appName: string): Promise<void> {
  const { shouldScaffold } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'shouldScaffold',
      message: messages.APP_CREATE_SCAFFOLD_PROMPT,
      default: true,
    },
  ]);

  if (shouldScaffold) {
    logInfo(`  ↳ Scaffolding "${appName}"...\n`);
    await scaffoldCommand({ appId: result.app_id });
  } else {
    printBox("What's next?", [
      CLI.APP_SCAFFOLD(result.app_id),
      CLI.APP_CREDENTIALS(result.app_id),
      CLI.APP_LIST,
    ]);
  }
}

export const createCommand = withCommandHandler(
  async (options: {
    name?: string;
    distribution?: string;
    redirectUri?: string[];
    logoUri?: string;
    json?: boolean;
  }): Promise<void> => {
    const jsonMode = !!options.json;

    if (!(await confirmCreateOverLinkedApp())) {
      return;
    }

    const inputs: CreateAppInputs = {
      appName: await resolveAppName(options.name),
      distribution: await resolveDistribution(options.distribution),
      redirectUrls: await resolveRedirectUrls(options.redirectUri, jsonMode),
      logoUri: await resolveLogoUri(options.logoUri, jsonMode),
    };

    const { result, appName } = await createAppWithRetry(inputs, jsonMode);

    // Store app credentials locally — client_secret may not be retrievable again
    saveAppCredentials(result.app_id, {
      clientId: result.client_id,
      clientSecret: result.client_secret,
    });
    if (appName) saveAppName(result.app_id, appName);

    if (jsonMode) {
      jsonOutput({
        appId: result.app_id,
        appName,
        clientId: result.client_id,
        clientSecret: messages.CLIENT_SECRET_HIDDEN_JSON,
        redirectUri: result.redirect_uris,
        ...(inputs.logoUri ? { logoUri: inputs.logoUri } : {}),
      });
      return;
    }

    renderCreatedApp(result, appName, inputs.logoUri);
    await offerScaffoldHandoff(result, appName);
  },
);
