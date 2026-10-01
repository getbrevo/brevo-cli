import inquirer from 'inquirer';
import { CLI } from '../../lib/constants';
import { logInfo, logSuccess } from '../../lib/logger';
import { messages } from '../../lang/en';
import { ApiError, CliError } from '../../lib/errors';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { createSpinner } from '../../lib/ui';
import { appService } from '../../container';
import { isM2mApp } from '../../services/app';
import { saveAppCredentials } from '../../lib/config';
import { assertAppSelectionAllowed, promptAppSelection } from './select-app';

export interface SecretRotateOptions {
  appId?: string;
  yes?: boolean;
  json?: boolean;
}

/**
 * Remap a rotate failure to friendlier copy for the codes this command knows about;
 * anything else is rethrown unchanged so the server's own message still reaches the
 * partner. ASSUMPTION pending the "brevo app secret rotate [Backend]" ticket (not yet
 * built): the status code matched here is a guess, not a verified contract — a wrong
 * guess only loses the friendlier copy, it never hides the real error.
 */
function mapRotateError(err: unknown, appId: string): unknown {
  if (err instanceof ApiError && err.statusCode === 401) {
    return new CliError(messages.APP_SECRET_ROTATE_UNAUTHORIZED(appId), err.exitCode);
  }
  return err;
}

/**
 * `brevo app secret rotate` (BEX-484) — rotate an M2M app's client secret.
 *
 * ASSUMPTION pending the "brevo app secret rotate [Backend]" ticket (not yet built at the
 * time this was written): the endpoint contract `appService.rotateAppSecret` sends is a
 * reasonable guess, not a verified implementation — see the plan doc for BEX-484.
 *
 * The new secret is printed in full, with no `--reveal-secret`-style gate — unlike
 * `app credentials`/`app create`. That gate exists to keep a permanent, disk-cached
 * secret off a screen unless someone deliberately asks; this command's entire purpose
 * IS handing back a new secret, including from a non-interactive CI rotation script,
 * where a TTY-gated reveal would make the command unable to ever return the value it
 * exists to produce. Do not "fix" this into the reveal-gated pattern. The confirmation
 * prompt below is a different gate: it confirms the destructive ACTION (the old secret
 * stops working immediately), not permission to display the result.
 */
export const secretRotateCommand = withCommandHandler(
  async (options: SecretRotateOptions): Promise<void> => {
    let appId = options.appId;
    let appLabel = '';

    if (!appId) {
      assertAppSelectionAllowed(CLI.APP_SECRET_ROTATE(), options.json);
      const selection = await promptAppSelection(messages.APP_SECRET_ROTATE_SELECT, {
        filter: isM2mApp,
        emptyMessage: messages.APP_SECRET_ROTATE_NO_M2M_APPS,
      });
      appId = selection.appId;
      appLabel = selection.appLabel;
    }

    const loadSpinner = createSpinner('Loading app...', { silent: options.json });
    const app = await appService.fetchApp(appId);
    loadSpinner.stop();
    if (!app) throw new CliError(`App ${appId} not found.`);
    if (!isM2mApp(app)) throw new CliError(messages.APP_SECRET_ROTATE_NOT_M2M(appId));
    appLabel = appLabel || app.name || '';

    if (!options.json && !options.yes) {
      const { confirmed } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmed',
          message: messages.APP_SECRET_ROTATE_CONFIRM(appLabel || appId, appId),
          default: false,
        },
      ]);
      if (!confirmed) {
        logInfo(messages.APP_SECRET_ROTATE_CANCELLED);
        return;
      }
    }

    const rotateSpinner = createSpinner('Rotating secret...', { silent: options.json });
    let rotated;
    try {
      rotated = await appService.rotateAppSecret(appId);
    } catch (err) {
      rotateSpinner.stop();
      throw mapRotateError(err, appId);
    }
    rotateSpinner.stop();

    // Keep the local cache in step with the secret that now actually works — the same
    // cache `app credentials`/`app start`/scaffolded templates read from.
    saveAppCredentials(appId, { clientId: rotated.clientId, clientSecret: rotated.clientSecret });

    if (options.json) {
      jsonOutput({
        appId,
        clientId: rotated.clientId,
        clientSecret: rotated.clientSecret,
        graceUntil: rotated.graceUntil ?? null,
      });
      return;
    }

    logSuccess(messages.APP_SECRET_ROTATE_SUCCESS(appId));
    logInfo(`  Client secret: ${rotated.clientSecret}`);
    if (rotated.graceUntil) logInfo(`  Old secret valid until: ${rotated.graceUntil}`);
    logInfo(`  ${messages.APP_SECRET_ROTATE_STORE_HINT}`);
    process.stdout.write('\n');
  },
);
