import inquirer from 'inquirer';
import { isAuthenticated, readProjectConfig } from '../lib/config';
import { logSuccess, logInfo, logWarn, logDebug } from '../lib/logger';
import { createSpinner, indentChoices } from '../lib/ui';
import { messages } from '../lang/en';
import { ApiError, AuthExpiredError, CliError, ErrorCode } from '../lib/errors';
import { withCommandHandler } from '../lib/command-handler';
import { loginCommand } from './login';
import { createCommand } from './app/create';
import { scaffoldCommand } from './app/scaffold';
import { appService, accountService } from '../container';

/**
 * Did the backend reject our credentials, or did the request just not land?
 *
 * Only the former justifies sending the user through a login. A network blip,
 * a 5xx or an unexpected throw says nothing about whether the session is valid.
 *
 * An auth gateway in front of the API (Cloudflare Access and friends) answers
 * with its own 401/403 interstitial, which the client surfaces as
 * `AUTH_GATEWAY`. That is not our credentials being refused — `brevo login`
 * cannot clear it — so it belongs with the inconclusive results, where the
 * real gateway error reaches the user on the next call.
 */
function isAuthRejection(err: unknown): boolean {
  if (err instanceof AuthExpiredError) return true;
  if (!(err instanceof ApiError)) return false;
  if (err.errorCode === ErrorCode.AUTH_GATEWAY) return false;
  return err.statusCode === 401 || err.statusCode === 403;
}

async function ensureLoggedIn(): Promise<void> {
  if (isAuthenticated()) {
    // Local creds exist — verify they still work against the backend before
    // the user invests time in the init prompts. Without this, init proceeds
    // happily and the first real API call (app create) hits a 401 mid-flow.
    const spinner = createSpinner('Verifying credentials...');
    try {
      await accountService.getAccount();
      spinner.stop();
      logSuccess(messages.INIT_ALREADY_LOGGED_IN);
      return;
    } catch (err) {
      spinner.stop();
      if (!isAuthRejection(err)) {
        // The probe is a courtesy, not a gate. Announcing "expired" and opening
        // a browser here would be wrong — and would fail for the same reason
        // the probe did. Carry on; the reactive 401 handler still catches
        // genuinely dead credentials later in the flow.
        logDebug('init credential probe inconclusive', {
          reason: err instanceof Error ? err.message : String(err),
        });
        logWarn(messages.INIT_VERIFY_UNAVAILABLE);
        return;
      }
      logWarn(messages.AUTH_EXPIRED);
      // Fall through to the login flow below.
    }
  }
  logInfo(messages.INIT_STEP_LOGIN);
  await loginCommand({ suppressNextSteps: true });
  if (!isAuthenticated()) {
    throw new CliError('Login failed.');
  }
}

async function appExistsOnServer(appId: string): Promise<boolean> {
  if (!appId) return false;
  const spinner = createSpinner('Verifying app...');
  try {
    const app = await appService.fetchApp(appId);
    return app !== null;
  } catch {
    return false;
  } finally {
    spinner.stop();
  }
}

async function promptLinkedAppAction(
  configAppId: string,
  linkedName: string,
): Promise<'scaffold' | 'create' | 'skip'> {
  logSuccess(messages.INIT_APP_LINKED(linkedName));
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: messages.INIT_APP_ACTION,
      choices: indentChoices([
        { name: 'Scaffold this app', value: 'scaffold' },
        { name: 'Create a new app', value: 'create' },
        { name: "Skip — I'm all set", value: 'skip' },
      ]),
    },
  ]);
  return action;
}

export const initCommand = withCommandHandler(
  async (_options: Record<string, unknown>): Promise<void> => {
    process.stdout.write(`\n  ${messages.INIT_WELCOME}\n`);
    process.stdout.write('  ──────────────────────────────────────\n\n');

    await ensureLoggedIn();

    process.stdout.write('\n');
    const projectConfig = readProjectConfig();
    const configAppId = typeof projectConfig?.appId === 'string' ? projectConfig.appId.trim() : '';
    const linkedName = projectConfig?.appName || configAppId;

    if (configAppId && (await appExistsOnServer(configAppId))) {
      const action = await promptLinkedAppAction(configAppId, linkedName);

      if (action === 'skip') {
        logInfo(`\n  ${messages.INIT_DONE}\n`);
        return;
      }

      if (action === 'scaffold') {
        process.stdout.write('\n');
        await scaffoldCommand({});
        logInfo(`\n  ${messages.INIT_DONE}\n`);
        return;
      }
      // action === 'create' — fall through
    } else if (configAppId) {
      logWarn(
        `App "${linkedName}" (from app-config.json) no longer exists on the server. It may have been deleted.`,
      );
      logInfo(messages.INIT_STEP_CREATE);
    } else {
      logInfo(messages.INIT_STEP_CREATE);
    }

    process.stdout.write('\n');
    await createCommand({});
    logInfo(`\n  ${messages.INIT_DONE}\n`);
  },
);
