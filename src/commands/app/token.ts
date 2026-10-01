import { CLI } from '../../lib/constants';
import { logInfo, logSuccess } from '../../lib/logger';
import { messages } from '../../lang/en';
import { ApiError, CliError } from '../../lib/errors';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { createSpinner } from '../../lib/ui';
import { appService } from '../../container';
import { isM2mApp } from '../../services/app';
import { splitScopes } from '../../lib/validators';
import { assertAppSelectionAllowed, promptAppSelection } from './select-app';
import { checkScopeList } from './scope-prompts';

export interface TokenOptions {
  appId?: string;
  scope?: string;
  json?: boolean;
}

/**
 * Remap a token-mint failure to friendlier copy for the codes this command knows about;
 * anything else is rethrown unchanged so the server's own message still reaches the
 * partner. ASSUMPTION pending the "brevo app token [Backend]" ticket (not yet built): the
 * `apiCode` values matched here (`scope_not_granted` / `SCOPE_NOT_GRANTED`) are a guess,
 * not a verified contract — a wrong guess only loses the friendlier copy, it never hides
 * the real error.
 */
function mapTokenError(err: unknown, appId: string): unknown {
  if (err instanceof ApiError && (err.statusCode === 401 || err.statusCode === 403)) {
    if (err.apiCode === 'scope_not_granted' || err.apiCode === 'SCOPE_NOT_GRANTED') {
      return new CliError(messages.APP_TOKEN_SCOPE_NOT_GRANTED(appId), err.exitCode);
    }
    if (err.statusCode === 401) {
      return new CliError(messages.APP_TOKEN_UNAUTHORIZED(appId), err.exitCode);
    }
  }
  return err;
}

/**
 * `brevo app token` (BEX-482) — mint a short-lived M2M access token for an app.
 *
 * ASSUMPTION pending the "brevo app token [Backend]" ticket (not yet built at the time
 * this was written): the endpoint contract `appService.mintAppToken` sends is a
 * reasonable guess, not a verified implementation — see the plan doc for BEX-482.
 *
 * The token is printed in full, with no `--reveal-secret`-style gate: unlike
 * `client_secret` (permanent, cached to disk, catastrophic if leaked), a minted token is
 * short-lived by construction, never persisted locally, and the command's whole purpose
 * is to hand it to the caller for immediate use.
 */
export const tokenCommand = withCommandHandler(async (options: TokenOptions): Promise<void> => {
  let appId = options.appId;

  if (!appId) {
    assertAppSelectionAllowed(CLI.APP_TOKEN(), options.json);
    const selection = await promptAppSelection(messages.APP_TOKEN_SELECT, {
      filter: isM2mApp,
      emptyMessage: messages.APP_TOKEN_NO_M2M_APPS,
    });
    appId = selection.appId;
  }

  const loadSpinner = createSpinner('Loading app...', { silent: options.json });
  const app = await appService.fetchApp(appId);
  loadSpinner.stop();
  if (!app) throw new CliError(`App ${appId} not found.`);
  if (!isM2mApp(app)) throw new CliError(messages.APP_TOKEN_NOT_M2M(appId));

  let scopes: string[] | undefined;
  if (options.scope !== undefined) {
    scopes = splitScopes(options.scope);
    const check = checkScopeList(scopes);
    if (check !== true) throw new CliError(check);
  }

  const mintSpinner = createSpinner('Minting token...', { silent: options.json });
  let token;
  try {
    token = await appService.mintAppToken(appId, scopes);
  } catch (err) {
    mintSpinner.stop();
    throw mapTokenError(err, appId);
  }
  mintSpinner.stop();

  if (options.json) {
    jsonOutput({
      appId,
      accessToken: token.accessToken,
      tokenType: token.tokenType,
      expiresIn: token.expiresIn,
      scope: token.scope ?? null,
    });
    return;
  }

  logSuccess(messages.APP_TOKEN_SUCCESS(token.expiresIn));
  logInfo(`  Authorization: ${token.tokenType} ${token.accessToken}`);
  if (token.scope) logInfo(`  Scope: ${token.scope}`);
  process.stdout.write('\n');
});
