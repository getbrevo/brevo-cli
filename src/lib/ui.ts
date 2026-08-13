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

export function printBox(title: string, lines: string[]): void {
  const maxLen = Math.max(title.length, ...lines.map((l) => stripAnsi(l).length));
  const border = '─'.repeat(maxLen + 2);

  process.stdout.write(`\n  ┌${border}┐\n`);
  process.stdout.write(`  │ \x1b[1m${title.padEnd(maxLen)}\x1b[0m │\n`);
  process.stdout.write(`  ├${border}┤\n`);
  for (const line of lines) {
    const pad = maxLen - stripAnsi(line).length;
    process.stdout.write(`  │ ${line}${' '.repeat(pad)} │\n`);
  }
  process.stdout.write(`  └${border}┘\n\n`);
}

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
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

  let out = `\n  ${color('1', title)}\n  ${color('90', rule)}\n\n`;
  out += `  ${color(code, icon)} ${color(`1;${code}`, label)}\n`;
  for (const line of message.split('\n')) {
    out += `${bodyIndent}${color('90', line)}\n`;
  }
  out += '\n';
  process.stdout.write(out);
}
