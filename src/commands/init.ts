import inquirer from 'inquirer';
import { isAuthenticated, readProjectConfig } from '../lib/config';
import { logSuccess, logInfo, logWarn } from '../lib/logger';
import { createSpinner } from '../lib/ui';
import { messages } from '../lang/en';
import { CliError } from '../lib/errors';
import { withCommandHandler } from '../lib/command-handler';
import { loginCommand } from './login';
import { createCommand } from './app/create';
import { scaffoldCommand } from './app/scaffold';
import { appService } from '../container';
import { offerSkillInstall } from '../lib/skill-notifier';

async function ensureLoggedIn(): Promise<{ ranLogin: boolean }> {
  if (isAuthenticated()) {
    logSuccess(messages.INIT_ALREADY_LOGGED_IN);
    return { ranLogin: false };
  }
  logInfo(messages.INIT_STEP_LOGIN);
  await loginCommand({ suppressNextSteps: true });
  if (!isAuthenticated()) {
    throw new CliError('Login failed.');
  }
  return { ranLogin: true };
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
      choices: [
        { name: 'Scaffold this app', value: 'scaffold' },
        { name: 'Create a new app', value: 'create' },
        { name: "Skip — I'm all set", value: 'skip' },
      ],
    },
  ]);
  return action;
}

export const initCommand = withCommandHandler(
  async (_options: Record<string, unknown>): Promise<void> => {
    process.stdout.write(`\n  ${messages.INIT_WELCOME}\n`);
    process.stdout.write('  ──────────────────────────────────────\n\n');

    const { ranLogin } = await ensureLoggedIn();

    // When login ran, it already offered the skill — don't double-prompt.
    // When the user was already authenticated, login was skipped, so we surface
    // the offer here so first-time `init` users still see it.
    if (!ranLogin) {
      await offerSkillInstall();
    }

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
        await scaffoldCommand({ appId: configAppId });
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
