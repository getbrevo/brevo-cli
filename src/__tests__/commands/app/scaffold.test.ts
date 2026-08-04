import * as fs from 'node:fs';
import * as path from 'node:path';
import { scaffoldCommand } from '../../../commands/app/scaffold';

// fs is fully mocked below, so these paths are never written. We deliberately
// avoid os.tmpdir() to keep tests off any shared, world-writable directory
// (SonarSource S5443) — the strings only flow into mocked fs calls.
const tmpPath = (name: string): string => path.join(__dirname, '__sandbox__', name);

jest.mock('inquirer', () => ({
  prompt: jest.fn(),
}));

jest.mock('../../../container', () => ({
  appService: {
    fetchAppsList: jest.fn(),
    fetchApp: jest.fn(),
    pickApp: jest.fn(),
    createApp: jest.fn(),
    updateApp: jest.fn(),
    deleteApp: jest.fn(),
    resolveAppCredentials: jest.fn(),
    syncAppCredentials: jest.fn(),
  },
  accountService: {
    validateApiKey: jest.fn(),
    getAccount: jest.fn(),
  },
  client: {},
}));

jest.mock('../../../lib/config', () => ({
  getApiKey: jest.fn().mockReturnValue('test-key'),
  getAppCredentials: jest.fn(),
  saveAppCredentials: jest.fn(),
  readProjectConfig: jest.fn().mockReturnValue(null),
  isUiAppConfig: (config: { ui_app?: unknown } | null | undefined) => !!config?.ui_app,
}));

jest.mock('../../../templates', () => ({
  loadBaseTemplates: jest.fn((_vars: Record<string, string>) => [
    { name: 'app-config.json', content: '{}' },
    { name: '.gitignore', content: 'src/oauth/.env.local' },
    { name: 'AGENTS.md', content: '# Agents' },
    { name: 'CLAUDE.md', content: '# Claude' },
    { name: 'README.md', content: '# README' },
  ]),
  loadFeatureTemplates: jest.fn((_featureType: string, vars: Record<string, string>) => [
    { name: 'src/oauth/server.js', content: '// server' },
    { name: 'src/oauth/handler.js', content: '// handler' },
    { name: 'src/oauth/token-store.js', content: '// token store' },
    { name: 'src/oauth/.env.example', content: `CLIENT_ID=${vars['{{CLIENT_ID}}'] || ''}` },
    { name: 'src/oauth/.env.local', content: `CLIENT_ID=${vars['{{CLIENT_ID}}'] || ''}` },
    { name: 'src/oauth/package.json', content: '{}' },
  ]),
}));

jest.mock('node:fs');
jest.mock('node:path', () => {
  const actual = jest.requireActual('node:path');
  return {
    ...actual,
    resolve: jest.fn((...args: string[]) => actual.resolve(...args)),
    join: jest.fn((...args: string[]) => actual.join(...args)),
    basename: jest.fn((p: string) => actual.basename(p)),
    dirname: jest.fn((p: string) => actual.dirname(p)),
  };
});

import inquirer from 'inquirer';
import { appService } from '../../../container';
import { readProjectConfig } from '../../../lib/config';

const mockPrompt = inquirer.prompt as unknown as jest.Mock;

// A server app + a local config that exactly matches it (no drift). Individual
// tests override fields on either side to introduce a diff.
const serverApp = {
  app_id: '1',
  name: 'Test App',
  client_id: 'cli-123',
  client_secret: 'secret-456',
  redirect_uris: ['http://localhost:3009/auth/callback'],
  scopes: ['contacts:read'],
  distribution_type: 'private' as const,
  logo_uri: '',
  version: '1.0.0',
};
const matchingLocalConfig = {
  appId: '1',
  appName: 'Test App',
  distribution_type: 'private' as const,
  logoUri: '',
  version: '1.0.0',
  auth: { scopes: ['contacts:read'], redirectUris: ['http://localhost:3009/auth/callback'] },
};

