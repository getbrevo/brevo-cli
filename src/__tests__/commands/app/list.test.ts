import { listCommand } from '../../../commands/app/list';

jest.mock('../../../lib/config', () => ({
  getAppNames: jest.fn().mockReturnValue({}),
  deleteAppName: jest.fn(),
}));

jest.mock('../../../container', () => ({
  appService: {
    fetchAppsList: jest.fn(),
    fetchApp: jest.fn(),
    pickApp: jest.fn(),
    createApp: jest.fn(),
    updateApp: jest.fn(),
    deleteApp: jest.fn(),
  },
  accountService: {
    validateApiKey: jest.fn(),
    getAccount: jest.fn(),
  },
  client: {},
}));

import { appService } from '../../../container';
import { getAppNames, deleteAppName } from '../../../lib/config';

describe('app/list', () => {
  let stdoutSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    jest.clearAllMocks();
    (getAppNames as jest.Mock).mockReturnValue({});
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  describe('listCommand', () => {
    it('should show empty message when no apps exist', async () => {
      (appService.fetchAppsList as jest.Mock).mockResolvedValue([]);

      await listCommand({ json: false });

      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('No apps found'));
    });

    it('should show empty message when apps is null', async () => {
      (appService.fetchAppsList as jest.Mock).mockResolvedValue(null);

      await listCommand({ json: false });

      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('No apps found'));
    });

    it('should display apps with details', async () => {
      (appService.fetchAppsList as jest.Mock).mockResolvedValue([
        {
          app_id: 1,
          name: 'Test App',
          client_id: 'cli-123',
          client_secret: 'secret',
          redirect_uris: ['http://localhost:3000'],
          scopes: ['all'],
          created_at: '2026-01-01',
          updated_at: '2026-01-01',
        },
      ]);

      await listCommand({ json: false });

      const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
      expect(output).toContain('Test App');
      expect(output).toContain('ID: 1');
      expect(output).toContain('cli-123');
      expect(output).toContain('http://localhost:3000');
      expect(output).toContain('Scopes:');
      expect(output).toContain('all');
    });

    it('should output JSON without client_secret when --json', async () => {
      (appService.fetchAppsList as jest.Mock).mockResolvedValue([
        {
          app_id: 1,
          name: 'Test',
          client_id: 'cli-123',
          client_secret: 'should-be-hidden',
          redirect_uris: [],
          created_at: '2026-01-01',
          updated_at: '2026-01-01',
        },
      ]);

      await listCommand({ json: true });

      const output = stdoutSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed[0].client_id).toBe('cli-123');
      expect(parsed[0].client_secret).toBeUndefined();
    });

    it('should override server name with cached name when they differ', async () => {
      (appService.fetchAppsList as jest.Mock).mockResolvedValue([
        {
          app_id: '42',
          name: 'Stale Server Name',
          client_id: 'cli-stale',
          client_secret: 'secret',
          redirect_uris: [],
          scopes: [],
          created_at: '2026-01-01',
          updated_at: '2026-01-01',
        },
      ]);
      (getAppNames as jest.Mock).mockReturnValue({ '42': 'Renamed Locally' });

      await listCommand({ json: true });

      const output = stdoutSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed[0].name).toBe('Renamed Locally');
      // Server hasn't caught up yet — cache must be retained for the next list
      expect(deleteAppName).not.toHaveBeenCalled();
    });

    it('should drop cached name once server has caught up', async () => {
      (appService.fetchAppsList as jest.Mock).mockResolvedValue([
        {
          app_id: '42',
          name: 'Renamed Locally',
          client_id: 'cli-stale',
          client_secret: 'secret',
          redirect_uris: [],
          scopes: [],
          created_at: '2026-01-01',
          updated_at: '2026-01-01',
        },
      ]);
      (getAppNames as jest.Mock).mockReturnValue({ '42': 'Renamed Locally' });

      await listCommand({ json: true });

      const output = stdoutSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed[0].name).toBe('Renamed Locally');
      // Cache and server agree — entry pruned so a future dashboard rename wins
      expect(deleteAppName).toHaveBeenCalledWith('42');
    });

    it('should show all redirect urls', async () => {
      (appService.fetchAppsList as jest.Mock).mockResolvedValue([
        {
          app_id: 2,
          name: 'Multi',
          client_id: 'cli-456',
          client_secret: 'secret',
          redirect_uris: [
            'http://localhost:3000',
            'http://localhost:4000',
            'http://localhost:5000',
          ],
          created_at: '2026-01-01',
          updated_at: '2026-01-01',
        },
      ]);

      await listCommand({ json: false });

      const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
      expect(output).toContain('http://localhost:3000');
      expect(output).toContain('http://localhost:4000');
      expect(output).toContain('http://localhost:5000');
    });
  });
});
