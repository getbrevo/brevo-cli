import { Command } from 'commander';
import { isAuthenticated } from './config';
import { CLI } from './constants';
import { CliError } from './errors';

// `available-scopes` only fetches the public IdP scope catalog (no Brevo API
// key involved), so it works before `brevo login`.
const UNAUTHENTICATED_COMMANDS = new Set([
  'login',
  'help',
  'init',
  'whoami',
  'logout',
  'available-scopes',
]);
// Subcommand groups whose entire subtree is local-only and never needs auth.
// Skill management touches files under ~/.claude/ — there is nothing to call
// against the Brevo API.
const UNAUTHENTICATED_GROUPS = new Set(['skill:cli']);

/**
 * True when the invocation being dispatched needs stored credentials.
 *
 * Shared by the auth guard and the proactive OAuth refresh hook
 * (`lib/oauth-freshness.ts`) so the two can never gate on different command
 * sets. Arguments match the `preAction` hook signature: `thisCommand` is the
 * command the hook was registered on (the root program), `actionCommand` the
 * one about to run.
 */
export function commandRequiresAuth(thisCommand: Command, actionCommand: Command): boolean {
  const commandName = actionCommand.name();
  const parentName = actionCommand.parent?.name();

  // The root program's default action handles "no args" (help) and
  // "unknown command" (error). Skipping the auth guard there ensures
  // unknown commands surface as "unknown command" instead of being
  // intercepted by an auth-required check.
  if (actionCommand === thisCommand || commandName === thisCommand.name()) {
    return false;
  }

  // Allow login, help, and version through without auth
  return !(
    UNAUTHENTICATED_COMMANDS.has(commandName) ||
    (parentName && UNAUTHENTICATED_GROUPS.has(parentName)) ||
    process.argv.includes('--help') ||
    process.argv.includes('-h') ||
    process.argv.includes('--version') ||
    process.argv.includes('-V') ||
    process.argv.length <= 2
  );
}

export function installAuthGuard(program: Command): void {
  program.hook('preAction', (thisCommand, actionCommand) => {
    if (!commandRequiresAuth(thisCommand, actionCommand)) {
      return;
    }

    if (!isAuthenticated()) {
      throw new CliError(`Not authenticated. Run: ${CLI.LOGIN}`);
    }
  });
}
