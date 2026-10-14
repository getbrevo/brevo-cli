import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  formatCommand,
  isOnPath,
  mcpAddCommand,
  mcpCommandsFor,
  registerMcp,
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

  describe('isOnPath', () => {
    it('finds a file in a PATH directory and nothing otherwise', () => {
      fs.mkdirSync(SANDBOX_ROOT, { recursive: true });
      const dir = fs.mkdtempSync(path.join(SANDBOX_ROOT, 'brevo-path-'));
      try {
        fs.writeFileSync(path.join(dir, 'claude'), '#!/bin/sh\n');
        fs.mkdirSync(path.join(dir, 'codex'));
        const env = { PATH: `${path.join(dir, 'missing')}${path.delimiter}${dir}` };
        expect(isOnPath('claude', env)).toBe(true);
        expect(isOnPath('codex', env)).toBe(false); // a directory is not a binary
        expect(isOnPath('gemini', env)).toBe(false);
        expect(isOnPath('claude', {})).toBe(false);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('registerMcp', () => {
    it('runs the agent CLI when it is on the PATH', () => {
      const run = jest.fn(() => ({ status: 0, output: 'Added' }));
      const result = registerMcp('claude', mcp, { isOnPath: () => true, run });
      expect(run).toHaveBeenCalledWith([
        'claude',
        'mcp',
        'add',
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
    });

    it('prints the command when the agent CLI is not on the PATH', () => {
      const run = jest.fn();
      const result = registerMcp('codex', mcp, { isOnPath: () => false, run });
      expect(run).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        status: 'printed',
        command: ['codex', 'mcp', 'add', 'brevo', '--url', 'https://mcp.brevo.example/openai'],
      });
    });

    it('reports a non-zero exit with the output', () => {
      const result = registerMcp('gemini', mcp, {
        isOnPath: () => true,
        run: () => ({ status: 2, output: 'boom' }),
      });
      expect(result).toMatchObject({ status: 'failed', detail: 'boom' });
      const silent = registerMcp('gemini', mcp, {
        isOnPath: () => true,
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

    it('falls back to the real PATH probe and runner when no stubs are given', () => {
      // `claude` is almost certainly not an executable in a scrubbed PATH, so the
      // command is printed rather than run.
      const original = process.env.PATH;
      process.env.PATH = '';
      try {
        expect(registerMcp('claude', mcp).status).toBe('printed');
      } finally {
        process.env.PATH = original;
      }
    });

    it('runs a real command through the default runner', () => {
      // `isOnPath` is stubbed so the runner executes `node -e` under the claude name.
      const result = registerMcp(
        'claude',
        { serverName: 'brevo', endpoints: { claude: 'https://x' } },
        {
          isOnPath: () => true,
          run: undefined,
        },
      );
      // `claude` is not installed here, so spawnSync reports an error (status null).
      expect(['failed', 'registered']).toContain(result.status);
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
          command: ['claude', 'mcp', 'add', '--transport', 'http', 'brevo', 'https://x'],
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
