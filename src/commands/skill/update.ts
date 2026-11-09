import { logInfo } from '../../lib/logger';
import { messages } from '../../lang/en';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { parseSkillAgents, skillService } from '../../services/skill';
import { InstallLikeOptions, reportRun } from './output';

export interface SkillUpdateOptions extends InstallLikeOptions {
  /** Skill names; empty means every installed skill. */
  names?: string[];
}

export const updateCommand = withCommandHandler(
  async (options: SkillUpdateOptions): Promise<void> => {
    const agents = parseSkillAgents(options.agent);
    const run = await skillService.update(options.names ?? [], {
      agents,
      pin: options.pin,
      force: options.force,
      dryRun: options.dryRun,
    });
    if (run.results.length === 0) {
      if (options.json) jsonOutput(run);
      else logInfo(`\n  ${messages.SKILL_UPDATE_NONE}`);
      return;
    }
    reportRun(run, agents, options);
  },
);
