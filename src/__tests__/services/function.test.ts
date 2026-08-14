import { ApiClient } from '../../api/client';
import { createFunctionService } from '../../services/function';

function createMockClient() {
  return {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    getWithKey: jest.fn(),
    setOnAuthFailure: jest.fn(),
  } as unknown as ApiClient;
}

describe('services/function', () => {
  let mockClient: ApiClient;
  let service: ReturnType<typeof createFunctionService>;

  beforeEach(() => {
    mockClient = createMockClient();
    service = createFunctionService(mockClient);
  });

  describe('fetchFunctionList', () => {
    it('should call client.get with the Brevo Functions endpoint', async () => {
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
      (mockClient.get as jest.Mock).mockResolvedValue(response);

      const result = await service.fetchFunctionList();

      expect(mockClient.get).toHaveBeenCalledWith('/v3/dp-functions/functions?limit=50&offset=0');
      expect(result).toEqual(response);
    });

    it('should propagate API errors', async () => {
      (mockClient.get as jest.Mock).mockRejectedValue(new Error('Forbidden'));

      await expect(service.fetchFunctionList()).rejects.toThrow('Forbidden');
    });
  });

  describe('fetchDraftFunctionList', () => {
    it('should call client.get with draft=true query param', async () => {
      const response = { drafts: [], total: 0 };
      (mockClient.get as jest.Mock).mockResolvedValue(response);

      const result = await service.fetchDraftFunctionList();

      expect(mockClient.get).toHaveBeenCalledWith(
        '/v3/dp-functions/functions?limit=50&offset=0&draft=true',
      );
      expect(result).toEqual(response);
    });

    it('should propagate API errors', async () => {
      (mockClient.get as jest.Mock).mockRejectedValue(new Error('Forbidden'));

      await expect(service.fetchDraftFunctionList()).rejects.toThrow('Forbidden');
    });
  });

  describe('fetchFunction', () => {
    it('should call client.get with the single-function endpoint', async () => {
      const response = {
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
      };
      (mockClient.get as jest.Mock).mockResolvedValue(response);

      const result = await service.fetchFunction('fn-001');

      expect(mockClient.get).toHaveBeenCalledWith('/v3/dp-functions/functions/fn-001');
      expect(result).toEqual(response);
    });

    it('should encode the function ID in the URL', async () => {
      (mockClient.get as jest.Mock).mockResolvedValue({});

      await service.fetchFunction('fn/special id');

      expect(mockClient.get).toHaveBeenCalledWith('/v3/dp-functions/functions/fn%2Fspecial%20id');
    });

    it('should propagate API errors', async () => {
      (mockClient.get as jest.Mock).mockRejectedValue(new Error('Not found'));

      await expect(service.fetchFunction('fn-999')).rejects.toThrow('Not found');
    });
  });
});
