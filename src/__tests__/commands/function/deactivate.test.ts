import { deactivateFunctionCommand } from '../../../commands/function/deactivate';

jest.mock('../../../container', () => ({
  functionService: {
    deactivateFunction: jest.fn(),
    fetchFunctionList: jest.fn(),
  },
}));

jest.mock('../../../commands/function/select-function', () => ({
  assertFunctionSelectionAllowed: jest.fn(),
  promptFunctionSelection: jest.fn(),
}));

import { functionService } from '../../../container';

describe('function/deactivate', () => {
  let stdoutSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    jest.clearAllMocks();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it('should call deactivateFunction and show success card', async () => {
    (functionService.deactivateFunction as jest.Mock).mockResolvedValue(undefined);

    await deactivateFunctionCommand({ id: 'fn-001', json: false });

    expect(functionService.deactivateFunction).toHaveBeenCalledWith('fn-001');
    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('Function Deactivated');
    expect(output).toContain('"fn-001" is now inactive.');
  });

  it('should output JSON with deactivated key on success', async () => {
    (functionService.deactivateFunction as jest.Mock).mockResolvedValue(undefined);

    await deactivateFunctionCommand({ id: 'fn-001', json: true });

    const output = stdoutSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.deactivated).toBe(true);
    expect(parsed.id).toBe('fn-001');
  });
});
