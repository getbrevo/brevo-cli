import { logInfo } from '../../lib/logger';
import { messages } from '../../lang/en';
import { appService } from '../../container';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { createSpinner } from '../../lib/ui';
import { readProjectConfig } from '../../lib/config';

// Prettify an enum-style state ("in_review") into a human label ("In Review").
function toLabel(state: string): string {
  return state
    .split('_')
    .map((word) => (word ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(' ');
}

// Resolve the app to inspect: explicit flag > linked app-config.json > picker.
async function resolveAppId(flagAppId?: string): Promise<string> {
  if (flagAppId) return flagAppId;
  const config = readProjectConfig();
  if (config?.appId) return config.appId;
  return appService.pickApp(messages.APP_STATUS_SELECT);
}

export const statusCommand = withCommandHandler(
  async (options: { appId?: string; json?: boolean }): Promise<void> => {
    const appId = await resolveAppId(options.appId);

    const spinner = createSpinner('Fetching app status...', { silent: options.json });
    let raw;
    try {
      raw = await appService.fetchAppState(appId);
    } finally {
      spinner.stop();
    }

    // Normalize a missing/empty state to a non-empty sentinel so both the
    // header label and --json output stay meaningful.
    const state = typeof raw.state === 'string' && raw.state ? raw.state : 'unknown';
    const message = messages.APP_STATUS_MESSAGE(state);

    if (options.json) {
      jsonOutput({ state, message });
      return;
    }

    logInfo(`\n  ${messages.APP_STATUS_HEADER(toLabel(state))}`);
    logInfo(`  ${message}\n`);
  },
);
