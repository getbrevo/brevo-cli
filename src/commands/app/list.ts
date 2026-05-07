import { logInfo } from '../../lib/logger';
import { messages } from '../../lang/en';
import { OAuthApp } from '../../types';
import { appService } from '../../container';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { createSpinner } from '../../lib/ui';
import { getAppNames, deleteAppName } from '../../lib/config';

export const listCommand = withCommandHandler(
  async (options: { json?: boolean }): Promise<void> => {
    const spinner = createSpinner('Fetching apps...', { silent: options.json });
    let apps: OAuthApp[] | undefined;
    try {
      apps = await appService.fetchAppsList();
    } finally {
      spinner.stop();
    }

    // The /v3/oauth/apps list endpoint lags behind /v3/app-store updates,
    // so a name set via `brevo app update` may not appear here for a while.
    // Merge locally cached names to mask the propagation delay. Once the server
    // catches up (cache equals server), drop the entry so any subsequent
    // out-of-band rename (e.g. dashboard) is visible on the next list.
    const cachedNames = getAppNames();
    apps = (apps || []).map((app) => {
      const cached = cachedNames[app.app_id];
      if (!cached) return app;
      if (cached === app.name) {
        deleteAppName(app.app_id);
        return app;
      }
      return { ...app, name: cached };
    });

    if (options.json) {
      const safeApps = apps.map(({ client_secret: _secret, ...rest }) => rest);
      jsonOutput(safeApps);
      return;
    }

    if (!apps || apps.length === 0) {
      logInfo(`\n  ${messages.APP_LIST_EMPTY}\n`);
      return;
    }

    logInfo(`\n  ${messages.APP_LIST_HEADER}\n`);

    for (const app of apps) {
      const name = app.name || '—';
      process.stdout.write(`  ${name}  (App ID: ${app.app_id})\n`);
      process.stdout.write(`    Client ID:     ${app.client_id}\n`);
      if (app.redirect_uris.length > 0) {
        app.redirect_uris.forEach((uri, i) => {
          process.stdout.write(`    Redirect URL ${i + 1}: ${uri}\n`);
        });
      } else {
        process.stdout.write(`    Redirect URLs: (none)\n`);
      }
      const scopes = app.scopes ?? [];
      process.stdout.write(
        `    Scopes:        ${scopes.length > 0 ? scopes.join(', ') : '(none)'}\n`,
      );
      process.stdout.write('\n');
    }
  },
);
