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
 *   3. The server-managed keys exist on one side only (`sandbox` only where `authored` — the
 *      local block — wrote one; see `stripUiAppWireOnlyKeys`) — stripped via
 *      `stripUiAppWireOnlyKeysFrom`, the single owner of that list, rather than by a
 *      filter duplicated here.
 */
export function canonicalizeUiApp(uiApp: UiApp | undefined, authored?: UiApp): string {
  if (!uiApp) return '';
  const normalized = sortKeysDeep(stripUiAppWireOnlyKeysFrom(uiApp, authored)) as Record<
    string,
    unknown
  >;
  const entries = normalized.surface_point_list;
  if (Array.isArray(entries)) {
    normalized.surface_point_list = entries
      .map(canonicalizeEntrySandbox)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  return JSON.stringify(normalized);
}

/**
 * An entry's `sandbox` as a set: tokens sorted and de-duplicated. The string is a token
 * LIST, so `"allow-forms allow-scripts"` and `"allow-scripts allow-forms"` are one policy,
 * and a server that echoes them in its own order must not read as an edit.
 */
function canonicalizeEntrySandbox(entry: unknown): unknown {
  const row = entry as { sandbox?: unknown } | null;
  if (!row || typeof row.sandbox !== 'string') return entry;
  const tokens = [...new Set(row.sandbox.trim().split(/\s+/).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
  return { ...(row as Record<string, unknown>), sandbox: tokens.join(' ') };
}

/**
 * Whether the local block and the server's describe the same configuration. An absent
 * block equals an absent one.
 *
 * Directional on one point: `sandbox` is compared only on entries the LOCAL block authored
 * one for (the server stamps a default on every entry, and that default is not a
 * difference). So `local` is the first argument, and the server's block the second.
 */
export function uiAppEquals(local: UiApp | undefined, server: UiApp | undefined): boolean {
  return canonicalizeUiApp(local, local) === canonicalizeUiApp(server, local);
}
