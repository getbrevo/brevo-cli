import { logSuccess, logInfo } from '../../lib/logger';
import { messages } from '../../lang/en';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { skillService } from '../../services/skill';

export const uninstallCommand = withCommandHandler(
  async (options: { json?: boolean }): Promise<void> => {
    const results = skillService.uninstallAll();

    if (options.json) {
      jsonOutput(results.map((r) => ({ uninstalled: true, ...r })));
      return;
    }

    if (results.length === 0) {
      logInfo(`\n  ${messages.SKILL_UNINSTALL_NONE}`);
      return;
    }

    for (const r of results) {
      logSuccess(messages.SKILL_UNINSTALL_SUCCESS(r.name, r.path));
    }
  },
);
