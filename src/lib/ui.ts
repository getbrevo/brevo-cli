import { color } from './logger';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export interface Spinner {
  update(text: string): void;
  stop(finalText?: string): void;
}

let activeSpinner: Spinner | null = null;

/**
 * Stop the currently active spinner (if any).
 * Used by the re-auth handler to clear the spinner before prompting.
 */
export function stopActiveSpinner(): void {
  if (activeSpinner) {
    activeSpinner.stop();
    activeSpinner = null;
  }
}

export function createSpinner(text: string, options?: { silent?: boolean }): Spinner {
  stopActiveSpinner();
  const isTTY = process.stdout.isTTY === true;

  if (options?.silent || !isTTY) {
    if (!options?.silent) {
      process.stderr.write(`  ${text}\n`);
    }
    return {
      update(t: string) {
        if (!options?.silent) process.stderr.write(`  ${t}\n`);
      },
      stop(t?: string) {
        if (t && !options?.silent) process.stderr.write(`  ${t}\n`);
      },
    };
  }

  let frame = 0;
  let currentText = text;

  const interval = setInterval(() => {
    const spinner = SPINNER_FRAMES[frame % SPINNER_FRAMES.length];
    process.stdout.write(`\r  \x1b[36m${spinner}\x1b[0m ${currentText}`);
    frame++;
  }, 80);

  const spinner: Spinner = {
    update(t: string) {
      currentText = t;
    },
    stop(finalText?: string) {
      clearInterval(interval);
      process.stdout.write('\r\x1b[K');
      if (finalText) process.stdout.write(`  ${finalText}\n`);
      if (activeSpinner === spinner) activeSpinner = null;
    },
  };

  activeSpinner = spinner;
  return spinner;
}

/**
 * Columns a box spends on itself: the two-space gutter, a border and a pad on each
 * side. Everything left over is the content budget.
 */
const BOX_CHROME_COLUMNS = 6;

/**
 * Narrowest content a box will size itself down to. Below this the frame is worth
 * less than the text, so an extremely narrow window gets an overflowing box rather
 * than a column of two-letter fragments.
 */
const BOX_MIN_CONTENT_COLUMNS = 24;

/**
 * How wide a box line may be before it has to wrap.
 *
 * A box used to size itself purely to its longest line, which meant the *terminal*
 * did the wrapping — and a terminal wraps the text without the frame, so the tail of
 * an over-long line carries no borders and every `│` after it lands mid-row. One
 * long line was enough to destroy the whole box: a created-app summary carrying an
 * example URL with six query parameters came to 147 columns and shredded itself in a
 * 127-column window.
 *
 * `process.stdout.columns` is undefined when stdout is a pipe or a file — there is no
 * width to respect there, and 80 keeps the frame intact for whoever reads it later.
 */
function boxContentBudget(): number {
  const columns = process.stdout.columns;
  const usable = (typeof columns === 'number' && columns > 0 ? columns : 80) - BOX_CHROME_COLUMNS;
  return Math.max(usable, BOX_MIN_CONTENT_COLUMNS);
}

export function printBox(title: string, lines: string[]): void {
  const budget = boxContentBudget();
  const titleRows = wrapToWidth(title, budget);
  const bodyRows = lines.flatMap((line) => wrapToWidth(line, budget));
  const maxLen = Math.max(...[...titleRows, ...bodyRows].map(displayWidth));
  const border = '─'.repeat(maxLen + 2);

  process.stdout.write(`\n  ┌${border}┐\n`);
  for (const row of titleRows) {
    process.stdout.write(`  │ \x1b[1m${row}${' '.repeat(maxLen - displayWidth(row))}\x1b[0m │\n`);
  }
  process.stdout.write(`  ├${border}┤\n`);
  for (const row of bodyRows) {
    process.stdout.write(`  │ ${row}${' '.repeat(maxLen - displayWidth(row))} │\n`);
  }
  process.stdout.write(`  └${border}┘\n\n`);
}

