import { deactivateFunctionCommand } from '../../../commands/function/deactivate';
import { ApiError } from '../../../lib/errors';

jest.mock('../../../container', () => ({
  functionService: {
    deactivateFunction: jest.fn(),
  },
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

  it('should show success message on deactivation', async () => {
    (functionService.deactivateFunction as jest.Mock).mockResolvedValue(undefined);

    await deactivateFunctionCommand({ id: 'fn-001', json: false });

    expect(functionService.deactivateFunction).toHaveBeenCalledWith('fn-001');
    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('Brevo Function "fn-001" deactivated');
  });

  it('should output JSON on success with --json', async () => {
    (functionService.deactivateFunction as jest.Mock).mockResolvedValue(undefined);

    await deactivateFunctionCommand({ id: 'fn-001', json: true });

    const output = stdoutSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.deactivated).toBe(true);
    expect(parsed.id).toBe('fn-001');
  });

  it('should show not-found message on 404', async () => {
    (functionService.deactivateFunction as jest.Mock).mockRejectedValue(
      new ApiError('Not found', 404),
    );

    await deactivateFunctionCommand({ id: 'fn-999', json: false });

    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('Brevo Function "fn-999" not found');
  });

  it('should output JSON error on 404 with --json', async () => {
    (functionService.deactivateFunction as jest.Mock).mockRejectedValue(
      new ApiError('Not found', 404),
    );

    await deactivateFunctionCommand({ id: 'fn-999', json: true });

    const output = stdoutSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.error).toBe('not_found');
    expect(parsed.message).toContain('fn-999');
  });

  it('should propagate non-404 API errors', async () => {
    (functionService.deactivateFunction as jest.Mock).mockRejectedValue(
      new ApiError('Server error', 500),
    );

    await expect(deactivateFunctionCommand({ id: 'fn-001', json: false })).rejects.toThrow(
      'Server error',
    );
  });

  it('should propagate generic errors', async () => {
    (functionService.deactivateFunction as jest.Mock).mockRejectedValue(new Error('Network error'));

    await expect(deactivateFunctionCommand({ id: 'fn-001', json: false })).rejects.toThrow(
      'Network error',
    );
  });
});
