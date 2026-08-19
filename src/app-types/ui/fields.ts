/**
 * Value formatting shared by every `ui_app` renderer.
 *
 * Three commands print the block — `app create`'s summary box, `app upload`'s diff, and
 * `app list` — and each has its own labels and column widths, which genuinely differ
 * (`Extension:` vs `Extension type:`) and are read by tests and users. So the LABELS stay in
 * the commands; only the value formatting lives here.
 *
 * That split is where the duplication actually mattered: the placement-with-context string was
 * written out identically in all three, and each copy had to be found and edited when the
 * entry gained its own per-page `context`. One of the two bugs fixed on this branch (the
 * unguarded null dereference) survived precisely because it existed in more than one copy.
 */
import type { UiApp } from '../../types';

/**
 * One line per placement: the slot slug, plus its own record context when it narrows one.
 *
 * Per-entry rather than a single shared context row, because two record pages can forward
 * different fields and a combined row would hide that.
 *
 * Returns lines WITHOUT any label or indent — the caller owns those, including the
 * first-row-label / continuation-row-padding pattern each renderer uses.
 */
export function formatPlacementLines(uiApp: Pick<UiApp, 'surface_point_list'>): string[] {
  return (uiApp.surface_point_list ?? []).map((entry) => {
    const context = entry.context?.length ? `  (context: ${entry.context.join(', ')})` : '';
    return `${entry.surface_point_name}${context}`;
  });
}
