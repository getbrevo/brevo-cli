import * as fs from 'node:fs';
import { startCommand } from '../../../commands/app/start';

jest.mock('node:fs');
jest.mock('node:child_process', () => ({
  spawn: jest.fn(),
}));

jest.mock('inquirer', () => ({
  __esModule: true,
  default: { prompt: jest.fn() },
}));

jest.mock('../../../lib/logger', () => ({
  logInfo: jest.fn(),
  logSuccess: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

jest.mock('../../../lib/ui', () => ({
  createSpinner: jest.fn(() => ({ update: jest.fn(), stop: jest.fn() })),
}));

jest.mock('../../../lib/config', () => ({
  getApiKey: jest.fn().mockReturnValue('test-key'),
  readProjectConfig: jest.fn().mockReturnValue(null),
  writeProjectConfig: jest.fn(),
}));

jest.mock('../../../container', () => ({
  appService: { updateApp: jest.fn().mockResolvedValue(undefined) },
  accountService: { validateApiKey: jest.fn(), getAccount: jest.fn() },
  client: {},
}));

jest.mock('../../../lib/port', () => ({
  isPortAvailable: jest.fn().mockResolvedValue(true),
}));

import { spawn } from 'node:child_process';
import { EventEmitter } from 'events';
import inquirer from 'inquirer';
import { isPortAvailable } from '../../../lib/port';
import { readProjectConfig, writeProjectConfig } from '../../../lib/config';
import { logWarn } from '../../../lib/logger';
import { appService } from '../../../container';

const mockPrompt = inquirer.prompt as unknown as jest.Mock;
const mockUpdateApp = appService.updateApp as jest.Mock;

describe('app/start', () => {
  let stdoutSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;
  let originalRedirectUri: string | undefined;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    // Strip any ambient REDIRECT_URI so tests can deterministically assert
    // whether the start command itself injected it into the spawn env.
    originalRedirectUri = process.env.REDIRECT_URI;
    delete process.env.REDIRECT_URI;
    jest.clearAllMocks();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    if (originalRedirectUri === undefined) {
      delete process.env.REDIRECT_URI;
    } else {
      process.env.REDIRECT_URI = originalRedirectUri;
    }
  });

  const getSpawnEnv = (): NodeJS.ProcessEnv =>
    (spawn as unknown as jest.Mock).mock.calls[0][2].env as NodeJS.ProcessEnv;

  it('should throw when no feature name is provided', async () => {
    await expect(startCommand({})).rejects.toThrow('Missing feature name');
  });

  it('should throw for unknown feature', async () => {
    await expect(startCommand({ feature: 'unknown-feature' })).rejects.toThrow('Unknown feature');
  });

  it('should throw when entry file does not exist', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);

    await expect(startCommand({ feature: 'oauth' })).rejects.toThrow('not found');
  });

  it('should throw when node_modules is missing', async () => {
    (fs.existsSync as jest.Mock)
      .mockReturnValueOnce(true) // entry file exists
      .mockReturnValueOnce(false); // node_modules missing

    await expect(startCommand({ feature: 'oauth' })).rejects.toThrow('yarn');
  });

  it('should throw detailed error when default port is in use', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (isPortAvailable as jest.Mock).mockResolvedValueOnce(false);

    await expect(startCommand({ feature: 'oauth' })).rejects.toThrow(
      'brevo app update --redirect-uri',
    );
  });

  it('should throw simple error when custom --port is in use', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (isPortAvailable as jest.Mock).mockResolvedValueOnce(false);

    await expect(startCommand({ feature: 'oauth', port: 4000 })).rejects.toThrow('redirect URL');
  });

  it('should spawn the oauth server process', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);

    const mockChild = new EventEmitter() as EventEmitter & { kill: jest.Mock };
    mockChild.kill = jest.fn();
    (spawn as unknown as jest.Mock).mockReturnValue(mockChild);

    const promise = startCommand({ feature: 'oauth', port: 4000 });

    // Simulate successful exit
    process.nextTick(() => mockChild.emit('close', 0));

    await promise;

    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      [expect.stringContaining('oauth/server.js')],
      expect.objectContaining({
        stdio: 'inherit',
        env: expect.objectContaining({ PORT: '4000' }),
      }),
    );
    // No linked app → no REDIRECT_URI injected by the start command.
    expect(getSpawnEnv().REDIRECT_URI).toBeUndefined();
  });

  it('should reject when child process exits with non-zero code', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);

    const mockChild = new EventEmitter() as EventEmitter & { kill: jest.Mock };
    mockChild.kill = jest.fn();
    (spawn as unknown as jest.Mock).mockReturnValue(mockChild);

    const promise = startCommand({ feature: 'oauth' });

    process.nextTick(() => mockChild.emit('close', 1));

    await expect(promise).rejects.toThrow('exited with code 1');
  });

  it('should derive port from app-config.json redirect URI', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (readProjectConfig as jest.Mock).mockReturnValueOnce({
      appId: '42',
      appName: 'Test',
      auth: { type: 'oauth', scopes: [], redirectUrls: ['http://localhost:3010/auth/callback'] },
    });

    const mockChild = new EventEmitter() as EventEmitter & { kill: jest.Mock };
    mockChild.kill = jest.fn();
    (spawn as unknown as jest.Mock).mockReturnValue(mockChild);

    const promise = startCommand({ feature: 'oauth' });
    process.nextTick(() => mockChild.emit('close', 0));
    await promise;

    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({
          PORT: '3010',
          REDIRECT_URI: 'http://localhost:3010/auth/callback',
        }),
      }),
    );
  });

  it('should default to port 3009', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);

    const mockChild = new EventEmitter() as EventEmitter & { kill: jest.Mock };
    mockChild.kill = jest.fn();
    (spawn as unknown as jest.Mock).mockReturnValue(mockChild);

    const promise = startCommand({ feature: 'oauth' });
    process.nextTick(() => mockChild.emit('close', 0));
    await promise;

    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({ PORT: '3009' }),
      }),
    );
    expect(getSpawnEnv().REDIRECT_URI).toBeUndefined();
  });

  it('should forward ambient REDIRECT_URI unchanged when no app is linked', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    process.env.REDIRECT_URI = 'http://localhost:9999/ambient';

    const mockChild = new EventEmitter() as EventEmitter & { kill: jest.Mock };
    mockChild.kill = jest.fn();
    (spawn as unknown as jest.Mock).mockReturnValue(mockChild);

    const promise = startCommand({ feature: 'oauth', port: 4000 });
    process.nextTick(() => mockChild.emit('close', 0));
    await promise;

    // No linked app → start command must not touch REDIRECT_URI; the
    // ambient value (typically loaded from .env.local) is forwarded as-is.
    expect(getSpawnEnv().REDIRECT_URI).toBe('http://localhost:9999/ambient');
  });

  describe('redirect-URL self-registration', () => {
    const ttyConfig = (
      redirectUrls: string[] = [],
      overrides: Partial<{ appId: string }> = {},
    ): Record<string, unknown> => ({
      appId: '42',
      appName: 'Test',
      auth: { type: 'oauth', scopes: [], redirectUrls },
      ...overrides,
    });

    let originalIsTTY: boolean | undefined;

    beforeEach(() => {
      originalIsTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
      (fs.existsSync as jest.Mock).mockReturnValue(true);
    });

    afterEach(() => {
      Object.defineProperty(process.stdin, 'isTTY', {
        value: originalIsTTY,
        configurable: true,
      });
    });

    it('should not prompt when redirect URL matches the resolved port', async () => {
      (readProjectConfig as jest.Mock).mockReturnValueOnce(
        ttyConfig(['http://localhost:3010/auth/callback']),
      );

      const mockChild = new EventEmitter() as EventEmitter & { kill: jest.Mock };
      mockChild.kill = jest.fn();
      (spawn as unknown as jest.Mock).mockReturnValue(mockChild);

      const promise = startCommand({ feature: 'oauth' });
      process.nextTick(() => mockChild.emit('close', 0));
      await promise;

      expect(mockPrompt).not.toHaveBeenCalled();
      expect(mockUpdateApp).not.toHaveBeenCalled();
      expect(writeProjectConfig).not.toHaveBeenCalled();
      expect(getSpawnEnv().REDIRECT_URI).toBe('http://localhost:3010/auth/callback');
    });

    it('should treat 127.0.0.1 as a localhost match and propagate it as-is', async () => {
      (readProjectConfig as jest.Mock).mockReturnValueOnce(
        ttyConfig(['http://127.0.0.1:4000/auth/callback']),
      );

      const mockChild = new EventEmitter() as EventEmitter & { kill: jest.Mock };
      mockChild.kill = jest.fn();
      (spawn as unknown as jest.Mock).mockReturnValue(mockChild);

      const promise = startCommand({ feature: 'oauth', port: 4000 });
      process.nextTick(() => mockChild.emit('close', 0));
      await promise;

      expect(mockPrompt).not.toHaveBeenCalled();
      // The matched URL is forwarded verbatim — Brevo does exact-string matching
      // on redirect_uri, so we must not normalise 127.0.0.1 → localhost.
      expect(getSpawnEnv().REDIRECT_URI).toBe('http://127.0.0.1:4000/auth/callback');
    });

    it('should prompt and register the new URL when no match exists (yes path)', async () => {
      (readProjectConfig as jest.Mock).mockReturnValueOnce(
        ttyConfig(['https://prod.example.com/cb']),
      );
      mockPrompt.mockResolvedValueOnce({ shouldRegister: true });

      const mockChild = new EventEmitter() as EventEmitter & { kill: jest.Mock };
      mockChild.kill = jest.fn();
      (spawn as unknown as jest.Mock).mockReturnValue(mockChild);

      const promise = startCommand({ feature: 'oauth', port: 4000 });
      process.nextTick(() => mockChild.emit('close', 0));
      await promise;

      expect(mockPrompt).toHaveBeenCalledTimes(1);
      expect(mockUpdateApp).toHaveBeenCalledWith('42', {
        redirect_uris: ['https://prod.example.com/cb', 'http://localhost:4000/auth/callback'],
      });
      expect(writeProjectConfig).toHaveBeenCalledTimes(1);
      const written = (writeProjectConfig as jest.Mock).mock.calls[0][0];
      expect(written.auth.redirectUrls).toEqual([
        'https://prod.example.com/cb',
        'http://localhost:4000/auth/callback',
      ]);
      // The freshly-registered URL is also forwarded to the child server so
      // the OAuth callback uses the same port the listener is bound to.
      expect(getSpawnEnv().REDIRECT_URI).toBe('http://localhost:4000/auth/callback');
    });

    it('should warn and continue without registering when user declines', async () => {
      (readProjectConfig as jest.Mock).mockReturnValueOnce(
        ttyConfig(['https://prod.example.com/cb']),
      );
      mockPrompt.mockResolvedValueOnce({ shouldRegister: false });

      const mockChild = new EventEmitter() as EventEmitter & { kill: jest.Mock };
      mockChild.kill = jest.fn();
      (spawn as unknown as jest.Mock).mockReturnValue(mockChild);

      const promise = startCommand({ feature: 'oauth', port: 4000 });
      process.nextTick(() => mockChild.emit('close', 0));
      await promise;

      expect(mockUpdateApp).not.toHaveBeenCalled();
      expect(writeProjectConfig).not.toHaveBeenCalled();
      expect(logWarn).toHaveBeenCalledWith(
        expect.stringContaining('http://localhost:4000/auth/callback'),
      );
      expect(spawn).toHaveBeenCalled();
      // Decline → don't override .env.local; the OAuth flow will still fail
      // (Brevo will reject the unregistered URL) but we leave the choice
      // visible to the user instead of silently rewriting their env.
      expect(getSpawnEnv().REDIRECT_URI).toBeUndefined();
    });

    it('should forward ambient REDIRECT_URI unchanged when user declines registration', async () => {
      (readProjectConfig as jest.Mock).mockReturnValueOnce(
        ttyConfig(['https://prod.example.com/cb']),
      );
      mockPrompt.mockResolvedValueOnce({ shouldRegister: false });
      process.env.REDIRECT_URI = 'http://localhost:9999/ambient';

      const mockChild = new EventEmitter() as EventEmitter & { kill: jest.Mock };
      mockChild.kill = jest.fn();
      (spawn as unknown as jest.Mock).mockReturnValue(mockChild);

      const promise = startCommand({ feature: 'oauth', port: 4000 });
      process.nextTick(() => mockChild.emit('close', 0));
      await promise;

      // Decline → start command must not touch REDIRECT_URI; the ambient
      // value (e.g. from .env.local) is forwarded as-is so the user sees
      // exactly what their scaffold configured, not a silent override.
      expect(getSpawnEnv().REDIRECT_URI).toBe('http://localhost:9999/ambient');
    });

    it('should hard-fail in non-TTY mode when port is not registered', async () => {
      Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
      (readProjectConfig as jest.Mock).mockReturnValueOnce(
        ttyConfig(['https://prod.example.com/cb']),
      );

      await expect(startCommand({ feature: 'oauth', port: 4000 })).rejects.toThrow(
        /not registered.*non-interactive/,
      );
      expect(mockPrompt).not.toHaveBeenCalled();
      expect(mockUpdateApp).not.toHaveBeenCalled();
    });

    it('should skip the registration check when app-config has no appId', async () => {
      // readProjectConfig returns null when appId is missing/invalid, so the
      // simplest setup is a null config — check is skipped, server starts.
      (readProjectConfig as jest.Mock).mockReturnValueOnce(null);

      const mockChild = new EventEmitter() as EventEmitter & { kill: jest.Mock };
      mockChild.kill = jest.fn();
      (spawn as unknown as jest.Mock).mockReturnValue(mockChild);

      const promise = startCommand({ feature: 'oauth', port: 4000 });
      process.nextTick(() => mockChild.emit('close', 0));
      await promise;

      expect(mockPrompt).not.toHaveBeenCalled();
      expect(mockUpdateApp).not.toHaveBeenCalled();
    });

    it('should propagate API errors from updateApp', async () => {
      (readProjectConfig as jest.Mock).mockReturnValueOnce(
        ttyConfig(['https://prod.example.com/cb']),
      );
      mockPrompt.mockResolvedValueOnce({ shouldRegister: true });
      mockUpdateApp.mockRejectedValueOnce(new Error('boom'));

      await expect(startCommand({ feature: 'oauth', port: 4000 })).rejects.toThrow('boom');
      expect(writeProjectConfig).not.toHaveBeenCalled();
      expect(spawn).not.toHaveBeenCalled();
    });
  });
});