describe('app/scaffold', () => {
  let stdoutSpy: jest.SpyInstance;
  let chdirSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    chdirSpy = jest.spyOn(process, 'chdir').mockImplementation(() => undefined);
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    (fs.mkdirSync as jest.Mock).mockReturnValue(undefined);
    (fs.writeFileSync as jest.Mock).mockReturnValue(undefined);
    (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify({ version: '9.9.9' }));
    (readProjectConfig as jest.Mock).mockReturnValue(null);
    (appService.resolveAppCredentials as jest.Mock).mockResolvedValue({
      diffs: [],
      app: serverApp,
    });
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    chdirSpy.mockRestore();
  });

  describe('scaffoldCommand', () => {
    it('errors (without fetching the app) when no app-config.json exists in cwd', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue(null);

      await expect(scaffoldCommand({})).rejects.toThrow(/app-config\.json/i);

      expect(appService.resolveAppCredentials).not.toHaveBeenCalled();
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('reads the app id from app-config.json (no picker) and scaffolds the feature merge-only', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue(matchingLocalConfig);
      mockPrompt.mockResolvedValueOnce({ featureType: 'oauth' });

      await scaffoldCommand({});

      expect(appService.pickApp).not.toHaveBeenCalled();
      expect(appService.resolveAppCredentials).toHaveBeenCalledWith('1');
      // No diff → no confirm prompt.
      expect(mockPrompt).not.toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ name: 'confirmed' })]),
      );
      // Feature files written (existsSync false → nothing to skip).
      expect(fs.writeFileSync).toHaveBeenCalled();

      const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
      expect(output).toContain('scaffolded');
      expect(output).toContain('brevo app start oauth');
      expect(output).toContain('brevo app available-scopes');
    });

    it('does not write the base config when there is no drift (feature-only, merge)', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue(matchingLocalConfig);
      mockPrompt.mockResolvedValueOnce({ featureType: 'oauth' });

      await scaffoldCommand({});

      const { loadBaseTemplates, loadFeatureTemplates } = require('../../../templates');
      expect(loadBaseTemplates).not.toHaveBeenCalled();
      expect(loadFeatureTemplates).toHaveBeenCalledWith('oauth', expect.anything());
    });

    it('prompts on existing feature files and skips them when the user chooses merge', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue(matchingLocalConfig);
      // Every feature file already exists → conflict prompt, then merge skips them all.
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      mockPrompt
        .mockResolvedValueOnce({ featureType: 'oauth' })
        .mockResolvedValueOnce({ action: 'merge' });

      await scaffoldCommand({});

      expect(mockPrompt).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ name: 'action' })]),
      );
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('overwrites existing feature files when the user chooses overwrite', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue(matchingLocalConfig);
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      mockPrompt
        .mockResolvedValueOnce({ featureType: 'oauth' })
        .mockResolvedValueOnce({ action: 'overwrite' });

      await scaffoldCommand({});

      // Existing files are rewritten rather than skipped.
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('cancels without writing when the user chooses cancel on the conflict prompt', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue(matchingLocalConfig);
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      mockPrompt
        .mockResolvedValueOnce({ featureType: 'oauth' })
        .mockResolvedValueOnce({ action: 'cancel' });

      await scaffoldCommand({});

      expect(fs.writeFileSync).not.toHaveBeenCalled();
      const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
      expect(output).toContain('cancelled');
    });

    it('does not prompt for conflicts when no feature files exist', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue(matchingLocalConfig);
      // existsSync defaults to false in beforeEach → no conflict.
      mockPrompt.mockResolvedValueOnce({ featureType: 'oauth' });

      await scaffoldCommand({});

      expect(mockPrompt).not.toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ name: 'action' })]),
      );
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('overwrites existing feature files without prompting when --overwrite is passed', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue(matchingLocalConfig);
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      mockPrompt.mockResolvedValueOnce({ featureType: 'oauth' });

      await scaffoldCommand({ overwrite: true });

      // No conflict prompt — the flag decides.
      expect(mockPrompt).not.toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ name: 'action' })]),
      );
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('shows the diff and refreshes the base config (full overwrite) on consent', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue({
        ...matchingLocalConfig,
        auth: { scopes: ['contacts:read'], redirectUris: ['http://old-host/cb'] },
      });
      mockPrompt
        .mockResolvedValueOnce({ confirmed: true })
        .mockResolvedValueOnce({ featureType: 'oauth' });

      await scaffoldCommand({});

      const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
      expect(output).toContain('redirectUris');
      expect(output).toContain('differs from the server');

      const { loadBaseTemplates, loadFeatureTemplates } = require('../../../templates');
      expect(loadBaseTemplates).toHaveBeenCalled();
      expect(loadFeatureTemplates).toHaveBeenCalledWith('oauth', expect.anything());
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it.each<[string, Record<string, unknown>, string]>([
      ['appName', { appName: 'Old Name' }, 'appName'],
      ['distribution_type', { distribution_type: 'public' as const }, 'distribution_type'],
      [
        'scopes',
        {
          auth: {
            scopes: ['contacts:write'],
            redirectUris: ['http://localhost:3009/auth/callback'],
          },
        },
        'scopes',
      ],
      ['logoUri', { logoUri: 'https://old.example.com/logo.png' }, 'logoUri'],
      ['version', { version: '0.9.0' }, 'version'],
    ])(
      'shows a diff and asks consent when %s differs from the server',
      async (_label, override, expectedFieldLabel) => {
        (readProjectConfig as jest.Mock).mockReturnValue({ ...matchingLocalConfig, ...override });
        mockPrompt
          .mockResolvedValueOnce({ confirmed: true })
          .mockResolvedValueOnce({ featureType: 'oauth' });

        await scaffoldCommand({});

        const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
        expect(output).toContain(expectedFieldLabel);
        expect(output).toContain('differs from the server');
        expect(fs.writeFileSync).toHaveBeenCalled();
      },
    );

    it('cancels without writing when the config differs and the user declines', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue({
        ...matchingLocalConfig,
        auth: { scopes: ['contacts:read'], redirectUris: ['http://old-host/cb'] },
      });
      mockPrompt.mockResolvedValueOnce({ confirmed: false });

      await scaffoldCommand({});

      expect(fs.writeFileSync).not.toHaveBeenCalled();
      const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
      expect(output).toMatch(/cancelled/i);
    });

    it('uses API credentials for feature templates', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue(matchingLocalConfig);
      (appService.resolveAppCredentials as jest.Mock).mockResolvedValue({
        diffs: [],
        app: { ...serverApp, client_id: 'api-client', client_secret: 'api-secret' },
      });
      mockPrompt.mockResolvedValueOnce({ featureType: 'oauth' });

      await scaffoldCommand({});

      const { loadFeatureTemplates } = require('../../../templates');
      const vars = (loadFeatureTemplates as jest.Mock).mock.calls[0][1];
      expect(vars['{{CLIENT_ID}}']).toBe('api-client');
    });

    it('never prints a "cd" step (scaffold always runs in the project directory)', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue(matchingLocalConfig);
      mockPrompt.mockResolvedValueOnce({ featureType: 'oauth' });

      await scaffoldCommand({});

      const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
      expect(output).toContain('Next steps');
      expect(output).not.toMatch(/cd /);
      expect(output).toContain('yarn --cwd src/oauth');
    });
  });

  describe('scaffoldCommand --json', () => {
    it('writes the feature and reports { scaffolded, directory } when there is no drift', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue(matchingLocalConfig);

      await scaffoldCommand({ json: true });

      // --json never prompts.
      expect(mockPrompt).not.toHaveBeenCalled();
      const output = stdoutSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.scaffolded).toBeGreaterThan(0);
      expect(parsed.directory).toBeTruthy();
    });

    it('cancels and surfaces the diffs (no prompt) when the config differs', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue({
        ...matchingLocalConfig,
        auth: { scopes: ['contacts:read'], redirectUris: ['http://old-host/cb'] },
      });

      await scaffoldCommand({ json: true });

      expect(mockPrompt).not.toHaveBeenCalled();
      expect(fs.writeFileSync).not.toHaveBeenCalled();
      const output = stdoutSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.cancelled).toBe(true);
      expect(parsed.diffs).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'redirectUris' })]),
      );
    });

    it('merges (skips existing feature files) by default without prompting', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue(matchingLocalConfig);
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      await scaffoldCommand({ json: true });

      expect(mockPrompt).not.toHaveBeenCalled();
      // Every feature file already exists → merge skips them all.
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('overwrites existing feature files when --overwrite is passed', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue(matchingLocalConfig);
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      await scaffoldCommand({ json: true, overwrite: true });

      expect(mockPrompt).not.toHaveBeenCalled();
      expect(fs.writeFileSync).toHaveBeenCalled();
    });
  });

  describe('runBaseScaffold (core, no prompting/output)', () => {
    const ctx = {
      appDetails: {
        app_id: '1',
        name: 'Test App',
        client_id: 'cli-123',
        client_secret: 'secret-456',
        redirect_uris: ['http://localhost:3009/auth/callback'],
        scopes: ['contacts:read'],
      },
      clientId: 'cli-123',
      clientSecret: 'secret-456',
      redirectUris: ['http://localhost:3009/auth/callback'],
      redirectUri: 'http://localhost:3009/auth/callback',
    };

    it('writes base files and returns metadata without prompting or printing', async () => {
      const { runBaseScaffold, computeSlug } = require('../../../commands/app/scaffold');

      const result = runBaseScaffold('1', ctx, tmpPath('run-base-core'), false);

      expect(result.written).toBeGreaterThan(0);
      expect(result.legacyAllSubstituted).toBe(false);
      expect(result.scopes).toEqual(['contacts:read']);
      expect(result.files.length).toBeGreaterThan(0);
      expect(fs.writeFileSync).toHaveBeenCalled();
      expect(mockPrompt).not.toHaveBeenCalled();
      expect(stdoutSpy).not.toHaveBeenCalled();
      expect(computeSlug('Test App')).toBe('test-app');
    });

    it('passes DEFAULT_SCOPES fallback into template vars without a CLI_VERSION var', () => {
      const { runBaseScaffold } = require('../../../commands/app/scaffold');
      runBaseScaffold(
        '1',
        { ...ctx, appDetails: { ...ctx.appDetails, scopes: [] } },
        tmpPath('run-base-vars'),
        false,
      );

      const { loadBaseTemplates } = require('../../../templates');
      const vars = (loadBaseTemplates as jest.Mock).mock.calls[0][0];
      expect(vars).not.toHaveProperty('{{CLI_VERSION}}');
      expect(vars['{{SCOPES_JSON}}']).toBe(
        JSON.stringify(['contacts:read', 'contacts:write', 'crm:read', 'crm:write']),
      );
    });

    it.each<[string, string | undefined, string]>([
      ['present', 'https://example.com/logo.png', 'https://example.com/logo.png'],
      ['absent', undefined, ''],
    ])('maps {{LOGO_URI}} when logo_uri is %s', (_label, logoUri, expected) => {
      const { runBaseScaffold } = require('../../../commands/app/scaffold');
      runBaseScaffold(
        '1',
        {
          ...ctx,
          appDetails: {
            ...ctx.appDetails,
            ...(logoUri === undefined ? {} : { logo_uri: logoUri }),
          },
        },
        tmpPath('run-base-logo'),
        false,
      );
      const { loadBaseTemplates } = require('../../../templates');
      const vars = (loadBaseTemplates as jest.Mock).mock.calls[0][0];
      expect(vars['{{LOGO_URI}}']).toBe(expected);
    });

    it.each<[string, string | undefined, string]>([
      ['present', '0.0.1', '0.0.1'],
      ['absent', undefined, ''],
    ])('maps {{APP_VERSION}} when version is %s', (_label, version, expected) => {
      const { runBaseScaffold } = require('../../../commands/app/scaffold');
      runBaseScaffold(
        '1',
        {
          ...ctx,
          appDetails: { ...ctx.appDetails, ...(version === undefined ? {} : { version }) },
        },
        tmpPath('run-base-version'),
        false,
      );
      const { loadBaseTemplates } = require('../../../templates');
      const vars = (loadBaseTemplates as jest.Mock).mock.calls[0][0];
      expect(vars['{{APP_VERSION}}']).toBe(expected);
    });

    describe("legacy 'all' scope substitution", () => {
      const DEFAULTS = ['contacts:read', 'contacts:write', 'crm:read', 'crm:write'];

      const run = (
        remoteScopes: string[],
      ): { writtenScopes: string; legacyAllSubstituted: boolean } => {
        const { runBaseScaffold } = require('../../../commands/app/scaffold');
        const result = runBaseScaffold(
          '1',
          { ...ctx, appDetails: { ...ctx.appDetails, scopes: remoteScopes } },
          tmpPath('run-base-legacy'),
          false,
        );
        const { loadBaseTemplates } = require('../../../templates');
        const vars = (loadBaseTemplates as jest.Mock).mock.calls[0][0];
        return {
          writtenScopes: vars['{{SCOPES_JSON}}'],
          legacyAllSubstituted: result.legacyAllSubstituted,
        };
      };

      it("writes DEFAULT_SCOPES when 'all' is the only scope", () => {
        const { writtenScopes, legacyAllSubstituted } = run(['all']);
        expect(writtenScopes).toBe(JSON.stringify(DEFAULTS));
        expect(legacyAllSubstituted).toBe(true);
      });

      it("keeps granular scopes and only drops 'all' when scopes are mixed", () => {
        const { writtenScopes, legacyAllSubstituted } = run(['all', 'crm:deals', 'companies:read']);
        expect(writtenScopes).toBe(JSON.stringify(['crm:deals', 'companies:read']));
        expect(legacyAllSubstituted).toBe(true);
      });

      it('propagates granular remote scopes untouched', () => {
        const { writtenScopes, legacyAllSubstituted } = run(['contacts:read', 'crm:write']);
        expect(writtenScopes).toBe(JSON.stringify(['contacts:read', 'crm:write']));
        expect(legacyAllSubstituted).toBe(false);
      });
    });
  });

  describe('runFeatureScaffold (core, no prompting/output)', () => {
    const ctx = {
      appDetails: {
        app_id: '1',
        name: 'Test App',
        client_id: 'cli-123',
        client_secret: 'secret-456',
        redirect_uris: ['http://localhost:3009/auth/callback'],
        scopes: ['contacts:read'],
      },
      clientId: 'cli-123',
      clientSecret: 'secret-456',
      redirectUris: ['http://localhost:3009/auth/callback'],
      redirectUri: 'http://localhost:3009/auth/callback',
    };

    it('writes the oauth feature files and returns the written count', () => {
      const { runFeatureScaffold } = require('../../../commands/app/scaffold');

      const result = runFeatureScaffold('oauth', '1', ctx, tmpPath('run-feature-core'), false);

      expect(result.written).toBeGreaterThan(0);
      expect(result.files.length).toBeGreaterThan(0);
      expect(fs.writeFileSync).toHaveBeenCalled();
      expect(mockPrompt).not.toHaveBeenCalled();
      expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('skips existing files under mergeOnly', () => {
      const { runFeatureScaffold } = require('../../../commands/app/scaffold');
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      const result = runFeatureScaffold('oauth', '1', ctx, tmpPath('run-feature-merge'), true);

      expect(result.written).toBe(0);
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });
  });

  describe('resolveProjectDirectory', () => {
    it('creates and chdirs into a fresh directory', async () => {
      const { resolveProjectDirectory } = require('../../../commands/app/scaffold');
      mockPrompt.mockResolvedValueOnce({ outputDir: tmpPath('fresh-dir') });

      const result = await resolveProjectDirectory('./default-slug');

      expect(fs.mkdirSync).toHaveBeenCalledWith(tmpPath('fresh-dir'), { recursive: true });
      expect(chdirSpy).toHaveBeenCalledWith(tmpPath('fresh-dir'));
      expect(result).toEqual({
        targetDir: tmpPath('fresh-dir'),
        mergeOnly: false,
        chooseAgain: false,
      });
    });

    it('chdirs (without re-mkdir) when overwriting an existing directory', async () => {
      const { resolveProjectDirectory } = require('../../../commands/app/scaffold');
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      mockPrompt
        .mockResolvedValueOnce({ outputDir: tmpPath('existing-dir') })
        .mockResolvedValueOnce({ action: 'overwrite' });

      const result = await resolveProjectDirectory('./default-slug');

      expect(chdirSpy).toHaveBeenCalledWith(tmpPath('existing-dir'));
      expect(result.chooseAgain).toBe(false);
    });

    it('does not chdir when the user chooses a different path', async () => {
      const { resolveProjectDirectory } = require('../../../commands/app/scaffold');
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      mockPrompt
        .mockResolvedValueOnce({ outputDir: tmpPath('existing-dir') })
        .mockResolvedValueOnce({ action: 'new' });

      const result = await resolveProjectDirectory('./default-slug');

      expect(chdirSpy).not.toHaveBeenCalled();
      expect(result.chooseAgain).toBe(true);
    });

    it('suppresses the directory notice in json mode', async () => {
      const { resolveProjectDirectory } = require('../../../commands/app/scaffold');

      await resolveProjectDirectory('./default-slug', true);

      const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
      expect(output).not.toContain('Creating');
      expect(mockPrompt).not.toHaveBeenCalled();
    });
  });

  describe('promptFeatureType', () => {
    it('prompts and returns the selected type when interactive', async () => {
      const { promptFeatureType } = require('../../../commands/app/scaffold');
      mockPrompt.mockResolvedValueOnce({ featureType: 'oauth' });

      const result = await promptFeatureType(true);

      expect(mockPrompt).toHaveBeenCalledWith([expect.objectContaining({ name: 'featureType' })]);
      expect(result).toBe('oauth');
    });

    it('returns oauth without prompting when not interactive', async () => {
      const { promptFeatureType } = require('../../../commands/app/scaffold');

      const result = await promptFeatureType(false);

      expect(mockPrompt).not.toHaveBeenCalled();
      expect(result).toBe('oauth');
    });
  });

  // ──────────────── UI apps (BEX-290) ────────────────
  describe('UI apps', () => {
    const uiApp = {
      extensionType: 'actionLink' as const,
      surfacePointList: ['contactDetails.headerMenu.action'],
      heading: 'Invoice Manager',
      // A value the server does not know about — the whole point of the
      // preservation test below.
      subheading: 'Hand-edited subheading',
      redirectLink: 'https://example.com/brevo',
      linkTarget: '_blank' as const,
    };

    // Drifts from serverApp on appName so the refresh path (a full overwrite of
    // app-config.json) is exercised.
    const driftedUiConfig = {
      appId: '1',
      appName: 'Renamed Locally',
      distribution_type: 'private' as const,
      logoUri: '',
      version: '1.0.0',
      auth: { scopes: ['contacts:read'] },
      ui_app: uiApp,
    };

    // This is the regression that matters: on detected drift the command
    // rewrites app-config.json wholesale from server values, and the server does
    // not return `ui_app`. Without the local block being carried into the
    // template vars, a partner's hand-edited action-link config is destroyed.
    it('preserves the local ui_app block through a confirmed config refresh', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue(driftedUiConfig);
      mockPrompt.mockResolvedValueOnce({ confirmed: true });

      await scaffoldCommand({});

      const { loadBaseTemplates } = require('../../../templates');
      expect(loadBaseTemplates).toHaveBeenCalled();
      const vars = (loadBaseTemplates as jest.Mock).mock.calls[0][0];
      expect(vars['{{UI_APP_JSON}}']).toContain('Hand-edited subheading');
      expect(JSON.parse(vars['{{UI_APP_JSON}}'].replaceAll('\n  ', '\n'))).toEqual(uiApp);
    });

    it('does not report phantom redirect-URL drift for a UI app', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue({
        ...driftedUiConfig,
        appName: 'Test App', // matches the server, so ONLY redirectUrls could differ
      });

      await scaffoldCommand({ json: true });

      // No drift detected → no cancellation, and the base refresh is skipped.
      const parsed = JSON.parse(stdoutSpy.mock.calls[0][0]);
      expect(parsed.cancelled).toBeUndefined();
    });

    it('offers no features and never scaffolds the OAuth server', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue({
        ...driftedUiConfig,
        appName: 'Test App',
      });

      await scaffoldCommand({});

      const { loadFeatureTemplates } = require('../../../templates');
      expect(loadFeatureTemplates).not.toHaveBeenCalled();
      const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
      expect(output).toMatch(/no features to scaffold/i);
    });

    // The app type is decided locally, never by server data. If the server
    // returned a `ui_app` for an app the local config says is OAuth, honouring it
    // would silently reclassify the project and write a UI config over an OAuth
    // one — so `fetchAppContext` takes the block from the caller only.
    it('ignores a server-returned ui_app block for a project whose local config is OAuth', async () => {
      (appService.resolveAppCredentials as jest.Mock).mockResolvedValue({
        diffs: [],
        app: { ...serverApp, ui_app: uiApp },
      });
      (readProjectConfig as jest.Mock).mockReturnValue({
        ...matchingLocalConfig,
        appName: 'Renamed Locally', // force the base refresh
      });
      mockPrompt
        .mockResolvedValueOnce({ confirmed: true })
        .mockResolvedValueOnce({ featureType: 'oauth' });

      await scaffoldCommand({});

      const { loadBaseTemplates, loadFeatureTemplates } = require('../../../templates');
      const vars = (loadBaseTemplates as jest.Mock).mock.calls[0][0];
      expect(vars['{{UI_APP_JSON}}']).toBe('');
      // Still treated as an OAuth project: the feature scaffold runs.
      expect(loadFeatureTemplates).toHaveBeenCalled();
    });

    it('reports an empty feature list under --json', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue({
        ...driftedUiConfig,
        appName: 'Test App',
      });

      await scaffoldCommand({ json: true });

      const parsed = JSON.parse(stdoutSpy.mock.calls[0][0]);
      expect(parsed.features).toEqual([]);
    });
  });
});
