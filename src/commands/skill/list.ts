import { logInfo } from '../../lib/logger';
import { messages } from '../../lang/en';
import { CLI } from '../../lib/constants';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { skillService } from '../../services/skill';

export const listCommand = withCommandHandler(
  async (options: { json?: boolean }): Promise<void> => {
    const skills = skillService.list();

    if (options.json) {
      jsonOutput(
        skills.map((s) =>
          s.installed
            ? {
                name: s.name,
                description: s.description,
                version: s.version,
                installed: true,
                installedVersion: s.installedVersion,
                upgradable: s.upgradable,
                path: s.path,
              }
            : {
                name: s.name,
                description: s.description,
                version: s.version,
                installed: false,
              },
        ),
      );
      return;
    }

    if (skills.length === 0) {
      logInfo(`\n  ${messages.SKILL_LIST_EMPTY}\n`);
      return;
    }

    logInfo(`\n  ${messages.SKILL_LIST_HEADER}\n`);
    for (const s of skills) {
      const status = !s.installed
        ? messages.SKILL_STATUS_NOT_INSTALLED
        : s.upgradable
          ? messages.SKILL_STATUS_UPGRADABLE(s.installedVersion, s.version)
          : messages.SKILL_STATUS_INSTALLED(s.installedVersion);
      process.stdout.write(`  ${s.name}  (v${s.version})  —  ${status}\n`);
      process.stdout.write(`    ${s.description}\n\n`);
    }
    logInfo(`  ${messages.SKILL_LIST_HINT(CLI.SKILL_INSTALL())}\n`);
  },
);
