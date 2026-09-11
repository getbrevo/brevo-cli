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
import { splitScopes } from '../../lib/validators';
import { assertAppSelectionAllowed, promptAppSelection } from './select-app';
import { checkScopeList, promptScopeSelection, promptTypedScopeList } from './scope-prompts';

export interface UpdateScopesOptions {
  appId?: string;
  scopes?: string;
  yes?: boolean;
  json?: boolean;
}

/**
 * `brevo app scopes update` (BEX-486) — change an existing M2M app's granted OAuth
 * scopes. ASSUMPTION pending BEX-481 (the backend scopes-update API): built against the
 * contract BEX-481's own spec describes, not a live implementation — see the plan doc for
 * this feature.
 *
 * There is deliberately no `--mode append|replace` flag. The current scopes read here
 * (`appService.fetchApp`) are used to PRE-FILL the interactive picker/typed prompt when
 * `--scopes` is omitted, so whatever comes back already IS the full desired scope list —
 * that is what lets `appService.updateAppScopes` send a plain replace, with no separate
 * merge for the server to reconcile. The two prompts keep that promise differently, though:
 * the picker (`promptScopeSelection`) genuinely starts with the current scopes ticked, so
 * ticking/unticking edits a complete set; the typed fallback (`promptTypedScopeList`) can
 * only show the current scopes as a hint and default-on-empty-submit (inquirer 8 does not
 * pre-populate an editable input line) — see that function's doc comment for how it warns
 * a partner not to type a partial list there. `--scopes`, passed directly, is the same
 * contract non-interactively: the full desired list, not a delta.
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
    // Only set from the picker (`select-app.ts` names the app it just listed) — a
    // directly-typed `--app-id` has no label yet, and the app we just fetched has a
    // `name` sitting right here, so fall back to it rather than leaving the confirm
    // prompt to repeat the bare ID.
    appLabel = appLabel || app.name || '';

    const currentScopes = app.scopes ?? [];

    // Resolve the new (full) scope list: --scopes flag, or the interactive
    // picker/typed-fallback — both pre-filled with `currentScopes` so the result is always
    // a complete set, never a delta.
    let newScopes: string[];
    if (options.scopes !== undefined) {
      newScopes = splitScopes(options.scopes);
      const check = checkScopeList(newScopes);
      if (check !== true) throw new CliError(check);
    } else {
      // Not `assertAppSelectionAllowed` — the app was already named (by `--app-id` or the
      // picker above); what can't be shown here is the SCOPE picker, a different prompt
      // with a different fix (`--scopes`, not `--app-id`). Reusing that helper's message
      // would blame the wrong flag.
      if (options.json || !process.stdin.isTTY) {
        throw new CliError(
          messages.APP_SCOPES_UPDATE_SCOPES_REQUIRED(CLI.APP_SCOPES_UPDATE(appId)),
        );
      }
      const picked = await promptScopeSelection(false, currentScopes);
      newScopes = picked ?? (await promptTypedScopeList(false, currentScopes));
    }

    // Diff for the CONFIRMATION PREVIEW — the request itself always sends `newScopes`
    // verbatim as a plain replace.
    const added = newScopes.filter((s) => !currentScopes.includes(s));
    const removed = currentScopes.filter((s) => !newScopes.includes(s));

    if (added.length === 0 && removed.length === 0) {
      if (options.json) {
        jsonOutput({ appId, scopes: currentScopes, changed: false });
        return;
      }
      logInfo(messages.APP_SCOPES_UPDATE_NO_CHANGE(appId));
      return;
    }

    if (!options.json && !options.yes) {
      logInfo(`\n  ${messages.APP_SCOPES_UPDATE_DIFF(currentScopes, newScopes, added, removed)}\n`);
      const { confirmed } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmed',
          message: messages.APP_SCOPES_UPDATE_CONFIRM(appLabel || appId, appId),
          default: false,
        },
      ]);
      if (!confirmed) {
        logInfo(messages.APP_SCOPES_UPDATE_CANCELLED);
        return;
      }
    }

    const updateSpinner = createSpinner('Updating scopes...', { silent: options.json });
    const updated = await appService.updateAppScopes(appId, newScopes);
    updateSpinner.stop();

    if (options.json) {
      jsonOutput({
        appId,
        scopes: updated.scopes ?? newScopes,
        changed: true,
        added,
        removed,
      });
      return;
    }
    logSuccess(messages.APP_SCOPES_UPDATE_SUCCESS(appId, updated.scopes ?? newScopes));
  },
);
