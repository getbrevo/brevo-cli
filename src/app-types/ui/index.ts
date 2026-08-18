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
 *   - `link_target`  — `app upload` injects `_blank` onto each `actionLink` entry; the server
 *                      also defaults it and echoes it back. Authoring it only invited a
 *                      partner to edit in a `_self` that 400s. Lives INSIDE an entry since
 *                      BEX-426, one level down, next to the `redirect_link` it qualifies.
 *   - `version`      — the snapshot version the server manages.
 *   - `extension_point_name` — the dotted slot name the platform resolves from each entry's
 *                      `surface_point_name` slug and stamps onto its own copy. Also INSIDE
 *                      an entry, which — with `link_target` — is why the strip recurses.
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

  // Recoverable only when the server actually echoed the block, which is not a detail of
  // the config — it IS the config, and the app-type discriminator.
  //
  // **`isUiAppRecordShape` is what makes this reachable, and why it must not be reused
  // here.** That predicate's fallback (`detect.ts`) calls a record a UI app whenever it
  // carries no OAuth material — no `client_id`, no `redirect_uris` — *whether or not it has
  // a block*. So a record with neither is classified `ui` and then arrives here with
  // nothing to write. Right for labelling a row; wrong for deciding there is a config.
  //
  // Refusal, not a partial write, because the omission is invisible: a config without
  // `ui_app` doesn't read as an incomplete UI app, it reads as a perfectly valid OAuth one,
  // and the next `app upload` pushes an `auth` block where `ui_app` belonged.
  //
  // This once justified itself with a *different*, specific case — "a UI app created but
  // never uploaded has no snapshot and comes back without it". **That case is false**:
  // `persistCreateResultTx` writes the `app_versions` row inside the create transaction
  // with the `ui_app` in its snapshot, and `GET /cli/apps/{id}` serves it back from there,
  // so a never-uploaded UI app *is* recoverable (verified against app-store-bo-be,
  // 2026-08-13). Correcting that is not a reason to drop the guard — the classifier above
  // is, and it is independent of anything the server does with snapshots.
  recoverableFromRecord: (app) => !!app?.ui_app,

  validateConfig: (config) => {
    // Shape only, and only ever about the FILE — a missing label, a bare-string placement, a
    // pre-BEX-290 field name. Whether a slot is registered is the upload endpoint's call; the
    // CLI holds no copy of that registry, on purpose.
    validateUiApp(config.ui_app);
  },

  wireOnlyKeys: UI_APP_WIRE_ONLY_KEYS,
};
