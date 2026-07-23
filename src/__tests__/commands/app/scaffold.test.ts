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
}));

jest.mock('../../../templates', () => ({
  loadAllTemplates: jest.fn((vars: Record<string, string>) => [
    { name: 'src/oauth/server.js', content: '// server' },
    { name: 'src/oauth/handler.js', content: '// handler' },
    { name: 'src/oauth/token-store.js', content: '// token store' },
    { name: 'src/oauth/.env.example', content: `CLIENT_ID=${vars['{{CLIENT_ID}}'] || ''}` },
    { name: 'src/oauth/.env.local', content: `CLIENT_ID=${vars['{{CLIENT_ID}}'] || ''}` },
    { name: 'src/oauth/package.json', content: '{}' },
    { name: 'app-config.json', content: '{}' },
    { name: '.gitignore', content: 'src/oauth/.env.local' },
    { name: 'AGENTS.md', content: '# Agents' },
    { name: 'CLAUDE.md', content: '# Claude' },
    { name: 'README.md', content: '# README' },
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
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    chdirSpy.mockRestore();
  });

  it('should scaffold files for a given app ID', async () => {
    (appService.resolveAppCredentials as jest.Mock).mockResolvedValue({
      diffs: [],
      app: {
        app_id: '1',
        name: 'Test App',
        client_id: 'cli-123',
        client_secret: 'secret-456',
        redirect_uris: ['http://localhost:3009/auth/callback'],
      },
    });

    mockPrompt
      .mockResolvedValueOnce({ outputDir: tmpPath('test-scaffold') }) // dir prompt
      .mockResolvedValueOnce({ projectType: 'oauth' });

    await scaffoldCommand({ appId: '1' });

    expect(appService.resolveAppCredentials).toHaveBeenCalledWith('1');
    expect(fs.mkdirSync).toHaveBeenCalled();
    expect(fs.writeFileSync).toHaveBeenCalled();

    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('scaffolded');
    expect(output).toContain('brevo app start oauth');
    expect(output).toContain('brevo app available-scopes');
    expect(output).toContain('app-config.json');
  });

  it('should output JSON when --json flag is used', async () => {
    (appService.resolveAppCredentials as jest.Mock).mockResolvedValue({
      diffs: [],
      app: {
        app_id: '1',
        name: 'Test App',
        client_id: 'cli-123',
        client_secret: 'secret',
        redirect_uris: [],
      },
    });

    mockPrompt.mockResolvedValueOnce({ outputDir: tmpPath('test-json') });

    await scaffoldCommand({ appId: '1', json: true });

    const output = stdoutSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.scaffolded).toBeGreaterThan(0);
    expect(parsed.directory).toBeTruthy();
  });

  it('should use API credentials for templates', async () => {
    (appService.resolveAppCredentials as jest.Mock).mockResolvedValue({
      diffs: [],
      app: {
        app_id: '1',
        name: 'Test App',
        client_id: 'api-client',
        client_secret: 'api-secret',
        redirect_uris: ['http://localhost:3009/auth/callback'],
      },
    });

    mockPrompt
      .mockResolvedValueOnce({ outputDir: tmpPath('test-creds') })
      .mockResolvedValueOnce({ projectType: 'oauth' });

    await scaffoldCommand({ appId: '1' });

    const { loadAllTemplates } = require('../../../templates');
    const vars = (loadAllTemplates as jest.Mock).mock.calls[0][0];
    expect(vars['{{CLIENT_ID}}']).toBe('api-client');
  });

  it('should pass cliVersion and DEFAULT_SCOPES into template vars', async () => {
    (appService.resolveAppCredentials as jest.Mock).mockResolvedValue({
      diffs: [],
      app: {
        app_id: '1',
        name: 'Test App',
        client_id: 'cli-123',
        client_secret: 'secret',
        redirect_uris: [],
      },
    });

    mockPrompt
      .mockResolvedValueOnce({ outputDir: tmpPath('test-version') })
      .mockResolvedValueOnce({ projectType: 'oauth' });

    await scaffoldCommand({ appId: '1' });

    const { loadAllTemplates } = require('../../../templates');
    const vars = (loadAllTemplates as jest.Mock).mock.calls[0][0];
    expect(vars['{{CLI_VERSION}}']).toBe('9.9.9');
    expect(vars['{{SCOPES_JSON}}']).toBe(
      JSON.stringify(['contacts:read', 'contacts:write', 'crm:read', 'crm:write']),
    );
  });

  it('should prefer localhost redirect URI over production URLs', async () => {
    (appService.resolveAppCredentials as jest.Mock).mockResolvedValue({
      diffs: [],
      app: {
        app_id: '1',
        name: 'Test App',
        client_id: 'cli-123',
        client_secret: 'secret',
        redirect_uris: [
          'https://myapp.example.com/callback',
          'http://localhost:3009/auth/callback',
        ],
      },
    });

    mockPrompt
      .mockResolvedValueOnce({ outputDir: tmpPath('test-redirect') })
      .mockResolvedValueOnce({ projectType: 'oauth' });

    await scaffoldCommand({ appId: '1' });

    const { loadAllTemplates } = require('../../../templates');
    const vars = (loadAllTemplates as jest.Mock).mock.calls[0][0];
    expect(vars['{{REDIRECT_URI}}']).toBe('http://localhost:3009/auth/callback');
  });

  it('should fall back to DEFAULT_REDIRECT_URI when only production URLs exist', async () => {
    (appService.resolveAppCredentials as jest.Mock).mockResolvedValue({
      diffs: [],
      app: {
        app_id: '1',
        name: 'Test App',
        client_id: 'cli-123',
        client_secret: 'secret',
        redirect_uris: ['https://myapp.example.com/callback'],
      },
    });

    mockPrompt
      .mockResolvedValueOnce({ outputDir: tmpPath('test-fallback') })
      .mockResolvedValueOnce({ projectType: 'oauth' });

    await scaffoldCommand({ appId: '1' });

    const { loadAllTemplates } = require('../../../templates');
    const vars = (loadAllTemplates as jest.Mock).mock.calls[0][0];
    expect(vars['{{REDIRECT_URI}}']).toBe('http://localhost:3009/auth/callback');
  });

  it('should prompt app picker when no appId provided', async () => {
    (appService.pickApp as jest.Mock).mockResolvedValue('5');
    (appService.resolveAppCredentials as jest.Mock).mockResolvedValue({
      diffs: [],
      app: {
        app_id: '5',
        name: 'Picked App',
        client_id: 'cli-picked',
        client_secret: 'secret',
        redirect_uris: [],
      },
    });

    mockPrompt
      .mockResolvedValueOnce({ outputDir: tmpPath('test-pick') })
      .mockResolvedValueOnce({ projectType: 'oauth' });

    await scaffoldCommand({});

    expect(appService.pickApp).toHaveBeenCalled();
    expect(appService.resolveAppCredentials).toHaveBeenCalledWith('5');
  });

  it('should handle existing directory with overwrite', async () => {
    const cwdAppConfig = path.join(process.cwd(), 'app-config.json');
    (fs.existsSync as jest.Mock).mockImplementation((p: string) => p !== cwdAppConfig);
    (appService.resolveAppCredentials as jest.Mock).mockResolvedValue({
      diffs: [],
      app: {
        app_id: '1',
        name: 'Test',
        client_id: 'cli-123',
        client_secret: 'secret',
        redirect_uris: [],
      },
    });

    mockPrompt
      .mockResolvedValueOnce({ outputDir: tmpPath('existing') }) // dir prompt
      .mockResolvedValueOnce({ action: 'overwrite' }) // action prompt
      .mockResolvedValueOnce({ projectType: 'oauth' });

    await scaffoldCommand({ appId: '1' });

    expect(fs.writeFileSync).toHaveBeenCalled();
  });

  it('should skip existing files in merge mode', async () => {
    const cwdAppConfig = path.join(process.cwd(), 'app-config.json');
    (fs.existsSync as jest.Mock).mockImplementation((p: string) => p !== cwdAppConfig);
    (appService.resolveAppCredentials as jest.Mock).mockResolvedValue({
      diffs: [],
      app: {
        app_id: '1',
        name: 'Test',
        client_id: 'cli-123',
        client_secret: 'secret',
        redirect_uris: [],
      },
    });

    mockPrompt
      .mockResolvedValueOnce({ outputDir: tmpPath('merge') })
      .mockResolvedValueOnce({ action: 'merge' })
      .mockResolvedValueOnce({ projectType: 'oauth' });

    await scaffoldCommand({ appId: '1' });

    // In merge mode with all files existing, writeFileSync should not be called
    // (mkdirSync is still called for directory creation)
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  describe('directory already linked to an app', () => {
    const cwdAppConfig = path.join(process.cwd(), 'app-config.json');
    const serverApp = {
      app_id: '1',
      name: 'Test App',
      client_id: 'cli-123',
      client_secret: 'secret',
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
      auth: { scopes: ['contacts:read'], redirectUrls: ['http://localhost:3009/auth/callback'] },
    };

    beforeEach(() => {
      (fs.existsSync as jest.Mock).mockImplementation((p: string) => p === cwdAppConfig);
      (appService.resolveAppCredentials as jest.Mock).mockResolvedValue({
        diffs: [],
        app: serverApp,
      });
    });

    it('proceeds merge-only with no prompt when the linked config already matches the server', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue(matchingLocalConfig);
      mockPrompt.mockResolvedValueOnce({ projectType: 'oauth' });

      await scaffoldCommand({ appId: '1' });

      expect(mockPrompt).not.toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ name: 'confirmed' })]),
      );
      expect(fs.writeFileSync).toHaveBeenCalled();
      expect(chdirSpy).not.toHaveBeenCalled();
    });

    it('shows the diff and does a full overwrite on consent when the config differs', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue({
        ...matchingLocalConfig,
        auth: { scopes: ['contacts:read'], redirectUrls: ['http://old-host/cb'] },
      });
      mockPrompt
        .mockResolvedValueOnce({ confirmed: true })
        .mockResolvedValueOnce({ projectType: 'oauth' });

      await scaffoldCommand({ appId: '1' });

      const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
      expect(output).toContain('redirectUrls');
      expect(output).toContain('differs from the server');
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
            redirectUrls: ['http://localhost:3009/auth/callback'],
          },
        },
        'scopes',
      ],
      ['logoUri', { logoUri: 'https://old.example.com/logo.png' }, 'logoUri'],
      ['version', { version: '0.9.0' }, 'version'],
    ])(
      'shows a diff and asks consent when %s differs from the server',
      async (_label, override, expectedFieldLabel) => {
        (readProjectConfig as jest.Mock).mockReturnValue({
          ...matchingLocalConfig,
          ...override,
        });
        mockPrompt
          .mockResolvedValueOnce({ confirmed: true })
          .mockResolvedValueOnce({ projectType: 'oauth' });

        await scaffoldCommand({ appId: '1' });

        const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
        expect(output).toContain(expectedFieldLabel);
        expect(output).toContain('differs from the server');
        expect(fs.writeFileSync).toHaveBeenCalled();
      },
    );

    it('cancels without writing when the config differs and the user declines', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue({
        ...matchingLocalConfig,
        auth: { scopes: ['contacts:read'], redirectUrls: ['http://old-host/cb'] },
      });
      mockPrompt.mockResolvedValueOnce({ confirmed: false });

      await scaffoldCommand({ appId: '1' });

      expect(fs.writeFileSync).not.toHaveBeenCalled();
      const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
      expect(output).toMatch(/cancelled/i);
    });

    it('offers a different directory when the linked app does not match', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue({ appId: '999', appName: 'Other App' });
      mockPrompt
        .mockResolvedValueOnce({ choice: 'choose' })
        .mockResolvedValueOnce({ outputDir: tmpPath('different-app-dir') })
        .mockResolvedValueOnce({ projectType: 'oauth' });
      (fs.existsSync as jest.Mock).mockImplementation(
        (p: string) => p === cwdAppConfig && p !== tmpPath('different-app-dir'),
      );

      await scaffoldCommand({ appId: '1' });

      expect(fs.writeFileSync).toHaveBeenCalled();
      expect(chdirSpy).toHaveBeenCalledWith(tmpPath('different-app-dir'));
    });

    it('cancels without writing when the linked app does not match and the user cancels', async () => {
      (readProjectConfig as jest.Mock).mockReturnValue({ appId: '999', appName: 'Other App' });
      mockPrompt.mockResolvedValueOnce({ choice: 'cancel' });

      await scaffoldCommand({ appId: '1' });

      expect(fs.writeFileSync).not.toHaveBeenCalled();
      const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
      expect(output).toMatch(/cancelled/i);
    });
  });

  describe("legacy 'all' scope substitution", () => {
    const DEFAULTS = ['contacts:read', 'contacts:write', 'crm:read', 'crm:write'];

    /** Scaffold an app with the given remote scopes; return written scopes + CLI output. */
    const scaffoldWithScopes = async (
      remoteScopes: string[],
      dir: string,
      json = false,
    ): Promise<{ writtenScopes: string; output: string }> => {
      (appService.resolveAppCredentials as jest.Mock).mockResolvedValue({
        diffs: [],
        app: {
          app_id: '1',
          name: 'Legacy App',
          client_id: 'cli-123',
          client_secret: 'secret',
          redirect_uris: [] as string[],
          scopes: remoteScopes,
        },
      });
      mockPrompt.mockResolvedValueOnce({ outputDir: tmpPath(dir) });
      // promptProjectType only prompts when interactive (i.e. !json) — queuing
      // an answer for it when json is true would go unconsumed and bleed into
      // the next test's mockPrompt queue (mockClear doesn't drop queued
      // once-implementations), so only queue it when it will actually be read.
      if (!json) {
        mockPrompt.mockResolvedValueOnce({ projectType: 'oauth' });
      }

      await scaffoldCommand({ appId: '1', json });

      const { loadAllTemplates } = require('../../../templates');
      const vars = (loadAllTemplates as jest.Mock).mock.calls[0][0];
      return {
        writtenScopes: vars['{{SCOPES_JSON}}'],
        output: stdoutSpy.mock.calls.map((c: [string]) => c[0]).join(''),
      };
    };

    it("writes DEFAULT_SCOPES when 'all' is the only scope and prints the substitution notice", async () => {
      const { writtenScopes, output } = await scaffoldWithScopes(['all'], 'test-legacy');
      expect(writtenScopes).toBe(JSON.stringify(DEFAULTS));
      expect(output).toMatch(/legacy 'all'/);
    });

    it("keeps granular scopes and only drops 'all' when scopes are mixed", async () => {
      const { writtenScopes, output } = await scaffoldWithScopes(
        ['all', 'crm:deals', 'companies:read'],
        'test-legacy-mixed',
      );
      expect(writtenScopes).toBe(JSON.stringify(['crm:deals', 'companies:read']));
      expect(output).toMatch(/legacy 'all'/);
      expect(output).toContain('crm:deals');
    });

    it('suppresses the substitution notice under --json', async () => {
      const { writtenScopes, output } = await scaffoldWithScopes(['all'], 'test-legacy-json', true);
      expect(output).not.toMatch(/legacy 'all'/);
      // Still substitutes in the written config
      expect(writtenScopes).toBe(JSON.stringify(DEFAULTS));
    });

    it('propagates granular remote scopes untouched, with no notice', async () => {
      const { writtenScopes, output } = await scaffoldWithScopes(
        ['contacts:read', 'crm:write'],
        'test-granular',
      );
      expect(writtenScopes).toBe(JSON.stringify(['contacts:read', 'crm:write']));
      expect(output).not.toMatch(/legacy 'all'/);
    });
  });

  it.each<[string, string | undefined, string]>([
    ['present', 'https://example.com/logo.png', 'https://example.com/logo.png'],
    ['absent', undefined, ''],
  ])(
    'should pass {{LOGO_URI}} into template vars when logo_uri is %s',
    async (_label, logoUri, expected) => {
      const app = {
        app_id: '1',
        name: 'Test App',
        client_id: 'cli-123',
        client_secret: 'secret',
        redirect_uris: [] as string[],
        ...(logoUri === undefined ? {} : { logo_uri: logoUri }),
      };
      (appService.resolveAppCredentials as jest.Mock).mockResolvedValue({ diffs: [], app });
      mockPrompt
        .mockResolvedValueOnce({ outputDir: tmpPath('test-logo') })
        .mockResolvedValueOnce({ projectType: 'oauth' });

      await scaffoldCommand({ appId: '1' });

      const { loadAllTemplates } = require('../../../templates');
      const vars = (loadAllTemplates as jest.Mock).mock.calls[0][0];
      expect(vars['{{LOGO_URI}}']).toBe(expected);
    },
  );

  it.each<[string, string | undefined, string]>([
    ['present', '0.0.1', '0.0.1'],
    ['absent', undefined, ''],
  ])(
    'should pass {{APP_VERSION}} into template vars when version is %s',
    async (_label, version, expected) => {
      const app = {
        app_id: '1',
        name: 'Test App',
        client_id: 'cli-123',
        client_secret: 'secret',
        redirect_uris: [] as string[],
        ...(version === undefined ? {} : { version }),
      };
      (appService.resolveAppCredentials as jest.Mock).mockResolvedValue({ diffs: [], app });
      mockPrompt
        .mockResolvedValueOnce({ outputDir: tmpPath('test-version') })
        .mockResolvedValueOnce({ projectType: 'oauth' });

      await scaffoldCommand({ appId: '1' });

      const { loadAllTemplates } = require('../../../templates');
      const vars = (loadAllTemplates as jest.Mock).mock.calls[0][0];
      expect(vars['{{APP_VERSION}}']).toBe(expected);
    },
  );

  describe('runScaffold (core, no prompting/output)', () => {
    it('writes files and returns metadata without prompting or printing', async () => {
      const { runScaffold, computeSlug } = require('../../../commands/app/scaffold');
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
        redirectUrls: ['http://localhost:3009/auth/callback'],
        redirectUri: 'http://localhost:3009/auth/callback',
      };

      const result = runScaffold('1', ctx, tmpPath('run-scaffold-core'), false);

      expect(result.written).toBeGreaterThan(0);
      expect(result.legacyAllSubstituted).toBe(false);
      expect(result.scopes).toEqual(['contacts:read']);
      expect(result.files.length).toBeGreaterThan(0);
      expect(fs.writeFileSync).toHaveBeenCalled();
      // No prompt, no stdout — this is a pure computation + write step.
      expect(mockPrompt).not.toHaveBeenCalled();
      expect(stdoutSpy).not.toHaveBeenCalled();
      expect(computeSlug('Test App')).toBe('test-app');
    });

    it("substitutes the legacy 'all' scope and reports it via legacyAllSubstituted", () => {
      const { runScaffold } = require('../../../commands/app/scaffold');
      const ctx = {
        appDetails: {
          app_id: '1',
          name: 'Legacy App',
          client_id: 'cli-123',
          client_secret: 'secret',
          redirect_uris: [] as string[],
          scopes: ['all'],
        },
        clientId: 'cli-123',
        clientSecret: 'secret',
        redirectUrls: [] as string[],
        redirectUri: '',
      };

      const result = runScaffold('1', ctx, tmpPath('run-scaffold-legacy'), false);

      expect(result.legacyAllSubstituted).toBe(true);
      expect(result.scopes).not.toContain('all');
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
  });

  describe('promptProjectType', () => {
    it('prompts and returns the selected type when interactive', async () => {
      const { promptProjectType } = require('../../../commands/app/scaffold');
      mockPrompt.mockResolvedValueOnce({ projectType: 'oauth' });

      const result = await promptProjectType(true);

      expect(mockPrompt).toHaveBeenCalledWith([expect.objectContaining({ name: 'projectType' })]);
      expect(result).toBe('oauth');
    });

    it('returns oauth without prompting when not interactive', async () => {
      const { promptProjectType } = require('../../../commands/app/scaffold');

      const result = await promptProjectType(false);

      expect(mockPrompt).not.toHaveBeenCalled();
      expect(result).toBe('oauth');
    });
  });
});
