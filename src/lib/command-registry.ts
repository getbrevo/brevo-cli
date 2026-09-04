import { Command } from 'commander';
import type { Capability } from '../app-types/capabilities';
import { CliError } from './errors';
import { FEATURE_STAGE, assertFeatureAvailable, isFeatureAvailable } from './preview';
import type { PreviewFeature } from './preview';
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
  /**
   * Keep the command out of `brevo app --help` while leaving it registered and callable.
   *
   * Distinct from the pre-GA gate below, which hides *and* refuses: this one hides only.
   * The command runs exactly as it always did for anyone who types it — it just stops
   * being advertised. Used for a command we don't want to put in front of users yet but
   * still need working for QA and the smoke tests (`app withdraw`).
   *
   * Hiding is only half the job: the hand-aligned root screen in `lib/help.ts` is a
   * separate renderer that Commander's `hidden` cannot reach, so a command set hidden
   * here must also be absent from `formatRootHelp`. `preview-gate.test.ts` asserts both.
   */
  hidden?: boolean;
  handler: (opts: Record<string, unknown>, ...args: unknown[]) => void | Promise<void>;
}

export interface SubcommandGroupDefinition {
  name: string;
  /** Alternative names that resolve to the same group (e.g. `fn` for `function`). */
  aliases?: string[];
  description: string;
  commands: CommandDefinition[];
}

/**
 * The pre-GA feature a command's `requires` names, if any.
 *
 * `Capability` is the wider set — `oauth-flow`, `redirect-uris` and `scaffold-feature`
 * are capabilities that no gate applies to. Only the names that also appear in
 * `FEATURE_STAGE` are gateable, so the lookup is a membership test rather than a cast.
 */
export function previewFeatureOf(def: CommandDefinition): PreviewFeature | undefined {
  if (!def.requires) return undefined;
  return def.requires in FEATURE_STAGE ? (def.requires as PreviewFeature) : undefined;
}

/**
 * Register a flat command on the program.
 *
 * A command gated behind an unreleased feature is registered `hidden` rather than
 * skipped. Skipping would drop it from the parser too, so invoking it would produce
 * Commander's `unknown command` — which tells the user the CLI has no such command,
 * when in fact it has one that isn't released. Registering it hidden keeps the typed
 * refusal (`assertFeatureAvailable`) and its exit code.
 *
 * Note this is a *feature* gate, not the capability gate `requires` is documented as
 * not being. The distinction is real: a capability gate depends on which app you are
 * acting on and each command answers it in its own words, while this one depends only
 * on whether the feature has shipped and is the same answer for every command. That
 * is why one interceptor is right here and wrong there.
 *
 * `def.hidden` is the other route to an unlisted command, and it is not the same thing:
 * it suppresses the help entry and nothing else. The command still parses, still runs,
 * and gains no refusal from being hidden.
 */
function registerCommand(parent: Command, def: CommandDefinition): void {
  const gatedBehind = previewFeatureOf(def);
  const gateHides = Boolean(gatedBehind) && !isFeatureAvailable(gatedBehind!);
  const hidden = def.hidden === true || gateHides;
  const cmd = parent.command(def.name, { hidden }).description(def.description);

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
    // Re-checked here rather than reusing `hidden` above: that was computed at
    // registration, and the refusal must reflect the state at invocation. Same answer
    // in practice, but the gate reads the credentials file and the env, and neither
    // belongs frozen in a module-init constant.
    if (gatedBehind) assertFeatureAvailable(gatedBehind);
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
  if (group.aliases) {
    for (const alias of group.aliases) {
      groupCmd.alias(alias);
    }
  }
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
