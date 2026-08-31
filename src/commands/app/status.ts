import { messages } from '../../lang/en';
import { appService } from '../../container';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { createSpinner, printStatusCard, StatusTone } from '../../lib/ui';
import { readProjectConfig } from '../../lib/config';

// Prettify an enum-style state ("in_review") into a human label ("In Review").
function toLabel(state: string): string {
  return state
    .split('_')
    .map((word) => (word ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(' ');
}

// Map each review state to a visual tone (colour + icon). Unrecognised states
// fall back to a neutral tone so new server-side states still render cleanly.
function toTone(state: string): StatusTone {
  switch (state) {
    case 'approved':
      return 'success';
    case 'rejected':
      return 'error';
    case 'changes_requested':
      return 'warn';
    case 'in_review':
      return 'progress';
    case 'submitted':
      return 'pending';
    case 'draft':
      return 'info';
    default:
      return 'neutral';
  }
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
    // Prefer the server-provided message; fall back to the CLI's per-state copy
    // when the API omits it (older server) or sends a blank string.
    const apiMessage =
      typeof raw.message === 'string' && raw.message.trim() ? raw.message : undefined;
    const message = apiMessage ?? messages.APP_STATUS_MESSAGE(state);

    if (options.json) {
      jsonOutput({ state, message });
      return;
    }

    printStatusCard(messages.APP_STATUS_TITLE, toLabel(state), message, toTone(state));
  },
);