// eslint-disable-next-line no-control-regex
const SGR = /\x1b\[[0-9;]*m/;
// eslint-disable-next-line no-control-regex
const SGR_GLOBAL = /\x1b\[[0-9;]*m/g;
const SGR_RESET = '\x1b[0m';

function stripAnsi(str: string): string {
  return str.replace(SGR_GLOBAL, '');
}

/** Columns a string occupies once printed — escape sequences take none. */
function displayWidth(str: string): number {
  return stripAnsi(str).length;
}

/**
 * The colour left open at the end of `row`, or `''` if none is.
 *
 * Only the last code is carried, so a row that stacked two styles resumes with one
 * of them. That is deliberate: it costs a shade on a wrapped line and cannot leak a
 * colour onto the border, which is the failure worth preventing.
 */
function openSgr(row: string): string {
  const codes = row.match(SGR_GLOBAL);
  const last = codes?.[codes.length - 1];
  return !last || last === SGR_RESET || last === '\x1b[m' ? '' : last;
}

/**
 * Take one row of at most `width` display columns off `line`.
 *
 * Escape sequences are copied through uncounted, so a coloured line measures by what
 * it prints. A word break is used when one falls in the back half of the row; a URL —
 * which is why this exists and has no spaces to break on — is cut at the boundary.
 */
function takeRow(line: string, width: number): { row: string; rest: string } {
  let row = '';
  let visible = 0;
  let i = 0;
  let breakAt = -1; // index into `row`, just before the last space seen
  let breakFrom = -1; // the same position in `line`

  while (i < line.length && visible < width) {
    const escape = SGR.exec(line.slice(i));
    if (escape?.index === 0) {
      row += escape[0];
      i += escape[0].length;
      continue;
    }
    if (line[i] === ' ' && visible > 0) {
      breakAt = row.length;
      breakFrom = i;
    }
    row += line[i];
    visible += 1;
    i += 1;
  }

  if (i >= line.length) return { row, rest: '' };
  if (breakAt > 0 && displayWidth(row.slice(0, breakAt)) >= width / 2) {
    return { row: row.slice(0, breakAt), rest: line.slice(breakFrom + 1) };
  }
  return { row, rest: line.slice(i) };
}

/**
 * Fit `line` into rows of at most `width` display columns.
 *
 * Continuation rows are indented two columns past the line's own leading whitespace,
 * so a wrapped value reads as belonging to its label rather than starting a new one.
 * The indent is capped so it can never eat the content budget it is measured against.
 */
function wrapToWidth(line: string, width: number): string[] {
  if (displayWidth(line) <= width) return [line];

  const leading = /^ */.exec(line)?.[0].length ?? 0;
  const indent = ' '.repeat(Math.max(Math.min(leading + 2, width - BOX_MIN_CONTENT_COLUMNS), 0));
  const rows: string[] = [];
  let rest = line;
  // Tracked across rows rather than read back off the last one, which has already had
  // its reset appended and would therefore always report nothing open.
  let carried = '';

  while (rest) {
    const first = rows.length === 0;
    const { row, rest: remaining } = takeRow(rest, width - (first ? 0 : indent.length));
    const full = first ? row : `${indent}${carried}${row}`;
    carried = openSgr(full);
    rows.push(carried ? `${full}${SGR_RESET}` : full);
    rest = remaining;
  }
  return rows;
}

/**
 * The two-space gutter every other line of CLI output already sits in — see
 * `logInfo`, `logWarn` and `printBox` above, which all open with two spaces.
 */
const OUTPUT_GUTTER = '  ';

/** A choice as inquirer accepts it, narrowed to the fields this helper touches. */
export interface PromptChoice {
  name: string;
  value: unknown;
  [key: string]: unknown;
}

/**
 * Indent a selection prompt's choice labels into the CLI's output gutter, so the
 * options read as nested under their question instead of running flush to the
 * terminal's left edge.
 *
 * **Only the label moves.** inquirer 8 renders each row as `pointer + ' ' + name`
 * (selected) or `'  ' + name`, and `listRender` is module-private — there is no hook
 * for the pointer, so `❯` stays in the gutter at column 0 while every label lines up
 * two columns further right. That is the intended look: the pointer reads as a margin
 * marker rather than as part of the option text. Don't try to "fix" the pointer by
 * subclassing `ListPrompt` — it would pin us to inquirer's private render internals
 * for two columns of alignment.
 *
 * Applies to `list` and `checkbox` prompts. Deliberately **not** applied to `rawlist`,
 * whose rows already open with ` 1) `, ` 2) ` — a number that both provides the
 * structure this adds and would be split from its own label by the indent.
 *
 * Anything that isn't a labelled choice (a separator, a bare string) is returned
 * untouched, so a caller can pass a mixed array without filtering first.
 */
export function indentChoices<T>(choices: readonly T[]): T[] {
  return choices.map((choice) => {
    if (!choice || typeof choice !== 'object') return choice;
    const candidate = choice as unknown as PromptChoice;
    if (candidate.type === 'separator' || typeof candidate.name !== 'string') return choice;
    return { ...candidate, name: `${OUTPUT_GUTTER}${candidate.name}` } as unknown as T;
  });
}

// Visual tone for a status. Each tone maps to an ANSI colour code and a glyph
// so a state reads at a glance (green ✓ approved, red ✗ rejected, …).
export type StatusTone = 'neutral' | 'info' | 'pending' | 'progress' | 'success' | 'warn' | 'error';

const TONE_STYLES: Record<StatusTone, { code: string; icon: string }> = {
  neutral: { code: '90', icon: '○' }, // gray
  info: { code: '36', icon: '◇' }, // cyan
  pending: { code: '34', icon: '◔' }, // blue
  progress: { code: '33', icon: '◐' }, // yellow
  success: { code: '32', icon: '✓' }, // green
  warn: { code: '33', icon: '⚠' }, // yellow
  error: { code: '31', icon: '✗' }, // red
};

/**
 * Print a colourful, aligned status card:
 *
 *   Title
 *   ─────
 *
 *   ✓ Label
 *     Message body, indented to line up under the label.
 *
 * Colours honour NO_COLOR / FORCE_COLOR / TTY via the shared `color` helper,
 * and every line shares the same left gutter so the block stays aligned.
 */
export function printStatusCard(
  title: string,
  label: string,
  message: string,
  tone: StatusTone,
): void {
  const { code, icon } = TONE_STYLES[tone];
  const rule = '─'.repeat(title.length);
  // "icon + space" is 2 columns wide; indent the message to align under the label.
  const bodyIndent = '  ' + ' '.repeat(2);

  // Bold the label in the tone's own colour.
  const boldCode = `1;${code}`;

  let out = `\n  ${color('1', title)}\n  ${color('90', rule)}\n\n`;
  out += `  ${color(code, icon)} ${color(boldCode, label)}\n`;
  for (const line of message.split('\n')) {
    out += `${bodyIndent}${color('90', line)}\n`;
  }
  out += '\n';
  process.stdout.write(out);
}
