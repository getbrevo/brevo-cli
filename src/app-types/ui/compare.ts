/**
 * Equality for two `ui_app` blocks, normalized so only a real authored change counts.
 *
 * Lifted out of `app upload` when a second command needed the same answer: `app install`
 * shows the configuration it is about to install *from the server*, and has to say when the
 * local `app-config.json` no longer matches it. Both questions are "are these two blocks the
 * same block?", and a second implementation of the normalization would drift from this one
 * the first time a wire-only key was added — the exact history `src/app-types/wire.ts`
 * records for the strip it delegates to.
 */
import type { UiApp } from '../../types';
import { stripUiAppWireOnlyKeysFrom } from '../wire';

/** Recursively sort object keys, so a serialized comparison is key-order-independent. */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortKeysDeep(v)]),
    );
  }
  return value;
}

/**
 * Stable serialization for equality checks. Three things vary without the block having
 * changed, and all three are normalized away here:
 *
 *   1. Key order in app-config.json depends on how the file was edited.
 *   2. `surface_point_list` ORDER is not meaningful — the server returns registry order,
 *      which need not match the order the partner picked their pages in. Without sorting,
 *      an authored [deal, contact] against an echoed [contact, deal] is phantom drift.
 *   3. The server-managed keys exist on one side only — stripped via
 *      `stripUiAppWireOnlyKeysFrom`, the single owner of that list, rather than by a
 *      filter duplicated here.
 */
export function canonicalizeUiApp(uiApp: UiApp | undefined): string {
  if (!uiApp) return '';
  const normalized = sortKeysDeep(stripUiAppWireOnlyKeysFrom(uiApp)) as Record<string, unknown>;
  const entries = normalized.surface_point_list;
  if (Array.isArray(entries)) {
    normalized.surface_point_list = [...entries].sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b)),
    );
  }
  return JSON.stringify(normalized);
}

/** Whether two blocks describe the same configuration. An absent block equals an absent one. */
export function uiAppEquals(a: UiApp | undefined, b: UiApp | undefined): boolean {
  return canonicalizeUiApp(a) === canonicalizeUiApp(b);
}
