/**
 * The UI app type (BEX-290) — an action link that renders inside a Brevo CRM record.
 *
 * `preview`: shipped in the CLI, not live on the platform. That is metadata for doc
 * generation only — the CLI deliberately has no runtime guard, see `contract.ts`.
 *
 * Note the descriptor does NOT expose this type's prompts. `./authoring` is imported directly
 * by `app create`, so `app list` doesn't pull `inquirer` and the whole registry-read flow in
 * just to print a `Type:` row.
 */
import { messages } from '../../lang/en';
import { validateUiApp } from '../../lib/validators';
import type { AppTypeModule } from '../contract';
import { isUiAppConfigShape, isUiAppRecordShape } from './detect';

/**
 * Keys the platform owns on a stored `ui_app` block, none of which belong in
 * `app-config.json`:
 *
 *   - `link_target`  — `app upload` injects `_blank`; the server also defaults it and echoes
 *                      it back. Authoring it only invited a partner to edit in a `_self` that
 *                      400s.
 *   - `version`      — the snapshot version the server manages.
 *   - `extension_point_name` — the dotted slot name the platform resolves from each entry's
 *                      `surface_point_name` slug and stamps onto its own copy. It lives
 *                      INSIDE an entry, one level down, which is why the strip recurses.
 *
 * All three exist on the server's side of a comparison only. Left in, the first successful
 * upload writes them into the file this command just decided to keep them out of, and every
 * subsequent upload reports drift on fields the partner cannot edit — so "already up to date"
 * would never print for a UI app again.
 */
const UI_APP_WIRE_ONLY_KEYS: readonly string[] = [
  'link_target',
  'version',
  'extension_point_name',
] as const;

export const uiAppType: AppTypeModule = {
  id: 'ui',
  label: messages.APP_TYPE_UI,
  availability: 'preview',

  detectConfig: isUiAppConfigShape,
  detectRecord: isUiAppRecordShape,

  // Recoverable only when the server actually echoed the block. The read endpoint sources
  // `ui_app` from the latest `app_versions` snapshot, so a UI app created but never uploaded
  // has no snapshot and comes back without it — and the block is not a detail of the config,
  // it IS the config (and the app-type discriminator). Note this is deliberately NOT
  // `isUiAppRecordShape`: that predicate's fallback classifies a blockless record as a UI app
  // on the absence of OAuth material, which is right for labelling a row and wrong for
  // deciding there is something to write.
  recoverableFromRecord: (app) => !!app?.ui_app,

  validateConfig: (config) => {
    // Shape only, and only ever about the FILE — a missing label, a bare-string placement, a
    // pre-BEX-290 field name. Whether a slot is registered is the upload endpoint's call; the
    // CLI holds no copy of that registry, on purpose.
    validateUiApp(config.ui_app);
  },

  wireOnlyKeys: UI_APP_WIRE_ONLY_KEYS,
};
