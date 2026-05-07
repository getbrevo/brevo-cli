import { readProjectConfig } from './config';
import { isNewer } from './update-notifier';
import { logWarn } from './logger';
import { messages } from '../lang/en';

interface CheckOptions {
  currentVersion: string;
  argv?: readonly string[];
}

function isJsonInvocation(argv: readonly string[]): boolean {
  return argv.includes('--json');
}

/**
 * Warn if the current CLI version is below the project's `minCliVersion`.
 * Silent when:
 *   - cwd has no app-config.json
 *   - app-config.json has no `minCliVersion`
 *   - current version is `0.0.0` (unpublished local dev build)
 *   - `--json` is passed (would corrupt machine-readable output)
 */
export function warnIfCliBelowMinVersion(opts: CheckOptions): void {
  const argv = opts.argv ?? process.argv;
  if (isJsonInvocation(argv)) return;
  if (opts.currentVersion === '0.0.0') return;

  const cfg = readProjectConfig();
  const required = cfg?.minCliVersion;
  if (!required) return;

  if (isNewer(opts.currentVersion, required)) {
    logWarn(messages.CLI_BELOW_MIN_VERSION(opts.currentVersion, required));
  }
}
