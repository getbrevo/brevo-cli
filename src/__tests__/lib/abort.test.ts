import { isAbortError } from '../../lib/abort';

describe('isAbortError', () => {
  it('should return false for non-Error values', () => {
    expect(isAbortError('string')).toBe(false);
    expect(isAbortError(42)).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
    expect(isAbortError({})).toBe(false);
  });

  it('should return true for readline was closed', () => {
    expect(isAbortError(new Error('readline was closed'))).toBe(true);
  });

  it('should return true for user force closed', () => {
    expect(isAbortError(new Error('User force closed the prompt'))).toBe(true);
  });

  it('should return true for ExitPromptError', () => {
    expect(isAbortError(new Error('ExitPromptError'))).toBe(true);
  });

  it('should return true for prompt was closed', () => {
    expect(isAbortError(new Error('prompt was closed'))).toBe(true);
  });

  it('should be case insensitive', () => {
    expect(isAbortError(new Error('READLINE WAS CLOSED'))).toBe(true);
    expect(isAbortError(new Error('User Force Closed'))).toBe(true);
  });

  it('should return false for other errors', () => {
    expect(isAbortError(new Error('some random error'))).toBe(false);
    expect(isAbortError(new Error('connection refused'))).toBe(false);
  });

  it('should detect abort by error name (ExitPromptError)', () => {
    const err = new Error('something');
    err.name = 'ExitPromptError';
    expect(isAbortError(err)).toBe(true);
  });
});
