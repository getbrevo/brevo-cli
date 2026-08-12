/**
 * Commands that no longer exist, kept registered only to say so.
 *
 * A removed command is not the same as a command that never existed. Commander answers
 * a name it doesn't know with `unknown command 'update'` plus a "did you mean" guess
 * drawn from string distance — for `app update` that guess was `create`, which is both
 * wrong (the replacement is `upload`) and expensive to act on. Registering the dead name
 * back lets the CLI name its replacement instead.
 *
 * Two consumers read this table, which is why it is a table and not a special case in
 * either of them:
 *
 * - `lib/command-registry.ts` registers each entry as a hidden command whose only
 *   action is to throw its message.
 * - `lib/auth-guard.ts` exempts them from the credential check. A removed command's
 *   whole job is to explain itself, and answering `Not authenticated` to someone whose
 *   actual problem is that the command is gone sends them to `brevo login` for nothing.
 *
 * Entries are cheap to keep and should outlive the release that removed the command by
 * a good margin — the users who need one are precisely the ones who haven't read the
 * changelog. Drop an entry only when the name is being reused for something else.
 */
import { messages } from '../lang/en';

export interface RemovedCommand {
  /**
   * The subcommand group it lived under (`app update` → `'app'`), or `undefined` for a
   * removed top-level command.
   */
  group?: string;
  name: string;
  /** What the user gets instead — in `lang/en.ts`, like every other user-facing string. */
  message: string;
}

export const REMOVED_COMMANDS: readonly RemovedCommand[] = [
  // BEX-250. Replaced by `brevo app upload`, with no shim and no flag-for-flag
  // equivalent — see `messages.APP_UPDATE_REMOVED`.
  { group: 'app', name: 'update', message: messages.APP_UPDATE_REMOVED },
];

/** The removed commands belonging to a group, or the top-level ones when called bare. */
export function removedCommandsIn(group?: string): RemovedCommand[] {
  return REMOVED_COMMANDS.filter((c) => c.group === group);
}

/**
 * Is this invocation one of the removed commands?
 *
 * `parentName` is whatever Commander reports as the parent, which for a top-level
 * command is the program itself (`brevo`) rather than `undefined` — so an entry with no
 * `group` matches on name alone and a grouped one has to match the group too.
 */
export function isRemovedCommand(name: string, parentName?: string): boolean {
  return REMOVED_COMMANDS.some(
    (c) => c.name === name && (c.group === undefined || c.group === parentName),
  );
}
