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

export const initCommand = withCommandHandler(
  async (_options: Record<string, unknown>): Promise<void> => {
    process.stdout.write(`\n  ${messages.INIT_WELCOME}\n`);
    process.stdout.write('  ──────────────────────────────────────\n\n');

    // Step 1: Login
    if (isAuthenticated()) {
      logSuccess(messages.INIT_ALREADY_LOGGED_IN);
    } else {
      logInfo(messages.INIT_STEP_LOGIN);
      await loginCommand({ suppressNextSteps: true });

      if (!isAuthenticated()) {
        throw new CliError('Login failed.');
      }
    }

    // Step 2: Check local app-config.json for existing app
    process.stdout.write('\n');
    const projectConfig = readProjectConfig();

    if (projectConfig?.appId) {
      const configAppId = typeof projectConfig.appId === 'string' ? projectConfig.appId.trim() : '';
      const linkedName = projectConfig.appName || configAppId;

      // Verify app still exists on the server
      let appExists = false;
      if (configAppId) {
        const spinner = createSpinner('Verifying app...');
        try {
          const app = await appService.fetchApp(configAppId);
          appExists = app !== null;
          spinner.stop();
        } catch {
          spinner.stop();
          // API error — treat as not found
        }
      }

      if (!appExists) {
        logWarn(
          `App "${linkedName}" (from app-config.json) no longer exists on the server. It may have been deleted.`,
        );
        logInfo(messages.INIT_STEP_CREATE);
      } else {
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
      }
    } else {
      logInfo(messages.INIT_STEP_CREATE);
    }

    process.stdout.write('\n');
    await createCommand({});

    logInfo(`\n  ${messages.INIT_DONE}\n`);
  },
);
