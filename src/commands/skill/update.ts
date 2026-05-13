import { logSuccess, logInfo } from '../../lib/logger';
import { messages } from '../../lang/en';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { skillService } from '../../services/skill';

export const updateCommand = withCommandHandler(
  async (options: { name?: string; json?: boolean }): Promise<void> => {
    const results = skillService.update(options.name);

    if (options.json) {
      jsonOutput(results);
      return;
    }

    if (results.length === 0) {
      logInfo(`\n  ${messages.SKILL_UPDATE_NO_INSTALLED}\n`);
      return;
    }

    for (const r of results) {
      logSuccess(messages.SKILL_UPDATE_SUCCESS(r.name, r.version));
    }
    if (!options.name) {
      logInfo(`\n  ${messages.SKILL_UPDATE_ALL_DONE(results.length)}\n`);
    }
  },
);
