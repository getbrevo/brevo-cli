import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { logDebug, logInfo } from '../../lib/logger';
import { messages } from '../../lang/en';
import {
  fetchSupportedScopes,
  groupScopesByCategory,
  ScopeEntry,
} from '../../services/oauth-metadata';
import { startScopesWebServer } from '../../services/scopes-web';
import { openBrowser } from '../../lib/browser';

interface ScopesOptions {
  json?: boolean;
  web?: boolean;
}

function waitForShutdownSignal(): Promise<void> {
  return new Promise((resolve) => {
    const handler = (): void => {
      process.off('SIGINT', handler);
      process.off('SIGTERM', handler);
      resolve();
    };
    process.once('SIGINT', handler);
    process.once('SIGTERM', handler);
  });
}

function printScopesByCategory(entries: ScopeEntry[]): void {
  // Headed by the raw category KEY, not the catalog's English label, and the names carry no
  // blurb — this list is a stable, greppable inventory, and both are available in the
  // richer surfaces (`--web`, and the `app create` scope picker).
  const byCategory = groupScopesByCategory(entries);

  let first = true;
  for (const [category, scopes] of byCategory) {
    if (!first) logInfo('');
    first = false;
    logInfo(`${category}:`);
    for (const scope of scopes) {
      logInfo(`  ${scope.name}`);
    }
  }

  logInfo('');
  logInfo(messages.APP_SCOPES_USAGE_HINT);
  logInfo(messages.APP_SCOPES_CATALOG_DOCS_HINT);
  logInfo(messages.APP_SCOPES_DOCS_HINT);
}

async function runWebMode(entries: ScopeEntry[]): Promise<void> {
  const server = await startScopesWebServer(entries, { refetch: fetchSupportedScopes });
  logInfo('');
  logInfo(messages.APP_SCOPES_WEB_LISTENING(server.url));
  try {
    openBrowser(server.url);
  } catch (err) {
    logDebug('openBrowser failed', { message: (err as Error).message });
  }
  await waitForShutdownSignal();
  await server.close();
}

export const scopesCommand = withCommandHandler(async (options: ScopesOptions): Promise<void> => {
  const entries = await fetchSupportedScopes();

  if (options.json) {
    jsonOutput({ scopes: entries.map((e) => e.name) });
    return;
  }

  if (entries.length === 0) {
    logInfo(messages.APP_SCOPES_EMPTY);
  } else {
    printScopesByCategory(entries);
  }

  if (options.web) {
    await runWebMode(entries);
  }
});
