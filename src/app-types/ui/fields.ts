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
import type { SurfacePointEntry, UiApp } from '../../types';

/** No value, rendered as one word so a `before → after` row reads on both sides. */
const NONE = '(none)';

/**
 * The entry's authored value rows, in the order they render, with the label padding that
 * aligns their values. Table-driven because the plain renderer and the diff renderer below
 * must agree on which fields exist and what they are called: adding a per-entry field to
 * one and not the other is how a partner ends up unable to see a value the CLI is about to
 * push.
 */
const VALUE_ROWS: ReadonlyArray<{
  label: string;
  read: (entry: SurfacePointEntry) => string | undefined;
}> = [
  { label: 'label:         ', read: (e) => e.label },
  { label: 'more info:     ', read: (e) => e.more_info },
  { label: 'redirect link: ', read: (e) => e.redirect_link },
  // An iframeExtension's modal URL is the destination, so it earns a line too.
  { label: 'modal URL:     ', read: (e) => e.modal_iframe_url },
  { label: 'card size:     ', read: (e) => formatSize(e.size) },
];

/** `{ width, height }` as one row — each axis is optional, so an absent one is omitted. */
function formatSize(size: SurfacePointEntry['size']): string | undefined {
  if (!size) return undefined;
  const axes = [
    ...(size.width ? [`width ${size.width}`] : []),
    ...(size.height ? [`height ${size.height}`] : []),
  ];
  return axes.length ? axes.join(', ') : undefined;
}

/** `  (context: recordId, email)`, or nothing when the entry narrows no context. */
function formatContext(entry: SurfacePointEntry): string {
  return entry.context?.length ? `  (context: ${entry.context.join(', ')})` : '';
}

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
  return (uiApp.surface_point_list ?? []).flatMap((entry) => [
    `${entry.surface_point_name}${formatContext(entry)}`,
    ...VALUE_ROWS.flatMap(({ label, read }) => {
      const value = read(entry);
      return value ? [`  ${label}${value}`] : [];
    }),
  ]);
}

/**
 * The same placement lines, but against what the server currently stores: every value
 * that differs renders as `before → after`, an added placement is tagged `(new)` and one
 * the local config dropped trails as `(removed)`.
 *
 * This is what makes `brevo app upload` answer the question it is asked. The block drives
 * what renders inside Brevo, and the summary used to print only the *desired* state with a
 * single `(changed)` marker beside it — so a partner reviewing the prompt could see that
 * something in the block differed but not what, which for a live app is the one thing worth
 * seeing before saying yes. The rest of the summary has always diffed this way (`Name`,
 * `Version`, `Scopes`); this brings the block in line with it.
 *
 * Entries are matched by `surface_point_name`, the slug that identifies the slot — never by
 * position, because `surface_point_list` order is not meaningful (the server returns
 * registry order) and matching on index would report every placement as changed the moment
 * the two orders disagreed.
 */
export function formatPlacementDiffLines(next: UiApp, current: UiApp | undefined): string[] {
  // No block on the server's side at all — either the app has never carried one, or the
  // build answering the read doesn't echo it. Nothing to compare against, so the lines
  // print plain rather than tagging every placement `(new)`: a tag would be asserting the
  // slot is new to the app, which an absent block is not evidence of. The summary's own
  // `(changed)` marker still says the block differs.
  if (!current) return formatPlacementLines(next);
  const currentEntries = current.surface_point_list ?? [];
  const nextEntries = next.surface_point_list ?? [];
  const before = new Map(currentEntries.map((entry) => [entry.surface_point_name, entry]));
  const nextNames = new Set(nextEntries.map((entry) => entry.surface_point_name));

  const changedOrKept = nextEntries.flatMap((entry) => {
    const previous = before.get(entry.surface_point_name);
    // A placement the server has never seen has nothing to compare against, so it prints
    // as itself with the tag — the same treatment `diffLines` gives a new scope or URL.
    if (!previous) {
      const [slot, ...rest] = formatPlacementLines({ surface_point_list: [entry] });
      return [`${slot}  (new)`, ...rest];
    }
    return [
      `${entry.surface_point_name}${diffContext(previous, entry)}`,
      ...VALUE_ROWS.flatMap(({ label, read }) => {
        const from = read(previous);
        const to = read(entry);
        if (from === to) return to ? [`  ${label}${to}`] : [];
        return [`  ${label}${from ?? NONE} → ${to ?? NONE}`];
      }),
    ];
  });

  return [
    ...changedOrKept,
    // Trailing, like every other removal in the summary. No value rows: the entry is
    // going away, so what it used to say is not what the partner needs to check.
    ...currentEntries
      .filter((entry) => !nextNames.has(entry.surface_point_name))
      .map((entry) => `${entry.surface_point_name}  (removed)`),
  ];
}

/** The context suffix, arrowed when the entry's allow-list narrowing changed. */
function diffContext(previous: SurfacePointEntry, entry: SurfacePointEntry): string {
  const from = previous.context ?? [];
  const to = entry.context ?? [];
  if (from.join(',') === to.join(',')) return formatContext(entry);
  return `  (context: ${from.length ? from.join(', ') : NONE} → ${to.length ? to.join(', ') : NONE})`;
}
