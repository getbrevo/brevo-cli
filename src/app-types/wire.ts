/**
 * Removal of the keys a type declares as wire-only — the ones the server derives, defaults
 * or stamps, which therefore exist on its side of a comparison only.
 *
 * This module exists so the rule has ONE traversal. It previously lived in `app upload` as a
 * private helper, and before that as two private helpers, which is the whole reason it is
 * here: the upload diff and the write-back each had their own, and each had to be fixed
 * separately when `link_target` started arriving on the server's echo and again when
 * `extension_point_name` turned up one level down inside a `surface_point_list` entry. The
 * scaffold's pull path (`brevo app scaffold` with no local config) is the third consumer, and
 * writing a third traversal would have been the same bug a third time.
 *
 * A note on why the strip has to recurse rather than filter top-level keys:
 * `extension_point_name` and (since BEX-426) `link_target` sit INSIDE each entry, one level
 * below the block, while `version` sits at the top. One list, two depths.
 */
import { appTypeById } from './index';
import type { UiApp } from '../types';

/** Strip `keys` from a value at every depth, returning a fresh structure. */
function stripKeysDeep(value: unknown, keys: readonly string[]): unknown {
  if (Array.isArray(value)) return value.map((entry) => stripKeysDeep(entry, keys));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !keys.includes(key))
        .map(([k, v]) => [k, stripKeysDeep(v, keys)]),
    );
  }
  return value;
}

/**
 * Drop every key the UI app type owns server-side from a `ui_app` block.
 *
 * The ONLY reader of `uiAppType.wireOnlyKeys`. All three consumers — the upload diff's
 * equality check, the upload write-back, and the scaffold pull's sanitize-before-write — go
 * through here, so a key added to that list cannot be honoured by one and forgotten by
 * another.
 *
 * Does not mutate its input: callers hold onto the server's raw record for other fields.
 */
export function stripUiAppWireOnlyKeys(uiApp: UiApp): UiApp {
  return stripKeysDeep(uiApp, appTypeById('ui').wireOnlyKeys) as UiApp;
}

/**
 * The generic form, for a value that is not a whole block — the upload diff canonicalizes
 * a possibly-undefined block and sorts it, so it needs the traversal without the `UiApp`
 * cast.
 */
export function stripUiAppWireOnlyKeysFrom(value: unknown): unknown {
  return stripKeysDeep(value, appTypeById('ui').wireOnlyKeys);
}
