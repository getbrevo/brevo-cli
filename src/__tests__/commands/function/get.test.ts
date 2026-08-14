import { getFunctionCommand } from '../../../commands/function/get';
import { ApiError } from '../../../lib/errors';

jest.mock('../../../container', () => ({
  functionService: {
    fetchFunction: jest.fn(),
  },
}));

import { functionService } from '../../../container';

describe('function/get', () => {
  let stdoutSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    jest.clearAllMocks();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  const sampleFunction = {
    id: 'fn-001',
    name: 'Score Leads',
    description: 'Scores leads based on activity',
    explanation: 'Uses engagement data',
    formula: 'SUM(clicks) * 10',
    category: 'scoring',
    version: 1,
    is_active: true,
    is_global: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    last_recalculated_at: '2026-01-15T00:00:00Z',
  };

  describe('getFunctionCommand', () => {
    it('should display all function details for a valid ID', async () => {
      (functionService.fetchFunction as jest.Mock).mockResolvedValue(sampleFunction);

      await getFunctionCommand({ id: 'fn-001', json: false });

      const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
      expect(output).toContain('Score Leads');
      expect(output).toContain('fn-001');
      expect(output).toContain('active');
      expect(output).toContain('Scores leads based on activity');
      expect(output).toContain('Uses engagement data');
      expect(output).toContain('SUM(clicks) * 10');
      expect(output).toContain('scoring');
      expect(output).toContain('2026-01-01T00:00:00Z');
      expect(output).toContain('2026-01-15T00:00:00Z');
      expect(functionService.fetchFunction).toHaveBeenCalledWith('fn-001');
    });

    it('should show inactive status for a disabled function', async () => {
      (functionService.fetchFunction as jest.Mock).mockResolvedValue({
        ...sampleFunction,
        is_active: false,
      });

      await getFunctionCommand({ id: 'fn-001', json: false });

      const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
      expect(output).toContain('inactive');
    });

    it('should omit optional fields when absent', async () => {
      const { category, last_recalculated_at, ...minimal } = sampleFunction;
      (functionService.fetchFunction as jest.Mock).mockResolvedValue(minimal);

      await getFunctionCommand({ id: 'fn-001', json: false });

      const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
      expect(output).not.toContain('Category');
      expect(output).not.toContain('Recalculated');
    });

    it('should output JSON when --json is set', async () => {
      (functionService.fetchFunction as jest.Mock).mockResolvedValue(sampleFunction);

      await getFunctionCommand({ id: 'fn-001', json: true });

      const output = stdoutSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.id).toBe('fn-001');
      expect(parsed.name).toBe('Score Leads');
      expect(parsed.formula).toBe('SUM(clicks) * 10');
    });

    it('should show not-found message on 404', async () => {
      (functionService.fetchFunction as jest.Mock).mockRejectedValue(
        new ApiError('Not found', 404),
      );

      await getFunctionCommand({ id: 'fn-999', json: false });

      const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
      expect(output).toContain('Brevo Function "fn-999" not found');
    });

    it('should output JSON error on 404 with --json', async () => {
      (functionService.fetchFunction as jest.Mock).mockRejectedValue(
        new ApiError('Not found', 404),
      );

      await getFunctionCommand({ id: 'fn-999', json: true });

      const output = stdoutSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.error).toBe('not_found');
      expect(parsed.message).toContain('fn-999');
    });

    it('should propagate non-404 API errors', async () => {
      (functionService.fetchFunction as jest.Mock).mockRejectedValue(
        new ApiError('Server error', 500),
      );

      await expect(getFunctionCommand({ id: 'fn-001', json: false })).rejects.toThrow(
        'Server error',
      );
    });

    it('should propagate generic errors', async () => {
      (functionService.fetchFunction as jest.Mock).mockRejectedValue(new Error('Network error'));

      await expect(getFunctionCommand({ id: 'fn-001', json: false })).rejects.toThrow(
        'Network error',
      );
    });
  });
});
