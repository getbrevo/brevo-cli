import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

import type { CatalogMcp } from './skill-catalog';
import { AGENT_PLATFORM, SkillAgent } from './skill';

// ──────────────── MCP registration ────────────────
// Each agent CLI has its own `mcp add`. The CLI runs it when the binary is on
// the PATH and otherwise prints it, so a user whose agent lives somewhere the
// CLI cannot see still gets the exact command. Registration is never required:
// every agent also connects through its own settings file.

/** The agent binary each `mcp add` goes through. */
const AGENT_BINARY: Record<SkillAgent, string> = {
  claude: 'claude',
  codex: 'codex',
  gemini: 'gemini',
};

export interface McpRegistration {
  agent: SkillAgent;
  /** The catalog endpoint for the agent's platform; absent when the catalog has none. */
  endpoint?: string;
  /** The command, argv-style, that registers the server for this agent. */
  command?: string[];
  status: 'registered' | 'printed' | 'failed' | 'no-endpoint';
  /** Why it failed, when it did. */
  detail?: string;
}

/**
 * The `mcp add` invocation for one agent, as argv. Claude Code and Gemini CLI default to a
 * per-project scope (Gemini refuses it in an untrusted folder), so both ask for the user
 * scope; Codex has a single global config.
 */
export function mcpAddCommand(agent: SkillAgent, serverName: string, endpoint: string): string[] {
  switch (agent) {
    case 'claude':
      return [
        'claude',
        'mcp',
        'add',
        '--scope',
        'user',
        '--transport',
        'http',
        serverName,
        endpoint,
      ];
    case 'codex':
      return ['codex', 'mcp', 'add', serverName, '--url', endpoint];
    case 'gemini':
      return [
        'gemini',
        'mcp',
        'add',
        '--scope',
        'user',
        '--transport',
        'http',
        serverName,
        endpoint,
      ];
  }
}

/** One shell-ready line for printing; every argument here is a plain token. */
export function formatCommand(argv: readonly string[]): string {
  return argv
    .map((a) => (/^[A-Za-z0-9_./:@=%-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`))
    .join(' ');
}

/**
 * The absolute path of `binary` on the PATH, or undefined. Only absolute PATH
 * entries count: a relative or empty entry (`.`, or the empty string Windows
 * reads as the current directory) would let a file planted in the working
 * directory stand in for the agent's CLI. On win32 the PATHEXT extensions are
 * tried, bare name first, so the caller can see what kind of file it found.
 */
export function resolveOnPath(
  binary: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const dirs = (env.PATH ?? '').split(path.delimiter).filter((dir) => path.isAbsolute(dir));
  const names =
    platform === 'win32'
      ? [binary, ...(env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').map((ext) => binary + ext)]
      : [binary];
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        // not here
      }
    }
  }
  return undefined;
}

/** True when `binary` resolves on the PATH (see {@link resolveOnPath}). */
export function isOnPath(binary: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveOnPath(binary, env) !== undefined;
}

export interface RegisterMcpOptions {
  /** PATH probe returning the absolute path to run; tests stub it. */
  resolve?: (binary: string) => string | undefined;
  /** Runs the command, `argv[0]` being that absolute path; tests stub it. */
  run?: (argv: string[]) => { status: number | null; output: string };
  /** The platform the `.cmd`/`.bat` rule is decided for; tests stub it. */
  platform?: NodeJS.Platform;
}

function runCommand(argv: string[]): { status: number | null; output: string } {
  const [bin, ...args] = argv;
  const result = spawnSync(bin!, args, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    windowsHide: true,
  });
  const output = [result.stdout, result.stderr, result.error?.message]
    .filter(Boolean)
    .join('\n')
    .trim();
  return { status: result.error ? null : result.status, output };
}

/**
 * Register the catalog's MCP server with one agent, or produce the command to
 * do it by hand. Only the agent's own CLI is ever executed, by the absolute
 * path it resolved to, with the catalog's `https://` endpoint as an argument
 * and no shell in between.
 */
export function registerMcp(
  agent: SkillAgent,
  mcp: CatalogMcp | undefined,
  options: RegisterMcpOptions = {},
): McpRegistration {
  const endpoint = mcp?.endpoints[AGENT_PLATFORM[agent]];
  if (!mcp || !endpoint) return { agent, status: 'no-endpoint' };

  const command = mcpAddCommand(agent, mcp.serverName, endpoint);
  const resolved = (options.resolve ?? resolveOnPath)(AGENT_BINARY[agent]);
  if (!resolved) {
    return { agent, endpoint, command, status: 'printed' };
  }
  // On Windows a `.cmd`/`.bat` launcher (how npm installs the agent CLIs) only
  // runs through cmd.exe, and handing an argument list to a shell is exactly
  // what this code avoids. Those are printed for the user to run; a real
  // `.exe` is executed directly.
  const platform = options.platform ?? process.platform;
  if (platform === 'win32' && !resolved.toLowerCase().endsWith('.exe')) {
    return { agent, endpoint, command, status: 'printed' };
  }
  // The resolved absolute path is what gets spawned, never the bare name, so
  // the OS does no lookup of its own (CreateProcess would search the current
  // directory first).
  const result = (options.run ?? runCommand)([resolved, ...command.slice(1)]);
  if (result.status === 0) return { agent, endpoint, command, status: 'registered' };
  return {
    agent,
    endpoint,
    command,
    status: 'failed',
    detail: result.output || `exit code ${result.status ?? 'unknown'}`,
  };
}

/** The command each agent would run, for printing when `--mcp` was not passed. */
export function mcpCommandsFor(
  agents: readonly SkillAgent[],
  mcp: CatalogMcp | undefined,
): McpRegistration[] {
  return agents.map((agent) => {
    const endpoint = mcp?.endpoints[AGENT_PLATFORM[agent]];
    if (!mcp || !endpoint) return { agent, status: 'no-endpoint' as const };
    return {
      agent,
      endpoint,
      command: mcpAddCommand(agent, mcp.serverName, endpoint),
      status: 'printed' as const,
    };
  });
}
