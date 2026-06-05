import { logInfo } from '../lib/logger';
import { messages } from '../lang/en';
import { CliError } from '../lib/errors';
import {
  isAuthenticated,
  getEmail,
  getOrganizationId,
  getUserId,
  getAuthCred,
} from '../lib/config';
import { accountService } from '../container';
import { AccountResponse } from '../types';
import { withCommandHandler } from '../lib/command-handler';
import { jsonOutput } from '../lib/json-output';
import { createSpinner } from '../lib/ui';

// Check for mismatches between stored credentials and API response
function findCredentialMismatches(account: AccountResponse): string[] {
  const mismatched: string[] = [];
  const storedEmail = getEmail();
  const storedOrgId = getOrganizationId();
  const storedUserId = getUserId();

  if (storedEmail && storedEmail !== account.email) mismatched.push('email');
  if (storedOrgId && storedOrgId !== account.organization_id) mismatched.push('organization');
  if (storedUserId != null && storedUserId !== account.user_id) mismatched.push('user id');

  return mismatched;
}

function renderAccount(account: AccountResponse): void {
  const authKind = getAuthCred()?.kind;
  let kindLabel = '';
  if (authKind === 'oauth') kindLabel = ' (browser login)';
  else if (authKind === 'api-key') kindLabel = ' (API key)';
  logInfo(
    `\n  ${messages.WHOAMI_AUTHENTICATED(account.email, account.companyName || 'N/A')}${kindLabel}\n` +
      `  Organization: ${account.organization_id}\n` +
      `  User ID:      ${account.user_id}\n`,
  );
}

export const whoamiCommand = withCommandHandler(
  async (options: { json?: boolean }): Promise<void> => {
    // No stored key at all
    if (!isAuthenticated()) {
      if (options.json) {
        jsonOutput({ authenticated: false, reason: 'no_key' });
      }
      throw new CliError(messages.WHOAMI_NOT_AUTHENTICATED);
    }

    // Key exists — validate it against the API
    const spinner = createSpinner('Checking credentials...', { silent: options.json });
    try {
      const account = await accountService.getAccount();
      spinner.stop();

      const mismatched = findCredentialMismatches(account);
      if (mismatched.length > 0) {
        if (options.json) {
          jsonOutput({
            authenticated: false,
            reason: 'credential_mismatch',
            mismatchedFields: mismatched,
          });
        }
        throw new CliError(messages.WHOAMI_CREDENTIAL_MISMATCH(mismatched));
      }

      if (options.json) {
        jsonOutput({
          authenticated: true,
          authKind: getAuthCred()?.kind,
          email: account.email,
          company: account.companyName || '',
          organizationId: account.organization_id,
          userId: account.user_id,
        });
      } else {
        renderAccount(account);
      }
    } catch (err) {
      spinner.stop();
      if (err instanceof CliError) throw err;
      if (options.json) {
        jsonOutput({ authenticated: false, reason: 'expired' });
      }
      throw new CliError(messages.AUTH_EXPIRED);
    }
  },
);
