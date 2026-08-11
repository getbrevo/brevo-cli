import { Command } from 'commander';
import type { Capability } from '../app-types/capabilities';

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
   * public-app review commands, `account-install` for deploy/rollback. See
   * `src/app-types/capabilities.ts`.
   *
   * **Declarative metadata, NOT a runtime guard.** The registry does not enforce it, and
   * that is deliberate rather than unfinished: each gated command already throws its own
   * tested message with its own exit code, and a generic interceptor here would replace
   * them all with one string — which `CLAUDE.md` counts as a user-visible break for any
   * script matching on it. Enforcement stays in the commands, via `assertCapability`, which
   * reads the same table.
   *
   * What it is for: making the rule enumerable. `bin/index.ts` currently states it as prose
   * ("App-review commands (public apps only):") in a hand-aligned help block, and the agent
   * docs restate it again — three copies that can drift. This field is the source those can
   * be generated from, and `command-capabilities.test.ts` already asserts it agrees with the
   * matrix so it cannot rot in the meantime.
   */
  requires?: Capability;
  handler: (opts: Record<string, unknown>, ...args: unknown[]) => void | Promise<void>;
}

export interface SubcommandGroupDefinition {
  name: string;
  description: string;
  commands: CommandDefinition[];
}

/**
 * Register a flat command on the program.
 */
function registerCommand(parent: Command, def: CommandDefinition): void {
  const cmd = parent.command(def.name).description(def.description);

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
 * Register a group of subcommands (e.g. `app create`, `app list`).
 */
function registerSubcommandGroup(parent: Command, group: SubcommandGroupDefinition): void {
  const groupCmd = parent.command(group.name).description(group.description);
  for (const def of group.commands) {
    registerCommand(groupCmd, def);
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
  for (const group of groups) {
    registerSubcommandGroup(program, group);
  }
}
