import { listCommand } from '../../../commands/app/list';

// Only the name-cache accessors are stubbed (they touch ~/.brevo). The app-type
// discriminator is pure logic, so the real one is exercised here.
jest.mock('../../../lib/config', () => ({
  ...jest.requireActual('../../../lib/config'),
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
          version: '0.0.1',
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
      expect(output).toContain('Version:       0.0.1');
    });

    it('should show (none) for version when the app has none', async () => {
      (appService.fetchAppsList as jest.Mock).mockResolvedValue([
        {
          app_id: 1,
          name: 'Test App',
          client_id: 'cli-123',
          redirect_uris: [],
          created_at: '2026-01-01',
          updated_at: '2026-01-01',
        },
      ]);

      await listCommand({ json: false });

      const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
      expect(output).toContain('Version:       (none)');
    });

    it('should include version in --json output', async () => {
      (appService.fetchAppsList as jest.Mock).mockResolvedValue([
        {
          app_id: 1,
          name: 'Test',
          client_id: 'cli-123',
          redirect_uris: [],
          version: '0.0.1',
          created_at: '2026-01-01',
          updated_at: '2026-01-01',
        },
      ]);

      await listCommand({ json: true });

      const output = stdoutSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed[0].version).toBe('0.0.1');
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

    describe("legacy 'all' scope flagging", () => {
      const legacyApp = {
        app_id: 1,
        name: 'Legacy App',
        client_id: 'cli-legacy',
        client_secret: 'secret',
        redirect_uris: [],
        scopes: ['all'],
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
      };
      const granularApp = {
        app_id: 2,
        name: 'Granular App',
        client_id: 'cli-granular',
        client_secret: 'secret',
        redirect_uris: [],
        scopes: ['contacts:read'],
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
      };

      it("appends the deprecation tag on the scopes line when scopes contain 'all'", async () => {
        (appService.fetchAppsList as jest.Mock).mockResolvedValue([legacyApp, granularApp]);

        await listCommand({ json: false });

        const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
        const legacyLine = output.split('\n').find((l: string) => l.includes("legacy 'all'"));
        expect(legacyLine).toBeDefined();
        expect(legacyLine).toContain('all');
        expect(legacyLine).toMatch(/deprecated/i);
        // Granular app's scopes line is untagged
        const granularLine = output.split('\n').find((l: string) => l.includes('contacts:read'));
        expect(granularLine).not.toMatch(/deprecated/i);
      });

      it('sets legacy_all_scope: true only on affected apps in --json output', async () => {
        (appService.fetchAppsList as jest.Mock).mockResolvedValue([legacyApp, granularApp]);

        await listCommand({ json: true });

        const parsed = JSON.parse(stdoutSpy.mock.calls[0][0]);
        expect(parsed[0].legacy_all_scope).toBe(true);
        expect(parsed[1]).not.toHaveProperty('legacy_all_scope');
      });
    });

    // The app-store list endpoint returns `null` (not `[]`, not absent) for
    // redirect_uris/scopes on any app with no OAuth block. Dereferencing either
    // one crashed the command. Covered separately from the UI-app cases below so
    // the guard is still asserted if app-type detection ever changes.
    describe('null OAuth collections', () => {
      it('renders (none) when redirect_uris comes back null', async () => {
        (appService.fetchAppsList as jest.Mock).mockResolvedValue([
          {
            app_id: 'a1',
            name: 'Nulled',
            client_id: 'cli-123',
            redirect_uris: null,
            scopes: null,
            created_at: '2026-01-01',
            updated_at: '2026-01-01',
          },
        ]);

        await listCommand({ json: false });

        const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
        expect(output).toContain('Redirect URLs: (none)');
        expect(output).toContain('Scopes:        (none)');
      });

      it('survives a null redirect_uris in --json output', async () => {
        (appService.fetchAppsList as jest.Mock).mockResolvedValue([
          {
            app_id: 'a1',
            name: 'Nulled',
            client_id: 'cli-123',
            redirect_uris: null,
            scopes: null,
            created_at: '2026-01-01',
            updated_at: '2026-01-01',
          },
        ]);

        await listCommand({ json: true });

        const parsed = JSON.parse(stdoutSpy.mock.calls[0][0]);
        expect(parsed[0].redirect_uris).toBeNull();
        expect(parsed[0]).not.toHaveProperty('legacy_all_scope');
      });
    });

    describe('UI apps', () => {
      const uiApp = {
        app_id: 'ui-1',
        name: 'My UI App',
        // A UI app sends no `auth` block, so the server stores no OAuth
        // material and echoes these back empty/null.
        client_id: '',
        redirect_uris: null,
        scopes: null,
        version: '0.0.1',
        ui_app: {
          extension_type: 'actionLink',
          // The CTA fields live on each entry (BEX-426), and that is what the read
          // path echoes back.
          surface_point_list: [
            {
              surface_point_name: 'contact-details-header-menu',
              label: 'Sync to Acme',
              more_info: 'Push this contact to Acme',
              redirect_link: 'https://example.com/sync',
            },
          ],
        },
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
      };

      it('labels the app type on both kinds of app', async () => {
        (appService.fetchAppsList as jest.Mock).mockResolvedValue([
          uiApp,
          {
            app_id: 'oauth-1',
            name: 'My OAuth App',
            client_id: 'cli-123',
            redirect_uris: ['http://localhost:3000'],
            scopes: ['contacts:read'],
            created_at: '2026-01-01',
            updated_at: '2026-01-01',
          },
        ]);

        await listCommand({ json: false });

        const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
        expect(output).toContain('Type:          UI app');
        expect(output).toContain('Type:          OAuth app');
      });

      it('renders the ui_app block when the server echoes it', async () => {
        (appService.fetchAppsList as jest.Mock).mockResolvedValue([uiApp]);

        await listCommand({ json: false });

        const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
        expect(output).toContain('Extension:     actionLink');
        expect(output).toContain('Placement:     contact-details-header-menu');
        // The entry's own CTA fields render nested under their placement (BEX-426).
        expect(output).toContain('label:         Sync to Acme');
        expect(output).toContain('more info:     Push this contact to Acme');
        expect(output).toContain('redirect link: https://example.com/sync');
      });

      it('omits the OAuth-only rows for a UI app', async () => {
        (appService.fetchAppsList as jest.Mock).mockResolvedValue([uiApp]);

        await listCommand({ json: false });

        const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
        expect(output).not.toContain('Client ID:');
        expect(output).not.toContain('Redirect URL');
        expect(output).not.toContain('Scopes:');
      });

      it('prints each placement on its own row with its context', async () => {
        (appService.fetchAppsList as jest.Mock).mockResolvedValue([
          {
            ...uiApp,
            ui_app: {
              ...uiApp.ui_app,
              surface_point_list: [
                {
                  surface_point_name: 'contact-details-header-menu',
                  context: ['recordId', 'accountId'],
                },
                { surface_point_name: 'deal-details-header-menu' },
              ],
            },
          },
        ]);

        await listCommand({ json: false });

        const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
        expect(output).toContain(
          'Placement:     contact-details-header-menu  (context: recordId, accountId)',
        );
        expect(output).toContain('               deal-details-header-menu\n');
      });

      // The list endpoint does not echo ui_app today, so the type has to be
      // inferred from the absence of every OAuth field.
      it('still recognises a UI app when the response omits the ui_app block', async () => {
        (appService.fetchAppsList as jest.Mock).mockResolvedValue([
          {
            app_id: 'ui-2',
            name: 'Echoless',
            client_id: '',
            redirect_uris: null,
            scopes: null,
            version: '0.0.1',
            created_at: '2026-01-01',
            updated_at: '2026-01-01',
          },
        ]);

        await listCommand({ json: false });

        const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
        expect(output).toContain('Type:          UI app');
        expect(output).toContain('Version:       0.0.1');
        expect(output).not.toContain('Client ID:');
        expect(output).not.toContain('Redirect URL');
      });

      // An OAuth app is only ever a UI app if it has NO OAuth material at all —
      // a client_id with empty callbacks is a half-configured OAuth app.
      it('does not mistake an OAuth app with no callbacks for a UI app', async () => {
        (appService.fetchAppsList as jest.Mock).mockResolvedValue([
          {
            app_id: 'oauth-2',
            name: 'Half configured',
            client_id: 'cli-123',
            redirect_uris: [],
            scopes: [],
            created_at: '2026-01-01',
            updated_at: '2026-01-01',
          },
        ]);

        await listCommand({ json: false });

        const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
        expect(output).toContain('Type:          OAuth app');
        expect(output).toContain('Redirect URLs: (none)');
      });
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
