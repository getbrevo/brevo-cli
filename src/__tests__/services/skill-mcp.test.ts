import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  formatCommand,
  isOnPath,
  mcpAddCommand,
  mcpCommandsFor,
  registerMcp,
  resolveOnPath,
} from '../../services/skill-mcp';
import { validateCatalog } from '../../services/skill-catalog';
import { makeCatalog } from './skill-fixtures';

const SANDBOX_ROOT = path.join(__dirname, '__sandbox__');

describe('services/skill-mcp', () => {
  const mcp = validateCatalog(makeCatalog()).mcp!;

  describe('mcpAddCommand', () => {
    it('builds each agent CLI invocation', () => {
      expect(mcpAddCommand('claude', 'brevo', 'https://x/claude')).toEqual([
        'claude',
        'mcp',
        'add',
        '--scope',
        'user',
        '--transport',
        'http',
        'brevo',
        'https://x/claude',
      ]);
      expect(mcpAddCommand('codex', 'brevo', 'https://x/openai')).toEqual([
        'codex',
        'mcp',
        'add',
        'brevo',
        '--url',
        'https://x/openai',
      ]);
      expect(mcpAddCommand('gemini', 'brevo', 'https://x/gemini')).toEqual([
        'gemini',
        'mcp',
        'add',
        '--scope',
        'user',
        '--transport',
        'http',
        'brevo',
        'https://x/gemini',
      ]);
    });
  });

  describe('formatCommand', () => {
    it('prints plain tokens bare and quotes the rest', () => {
      expect(formatCommand(['claude', 'mcp', 'add', 'https://x/y?a=1'])).toBe(
        "claude mcp add 'https://x/y?a=1'",
      );
      expect(formatCommand(["it's"])).toBe("'it'\\''s'");
    });
  });

  describe('resolveOnPath / isOnPath', () => {
    it('returns the absolute path of a file in an absolute PATH directory, and nothing otherwise', () => {
      fs.mkdirSync(SANDBOX_ROOT, { recursive: true });
      const dir = fs.mkdtempSync(path.join(SANDBOX_ROOT, 'brevo-path-'));
      try {
        fs.writeFileSync(path.join(dir, 'claude'), '#!/bin/sh\n');
        fs.mkdirSync(path.join(dir, 'codex'));
        const env = { PATH: `${path.join(dir, 'missing')}${path.delimiter}${dir}` };
        expect(resolveOnPath('claude', env)).toBe(path.join(dir, 'claude'));
        expect(isOnPath('claude', env)).toBe(true);
        expect(resolveOnPath('codex', env)).toBeUndefined(); // a directory is not a binary
        expect(isOnPath('gemini', env)).toBe(false);
        expect(isOnPath('claude', {})).toBe(false);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('ignores relative, empty and `.` PATH entries', () => {
      const dir = fs.mkdtempSync(path.join(SANDBOX_ROOT, 'brevo-path-'));
      const cwd = process.cwd();
      try {
        fs.writeFileSync(path.join(dir, 'claude'), '#!/bin/sh\n');
        process.chdir(dir);
        const relative = path.relative(process.cwd(), dir) || '.';
        const env = { PATH: ['', '.', relative, 'bin'].join(path.delimiter) };
        expect(resolveOnPath('claude', env)).toBeUndefined();
        expect(resolveOnPath('claude', { PATH: dir })).toBe(path.join(dir, 'claude'));
      } finally {
        process.chdir(cwd);
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('tries the PATHEXT extensions on win32', () => {
      const dir = fs.mkdtempSync(path.join(SANDBOX_ROOT, 'brevo-path-'));
      try {
        // Named with the upper-case extension the default PATHEXT lists, so the lookup also
        // matches on a case-sensitive (Linux) filesystem; Windows matches either case.
        fs.writeFileSync(path.join(dir, 'claude.CMD'), '@echo off\n');
        expect(resolveOnPath('claude', { PATH: dir }, 'win32')?.toLowerCase()).toBe(
          path.join(dir, 'claude.cmd').toLowerCase(),
        );
        expect(resolveOnPath('claude', { PATH: dir, PATHEXT: '.EXE' }, 'win32')).toBeUndefined();
        expect(resolveOnPath('claude', { PATH: dir }, 'linux')).toBeUndefined();
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('registerMcp', () => {
    const CLAUDE_BIN = path.join(path.sep, 'opt', 'agents', 'bin', 'claude');

    it('spawns the resolved absolute path, never the bare name', () => {
      const run = jest.fn(() => ({ status: 0, output: 'Added' }));
      const result = registerMcp('claude', mcp, { resolve: () => CLAUDE_BIN, run });
      expect(run).toHaveBeenCalledWith([
        CLAUDE_BIN,
        'mcp',
        'add',
        '--scope',
        'user',
        '--transport',
        'http',
        'brevo',
        'https://mcp.brevo.example/claude',
      ]);
      expect(result).toMatchObject({
        agent: 'claude',
        status: 'registered',
        endpoint: 'https://mcp.brevo.example/claude',
      });
      // The command reported to the user keeps the plain name.
      expect(result.command?.[0]).toBe('claude');
    });

    it('prints the command when the agent CLI is not on the PATH', () => {
      const run = jest.fn();
      const result = registerMcp('codex', mcp, { resolve: () => undefined, run });
      expect(run).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        status: 'printed',
        command: ['codex', 'mcp', 'add', 'brevo', '--url', 'https://mcp.brevo.example/openai'],
      });
    });

    it('on win32 runs an .exe but prints a .cmd or .bat launcher', () => {
      const run = jest.fn(() => ({ status: 0, output: '' }));
      expect(
        registerMcp('claude', mcp, {
          resolve: () => 'C:\\agents\\claude.CMD',
          run,
          platform: 'win32',
        }).status,
      ).toBe('printed');
      expect(
        registerMcp('claude', mcp, {
          resolve: () => 'C:\\agents\\claude.bat',
          run,
          platform: 'win32',
        }).status,
      ).toBe('printed');
      expect(run).not.toHaveBeenCalled();
      expect(
        registerMcp('claude', mcp, {
          resolve: () => 'C:\\agents\\claude.exe',
          run,
          platform: 'win32',
        }).status,
      ).toBe('registered');
      expect(run).toHaveBeenCalledWith(expect.arrayContaining(['C:\\agents\\claude.exe']));
      // Off Windows an extensionless binary runs.
      expect(
        registerMcp('claude', mcp, { resolve: () => CLAUDE_BIN, run, platform: 'linux' }).status,
      ).toBe('registered');
    });

    it('reports a non-zero exit with the output', () => {
      const result = registerMcp('gemini', mcp, {
        resolve: () => CLAUDE_BIN,
        run: () => ({ status: 2, output: 'boom' }),
      });
      expect(result).toMatchObject({ status: 'failed', detail: 'boom' });
      const silent = registerMcp('gemini', mcp, {
        resolve: () => CLAUDE_BIN,
        run: () => ({ status: null, output: '' }),
      });
      expect(silent.detail).toBe('exit code unknown');
    });

    it('has nothing to register without an endpoint or an mcp block', () => {
      expect(registerMcp('claude', undefined)).toEqual({ agent: 'claude', status: 'no-endpoint' });
      expect(
        registerMcp('gemini', { serverName: 'brevo', endpoints: { claude: 'https://x' } }),
      ).toEqual({
        agent: 'gemini',
        status: 'no-endpoint',
      });
    });

    it('falls back to the real PATH probe when no stub is given', () => {
      const original = process.env.PATH;
      process.env.PATH = '';
      try {
        expect(registerMcp('claude', mcp).status).toBe('printed');
      } finally {
        process.env.PATH = original;
      }
    });

    it('runs a real command through the default runner, by absolute path and without a shell', () => {
      const result = registerMcp(
        'claude',
        { serverName: 'brevo', endpoints: { claude: 'https://x' } },
        {
          resolve: () => process.execPath, // node itself stands in for the agent CLI
          platform: 'linux',
        },
      );
      // `node mcp add --transport http brevo https://x` fails to open a script named "mcp".
      expect(result.status).toBe('failed');
      expect(result.detail).toMatch(/mcp/);
    });
  });

  describe('mcpCommandsFor', () => {
    it('lists the command per agent, or no-endpoint', () => {
      const commands = mcpCommandsFor(['claude', 'gemini'], {
        serverName: 'brevo',
        endpoints: { claude: 'https://x' },
      });
      expect(commands).toEqual([
        {
          agent: 'claude',
          endpoint: 'https://x',
          command: [
            'claude',
            'mcp',
            'add',
            '--scope',
            'user',
            '--transport',
            'http',
            'brevo',
            'https://x',
          ],
          status: 'printed',
        },
        { agent: 'gemini', status: 'no-endpoint' },
      ]);
      expect(mcpCommandsFor(['codex'], undefined)).toEqual([
        { agent: 'codex', status: 'no-endpoint' },
      ]);
    });
  });
});
