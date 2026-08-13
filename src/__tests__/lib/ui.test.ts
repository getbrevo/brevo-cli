import { createSpinner, printBox, indentChoices } from '../../lib/ui';

describe('ui', () => {
  let stdoutSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  describe('createSpinner', () => {
    it('should create a spinner with update and stop methods', () => {
      const originalTTY = process.stdout.isTTY;
      Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });

      const spinner = createSpinner('Loading...');
      expect(spinner).toHaveProperty('update');
      expect(spinner).toHaveProperty('stop');
      expect(typeof spinner.update).toBe('function');
      expect(typeof spinner.stop).toBe('function');

      Object.defineProperty(process.stdout, 'isTTY', { value: originalTTY, configurable: true });
    });

    it('should write text directly in non-TTY mode', () => {
      const originalTTY = process.stdout.isTTY;
      Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });

      const spinner = createSpinner('Loading...');
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Loading...'));

      spinner.update('Updated');
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Updated'));

      spinner.stop('Done');
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Done'));

      Object.defineProperty(process.stdout, 'isTTY', { value: originalTTY, configurable: true });
    });

    it('should start interval in TTY mode and stop clears it', () => {
      const originalTTY = process.stdout.isTTY;
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });

      jest.useFakeTimers();
      const spinner = createSpinner('Working...');

      jest.advanceTimersByTime(160); // 2 frames
      expect(stdoutSpy).toHaveBeenCalled();

      spinner.stop('Finished');
      jest.useRealTimers();

      Object.defineProperty(process.stdout, 'isTTY', { value: originalTTY, configurable: true });
    });
  });

  describe('printBox', () => {
    const originalColumns = Object.getOwnPropertyDescriptor(process.stdout, 'columns');

    const setColumns = (value: number | undefined) => {
      Object.defineProperty(process.stdout, 'columns', {
        value,
        configurable: true,
        writable: true,
      });
    };

    /** The box as printed, split into rows with their escape codes removed. */
    const rendered = (): string[] =>
      stdoutSpy.mock.calls
        .map((c: [string]) => c[0])
        .join('')
        // eslint-disable-next-line no-control-regex
        .replace(/\x1b\[[0-9;]*m/g, '')
        .split('\n')
        .filter((row: string) => row.trim() !== '');

    afterEach(() => {
      if (originalColumns) {
        Object.defineProperty(process.stdout, 'columns', originalColumns);
      } else {
        Reflect.deleteProperty(process.stdout, 'columns');
      }
    });

    it('should print a box with title and lines', () => {
      setColumns(120);
      printBox('Test Title', ['Line 1', 'Line 2']);
      const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
      expect(output).toContain('Test Title');
      expect(output).toContain('Line 1');
      expect(output).toContain('Line 2');
      expect(output).toContain('┌');
      expect(output).toContain('┘');
    });

    // The whole point: a box wider than the window is wrapped by the TERMINAL, which
    // wraps the text without the frame — so every border after the first long line
    // lands mid-row and the box is destroyed. Every row must fit.
    it('never renders a row wider than the terminal', () => {
      setColumns(60);
      printBox('UI app created', [
        'Redirect link:  https://example.com/brevo',
        '  https://example.com/brevo?recordId=RECORD_ID&recordName=RECORD_NAME&accountId=ACCOUNT_ID',
      ]);

      const rows = rendered();
      expect(rows.length).toBeGreaterThan(4);
      for (const row of rows) expect([...row].length).toBeLessThanOrEqual(60);
    });

    // Every row is padded to the same width, so the right-hand border is a column.
    it('keeps every row the same width, borders included', () => {
      setColumns(72);
      printBox('Next steps', ['1. cd app', '2. brevo app upload', 'a'.repeat(200)]);

      const widths = new Set(rendered().map((row) => [...row].length));
      expect(widths.size).toBe(1);
    });

    it('breaks a long line at a word when one is near the edge, and mid-token when not', () => {
      setColumns(48);
      printBox('T', ['Values are placeholders and the path is never templated at all']);
      expect(rendered().some((row) => /\bplaceholders\b/.test(row))).toBe(true);

      stdoutSpy.mockClear();
      printBox('T', [`https://example.com/${'x'.repeat(80)}`]);
      // No spaces to break on, so the URL is cut at the column boundary rather than
      // being allowed to overflow.
      expect(rendered().every((row) => [...row].length <= 48)).toBe(true);
    });

    // Continuation rows sit past the wrapped line's own indent, so a wrapped value
    // still reads as belonging to the label above it.
    it('indents continuation rows past the wrapped line', () => {
      setColumns(50);
      printBox('T', [`  ${'token '.repeat(20)}`]);

      const body = rendered().slice(3, -1);
      expect(body.length).toBeGreaterThan(1);
      expect(body[1]).toMatch(/^ {2}│ {5}/);
    });

    // A pipe or a file has no width to respect. 80 keeps the frame intact for
    // whoever reads the captured output later.
    it('falls back to 80 columns when stdout reports no width', () => {
      setColumns(undefined);
      printBox('T', ['b'.repeat(200)]);

      const widths = new Set(rendered().map((row) => [...row].length));
      expect([...widths]).toEqual([80]);
    });

    // Narrower than the frame is worth: the box stops shrinking rather than
    // producing a column of two-letter fragments.
    it('stops shrinking at a floor rather than degenerating', () => {
      setColumns(10);
      printBox('T', ['c'.repeat(60)]);

      const widths = new Set(rendered().map((row) => [...row].length));
      expect([...widths]).toEqual([30]); // 24-column floor + 6 of chrome
    });

    // Colour is measured by what it prints, and closed at the row edge so it can
    // never bleed onto the border.
    it('measures a coloured line by its visible text and closes the colour per row', () => {
      setColumns(40);
      printBox('T', [`\x1b[36m${'word '.repeat(20)}\x1b[0m`]);

      const raw = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
      for (const row of raw.split('\n').filter((r: string) => r.includes('│'))) {
        expect(row.trimEnd().endsWith('│')).toBe(true);
      }
      // One width for every row, and within the window — the escape codes are not
      // counted, which is what measuring by visible text means.
      const widths = new Set(rendered().map((row) => [...row].length));
      expect(widths.size).toBe(1);
      expect([...widths][0]).toBeLessThanOrEqual(40);
    });
  });

  describe('indentChoices', () => {
    it('pads each label into the same two-space gutter the rest of the output uses', () => {
      expect(
        indentChoices([
          { name: 'Private  (Used exclusively by your organisation)', value: 'private' },
          { name: 'Public   (Distributed to end users)', value: 'public' },
        ]),
      ).toEqual([
        { name: '  Private  (Used exclusively by your organisation)', value: 'private' },
        { name: '  Public   (Distributed to end users)', value: 'public' },
      ]);
    });

    it('carries every other field through, so a disabled choice stays disabled', () => {
      expect(
        indentChoices([
          { name: 'Modal iframe', value: 'iframeExtension', disabled: 'Coming soon' },
        ]),
      ).toEqual([{ name: '  Modal iframe', value: 'iframeExtension', disabled: 'Coming soon' }]);
    });

    it('does not mutate the choices it was given', () => {
      const choices = [{ name: 'OAuth app', value: 'oauth' }];
      indentChoices(choices);
      expect(choices[0]?.name).toBe('OAuth app');
    });

    // Callers can pass a mixed array without filtering: a separator has no label to
    // indent, and indenting one would push its rule out of alignment with the choices.
    it('leaves separators and non-labelled entries untouched', () => {
      const separator = { type: 'separator', line: '── Contact ──' };
      expect(indentChoices([separator, 'bare string', null])).toEqual([
        separator,
        'bare string',
        null,
      ]);
    });
  });
});
