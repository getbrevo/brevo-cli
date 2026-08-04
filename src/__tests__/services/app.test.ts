import { ApiClient } from '../../api/client';
import { createAppService } from '../../services/app';
import { ApiError } from '../../lib/errors';
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
      expect(mockClient.get).toHaveBeenCalledWith(`/v3/app-store/apps/${UUID}`);
    });

    it('should return null when response is null', async () => {
      (mockClient.get as jest.Mock).mockResolvedValue(null);
      const result = await service.fetchApp('999');
      expect(result).toBeNull();
    });
  });

  describe('fetchAppState', () => {
    it('should GET the state endpoint and return the state payload', async () => {
      (mockClient.get as jest.Mock).mockResolvedValue({ state: 'in_review' });
      const result = await service.fetchAppState('42');
      expect(result).toEqual({ state: 'in_review' });
      expect(mockClient.get).toHaveBeenCalledWith('/v3/app-store/apps/42/state');
    });

    it('should encode the app id in the path', async () => {
      (mockClient.get as jest.Mock).mockResolvedValue({ state: 'approved' });
      await service.fetchAppState(UUID);
      expect(mockClient.get).toHaveBeenCalledWith(`/v3/app-store/apps/${UUID}/state`);
    });

    it('should map a 404 to an app-not-found CliError', async () => {
      const { ApiError } = jest.requireActual('../../lib/errors');
      (mockClient.get as jest.Mock).mockRejectedValue(new ApiError('nope', 404));
      await expect(service.fetchAppState('999')).rejects.toThrow('App 999 not found.');
    });

    it('should propagate non-404 errors unchanged', async () => {
      (mockClient.get as jest.Mock).mockRejectedValue(new Error('boom'));
      await expect(service.fetchAppState('42')).rejects.toThrow('boom');
    });
  });

  describe('createApp', () => {
    it('should POST to app-store/apps with payload and normalize app_id', async () => {
      const response = {
        app_id: 1,
        client_id: 'cli-123',
        client_secret: 'secret',
        redirect_uris: [],
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
      };
      (mockClient.post as jest.Mock).mockResolvedValue(response);

      const result = await service.createApp({ name: 'Test App', distribution_type: 'private' });

      expect(mockClient.post).toHaveBeenCalledWith('/v3/app-store/apps', {
        name: 'Test App',
        distribution_type: 'private',
        source: 'cli',
      });
      expect(result).toEqual({ ...response, app_id: '1' });
    });

    it('should propagate API errors', async () => {
      (mockClient.post as jest.Mock).mockRejectedValue(new Error('API error'));
      await expect(
        service.createApp({ name: 'Test', distribution_type: 'private' }),
      ).rejects.toThrow('API error');
    });
  });

  describe('uploadApp', () => {
    // The upload endpoint binds its body strictly and 400s on unknown top-level
    // keys, so the payload must go over the wire unchanged — the CLI version
    // already travels on every request via the User-Agent header.
    it('should POST to the upload endpoint with the payload unchanged', async () => {
      const response = {
        app_id: UUID,
        name: 'Test App',
        logo_uri: '',
        version: '0.0.2',
        distribution_type: 'private',
        auth: {
          scopes: ['contacts:read'],
          redirect_uris: ['http://localhost:3010/auth/callback'],
        },
      };
      (mockClient.post as jest.Mock).mockResolvedValue(response);

      const result = await service.uploadApp(UUID, {
        app_id: UUID,
        name: 'Test App',
        logo_uri: '',
        app_version: '0.0.2',
        distribution_type: 'private',
        auth: {
          scopes: ['contacts:read'],
          redirect_uris: ['http://localhost:3010/auth/callback'],
        },
      });

      expect(mockClient.post).toHaveBeenCalledWith(`/v3/app-store/apps/${UUID}/upload`, {
        app_id: UUID,
        name: 'Test App',
        logo_uri: '',
        app_version: '0.0.2',
        distribution_type: 'private',
        auth: {
          scopes: ['contacts:read'],
          redirect_uris: ['http://localhost:3010/auth/callback'],
        },
      });
      expect((mockClient.post as jest.Mock).mock.calls[0][1]).not.toHaveProperty('cli_version');
      expect(result).toEqual(response);
    });

    it('should propagate API errors (e.g. app_version_outdated rejections)', async () => {
      (mockClient.post as jest.Mock).mockRejectedValue(new Error('app_version_outdated'));
      await expect(
        service.uploadApp('42', {
          app_id: '42',
          name: 'X',
          logo_uri: '',
          app_version: '0.0.1',
          distribution_type: 'private',
          auth: { scopes: [], redirect_uris: [] },
        }),
      ).rejects.toThrow('app_version_outdated');
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
      expect(mockClient.get).toHaveBeenCalledWith(`/v3/app-store/apps/${UUID}`);
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

      expect(mockClient.delete).toHaveBeenCalledWith('/v3/app-store/apps/42');
    });

    it('should DELETE the app by UUID', async () => {
      (mockClient.delete as jest.Mock).mockResolvedValue(undefined);

      await service.deleteApp(UUID);

      expect(mockClient.delete).toHaveBeenCalledWith(`/v3/app-store/apps/${UUID}`);
    });

    it('should propagate API errors', async () => {
      (mockClient.delete as jest.Mock).mockRejectedValue(new Error('Not found'));
      await expect(service.deleteApp('999')).rejects.toThrow('Not found');
    });
  });

  describe('withdrawApp', () => {
    it('should POST to the withdraw endpoint by numeric-string ID', async () => {
      (mockClient.post as jest.Mock).mockResolvedValue(undefined);

      await service.withdrawApp('42');

      expect(mockClient.post).toHaveBeenCalledWith('/v3/app-store/apps/42/withdraw');
    });

    it('should POST to the withdraw endpoint by UUID', async () => {
      (mockClient.post as jest.Mock).mockResolvedValue(undefined);

      await service.withdrawApp(UUID);

      expect(mockClient.post).toHaveBeenCalledWith(`/v3/app-store/apps/${UUID}/withdraw`);
    });

    it('should rethrow a 404 as a friendly not-found error', async () => {
      (mockClient.post as jest.Mock).mockRejectedValue(new ApiError('nope', 404));

      await expect(service.withdrawApp('999')).rejects.toThrow('App 999 not found.');
    });

    it('should propagate a 422 ApiError unchanged (handled as informational by the command)', async () => {
      (mockClient.post as jest.Mock).mockRejectedValue(new ApiError('not submitted', 422));

      await expect(service.withdrawApp('42')).rejects.toMatchObject({ statusCode: 422 });
    });
  });
});
