import { Command } from 'commander';
import { isAuthenticated } from './config';
import { CLI } from './constants';
import { CliError } from './errors';

const UNAUTHENTICATED_COMMANDS = ['login', 'help', 'init', 'whoami', 'logout'];

export function installAuthGuard(program: Command): void {
  program.hook('preAction', (thisCommand, actionCommand) => {
    const commandName = actionCommand.name();

    // The root program's default action handles "no args" (help) and
    // "unknown command" (error). Skipping the auth guard there ensures
    // unknown commands surface as "unknown command" instead of being
    // intercepted by an auth-required check.
    if (actionCommand === thisCommand || commandName === program.name()) {
      return;
    }

    // Allow login, help, and version through without auth
    if (
      UNAUTHENTICATED_COMMANDS.includes(commandName) ||
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
