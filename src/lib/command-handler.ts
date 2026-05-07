import { withAbortHandler } from './abort';

/**
 * Wraps a command handler with abort handling (Ctrl+C during inquirer prompts).
 *
 * Usage:
 *   export const myCommand = withCommandHandler(async (opts) => {
 *     // command logic
 *   });
 */
export function withCommandHandler<T extends Record<string, unknown>>(
  fn: (opts: T) => Promise<void>,
): (opts: T) => Promise<void> {
  return (opts: T) => withAbortHandler(() => fn(opts));
}
