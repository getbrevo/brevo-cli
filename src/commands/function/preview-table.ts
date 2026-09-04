/** Keys excluded from the execute-result preview table (internal identifiers + error). */
export const PREVIEW_EXCLUDED_KEYS = new Set(['organization_id', 'attribute_id', '__error']);

/** Format a cell value for the preview table, handling objects explicitly. */
export function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return `${value}`;
  return JSON.stringify(value);
}

export function printResultsTable(rows: Record<string, unknown>[]): void {
  if (rows.length === 0) return;
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) seen.add(key);
  }
  const cols = [...seen].filter((k) => !PREVIEW_EXCLUDED_KEYS.has(k));
  if (cols.length === 0) return;

  const widths = cols.map((col) =>
    Math.max(col.length, ...rows.map((r) => formatCellValue(r[col]).length)),
  );
  const gutter = '  ';

  process.stdout.write(`\n  ${cols.map((c, i) => c.padEnd(widths[i]!)).join(gutter)}\n`);
  process.stdout.write(`  ${widths.map((w) => '-'.repeat(w)).join(gutter)}\n`);
  for (const row of rows) {
    process.stdout.write(
      `  ${cols.map((c, i) => formatCellValue(row[c]).padEnd(widths[i]!)).join(gutter)}\n`,
    );
  }
  process.stdout.write('\n');
}

/** True when any row in the execute response carries an `__error` key. */
export function hasPreviewErrors(rows: Record<string, unknown>[]): boolean {
  return rows.some((r) => '__error' in r);
}

/**
 * Derive an `attribute_id` from a function name by converting to
 * SCREAMING_SNAKE_CASE: "sample test" -> "SAMPLE_TEST".
 */
export function deriveAttributeId(name: string): string {
  return name
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .toUpperCase();
}
