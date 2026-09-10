import inquirer from 'inquirer';
import { CLI } from '../../lib/constants';
import { logInfo, logSuccess } from '../../lib/logger';
import { messages } from '../../lang/en';
import { CliError } from '../../lib/errors';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { createSpinner } from '../../lib/ui';
import { appService } from '../../container';
import { isM2mApp } from '../../services/app';
import { splitScopes, ScopeUpdateMode } from '../../lib/validators';
import { assertAppSelectionAllowed, promptAppSelection } from './select-app';
import { checkScopeList, promptScopeSelection, promptTypedScopeList } from './scope-prompts';

export interface UpdateScopesOptions {
  appId?: string;
  scopes?: string;
  mode?: ScopeUpdateMode;
  yes?: boolean;
  json?: boolean;
}

/**
 * `brevo app scopes update` (BEX-486) — change an existing M2M app's granted OAuth
 * scopes. ASSUMPTION pending BEX-481 (the backend scopes-update API): built against the
 * contract BEX-481's own spec describes, not a live implementation — see the plan doc for
 * this feature. The `mode` field this sends is a CLI-driven addition on top of that spec.
 *
 * The current scopes read here (`appService.fetchApp`) is used ONLY to render the
 * confirmation preview below — the request always sends the raw `scopes` list the user
 * asked for plus `mode`, never a client-computed merge, since the server is the authority
 * on the app's actual current scope set and performs the real append/replace itself.
 */
export const updateScopesCommand = withCommandHandler(
  async (options: UpdateScopesOptions): Promise<void> => {
    let appId = options.appId;
    let appLabel = '';

    if (!appId) {
      assertAppSelectionAllowed(CLI.APP_SCOPES_UPDATE(), options.json);
      const selection = await promptAppSelection(messages.APP_SCOPES_UPDATE_SELECT, {
        filter: isM2mApp,
        emptyMessage: messages.APP_SCOPES_UPDATE_NO_M2M_APPS,
      });
      appId = selection.appId;
      appLabel = selection.appLabel;
    }

    // Read current app + validate M2M-only, regardless of whether app-id came from a flag
    // or the picker — the picker's filter narrows choices, but a directly-typed --app-id
    // still needs the same check.
    const loadSpinner = createSpinner('Loading app...', { silent: options.json });
    const app = await appService.fetchApp(appId);
    loadSpinner.stop();
    if (!app) throw new CliError(`App ${appId} not found.`);
    if (!isM2mApp(app)) throw new CliError(messages.APP_SCOPES_UPDATE_NOT_M2M(appId));

    const currentScopes = app.scopes ?? [];
    const interactive = !options.json && Boolean(process.stdin.isTTY);

    // Resolve new scopes: --scopes flag, or interactive picker/typed-fallback reusing the
    // same M2M scope-collection module `app create` uses.
    let newScopes: string[];
    if (options.scopes !== undefined) {
      newScopes = splitScopes(options.scopes);
      const check = checkScopeList(newScopes);
      if (check !== true) throw new CliError(check);
    } else {
      assertAppSelectionAllowed(CLI.APP_SCOPES_UPDATE(appId), options.json);
      const picked = await promptScopeSelection();
      newScopes = picked ?? (await promptTypedScopeList());
    }

    // Resolve mode: --mode flag, or (interactive only) a list prompt. Non-interactive with
    // --mode omitted is a hard failure — no silent default, and specifically no silent
    // default to "replace", which could quietly drop scopes the user did not intend to
    // remove.
    let mode = options.mode;
    if (!mode) {
      if (!interactive) throw new CliError(messages.APP_SCOPES_UPDATE_MODE_REQUIRED());
      const { selectedMode } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectedMode',
          message: messages.APP_SCOPES_UPDATE_MODE_PROMPT,
          choices: [
            { name: messages.APP_SCOPES_UPDATE_MODE_APPEND_LABEL, value: 'append' },
            { name: messages.APP_SCOPES_UPDATE_MODE_REPLACE_LABEL, value: 'replace' },
          ],
        },
      ]);
      mode = selectedMode as ScopeUpdateMode;
    }

    // Diff for the CONFIRMATION PREVIEW only — never what's sent to the server. The
    // server receives `newScopes` + `mode` verbatim and performs the actual merge/replace
    // against its own authoritative current-scopes state.
    const previewAdded = newScopes.filter((s) => !currentScopes.includes(s));
    const previewRemoved =
      mode === 'replace' ? currentScopes.filter((s) => !newScopes.includes(s)) : [];
    const previewFinal = mode === 'append' ? [...currentScopes, ...previewAdded] : newScopes;

    if (previewAdded.length === 0 && previewRemoved.length === 0) {
      if (options.json) {
        jsonOutput({ appId, scopes: currentScopes, mode, changed: false });
        return;
      }
      logInfo(messages.APP_SCOPES_UPDATE_NO_CHANGE(appId));
      return;
    }

    if (!options.yes) {
      logInfo(
        `\n  ${messages.APP_SCOPES_UPDATE_DIFF(mode, currentScopes, previewFinal, previewAdded, previewRemoved)}\n`,
      );
      const { confirmed } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmed',
          message: messages.APP_SCOPES_UPDATE_CONFIRM(appLabel || appId, appId, mode),
          default: false,
        },
      ]);
      if (!confirmed) {
        logInfo(messages.APP_SCOPES_UPDATE_CANCELLED);
        return;
      }
    }

    const updateSpinner = createSpinner('Updating scopes...', { silent: options.json });
    const updated = await appService.updateAppScopes(appId, newScopes, mode);
    updateSpinner.stop();

    if (options.json) {
      jsonOutput({
        appId,
        scopes: updated.scopes ?? previewFinal,
        mode,
        changed: true,
        added: previewAdded,
        removed: previewRemoved,
      });
      return;
    }
    logSuccess(messages.APP_SCOPES_UPDATE_SUCCESS(appId, updated.scopes ?? previewFinal));
  },
);
