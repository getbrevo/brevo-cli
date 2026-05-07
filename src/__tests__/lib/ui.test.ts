import { createSpinner, printBox } from '../../lib/ui';

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
    it('should print a box with title and lines', () => {
      printBox('Test Title', ['Line 1', 'Line 2']);
      const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
      expect(output).toContain('Test Title');
      expect(output).toContain('Line 1');
      expect(output).toContain('Line 2');
      expect(output).toContain('┌');
      expect(output).toContain('┘');
    });
  });
});
