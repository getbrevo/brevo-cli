import { activateFunctionCommand } from '../../../commands/function/activate';
import { ApiError } from '../../../lib/errors';

jest.mock('../../../container', () => ({
  functionService: {
    activateFunction: jest.fn(),
  },
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

  it('should show success message on activation', async () => {
    (functionService.activateFunction as jest.Mock).mockResolvedValue(undefined);

    await activateFunctionCommand({ id: 'fn-001', json: false });

    expect(functionService.activateFunction).toHaveBeenCalledWith('fn-001');
    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('Brevo Function "fn-001" activated');
  });

  it('should output JSON on success with --json', async () => {
    (functionService.activateFunction as jest.Mock).mockResolvedValue(undefined);

    await activateFunctionCommand({ id: 'fn-001', json: true });

    const output = stdoutSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.activated).toBe(true);
    expect(parsed.id).toBe('fn-001');
  });

  it('should show not-found message on 404', async () => {
    (functionService.activateFunction as jest.Mock).mockRejectedValue(
      new ApiError('Not found', 404),
    );

    await activateFunctionCommand({ id: 'fn-999', json: false });

    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('Brevo Function "fn-999" not found');
  });

  it('should output JSON error on 404 with --json', async () => {
    (functionService.activateFunction as jest.Mock).mockRejectedValue(
      new ApiError('Not found', 404),
    );

    await activateFunctionCommand({ id: 'fn-999', json: true });

    const output = stdoutSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.error).toBe('not_found');
    expect(parsed.message).toContain('fn-999');
  });

  it('should propagate non-404 API errors', async () => {
    (functionService.activateFunction as jest.Mock).mockRejectedValue(
      new ApiError('Server error', 500),
    );

    await expect(activateFunctionCommand({ id: 'fn-001', json: false })).rejects.toThrow(
      'Server error',
    );
  });

  it('should propagate generic errors', async () => {
    (functionService.activateFunction as jest.Mock).mockRejectedValue(new Error('Network error'));

    await expect(activateFunctionCommand({ id: 'fn-001', json: false })).rejects.toThrow(
      'Network error',
    );
  });
});
