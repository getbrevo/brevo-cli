import { logInfo } from '../../lib/logger';
import { messages } from '../../lang/en';
import { OAuthApp, UiApp } from '../../types';
import { appService } from '../../container';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { createSpinner } from '../../lib/ui';
import { getAppNames, deleteAppName } from '../../lib/config';
import { containsLegacyAllScope } from '../../lib/validators';
import { resolveFromRecord } from '../../app-types';
import { formatPlacementLines } from '../../app-types/ui/fields';

export const listCommand = withCommandHandler(
  async (options: { json?: boolean }): Promise<void> => {
    const spinner = createSpinner('Fetching apps...', { silent: options.json });
    let apps: OAuthApp[] | undefined;
    try {
      apps = await appService.fetchAppsList();
    } finally {
      spinner.stop();
    }

    const merged = mergeCachedNames(apps || []);

    if (options.json) {
      jsonOutput(merged.map(toJsonApp));
      return;
    }

    if (merged.length === 0) {
      logInfo(`\n  ${messages.APP_LIST_EMPTY}\n`);
      return;
    }

    logInfo(`\n  ${messages.APP_LIST_HEADER}\n`);

    for (const app of merged) {
      printApp(app);
    }
  },
);

/**
 * The app-store list endpoint can lag behind writes (eventual consistency), so a name set
 * via `brevo app upload` may not appear here for a while. Merge locally cached names to
 * mask the propagation delay. Once the server catches up (cache equals server), drop the
 * entry so any subsequent out-of-band rename (e.g. dashboard) is visible on the next list.
 */
function mergeCachedNames(apps: OAuthApp[]): OAuthApp[] {
  const cachedNames = getAppNames();
  return apps.map((app) => {
    const cached = cachedNames[app.app_id];
    if (!cached) return app;
    if (cached === app.name) {
      deleteAppName(app.app_id);
      return app;
    }
    return { ...app, name: cached };
  });
}

/**
 * Strip the secret and add the machine-readable deprecation signal.
 *
 * `legacy_all_scope: true` is for scripts/agents — only present on affected apps (BEX-214).
 */
function toJsonApp({ client_secret: _secret, ...rest }: OAuthApp): Record<string, unknown> {
  return {
    ...rest,
    ...(containsLegacyAllScope(rest.scopes) ? { legacy_all_scope: true } : {}),
  };
}

function printApp(app: OAuthApp): void {
  const name = app.name || '—';
  // The type resolves itself and carries its own label, so a third app type shows up
  // here correctly without this function learning about it.
  const appType = resolveFromRecord(app);
  const isUiApp = appType.id === 'ui';
  process.stdout.write(`  ${name}  (App ID: ${app.app_id})\n`);
  process.stdout.write(`    Type:          ${appType.label}\n`);
  // A UI app has no OAuth material at all — no client_id, no callbacks, no
  // scopes. Printing those rows empty would read as a broken OAuth app
  // rather than a UI app, so they are skipped entirely (same reasoning as
  // the upload summary's UI-app branch).
  if (!isUiApp) printOAuthIdentity(app);
  process.stdout.write(`    Logo URL:      ${app.logo_uri || '(none)'}\n`);
  process.stdout.write(`    Version:       ${app.version || '(none)'}\n`);
  if (!isUiApp) printScopes(app);
  // Only when the server echoes the block. The list endpoint does not today,
  // so a UI app usually stops at the Type row — which is still the truth of
  // what the response carried, and better than inventing empty rows.
  if (app.ui_app) printUiApp(app.ui_app);
  process.stdout.write('\n');
}

function printOAuthIdentity(app: OAuthApp): void {
  process.stdout.write(`    Client ID:     ${app.client_id}\n`);
  const redirectUris = app.redirect_uris ?? [];
  if (redirectUris.length === 0) {
    process.stdout.write(`    Redirect URLs: (none)\n`);
    return;
  }
  redirectUris.forEach((uri, i) => {
    process.stdout.write(`    Redirect URL ${i + 1}: ${uri}\n`);
  });
}

function printScopes(app: OAuthApp): void {
  const scopes = app.scopes ?? [];
  const legacyTag = containsLegacyAllScope(scopes) ? messages.LEGACY_ALL_SCOPE_LIST_TAG : '';
  process.stdout.write(
    `    Scopes:        ${scopes.length > 0 ? scopes.join(', ') : '(none)'}${legacyTag}\n`,
  );
}

/**
 * The stored `ui_app` block, field for field — this is what actually renders
 * inside Brevo, so the rows mirror the upload summary's rather than collapsing
 * to a one-line "UI app".
 */
function printUiApp(uiApp: UiApp): void {
  process.stdout.write(`    Extension:     ${uiApp.extension_type}\n`);
  // One group of rows per placement, each with its own context, label and destination:
  // everything CTA is per-entry now (BEX-426), so shared rows would hide that two record
  // pages can forward different fields, show different labels and open different URLs.
  formatPlacementLines(uiApp).forEach((line, i) => {
    process.stdout.write(`    ${i === 0 ? 'Placement:     ' : '               '}${line}\n`);
  });
  // No link_target row: app-config.json does not carry the field (upload injects
  // `_blank`), so surfacing it only sends a partner looking for one to edit.
}
