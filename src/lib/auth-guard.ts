import { Command } from 'commander';
import { isAuthenticated } from './config';
import { CLI } from './constants';
import { CliError } from './errors';

const UNAUTHENTICATED_COMMANDS = new Set(['login', 'help', 'init', 'whoami', 'logout']);
// Subcommand groups whose entire subtree is local-only and never needs auth.
// Skill management touches files under ~/.claude/ — there is nothing to call
// against the Brevo API.
const UNAUTHENTICATED_GROUPS = new Set(['skill:cli']);

export function installAuthGuard(program: Command): void {
  program.hook('preAction', (thisCommand, actionCommand) => {
    const commandName = actionCommand.name();
    const parentName = actionCommand.parent?.name();

    // The root program's default action handles "no args" (help) and
    // "unknown command" (error). Skipping the auth guard there ensures
    // unknown commands surface as "unknown command" instead of being
    // intercepted by an auth-required check.
    if (actionCommand === thisCommand || commandName === program.name()) {
      return;
    }

    // Allow login, help, and version through without auth
    if (
      UNAUTHENTICATED_COMMANDS.has(commandName) ||
      (parentName && UNAUTHENTICATED_GROUPS.has(parentName)) ||
      process.argv.includes('--help') ||
      process.argv.includes('-h') ||
      process.argv.includes('--version') ||
      process.argv.includes('-V') ||
      process.argv.length <= 2
    ) {
      return;
    }

    if (!isAuthenticated()) {
      throw new CliError(`Not authenticated. Run: ${CLI.LOGIN}`);
    }
  });
}
