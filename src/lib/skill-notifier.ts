import inquirer from 'inquirer';

import { messages } from '../lang/en';
import { CLI } from './constants';
import { skillService } from '../services/skill';
import { logSuccess, logInfo } from './logger';

// ──────────────── Auto-refresh ────────────────
// Local-only check, no network call — safe to run on every CLI invocation.
// When an installed skill is older than the bundled version, we overwrite the
// installed copy in place so the AI tool always sees the latest primer.
// This is silent except for a single one-line notice on stderr per refresh.

export interface SkillAutoRefreshOptions {
  argv?: readonly string[];
  env?: NodeJS.ProcessEnv;
  output?: NodeJS.WriteStream;
}

export function shouldSkipSkillAutoRefresh(opts: SkillAutoRefreshOptions = {}): boolean {
  const env = opts.env ?? process.env;
  const argv = opts.argv ?? process.argv;

  // CI runners shouldn't have surprise mutations to ~/.claude.
  if (env.CI === 'true' || env.CI === '1') return true;
  // --json callers want deterministic, machine-readable output on stdout/stderr.
  if (argv.includes('--json')) return true;
  // The user is already managing skills — let their explicit command do the work.
  if (argv.length > 2 && argv[2] === 'skill') return true;
  // Dedicated opt-out for users who hand-edit their installed SKILL.md and
  // don't want it clobbered on the next `brevo` run.
  if (env.BREVO_NO_SKILL_AUTOREFRESH === '1' || env.BREVO_NO_SKILL_AUTOREFRESH === 'true') {
    return true;
  }
  return false;
}

export function autoRefreshOutdatedSkills(opts: SkillAutoRefreshOptions = {}): void {
  if (shouldSkipSkillAutoRefresh(opts)) return;

  let outdated;
  try {
    outdated = skillService.getOutdatedSkills();
  } catch {
    // A broken marker shouldn't block the user's actual command.
    return;
  }
  if (outdated.length === 0) return;

  const output = opts.output ?? process.stderr;
  for (const s of outdated) {
    try {
      skillService.install(s.name, { force: true });
      output.write(
        `  ${messages.SKILL_AUTOREFRESHED(s.name, s.installedVersion, s.latestVersion)}\n`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      output.write(`  ${messages.SKILL_AUTOREFRESH_FAILED(s.name, msg)}\n`);
    }
  }
}

// ──────────────── First-run install prompt ────────────────
// Surface a friendly offer during the `brevo login` / `brevo app init` flows
// so users don't have to discover `brevo skill install` themselves. We keep
// this conservative: TTY only, never under --json, and a dedicated opt-out
// env var so users who don't want any prompts can mute it independently of
// the auto-refresh opt-out.

export interface OfferSkillInstallOptions {
  json?: boolean;
  env?: NodeJS.ProcessEnv;
  isTTY?: boolean;
  /** Inject for tests — defaults to inquirer.prompt. */
  prompt?: (question: { name: string; message: string; default?: boolean }) => Promise<{
    install?: boolean;
  }>;
}

export function shouldSkipInstallPrompt(opts: OfferSkillInstallOptions = {}): boolean {
  if (opts.json) return true;
  const env = opts.env ?? process.env;
  const isTTY = opts.isTTY ?? Boolean(process.stdin.isTTY);
  if (!isTTY) return true;
  if (env.CI === 'true' || env.CI === '1') return true;
  if (env.BREVO_NO_SKILL_PROMPT === '1' || env.BREVO_NO_SKILL_PROMPT === 'true') return true;
  return false;
}

const BREVO_CLI_SKILL = 'brevo-cli';

export async function offerSkillInstall(opts: OfferSkillInstallOptions = {}): Promise<void> {
  if (shouldSkipSkillInstallPromptFor(BREVO_CLI_SKILL, opts)) return;

  const ask =
    opts.prompt ??
    (async (question) =>
      inquirer.prompt([{ type: 'confirm', default: true, ...question }]) as Promise<{
        install?: boolean;
      }>);

  logInfo(`\n  ${messages.SKILL_PROMPT_INTRO}`);
  const { install } = await ask({
    name: 'install',
    message: messages.SKILL_PROMPT_CONFIRM,
    default: true,
  });

  if (!install) {
    logInfo(`  ${messages.SKILL_PROMPT_DECLINED(CLI.SKILL_INSTALL)}\n`);
    return;
  }

  const result = skillService.install(BREVO_CLI_SKILL);
  if (result.status === 'installed') {
    logSuccess(messages.SKILL_INSTALL_SUCCESS(result.name, result.version, result.path));
  } else {
    logInfo(`  ${messages.SKILL_PROMPT_NOOP(result.name)}\n`);
  }
}

function shouldSkipSkillInstallPromptFor(name: string, opts: OfferSkillInstallOptions): boolean {
  if (shouldSkipInstallPrompt(opts)) return true;
  // Already installed → nothing to offer. Auto-refresh handles upgrades.
  if (skillService.isInstalled(name)) return true;
  return false;
}
