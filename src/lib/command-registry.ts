import { Command } from 'commander';

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
    const opts = actionArgs[actionArgs.length - 2] as Record<string, unknown>;
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
