import { ApiError } from '../../../lib/errors';

jest.mock('../../../container', () => ({
  functionService: { fetchFunctionList: jest.fn() },
}));

jest.mock('../../../commands/function/select-function', () => ({
  assertFunctionSelectionAllowed: jest.fn(),
  promptFunctionSelection: jest.fn(),
}));

import { executeFunctionAction } from '../../../commands/function/function-action';
import type { FunctionActionConfig } from '../../../commands/function/function-action';

function makeConfig(overrides?: Partial<FunctionActionConfig>): FunctionActionConfig {
  return {
    commandName: 'brevo function test-action',
    jsonSuccessKey: 'done',
    cardTone: 'success',
    execute: jest.fn().mockResolvedValue(undefined),
    messages: {
      selectPrompt: 'Select a function',
      notFound: (id: string) => `Function "${id}" not found`,
      spinnerText: 'Working...',
      cardTitle: 'Done',
      cardLabel: 'Status',
      cardMessage: (id: string) => `"${id}" is done.`,
    },
    ...overrides,
  };
}

describe('executeFunctionAction', () => {
  let stdoutSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    jest.clearAllMocks();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it('should call execute with the provided id', async () => {
    const config = makeConfig();
    await executeFunctionAction(config, { id: 'fn-001', json: false });
    expect(config.execute).toHaveBeenCalledWith('fn-001');
  });

  it('should output JSON on success with --json', async () => {
    const config = makeConfig({ jsonSuccessKey: 'activated' });
    await executeFunctionAction(config, { id: 'fn-001', json: true });

    const output = stdoutSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.activated).toBe(true);
    expect(parsed.id).toBe('fn-001');
  });

  it('should print status card on success without --json', async () => {
    const config = makeConfig();
    await executeFunctionAction(config, { id: 'fn-001', json: false });

    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('Done');
    expect(output).toContain('"fn-001" is done.');
  });

  it('should show not-found message on 404', async () => {
    const config = makeConfig({
      execute: jest.fn().mockRejectedValue(new ApiError('Not found', 404)),
    });
    await executeFunctionAction(config, { id: 'fn-999', json: false });

    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('Function "fn-999" not found');
  });

  it('should output JSON error on 404 with --json', async () => {
    const config = makeConfig({
      execute: jest.fn().mockRejectedValue(new ApiError('Not found', 404)),
    });
    await executeFunctionAction(config, { id: 'fn-999', json: true });

    const output = stdoutSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.error).toBe('not_found');
    expect(parsed.message).toContain('fn-999');
  });

  it('should propagate non-404 API errors', async () => {
    const config = makeConfig({
      execute: jest.fn().mockRejectedValue(new ApiError('Server error', 500)),
    });
    await expect(executeFunctionAction(config, { id: 'fn-001', json: false })).rejects.toThrow(
      'Server error',
    );
  });

  it('should propagate generic errors', async () => {
    const config = makeConfig({
      execute: jest.fn().mockRejectedValue(new Error('Network error')),
    });
    await expect(executeFunctionAction(config, { id: 'fn-001', json: false })).rejects.toThrow(
      'Network error',
    );
  });
});
