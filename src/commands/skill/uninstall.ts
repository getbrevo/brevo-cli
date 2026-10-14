import { logSuccess, logInfo } from '../../lib/logger';
import { messages } from '../../lang/en';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { parseSkillAgents, skillService } from '../../services/skill';

export interface SkillUninstallOptions {
  json?: boolean;
  agent?: string;
  /** Skill names; empty means every skill the CLI installed. */
  names?: string[];
}

export const uninstallCommand = withCommandHandler(
  async (options: SkillUninstallOptions): Promise<void> => {
    // Without --agent, remove every copy the CLI installed, whichever agent it was for.
    const agents = options.agent === undefined ? undefined : parseSkillAgents(options.agent);
    const results = skillService.uninstall(options.names ?? [], { agents });

    if (options.json) {
      jsonOutput(results.map((r) => ({ uninstalled: r.status === 'removed', ...r })));
      return;
    }

    if (results.length === 0) {
      logInfo(`\n  ${messages.SKILL_UNINSTALL_NONE}`);
      return;
    }

    for (const r of results) {
      if (r.status === 'removed') {
        logSuccess(messages.SKILL_UNINSTALL_SUCCESS(r.name, r.path, r.agents.join(', ')));
      } else {
        logInfo(`  ${messages.SKILL_UNINSTALL_NOT_OURS(r.name, r.path)}`);
      }
    }
  },
);
