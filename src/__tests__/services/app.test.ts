import { ApiClient } from '../../api/client';
import { createAppService } from '../../services/app';
import { CLI_VERSION } from '../../lib/cli-version';
import { getAppCredentials, saveAppCredentials } from '../../lib/config';

jest.mock('../../lib/config', () => ({
  getAppCredentials: jest.fn(),
  saveAppCredentials: jest.fn(),
}));

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

const UUID = '550e8400-e29b-41d4-a716-446655440000';

describe('services/app', () => {
  let mockClient: ApiClient;
  let service: ReturnType<typeof createAppService>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockClient = createMockClient();
    service = createAppService(mockClient);
  });

  describe('fetchAppsList', () => {
    it('should normalize numeric app_id to string', async () => {
      (mockClient.get as jest.Mock).mockResolvedValue([{ app_id: 1 }]);
      const result = await service.fetchAppsList();
      expect(result).toEqual([{ app_id: '1' }]);
    });

    it('should pass UUID app_id through unchanged', async () => {
      (mockClient.get as jest.Mock).mockResolvedValue([{ app_id: UUID }]);
      const result = await service.fetchAppsList();
      expect(result).toEqual([{ app_id: UUID }]);
    });

    it('should return empty array when null', async () => {
      (mockClient.get as jest.Mock).mockResolvedValue(null);
      const result = await service.fetchAppsList();
      expect(result).toEqual([]);
    });
  });

  describe('fetchApp', () => {
    it('should normalize numeric app_id on a legacy response', async () => {
      (mockClient.get as jest.Mock).mockResolvedValue({ app_id: 42, name: 'test' });
      const result = await service.fetchApp('42');
      expect(result).toEqual({ app_id: '42', name: 'test' });
    });

    it('should return UUID app_id unchanged', async () => {
      (mockClient.get as jest.Mock).mockResolvedValue({ app_id: UUID, name: 'test' });
      const result = await service.fetchApp(UUID);
      expect(result).toEqual({ app_id: UUID, name: 'test' });
      expect(mockClient.get).toHaveBeenCalledWith(`/v3/oauth/apps/${UUID}`);
    });

    it('should return null when response is null', async () => {
      (mockClient.get as jest.Mock).mockResolvedValue(null);
      const result = await service.fetchApp('999');
      expect(result).toBeNull();
    });
  });

  describe('createApp', () => {
    it('should POST to oauth/apps with payload and normalize app_id', async () => {
      const response = {
        app_id: 1,
        client_id: 'cli-123',
        client_secret: 'secret',
        redirect_uris: [],
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
      };
      (mockClient.post as jest.Mock).mockResolvedValue(response);

      const result = await service.createApp({ name: 'Test App', public: false });

      expect(mockClient.post).toHaveBeenCalledWith('/v3/oauth/apps', {
        name: 'Test App',
        public: false,
        source: 'cli',
        cli_version: CLI_VERSION,
      });
      expect(result).toEqual({ ...response, app_id: '1' });
    });

    it('should propagate API errors', async () => {
      (mockClient.post as jest.Mock).mockRejectedValue(new Error('API error'));
      await expect(service.createApp({ name: 'Test', public: false })).rejects.toThrow('API error');
    });
  });

  describe('updateApp', () => {
    it('should PUT with the UUID path and return void regardless of response body', async () => {
      // Real server returns only {"message": "app updated successfully"} —
      // the service must not depend on any echoed fields.
      (mockClient.put as jest.Mock).mockResolvedValue({ message: 'app updated successfully' });

      const result = await service.updateApp(UUID, {
        name: 'Updated App',
        redirect_uris: ['http://localhost:3000'],
      });

      expect(mockClient.put).toHaveBeenCalledWith(`/v3/app-store/apps/${UUID}`, {
        name: 'Updated App',
        redirect_uris: ['http://localhost:3000'],
        cli_version: CLI_VERSION,
      });
      expect(result).toBeUndefined();
    });

    it('forwards scopes when present', async () => {
      (mockClient.put as jest.Mock).mockResolvedValue(undefined);
      await service.updateApp('42', {
        name: 'X',
        redirect_uris: ['https://x/cb'],
        scopes: ['contacts:read', 'crm:write'],
      });
      expect(mockClient.put).toHaveBeenCalledWith(
        expect.stringContaining('/v3/app-store/apps/42'),
        {
          name: 'X',
          redirect_uris: ['https://x/cb'],
          scopes: ['contacts:read', 'crm:write'],
          cli_version: CLI_VERSION,
        },
      );
    });

    it('omits scopes when undefined (back-compat)', async () => {
      (mockClient.put as jest.Mock).mockResolvedValue(undefined);
      await service.updateApp('42', { name: 'X', redirect_uris: ['https://x/cb'] });
      expect(mockClient.put).toHaveBeenCalledWith(
        expect.stringContaining('/v3/app-store/apps/42'),
        { name: 'X', redirect_uris: ['https://x/cb'], cli_version: CLI_VERSION },
      );
    });
  });

  describe('resolveAppCredentials', () => {
    it('should merge local secret when API does not return it', async () => {
      (mockClient.get as jest.Mock).mockResolvedValue({
        app_id: 1,
        client_id: 'cli-123',
        client_secret: undefined,
        redirect_uris: [],
      });
      (getAppCredentials as jest.Mock).mockReturnValue({
        clientId: 'cli-123',
        clientSecret: 'local-secret',
      });

      const result = await service.resolveAppCredentials('1');

      expect(result?.app.client_secret).toBe('local-secret');
      expect(result?.app.app_id).toBe('1');
      expect(result?.diffs).toEqual([]);
    });

    it('should resolve a UUID app_id', async () => {
      (mockClient.get as jest.Mock).mockResolvedValue({
        app_id: UUID,
        client_id: 'cli-123',
        client_secret: 'remote-secret',
        redirect_uris: [],
      });
      (getAppCredentials as jest.Mock).mockReturnValue(undefined);

      const result = await service.resolveAppCredentials(UUID);

      expect(result?.app.app_id).toBe(UUID);
      expect(mockClient.get).toHaveBeenCalledWith(`/v3/oauth/apps/${UUID}`);
    });

    it('should prefer remote secret when API returns it', async () => {
      (mockClient.get as jest.Mock).mockResolvedValue({
        app_id: 1,
        client_id: 'cli-123',
        client_secret: 'remote-secret',
        redirect_uris: [],
      });
      (getAppCredentials as jest.Mock).mockReturnValue({
        clientId: 'cli-123',
        clientSecret: 'local-secret',
      });

      const result = await service.resolveAppCredentials('1');

      expect(result?.app.client_secret).toBe('remote-secret');
      expect(result?.diffs).toEqual(['client_secret']);
    });

    it('should return null when app not found', async () => {
      (mockClient.get as jest.Mock).mockResolvedValue(null);
      const result = await service.resolveAppCredentials('999');
      expect(result).toBeNull();
    });
  });

  describe('syncAppCredentials', () => {
    it('should preserve local secret when app has no secret', () => {
      (getAppCredentials as jest.Mock).mockReturnValue({
        clientId: 'cli-123',
        clientSecret: 'saved-secret',
      });

      service.syncAppCredentials('1', {
        app_id: '1',
        client_id: 'cli-123',
        client_secret: undefined,
        name: 'Test',
        redirect_uris: [],
        created_at: '',
        updated_at: '',
      });

      expect(saveAppCredentials).toHaveBeenCalledWith('1', {
        clientId: 'cli-123',
        clientSecret: 'saved-secret',
      });
    });

    it('should save remote secret when present (UUID app)', () => {
      (getAppCredentials as jest.Mock).mockReturnValue(undefined);

      service.syncAppCredentials(UUID, {
        app_id: UUID,
        client_id: 'cli-123',
        client_secret: 'new-secret',
        name: 'Test',
        redirect_uris: [],
        created_at: '',
        updated_at: '',
      });

      expect(saveAppCredentials).toHaveBeenCalledWith(UUID, {
        clientId: 'cli-123',
        clientSecret: 'new-secret',
      });
    });

    it('should skip write when no secret is available from API or cache', () => {
      (getAppCredentials as jest.Mock).mockReturnValue(undefined);

      service.syncAppCredentials('1', {
        app_id: '1',
        client_id: 'cli-123',
        client_secret: undefined,
        name: 'Test',
        redirect_uris: [],
        created_at: '',
        updated_at: '',
      });

      expect(saveAppCredentials).not.toHaveBeenCalled();
    });
  });

  describe('deleteApp', () => {
    it('should DELETE the app by numeric-string ID', async () => {
      (mockClient.delete as jest.Mock).mockResolvedValue(undefined);

      await service.deleteApp('42');

      expect(mockClient.delete).toHaveBeenCalledWith('/v3/oauth/apps/42');
    });

    it('should DELETE the app by UUID', async () => {
      (mockClient.delete as jest.Mock).mockResolvedValue(undefined);

      await service.deleteApp(UUID);

      expect(mockClient.delete).toHaveBeenCalledWith(`/v3/oauth/apps/${UUID}`);
    });

    it('should propagate API errors', async () => {
      (mockClient.delete as jest.Mock).mockRejectedValue(new Error('Not found'));
      await expect(service.deleteApp('999')).rejects.toThrow('Not found');
    });
  });
});
