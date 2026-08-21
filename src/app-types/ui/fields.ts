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
 * A group of lines per placement: the slot slug (plus its own record context when it
 * narrows one), followed by the entry's own CTA fields — label, supporting text and
 * destination — indented under it.
 *
 * Per-entry rather than shared rows, because everything here is per-entry now: two
 * record pages can forward different fields, show different labels and open different
 * URLs (BEX-426), and combined rows would hide all of that.
 *
 * Returns lines WITHOUT any label or left indent — the caller owns those, including the
 * first-row-label / continuation-row-padding pattern each renderer uses. The two-space
 * indent that nests a CTA line under its slot line is part of the value, so the three
 * renderers can't drift on it.
 */
export function formatPlacementLines(uiApp: Pick<UiApp, 'surface_point_list'>): string[] {
  return (uiApp.surface_point_list ?? []).flatMap((entry) => {
    const context = entry.context?.length ? `  (context: ${entry.context.join(', ')})` : '';
    return [
      `${entry.surface_point_name}${context}`,
      ...(entry.label ? [`  label:         ${entry.label}`] : []),
      ...(entry.more_info ? [`  more info:     ${entry.more_info}`] : []),
      ...(entry.redirect_link ? [`  redirect link: ${entry.redirect_link}`] : []),
      // An iframeExtension's modal URL is the destination, so it earns a line too.
      ...(entry.modal_iframe_url ? [`  modal URL:     ${entry.modal_iframe_url}`] : []),
    ];
  });
}
