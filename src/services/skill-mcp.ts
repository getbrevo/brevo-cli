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

/** The `mcp add` invocation for one agent, as argv. */
export function mcpAddCommand(agent: SkillAgent, serverName: string, endpoint: string): string[] {
  switch (agent) {
    case 'claude':
      return ['claude', 'mcp', 'add', '--transport', 'http', serverName, endpoint];
    case 'codex':
      return ['codex', 'mcp', 'add', serverName, '--url', endpoint];
    case 'gemini':
      return ['gemini', 'mcp', 'add', '--transport', 'http', serverName, endpoint];
  }
}

/** One shell-ready line for printing; every argument here is a plain token. */
export function formatCommand(argv: readonly string[]): string {
  return argv
    .map((a) => (/^[A-Za-z0-9_./:@=%-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`))
    .join(' ');
}

/** True when `binary` resolves on the PATH (with the Windows extensions on win32). */
export function isOnPath(binary: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const dirs = (env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const names =
    process.platform === 'win32'
      ? [binary, ...(env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').map((ext) => binary + ext)]
      : [binary];
  for (const dir of dirs) {
    for (const name of names) {
      try {
        const stat = fs.statSync(path.join(dir, name));
        if (stat.isFile()) return true;
      } catch {
        // not here
      }
    }
  }
  return false;
}

export interface RegisterMcpOptions {
  /** PATH probe; tests stub it. */
  isOnPath?: (binary: string) => boolean;
  /** Runs the command; tests stub it. Returns the exit status and combined output. */
  run?: (argv: string[]) => { status: number | null; output: string };
}

function runCommand(argv: string[]): { status: number | null; output: string } {
  const [bin, ...args] = argv;
  const result = spawnSync(bin!, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  const output = [result.stdout, result.stderr, result.error?.message]
    .filter(Boolean)
    .join('\n')
    .trim();
  return { status: result.error ? null : result.status, output };
}

/**
 * Register the catalog's MCP server with one agent, or produce the command to
 * do it by hand. Only the agent's own CLI is ever executed, with the catalog's
 * `https://` endpoint as an argument and no shell in between.
 */
export function registerMcp(
  agent: SkillAgent,
  mcp: CatalogMcp | undefined,
  options: RegisterMcpOptions = {},
): McpRegistration {
  const endpoint = mcp?.endpoints[AGENT_PLATFORM[agent]];
  if (!mcp || !endpoint) return { agent, status: 'no-endpoint' };

  const command = mcpAddCommand(agent, mcp.serverName, endpoint);
  const onPath = options.isOnPath ?? isOnPath;
  if (!onPath(AGENT_BINARY[agent])) {
    return { agent, endpoint, command, status: 'printed' };
  }
  const result = (options.run ?? runCommand)(command);
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
