import { deleteFunctionCommand } from '../../../commands/function/delete';
import { ApiError } from '../../../lib/errors';

jest.mock('inquirer', () => ({
  prompt: jest.fn(),
}));

jest.mock('../../../container', () => ({
  functionService: {
    deleteFunction: jest.fn(),
    fetchFunctionList: jest.fn(),
  },
}));

jest.mock('../../../commands/function/select-function', () => ({
  assertFunctionSelectionAllowed: jest.fn(),
  promptFunctionSelection: jest.fn(),
}));

import inquirer from 'inquirer';
import { functionService } from '../../../container';

describe('function/delete', () => {
  let stdoutSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    jest.clearAllMocks();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it('should delete with --force without prompting', async () => {
    (functionService.deleteFunction as jest.Mock).mockResolvedValue(undefined);

    await deleteFunctionCommand({ id: 'fn-001', force: true, json: false });

    expect(inquirer.prompt).not.toHaveBeenCalled();
    expect(functionService.deleteFunction).toHaveBeenCalledWith('fn-001');
    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('Function Deleted');
    expect(output).toContain('"fn-001" has been permanently deleted.');
  });

  it('should output JSON with --force --json', async () => {
    (functionService.deleteFunction as jest.Mock).mockResolvedValue(undefined);

    await deleteFunctionCommand({ id: 'fn-001', force: true, json: true });

    expect(inquirer.prompt).not.toHaveBeenCalled();
    const output = stdoutSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.deleted).toBe(true);
    expect(parsed.id).toBe('fn-001');
  });

  it('should delete when user confirms', async () => {
    (inquirer.prompt as unknown as jest.Mock).mockResolvedValue({ confirmed: true });
    (functionService.deleteFunction as jest.Mock).mockResolvedValue(undefined);

    await deleteFunctionCommand({ id: 'fn-001', force: false, json: false });

    expect(inquirer.prompt).toHaveBeenCalled();
    expect(functionService.deleteFunction).toHaveBeenCalledWith('fn-001');
    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('Function Deleted');
  });

  it('should cancel when user declines', async () => {
    (inquirer.prompt as unknown as jest.Mock).mockResolvedValue({ confirmed: false });

    await deleteFunctionCommand({ id: 'fn-001', force: false, json: false });

    expect(functionService.deleteFunction).not.toHaveBeenCalled();
    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('Deletion cancelled');
  });

  it('should skip prompt with --json (implied force)', async () => {
    (functionService.deleteFunction as jest.Mock).mockResolvedValue(undefined);

    await deleteFunctionCommand({ id: 'fn-001', force: false, json: true });

    expect(inquirer.prompt).not.toHaveBeenCalled();
    expect(functionService.deleteFunction).toHaveBeenCalledWith('fn-001');
    const output = stdoutSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.deleted).toBe(true);
  });

  it('should show not-found on 404 with --force', async () => {
    (functionService.deleteFunction as jest.Mock).mockRejectedValue(new ApiError('Not found', 404));

    await deleteFunctionCommand({ id: 'fn-999', force: true, json: false });

    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('Brevo Function "fn-999" not found');
  });

  it('should propagate non-404 errors', async () => {
    (functionService.deleteFunction as jest.Mock).mockRejectedValue(
      new ApiError('Server error', 500),
    );

    await expect(deleteFunctionCommand({ id: 'fn-001', force: true, json: false })).rejects.toThrow(
      'Server error',
    );
  });
});
