import { logInfo, logWarn } from '../../lib/logger';
import { messages } from '../../lang/en';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { skillService } from '../../services/skill';

export const listCommand = withCommandHandler(
  async (options: { json?: boolean }): Promise<void> => {
    const result = await skillService.list();

    if (options.json) {
      jsonOutput(result);
      return;
    }

    if (result.installed.length === 0) {
      logInfo(`\n  ${messages.SKILL_LIST_NONE_INSTALLED}`);
    } else {
      logInfo(`\n  ${messages.SKILL_LIST_INSTALLED_HEADER}`);
      for (const s of result.installed) {
        const flags = [
          s.outdated && s.latestVersion ? `update available: ${s.latestVersion}` : '',
          s.pin ? `pinned to ${s.pin}` : '',
          s.source === 'brevo-cli' ? 'bundled copy' : '',
        ]
          .filter(Boolean)
          .join(', ');
        logInfo(
          `    ${s.name}@${s.version}  ${s.agents.join(', ')}  ${s.path}${flags ? `  (${flags})` : ''}`,
        );
      }
    }

    if (result.catalog.source === 'none') {
      logWarn(messages.SKILL_LIST_NO_CATALOG(result.catalog.error ?? 'unknown error'));
      return;
    }
    logInfo(
      `\n  ${messages.SKILL_LIST_AVAILABLE_HEADER(result.catalog.release ?? '?', result.catalog.source)}`,
    );
    for (const s of result.available) {
      const tags = [s.default ? 'default' : '', s.platforms.join('/')].filter(Boolean).join(', ');
      logInfo(`    ${s.name}@${s.version}  (${tags})  ${s.summary}`);
    }
  },
);
