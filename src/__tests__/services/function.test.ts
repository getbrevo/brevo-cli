import { ApiClient } from '../../api/client';
import { createFunctionService } from '../../services/function';
import * as sseStreamModule from '../../api/sse-stream';

jest.mock('../../api/sse-stream');

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

  describe('activateFunction', () => {
    it('should call client.patch with is_active: true', async () => {
      (mockClient.patch as jest.Mock).mockResolvedValue(undefined);

      await service.activateFunction('fn-001');

      expect(mockClient.patch).toHaveBeenCalledWith('/v3/dp-functions/functions/fn-001', {
        is_active: true,
      });
    });

    it('should encode the function ID in the URL', async () => {
      (mockClient.patch as jest.Mock).mockResolvedValue(undefined);

      await service.activateFunction('fn/special id');

      expect(mockClient.patch).toHaveBeenCalledWith(
        '/v3/dp-functions/functions/fn%2Fspecial%20id',
        { is_active: true },
      );
    });

    it('should propagate API errors', async () => {
      (mockClient.patch as jest.Mock).mockRejectedValue(new Error('Forbidden'));

      await expect(service.activateFunction('fn-001')).rejects.toThrow('Forbidden');
    });
  });

  describe('deactivateFunction', () => {
    it('should call client.patch with is_active: false', async () => {
      (mockClient.patch as jest.Mock).mockResolvedValue(undefined);

      await service.deactivateFunction('fn-001');

      expect(mockClient.patch).toHaveBeenCalledWith('/v3/dp-functions/functions/fn-001', {
        is_active: false,
      });
    });

    it('should encode the function ID in the URL', async () => {
      (mockClient.patch as jest.Mock).mockResolvedValue(undefined);

      await service.deactivateFunction('fn/special id');

      expect(mockClient.patch).toHaveBeenCalledWith(
        '/v3/dp-functions/functions/fn%2Fspecial%20id',
        { is_active: false },
      );
    });

    it('should propagate API errors', async () => {
      (mockClient.patch as jest.Mock).mockRejectedValue(new Error('Forbidden'));

      await expect(service.deactivateFunction('fn-001')).rejects.toThrow('Forbidden');
    });
  });

  describe('deleteFunction', () => {
    it('should call client.delete with the function endpoint', async () => {
      (mockClient.delete as jest.Mock).mockResolvedValue(undefined);

      await service.deleteFunction('fn-001');

      expect(mockClient.delete).toHaveBeenCalledWith('/v3/dp-functions/functions/fn-001');
    });

    it('should encode the function ID in the URL', async () => {
      (mockClient.delete as jest.Mock).mockResolvedValue(undefined);

      await service.deleteFunction('fn/special id');

      expect(mockClient.delete).toHaveBeenCalledWith(
        '/v3/dp-functions/functions/fn%2Fspecial%20id',
      );
    });

    it('should propagate API errors', async () => {
      (mockClient.delete as jest.Mock).mockRejectedValue(new Error('Forbidden'));

      await expect(service.deleteFunction('fn-001')).rejects.toThrow('Forbidden');
    });
  });

  describe('fetchTemplates', () => {
    it('should call client.get with the templates endpoint and unwrap the response', async () => {
      const templates = [
        { id: 't-1', name: 'Lead Score', description: 'Score leads', code: 'return 1;' },
      ];
      (mockClient.get as jest.Mock).mockResolvedValue({ templates });

      const result = await service.fetchTemplates();

      expect(mockClient.get).toHaveBeenCalledWith('/v3/dp-functions/functions/templates');
      expect(result).toEqual(templates);
    });

    it('should propagate API errors', async () => {
      (mockClient.get as jest.Mock).mockRejectedValue(new Error('Forbidden'));

      await expect(service.fetchTemplates()).rejects.toThrow('Forbidden');
    });
  });

  describe('createFunction', () => {
    it('should call client.post with correct endpoint and payload', async () => {
      const payload = { name: 'My Fn', code: 'return 42;', category: 'scoring' };
      const response = { id: 'fn-new', name: 'My Fn', version: 1 };
      (mockClient.post as jest.Mock).mockResolvedValue(response);

      const result = await service.createFunction(payload);

      expect(mockClient.post).toHaveBeenCalledWith('/v3/dp-functions/functions', payload);
      expect(result).toEqual(response);
    });

    it('should propagate API errors', async () => {
      (mockClient.post as jest.Mock).mockRejectedValue(new Error('Bad request'));

      await expect(service.createFunction({ name: 'x', code: 'x' })).rejects.toThrow('Bad request');
    });
  });

  describe('generateStream', () => {
    it('should delegate to sseStream with POST and the generate endpoint', async () => {
      const mockEvent = { data: '{"stage":"enriching"}' };
      (sseStreamModule.sseStream as jest.Mock).mockImplementation(async function* () {
        yield mockEvent;
      });

      const deps = { baseUrl: 'https://api.example.com', getAuthHeader: () => ({}) };
      const payload = { user_prompt: 'create a scoring function' };

      const events = [];
      for await (const event of service.generateStream(deps, payload)) {
        events.push(event);
      }

      expect(sseStreamModule.sseStream).toHaveBeenCalledWith(
        deps,
        'POST',
        '/v3/dp-functions/generate/stream',
        payload,
      );
      expect(events).toEqual([mockEvent]);
    });
  });

  describe('iterateStream', () => {
    it('should delegate to sseStream with PATCH and the generate endpoint', async () => {
      const mockEvent = { data: '{"code":"updated"}' };
      (sseStreamModule.sseStream as jest.Mock).mockImplementation(async function* () {
        yield mockEvent;
      });

      const deps = { baseUrl: 'https://api.example.com', getAuthHeader: () => ({}) };
      const payload = {
        draft_function_id: 'd-1',
        user_prompt: 'add error handling',
        previous_code: 'return 1;',
        chat_history: [],
      };

      const events = [];
      for await (const event of service.iterateStream(deps, payload)) {
        events.push(event);
      }

      expect(sseStreamModule.sseStream).toHaveBeenCalledWith(
        deps,
        'PATCH',
        '/v3/dp-functions/generate/stream',
        payload,
      );
      expect(events).toEqual([mockEvent]);
    });
  });
});
