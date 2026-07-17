import { withCommandHandler } from '../../lib/command-handler';
import { createSpinner } from '../../lib/ui';
import { logInfo } from '../../lib/logger';
import { jsonOutput } from '../../lib/json-output';
import { dpFunctionsService } from '../../container';

export const dpToolsCommand = withCommandHandler(
  async (options: { json?: boolean }): Promise<void> => {
    const spinner = createSpinner('Fetching MCP tools...', { silent: options.json });
    const tools = await dpFunctionsService.discoverTools();
    spinner.stop();

    if (options.json) {
      jsonOutput(tools);
      return;
    }

    if (tools.length === 0) {
      logInfo('\n  No MCP tools available.\n');
      return;
    }

    logInfo(`\n  MCP Tools (${tools.length}):\n`);
    const nameWidth = Math.max(4, ...tools.map((t) => t.name.length));

    logInfo(`  ${'NAME'.padEnd(nameWidth)}  DESCRIPTION`);
    logInfo(`  ${'─'.repeat(nameWidth)}  ${'─'.repeat(40)}`);

    for (const tool of tools) {
      const desc =
        tool.description.length > 60 ? tool.description.slice(0, 57) + '...' : tool.description;
      logInfo(`  ${tool.name.padEnd(nameWidth)}  ${desc}`);
    }
    logInfo('');
  },
);
