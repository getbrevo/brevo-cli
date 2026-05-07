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
