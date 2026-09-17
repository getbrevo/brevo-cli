import { activateFunctionCommand } from '../../../commands/function/activate';

jest.mock('../../../container', () => ({
  functionService: {
    activateFunction: jest.fn(),
    fetchFunctionList: jest.fn(),
  },
}));

jest.mock('../../../commands/function/select-function', () => ({
  assertFunctionSelectionAllowed: jest.fn(),
  promptFunctionSelection: jest.fn(),
}));

import { functionService } from '../../../container';

describe('function/activate', () => {
  let stdoutSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    jest.clearAllMocks();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it('should call activateFunction and show success card', async () => {
    (functionService.activateFunction as jest.Mock).mockResolvedValue(undefined);

    await activateFunctionCommand({ id: 'fn-001', json: false });

    expect(functionService.activateFunction).toHaveBeenCalledWith('fn-001');
    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('Function Activated');
    expect(output).toContain('"fn-001" is now active and processing data.');
  });

  it('should output JSON with activated key on success', async () => {
    (functionService.activateFunction as jest.Mock).mockResolvedValue(undefined);

    await activateFunctionCommand({ id: 'fn-001', json: true });

    const output = stdoutSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.activated).toBe(true);
    expect(parsed.id).toBe('fn-001');
  });
});
