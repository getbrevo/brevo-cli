import { logSuccess, logInfo } from '../../lib/logger';
import { messages } from '../../lang/en';
import { CLI } from '../../lib/constants';
import { CliError } from '../../lib/errors';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { skillService, InstallResult } from '../../services/skill';

export const installCommand = withCommandHandler(
  async (options: {
    name?: string;
    all?: boolean;
    force?: boolean;
    json?: boolean;
  }): Promise<void> => {
    if (!options.name && !options.all) {
      throw new CliError(messages.SKILL_INSTALL_MISSING_NAME(CLI.SKILL_LIST));
    }

    const force = Boolean(options.force);
    const results: InstallResult[] = options.all
      ? skillService.installAll({ force })
      : [skillService.install(options.name as string, { force })];

    if (options.json) {
      jsonOutput(results);
      return;
    }

    for (const r of results) {
      if (r.status === 'already-installed') {
        logInfo(
          `\n  ${messages.SKILL_INSTALL_ALREADY(r.name, r.version, CLI.SKILL_UPDATE(r.name))}`,
        );
      } else if (r.status === 'overwritten') {
        logSuccess(messages.SKILL_INSTALL_OVERWRITTEN(r.name, r.version, r.path));
      } else {
        logSuccess(messages.SKILL_INSTALL_SUCCESS(r.name, r.version, r.path));
      }
    }
    if (options.all) {
      logInfo(`\n  ${messages.SKILL_INSTALL_ALL_DONE(results.length)}\n`);
    }
  },
);
