import { listFunctionCommand } from '../../../commands/function/list';

jest.mock('../../../container', () => ({
  functionService: {
    fetchFunctionList: jest.fn(),
    fetchDraftFunctionList: jest.fn(),
  },
}));

import { functionService } from '../../../container';

describe('function/list', () => {
  let stdoutSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    jest.clearAllMocks();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  describe('listFunctionCommand', () => {
    it('should display functions with total/max count', async () => {
      (functionService.fetchFunctionList as jest.Mock).mockResolvedValue({
        functions: [
          {
            id: 'fn-001',
            name: 'Score Leads',
            description: 'Scores leads based on activity',
            explanation: 'Uses engagement data',
            formula: 'SUM(clicks) * 10',
            version: 1,
            is_active: true,
            is_global: false,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
          {
            id: 'fn-002',
            name: 'Churn Risk',
            description: 'Predicts churn risk',
            explanation: 'Inactivity metric',
            formula: 'DAYS_SINCE(last_open) > 30',
            version: 2,
            is_active: false,
            is_global: true,
            created_at: '2026-02-01T00:00:00Z',
            updated_at: '2026-02-01T00:00:00Z',
          },
        ],
        total: 2,
        max: 7,
        limit: 50,
        offset: 0,
        has_more: false,
      });

      await listFunctionCommand({ json: false });

      const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
      expect(output).toContain('Score Leads');
      expect(output).toContain('ID: fn-001');
      expect(output).toContain('active');
      expect(output).toContain('SUM(clicks) * 10');
      expect(output).toContain('Churn Risk');
      expect(output).toContain('ID: fn-002');
      expect(output).toContain('inactive');
      expect(output).toContain('Total: 2 / 7');
    });

    it('should show empty message when no functions exist', async () => {
      (functionService.fetchFunctionList as jest.Mock).mockResolvedValue({
        functions: [],
        total: 0,
        max: 7,
        limit: 50,
        offset: 0,
        has_more: false,
      });

      await listFunctionCommand({ json: false });

      const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
      expect(output).toContain('No Brevo Functions found');
    });

    it('should output JSON when --json is set', async () => {
      const response = {
        functions: [
          {
            id: 'fn-001',
            name: 'Score Leads',
            description: 'Scores leads',
            explanation: 'Uses data',
            formula: 'SUM(clicks)',
            version: 1,
            is_active: true,
            is_global: false,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
        total: 1,
        max: 7,
        limit: 50,
        offset: 0,
        has_more: false,
      };
      (functionService.fetchFunctionList as jest.Mock).mockResolvedValue(response);

      await listFunctionCommand({ json: true });

      const output = stdoutSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.functions).toHaveLength(1);
      expect(parsed.functions[0].id).toBe('fn-001');
      expect(parsed.total).toBe(1);
      expect(parsed.max).toBe(7);
    });

    it('should handle API errors', async () => {
      (functionService.fetchFunctionList as jest.Mock).mockRejectedValue(
        new Error('Network error'),
      );

      await expect(listFunctionCommand({ json: false })).rejects.toThrow('Network error');
    });

    it('should tolerate a response with missing functions array', async () => {
      (functionService.fetchFunctionList as jest.Mock).mockResolvedValue({
        total: 0,
        max: 7,
        limit: 50,
        offset: 0,
        has_more: false,
      });

      await listFunctionCommand({ json: false });

      const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
      expect(output).toContain('No Brevo Functions found');
    });

    it('should display draft functions when --draft is set', async () => {
      (functionService.fetchDraftFunctionList as jest.Mock).mockResolvedValue({
        drafts: [
          {
            id: 'draft-001',
            description: 'A draft function',
            explanation: 'Draft explanation',
            formula: 'X + 1',
            created_at: '2026-01-01T00:00:00Z',
            expires_at: '2026-01-02T00:00:00Z',
          },
        ],
        total: 1,
        limit: 50,
        offset: 0,
        has_more: false,
      });

      await listFunctionCommand({ json: false, draft: true });

      expect(functionService.fetchDraftFunctionList).toHaveBeenCalled();
      const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
      expect(output).toContain('draft Brevo Functions');
      expect(output).toContain('draft-001');
      expect(output).toContain('A draft function');
      expect(output).toContain('X + 1');
      expect(output).toContain('Expires');
      expect(output).toContain('Total: 1');
    });

    it('should show draft empty message when --draft returns no drafts', async () => {
      (functionService.fetchDraftFunctionList as jest.Mock).mockResolvedValue({
        drafts: [],
        total: 0,
        limit: 50,
        offset: 0,
        has_more: false,
      });

      await listFunctionCommand({ json: false, draft: true });

      const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
      expect(output).toContain('No draft Brevo Functions found');
    });

    it('should output draft JSON when --draft --json is set', async () => {
      const response = {
        drafts: [
          {
            id: 'draft-001',
            description: 'A draft',
            explanation: 'Explanation',
            formula: 'X + 1',
            created_at: '2026-01-01T00:00:00Z',
            expires_at: '2026-01-02T00:00:00Z',
          },
        ],
        total: 1,
        limit: 50,
        offset: 0,
        has_more: false,
      };
      (functionService.fetchDraftFunctionList as jest.Mock).mockResolvedValue(response);

      await listFunctionCommand({ json: true, draft: true });

      const output = stdoutSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.drafts).toHaveLength(1);
      expect(parsed.drafts[0].id).toBe('draft-001');
      expect(parsed.total).toBe(1);
    });
  });
});
