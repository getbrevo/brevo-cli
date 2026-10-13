import { logSuccess, logInfo } from '../../lib/logger';
import { messages } from '../../lang/en';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { parseSkillAgents, skillService } from '../../services/skill';

export const installCommand = withCommandHandler(
  async (options: { json?: boolean; agent?: string }): Promise<void> => {
    const agents = parseSkillAgents(options.agent);
    const results = skillService.installAll({ agents });

    if (options.json) {
      jsonOutput(results);
      return;
    }

    let installedFresh = false;
    for (const r of results) {
      if (r.status === 'already-installed') {
        logInfo(`\n  ${messages.SKILL_INSTALL_ALREADY(r.name, r.version)}`);
      } else {
        logSuccess(messages.SKILL_INSTALL_SUCCESS(r.name, r.version, r.path, r.agents.join(', ')));
        installedFresh = true;
      }
    }

    // Only the default (Claude Code) install needs the pointer to the other agents.
    if (installedFresh && options.agent === undefined) {
      logInfo(`\n  ${messages.SKILL_INSTALL_OTHER_AGENTS}`);
    }
  },
);
