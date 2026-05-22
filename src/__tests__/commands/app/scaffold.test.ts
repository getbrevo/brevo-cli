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

const mockPrompt = inquirer.prompt as unknown as jest.Mock;

describe('app/scaffold', () => {
  let stdoutSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    (fs.mkdirSync as jest.Mock).mockReturnValue(undefined);
    (fs.writeFileSync as jest.Mock).mockReturnValue(undefined);
    (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify({ version: '9.9.9' }));
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
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

    mockPrompt.mockResolvedValueOnce({ outputDir: tmpPath('test-scaffold') }); // dir prompt

    await scaffoldCommand({ appId: '1' });

    expect(appService.resolveAppCredentials).toHaveBeenCalledWith('1');
    expect(fs.mkdirSync).toHaveBeenCalled();
    expect(fs.writeFileSync).toHaveBeenCalled();

    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('scaffolded');
    expect(output).toContain('brevo app start oauth');
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

    mockPrompt.mockResolvedValueOnce({ outputDir: tmpPath('test-creds') });

    await scaffoldCommand({ appId: '1' });

    const { loadAllTemplates } = require('../../../templates');
    const vars = (loadAllTemplates as jest.Mock).mock.calls[0][0];
    expect(vars['{{CLIENT_ID}}']).toBe('api-client');
  });

  it('should pass cliVersion and minCliVersion into template vars', async () => {
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

    mockPrompt.mockResolvedValueOnce({ outputDir: tmpPath('test-version') });

    await scaffoldCommand({ appId: '1' });

    const { loadAllTemplates } = require('../../../templates');
    const vars = (loadAllTemplates as jest.Mock).mock.calls[0][0];
    expect(vars['{{CLI_VERSION}}']).toBe('9.9.9');
    expect(vars['{{MIN_CLI_VERSION}}']).toBe('0.0.0');
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

    mockPrompt.mockResolvedValueOnce({ outputDir: tmpPath('test-redirect') });

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

    mockPrompt.mockResolvedValueOnce({ outputDir: tmpPath('test-fallback') });

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

    mockPrompt.mockResolvedValueOnce({ outputDir: tmpPath('test-pick') });

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
      .mockResolvedValueOnce({ action: 'overwrite' }); // action prompt

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
      .mockResolvedValueOnce({ action: 'merge' });

    await scaffoldCommand({ appId: '1' });

    // In merge mode with all files existing, writeFileSync should not be called
    // (mkdirSync is still called for directory creation)
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('should refuse to scaffold when app-config.json exists in cwd', async () => {
    const cwdAppConfig = path.join(process.cwd(), 'app-config.json');
    (fs.existsSync as jest.Mock).mockImplementation((p: string) => p === cwdAppConfig);

    await expect(scaffoldCommand({ appId: '1' })).rejects.toThrow(/already scaffolded/i);

    expect(appService.resolveAppCredentials).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
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
      mockPrompt.mockResolvedValueOnce({ outputDir: tmpPath('test-logo') });

      await scaffoldCommand({ appId: '1' });

      const { loadAllTemplates } = require('../../../templates');
      const vars = (loadAllTemplates as jest.Mock).mock.calls[0][0];
      expect(vars['{{LOGO_URI}}']).toBe(expected);
    },
  );
});
