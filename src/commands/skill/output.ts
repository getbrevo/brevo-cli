import { logSuccess, logInfo, logWarn } from '../../lib/logger';
import { messages } from '../../lang/en';
import { CliError } from '../../lib/errors';
import { CLI_VERSION } from '../../lib/cli-version';
import { jsonOutput } from '../../lib/json-output';
import { InstallResult, InstallRun, SkillAgent } from '../../services/skill';
import {
  McpRegistration,
  formatCommand,
  mcpCommandsFor,
  registerMcp,
} from '../../services/skill-mcp';

/** The options `install` and `update` share; `names` are the positional skill names. */
export interface InstallLikeOptions {
  json?: boolean;
  agent?: string;
  pin?: string;
  mcp?: boolean;
  force?: boolean;
  dryRun?: boolean;
}

function logResult(r: InstallResult, dryRun: boolean): void {
  const agents = r.agents.join(', ');
  switch (r.status) {
    case 'installed':
      if (dryRun) logInfo(`  ${messages.SKILL_WOULD_INSTALL(r.name, r.version, r.path, agents)}`);
      else logSuccess(messages.SKILL_INSTALL_SUCCESS(r.name, r.version, r.path, agents));
      return;
    case 'updated': {
      const from = r.previousVersion ?? '?';
      if (dryRun)
        logInfo(`  ${messages.SKILL_WOULD_UPDATE(r.name, from, r.version, r.path, agents)}`);
      else logSuccess(messages.SKILL_UPDATE_SUCCESS(r.name, from, r.version, r.path, agents));
      return;
    }
    case 'already-installed':
      logInfo(`  ${messages.SKILL_INSTALL_ALREADY(r.name, r.version, agents)}`);
      return;
    case 'skipped':
      switch (r.reason) {
        case 'platform':
          logInfo(`  ${messages.SKILL_SKIPPED_PLATFORM(r.name, agents, r.detail ?? '')}`);
          return;
        case 'min-cli-version':
          logWarn(messages.SKILL_SKIPPED_MIN_CLI(r.name, r.detail ?? '?', CLI_VERSION));
          return;
        case 'hash-mismatch':
          logWarn(messages.SKILL_SKIPPED_HASH(r.name, r.detail ?? ''));
          return;
        case 'download-failed':
          logWarn(messages.SKILL_SKIPPED_DOWNLOAD(r.name, r.detail ?? ''));
          return;
        case 'not-installed':
          logInfo(`  ${messages.SKILL_SKIPPED_NOT_INSTALLED(r.name)}`);
          return;
        case 'not-in-catalog':
          logInfo(`  ${messages.SKILL_SKIPPED_NOT_IN_CATALOG(r.name, r.release ?? '?')}`);
          return;
        default:
          logInfo(`  Skipped ${r.name}.`);
      }
  }
}

function logMcp(m: McpRegistration): void {
  const command = m.command ? formatCommand(m.command) : '';
  switch (m.status) {
    case 'registered':
      logSuccess(messages.SKILL_MCP_REGISTERED(m.agent, m.endpoint ?? ''));
      return;
    case 'printed':
      logInfo(`  ${messages.SKILL_MCP_PRINT(m.agent, command)}`);
      return;
    case 'failed':
      logWarn(messages.SKILL_MCP_FAILED(m.agent, command, m.detail ?? ''));
      return;
    case 'no-endpoint':
      logInfo(`  ${messages.SKILL_MCP_NO_ENDPOINT(m.agent)}`);
  }
}

/**
 * Print an install or update run, register (or print) the MCP commands, and
 * throw when a skill was refused so the process exits 1. Under `--json` one
 * document carries the run and the MCP outcome; the throw then adds nothing,
 * because the JSON error path only emits when nothing has been written yet.
 */
export function reportRun(
  run: InstallRun,
  agents: readonly SkillAgent[],
  options: InstallLikeOptions,
  extra: { otherAgentsHint?: boolean } = {},
): void {
  const wroteSomething = run.results.some(
    (r) => r.status === 'installed' || r.status === 'updated',
  );
  const mcp: McpRegistration[] =
    run.dryRun || !wroteSomething
      ? []
      : options.mcp
        ? agents.map((agent) => registerMcp(agent, run.mcp))
        : mcpCommandsFor(agents, run.mcp);

  if (options.json) {
    jsonOutput({ ...run, mcp: mcp.length ? mcp : undefined, catalogMcp: run.mcp });
    if (run.failed) throw new CliError(messages.SKILL_RUN_FAILED);
    return;
  }

  for (const warning of run.warnings) logWarn(warning);
  for (const r of run.results) logResult(r, run.dryRun);
  if (run.dryRun) logInfo(`\n  ${messages.SKILL_DRY_RUN_NOTE}`);

  // The MCP server is optional; without --mcp the command is printed once per
  // agent that has an endpoint, and silence is the right answer when none does.
  for (const m of mcp) {
    if (m.status !== 'no-endpoint' || options.mcp) logMcp(m);
  }

  if (extra.otherAgentsHint && wroteSomething && !run.dryRun) {
    logInfo(`\n  ${messages.SKILL_INSTALL_OTHER_AGENTS}`);
  }

  if (run.failed) throw new CliError(messages.SKILL_RUN_FAILED);
}
