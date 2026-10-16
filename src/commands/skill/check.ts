import { logInfo, logSuccess, logWarn } from '../../lib/logger';
import { messages } from '../../lang/en';
import { CliError } from '../../lib/errors';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { skillService } from '../../services/skill';

export const checkCommand = withCommandHandler(
  async (options: { json?: boolean }): Promise<void> => {
    const run = await skillService.check();

    if (options.json) {
      jsonOutput(run);
    } else {
      if (run.catalog.source === 'none') {
        logWarn(messages.SKILL_LIST_NO_CATALOG(run.catalog.error ?? 'unknown error'));
      }
      for (const r of run.results) {
        if (r.tampered) logWarn(messages.SKILL_CHECK_TAMPERED(r.name, r.path));
        if (r.outdated) {
          logWarn(messages.SKILL_CHECK_OUTDATED(r.name, r.version, r.latestVersion ?? '?', r.path));
        }
        if (r.unverified && !r.outdated)
          logInfo(`  ${messages.SKILL_CHECK_UNVERIFIED(r.name, r.path)}`);
        if (!r.tampered && !r.outdated && !r.unverified) {
          logInfo(`  ${messages.SKILL_CHECK_CURRENT(r.name, r.version, r.path)}`);
        }
      }
      if (run.ok) logSuccess(messages.SKILL_CHECK_OK(run.results.length));
    }

    if (!run.ok) {
      throw new CliError(
        messages.SKILL_CHECK_FAILED(
          run.results.filter((r) => r.outdated).length,
          run.results.filter((r) => r.tampered).length,
        ),
      );
    }
  },
);
