import { Command } from 'commander';
import type { Capability } from '../app-types/capabilities';
import { CliError } from './errors';
import { removedCommandsIn } from './removed-commands';
import type { RemovedCommand } from './removed-commands';

export interface CommandOption {
  flags: string;
  description: string;
  parser?: (value: string) => unknown;
}

export interface CommandArgument {
  name: string;
  description: string;
}

export interface CommandDefinition {
  name: string;
  description: string;
  arguments?: CommandArgument[];
  options?: CommandOption[];
  examples?: string[];
  /**
   * The capability an app must have for this command to apply — `review-lifecycle` for the
   * public-app review commands, `account-install` for install/uninstall. See
   * `src/app-types/capabilities.ts`.
   *
   * **Declarative metadata, NOT a runtime guard.** The registry does not enforce it, and
   * that is deliberate rather than unfinished: each of these commands already throws its
   * own tested message with its own exit code, and a generic interceptor here would
   * replace them all with one string — which `CLAUDE.md` counts as a user-visible break
   * for any script matching on it. Enforcement stays in the commands, via
   * `assertCapability`, which reads the same table.
   *
   * What it is for: making the rule enumerable. `bin/index.ts` currently states it as prose
   * ("App-review commands (public apps only):") in a hand-aligned help block, and the agent
   * docs restate it again — three copies that can drift. This field is the source those can
   * be generated from, and `command-capabilities.test.ts` already asserts it agrees with the
   * matrix so it cannot rot in the meantime.
   */
  requires?: Capability;
  /**
   * Keep the command out of `brevo app --help` while leaving it registered and callable.
   *
   * Hides only — it never refuses. The command runs exactly as it always did for anyone
   * who types it, it just stops being advertised. Used for a command we don't want to put
   * in front of users yet but still need working for QA and the smoke tests (`app
   * withdraw` was the last one, un-hidden when the review lifecycle shipped; nothing sets
   * it today).
   *
   * Hiding is only half the job: the hand-aligned root screen in `lib/help.ts` is a
   * separate renderer that Commander's `hidden` cannot reach, so a command set hidden
   * here must also be absent from `formatRootHelp`. `help-surface.test.ts` asserts both
   * renderers agree.
   */
  hidden?: boolean;
  handler: (opts: Record<string, unknown>, ...args: unknown[]) => void | Promise<void>;
}

export interface SubcommandGroupDefinition {
  name: string;
  description: string;
  commands: CommandDefinition[];
}

/**
 * Register a flat command on the program.
 *
 * Every declared command is registered and callable. `def.hidden` is the only route to
 * an unlisted command and it suppresses the help entry and nothing else — the command
 * still parses and still runs. A command that should *refuse* says so itself, in its own
 * words, via `assertCapability`; there is deliberately no interceptor here, for the
 * reason `CommandDefinition.requires` gives.
 */
function registerCommand(parent: Command, def: CommandDefinition): void {
  const cmd = parent
    .command(def.name, { hidden: def.hidden === true })
    .description(def.description);

  if (def.arguments) {
    for (const arg of def.arguments) {
      cmd.argument(arg.name, arg.description);
    }
  }

  if (def.options) {
    for (const opt of def.options) {
      if (opt.parser) {
        cmd.option(opt.flags, opt.description, opt.parser);
      } else {
        cmd.option(opt.flags, opt.description);
      }
    }
  }

  if (def.examples?.length) {
    cmd.addHelpText(
      'after',
      '\nExamples:\n' + def.examples.map((e) => `  $ ${e}`).join('\n') + '\n',
    );
  }

  cmd.action((...actionArgs) => {
    // Commander passes positional args first, then options object, then Command
    const opts = actionArgs.at(-2) as Record<string, unknown>;
    const positionalArgs = actionArgs.slice(0, -2);
    return def.handler(opts, ...positionalArgs);
  });
}

/**
 * Register a command that no longer exists, purely so it can say so.
 *
 * See `lib/removed-commands.ts` for why a removed name is worth registering at all.
 * Four settings make the message reachable however the old invocation was typed, and
 * each one is load-bearing:
 *
 * - `hidden` keeps it out of `brevo app --help`. It is not a command on offer; it is a
 *   forwarding address.
 * - `allowUnknownOption` plus a variadic argument swallow the flags the command used to
 *   take, so `brevo app update --name X` gets the migration message instead of
 *   Commander's `unknown option '--name'` — which would bury the one thing the user
 *   needs to know behind a complaint about a flag that is gone either way.
 * - `allowExcessArguments` does the same for stray operands.
 * - `helpOption(false)` sends `brevo app update --help` to the message too. Left on,
 *   Commander would print a usage screen for a command that isn't there and exit `0`,
 *   which is the one answer a script must not get.
 */
function registerRemovedCommand(parent: Command, removed: RemovedCommand): void {
  const cmd = parent
    .command(removed.name, { hidden: true })
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .helpOption(false)
    .argument('[args...]')
    .action(() => {
      throw new CliError(removed.message);
    });

  // `brevo app help update` is the one route that reaches neither the action nor the
  // help option: Commander's help command calls the target's `help()` directly
  // (`_dispatchHelpCommand`, which does not skip hidden commands), printing a usage
  // screen and exiting `0`. There is no hook in front of that, so the method itself is
  // replaced — the same message, by the same route as every other invocation.
  cmd.help = () => {
    throw new CliError(removed.message);
  };
}

/**
 * Register a group of subcommands (e.g. `app create`, `app list`).
 */
function registerSubcommandGroup(parent: Command, group: SubcommandGroupDefinition): void {
  const groupCmd = parent.command(group.name).description(group.description);
  for (const def of group.commands) {
    registerCommand(groupCmd, def);
  }
  for (const removed of removedCommandsIn(group.name)) {
    registerRemovedCommand(groupCmd, removed);
  }
}

/**
 * Register all commands and subcommand groups onto the program.
 */
export function registerAll(
  program: Command,
  commands: CommandDefinition[],
  groups: SubcommandGroupDefinition[],
): void {
  for (const cmd of commands) {
    registerCommand(program, cmd);
  }
  for (const removed of removedCommandsIn()) {
    registerRemovedCommand(program, removed);
  }
  for (const group of groups) {
    registerSubcommandGroup(program, group);
  }
}
