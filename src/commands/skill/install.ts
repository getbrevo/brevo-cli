import { logSuccess, logInfo } from '../../lib/logger';
import { messages } from '../../lang/en';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { skillService } from '../../services/skill';

export const installCommand = withCommandHandler(
  async (options: { json?: boolean }): Promise<void> => {
    const results = skillService.installAll();

    if (options.json) {
      jsonOutput(results);
      return;
    }

    let installedFresh = false;
    for (const r of results) {
      if (r.status === 'already-installed') {
        logInfo(`\n  ${messages.SKILL_INSTALL_ALREADY(r.name, r.version)}`);
      } else {
        logSuccess(messages.SKILL_INSTALL_SUCCESS(r.name, r.version, r.path));
        installedFresh = true;
      }
    }

    if (installedFresh) {
      logInfo(`\n  ${messages.SKILL_INSTALL_CLAUDE_ONLY}`);
    }
  },
);
