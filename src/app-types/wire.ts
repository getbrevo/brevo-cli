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
 * The entries of a block that authored a `sandbox`, by slot slug.
 *
 * `sandbox` is the one wire-only key a developer may also write (BEX-498): a private
 * app's `iframeExtension` entry can carry its own. Everywhere else — the block root, and
 * any entry that authored none — it is the platform's stamped default, which comes back on
 * every echo and must neither reach `app-config.json` nor read as drift. The two cases are
 * told apart by asking the LOCAL block, which is the only party that knows what was
 * authored: an echoed entry keeps its `sandbox` exactly when the local entry for the same
 * slot has one. Matched by `surface_point_name`, never by position — list order is the
 * registry's, not the file's.
 */
function authoredSandboxSlots(authored: unknown): Set<string> {
  const slots = new Set<string>();
  const entries = (authored as { surface_point_list?: unknown } | undefined)?.surface_point_list;
  if (!Array.isArray(entries)) return slots;
  for (const entry of entries) {
    const row = entry as { surface_point_name?: unknown; sandbox?: unknown } | null;
    if (typeof row?.surface_point_name === 'string' && typeof row.sandbox === 'string') {
      slots.add(row.surface_point_name);
    }
  }
  return slots;
}

/**
 * Strip the wire-only keys from `value`, then put back each entry's OWN `sandbox` where the
 * `authored` block says that slot authored one. `value` and `authored` may be the same
 * block (the local file normalized against itself) or different ones (the server's echo
 * normalized against the file) — the echoed value is what survives in the second case, so
 * a difference between what was authored and what the server holds is still visible to the
 * diff. Without `authored` every `sandbox` is stripped: the scaffold pull has no local
 * file to ask, and the platform's default is not something to write into a new one.
 */
function stripWireOnly(value: unknown, authored?: unknown): unknown {
  const stripped = stripKeysDeep(value, appTypeById('ui').wireOnlyKeys);
  const slots = authoredSandboxSlots(authored);
  const original = (value as { surface_point_list?: unknown } | undefined)?.surface_point_list;
  const list = (stripped as { surface_point_list?: unknown } | undefined)?.surface_point_list;
  if (slots.size === 0 || !Array.isArray(original) || !Array.isArray(list)) return stripped;
  const kept = list.map((entry, i) => {
    const source = original[i] as { surface_point_name?: unknown; sandbox?: unknown } | null;
    const name = source?.surface_point_name;
    if (typeof name !== 'string' || !slots.has(name) || typeof source?.sandbox !== 'string') {
      return entry;
    }
    return { ...(entry as Record<string, unknown>), sandbox: source.sandbox };
  });
  return { ...(stripped as Record<string, unknown>), surface_point_list: kept };
}

/**
 * Drop every key the UI app type owns server-side from a `ui_app` block.
 *
 * The ONLY reader of `uiAppType.wireOnlyKeys`. All three consumers — the upload diff's
 * equality check, the upload write-back, and the scaffold pull's sanitize-before-write — go
 * through here, so a key added to that list cannot be honoured by one and forgotten by
 * another.
 *
 * `authored` is the local block whose entries' own `sandbox` values are kept (see
 * `authoredSandboxSlots`); omit it to strip every `sandbox`.
 *
 * Does not mutate its input: callers hold onto the server's raw record for other fields.
 */
export function stripUiAppWireOnlyKeys(uiApp: UiApp, authored?: UiApp): UiApp {
  return stripWireOnly(uiApp, authored) as UiApp;
}

/**
 * The generic form, for a value that is not a whole block — the upload diff canonicalizes
 * a possibly-undefined block and sorts it, so it needs the traversal without the `UiApp`
 * cast.
 */
export function stripUiAppWireOnlyKeysFrom(value: unknown, authored?: unknown): unknown {
  return stripWireOnly(value, authored);
}
