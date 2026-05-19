import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { logInfo } from '../../lib/logger';
import { messages } from '../../lang/en';
import { fetchSupportedScopes } from '../../services/oauth-metadata';

interface ScopesOptions {
  json?: boolean;
}

export const scopesCommand = withCommandHandler(async (options: ScopesOptions): Promise<void> => {
  const scopes = await fetchSupportedScopes();

  if (options.json) {
    jsonOutput({ scopes });
    return;
  }

  if (scopes.length === 0) {
    logInfo(messages.APP_SCOPES_EMPTY);
    return;
  }

  for (const scope of scopes) {
    logInfo(scope);
  }
});
