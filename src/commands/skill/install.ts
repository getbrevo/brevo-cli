import { withCommandHandler } from '../../lib/command-handler';
import { parseSkillAgents, skillService } from '../../services/skill';
import { InstallLikeOptions, reportRun } from './output';

export interface SkillInstallOptions extends InstallLikeOptions {
  /** Skill names; empty means every skill in the catalog. */
  names?: string[];
}

export const installCommand = withCommandHandler(
  async (options: SkillInstallOptions): Promise<void> => {
    const agents = parseSkillAgents(options.agent);
    const run = await skillService.install(options.names ?? [], {
      agents,
      pin: options.pin,
      force: options.force,
      dryRun: options.dryRun,
    });
    // Only the default (Claude Code) install needs the pointer to the other agents.
    reportRun(run, agents, options, { otherAgentsHint: options.agent === undefined });
  },
);
