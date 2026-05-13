import { logSuccess } from '../../lib/logger';
import { messages } from '../../lang/en';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { skillService } from '../../services/skill';

export const uninstallCommand = withCommandHandler(
  async (options: { name: string; json?: boolean }): Promise<void> => {
    const result = skillService.uninstall(options.name);

    if (options.json) {
      jsonOutput({ uninstalled: true, ...result });
      return;
    }

    logSuccess(messages.SKILL_UNINSTALL_SUCCESS(result.name, result.path));
  },
);
