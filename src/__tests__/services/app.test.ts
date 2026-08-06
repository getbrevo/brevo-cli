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

  describe('fetchSurfacePoints', () => {
    // The registry's own column names. `surface_point_name` is a kebab-case SLUG, not
    // display text — the CLI never renders it (see EXTENSION_PLACE_LABELS).
    const ROW = {
      surface_point: 'contactDetails.headerMenu.action',
      surface_point_name: 'contact-details-header-menu',
      location_name: 'contactDetails',
      section_name: 'headerMenu',
      component_type: 'action',
      allowed_context_field: ['recordId', 'recordName', 'userId', 'locale', 'accountId'],
      default_context_field: ['recordId', 'recordName', 'accountId', 'locale'],
      extension_type_list: ['actionLink', 'iframeExtension'],
      status: 'active',
    };

    // No extensionType filter: both extension types render on both kinds, so filtering
    // server-side would hide authorable placements. The create flow checks each row's
    // own extension_type_list instead.
    it('GETs the unfiltered endpoint when no locations are given', async () => {
      (mockClient.get as jest.Mock).mockResolvedValue({ surface_points: [ROW], count: 1 });
      const result = await service.fetchSurfacePoints();
      expect(mockClient.get).toHaveBeenCalledWith('/v3/app-store/surface-points');
      expect(result).toEqual([ROW]);
    });

    it('passes selected locations as a comma-separated location filter', async () => {
      (mockClient.get as jest.Mock).mockResolvedValue({ surface_points: [ROW] });
      await service.fetchSurfacePoints(['contactDetails', 'dealDetails']);
      expect(mockClient.get).toHaveBeenCalledWith(
        '/v3/app-store/surface-points?location=contactDetails%2CdealDetails',
      );
    });

    it('omits the filter for an empty or blank location list', async () => {
      (mockClient.get as jest.Mock).mockResolvedValue({ surface_points: [] });
      await service.fetchSurfacePoints([]);
      await service.fetchSurfacePoints(['  ']);
      expect(mockClient.get).toHaveBeenNthCalledWith(1, '/v3/app-store/surface-points');
      expect(mockClient.get).toHaveBeenNthCalledWith(2, '/v3/app-store/surface-points');
    });

    it('tolerates a bare-array response', async () => {
      (mockClient.get as jest.Mock).mockResolvedValue([ROW]);
      expect(await service.fetchSurfacePoints()).toEqual([ROW]);
    });

    // The endpoint is specified but NOT BUILT, and two namings are in play: the registry's
    // columns and the pre-BEX-361 draft's extension_point / location / place / kind. Keying
    // strictly on either would fail CLOSED against the other — every row dropped, and the
    // partner told the registry "has not been seeded", a data problem that doesn't exist.
    it('normalizes the pre-BEX-361 field spellings onto the registry column names', async () => {
      (mockClient.get as jest.Mock).mockResolvedValue({
        surface_points: [
          {
            extension_point: 'dealDetails.overviewSidebar.widget',
            location: 'dealDetails',
            place: 'overviewSidebar',
            kind: 'widget',
            supported_extension_types: ['actionLink'],
            default_context_field: ['recordId'],
          },
        ],
      });

      expect(await service.fetchSurfacePoints()).toEqual([
        {
          surface_point: 'dealDetails.overviewSidebar.widget',
          location_name: 'dealDetails',
          section_name: 'overviewSidebar',
          component_type: 'widget',
          extension_type_list: ['actionLink'],
          default_context_field: ['recordId'],
        },
      ]);
    });

    it('prefers the registry column names when a row carries both spellings', async () => {
      (mockClient.get as jest.Mock).mockResolvedValue({
        surface_points: [{ ...ROW, extension_point: 'stale.value.here', location: 'stale' }],
      });

      expect(await service.fetchSurfacePoints()).toEqual([ROW]);
    });

    it('drops rows without a usable slot name and dedupes by name', async () => {
      (mockClient.get as jest.Mock).mockResolvedValue({
        surface_points: [
          ROW,
          { ...ROW, surface_point: '  contactDetails.headerMenu.action  ' }, // dupe after trim
          { surface_point_name: 'nameless' },
          { surface_point: '   ' },
          null,
        ],
      });
      expect(await service.fetchSurfacePoints()).toEqual([ROW]);
    });

    it('returns [] for a null response body', async () => {
      (mockClient.get as jest.Mock).mockResolvedValue(null);
      expect(await service.fetchSurfacePoints()).toEqual([]);
    });

    it('propagates ApiError unchanged (the command owns the actionable message)', async () => {
      (mockClient.get as jest.Mock).mockRejectedValue(new ApiError('nope', 404));
      await expect(service.fetchSurfacePoints()).rejects.toThrow(ApiError);
    });
  });

  // The record pages come from the registry's own location list, not from reducing a full
  // row read — `app create`'s page prompt asks the registry which pages exist rather than
  // inferring it from whichever rows came back.
  describe('fetchSurfacePointLocations', () => {
    it('GETs the locations endpoint and returns the list in server order', async () => {
      (mockClient.get as jest.Mock).mockResolvedValue({
        locations: ['companyDetails', 'contactDetails', 'dealDetails'],
        count: 3,
      });

      expect(await service.fetchSurfacePointLocations()).toEqual([
        'companyDetails',
        'contactDetails',
        'dealDetails',
      ]);
      expect(mockClient.get).toHaveBeenCalledWith('/v3/app-store/surface-points/locations');
    });

    it('tolerates a bare-array response', async () => {
      (mockClient.get as jest.Mock).mockResolvedValue(['contactDetails']);
      expect(await service.fetchSurfacePointLocations()).toEqual(['contactDetails']);
    });

    // Callers build prompt choices straight off these values, so a blank, a non-string or a
    // duplicate would become an unpickable or repeated page choice.
    it('drops blank, non-string and duplicate entries', async () => {
      (mockClient.get as jest.Mock).mockResolvedValue({
        locations: ['contactDetails', '  contactDetails  ', '   ', 42, null, 'dealDetails'],
      });

      expect(await service.fetchSurfacePointLocations()).toEqual(['contactDetails', 'dealDetails']);
    });

    it('returns [] for a null response body', async () => {
      (mockClient.get as jest.Mock).mockResolvedValue(null);
      expect(await service.fetchSurfacePointLocations()).toEqual([]);
    });

    it('propagates ApiError unchanged (the command owns the actionable message)', async () => {
      (mockClient.get as jest.Mock).mockRejectedValue(new ApiError('nope', 404));
      await expect(service.fetchSurfacePointLocations()).rejects.toThrow(ApiError);
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
        version: '0.0.2',
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
        version: '0.0.2',
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
          version: '0.0.1',
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

  describe('deployApp / rollbackApp', () => {
    it('should POST an install with the account ID coerced to a number', async () => {
      (mockClient.post as jest.Mock).mockResolvedValue(undefined);

      await service.deployApp(UUID, '99999', 'Invoice Manager');

      expect(mockClient.post).toHaveBeenCalledWith(`/v3/app-store/apps/${UUID}/installs`, {
        deploy_client_id: 99999,
        name: 'Invoice Manager',
        is_developer: true,
      });
    });

    it('should DELETE the same install resource with the same body', async () => {
      (mockClient.delete as jest.Mock).mockResolvedValue(undefined);

      await service.rollbackApp(UUID, '99999', 'Invoice Manager');

      expect(mockClient.delete).toHaveBeenCalledWith(`/v3/app-store/apps/${UUID}/installs`, {
        deploy_client_id: 99999,
        name: 'Invoice Manager',
        is_developer: true,
      });
    });

    it('should rethrow a 404 as a friendly not-found error on both verbs', async () => {
      (mockClient.post as jest.Mock).mockRejectedValue(new ApiError('nope', 404));
      (mockClient.delete as jest.Mock).mockRejectedValue(new ApiError('nope', 404));

      await expect(service.deployApp('999', '1', 'x')).rejects.toThrow('App 999 not found.');
      await expect(service.rollbackApp('999', '1', 'x')).rejects.toThrow('App 999 not found.');
    });

    // The commands map 422 themselves — deploy to "upload first", rollback to an
    // informational "not deployed" — so the service must not swallow it.
    it('should propagate a 422 ApiError unchanged', async () => {
      (mockClient.post as jest.Mock).mockRejectedValue(new ApiError('not configured', 422));

      await expect(service.deployApp('42', '1', 'x')).rejects.toMatchObject({ statusCode: 422 });
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
