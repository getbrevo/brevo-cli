import inquirer from 'inquirer';

import { messages } from '../lang/en';
import { CLI } from './constants';
import { skillService } from '../services/skill';
import { logSuccess, logInfo } from './logger';

// ──────────────── Update banner ────────────────
// Local-only check, no network call — safe to run on every CLI invocation.
// Honors the same opt-out env vars as the npm-version update notifier so a
// user who has globally muted "this CLI is asking me about upgrades" only has
// to set one flag.

export interface SkillNotifierOptions {
  argv?: readonly string[];
  env?: NodeJS.ProcessEnv;
  isTTY?: boolean;
  output?: NodeJS.WriteStream;
}

export function shouldSkipSkillNotifier(opts: SkillNotifierOptions = {}): boolean {
  const env = opts.env ?? process.env;
  const argv = opts.argv ?? process.argv;
  const isTTY = opts.isTTY ?? Boolean(process.stdout.isTTY);

  if (env.CI === 'true' || env.CI === '1') return true;
  if (!isTTY) return true;
  if (env.NO_UPDATE_NOTIFIER === '1' || env.NO_UPDATE_NOTIFIER === 'true') return true;
  if (env.BREVO_NO_UPDATE_NOTIFIER === '1' || env.BREVO_NO_UPDATE_NOTIFIER === 'true') return true;
  if (argv.includes('--no-update-notifier')) return true;
  // Suppress when the user is already managing skills — the relevant info is
  // surfaced by the subcommand itself, no banner needed.
  if (argv.length > 2 && argv[2] === 'skill') return true;
  return false;
}

export function notifyOutdatedSkills(opts: SkillNotifierOptions = {}): void {
  if (shouldSkipSkillNotifier(opts)) return;
  const outdated = skillService.getOutdatedSkills();
  if (outdated.length === 0) return;

  const output = opts.output ?? process.stderr;
  output.write('\n');
  for (const s of outdated) {
    output.write(
      `  ${messages.SKILL_NOTIFIER_AVAILABLE(s.name, s.installedVersion, s.latestVersion, CLI.SKILL_UPDATE(s.name))}\n`,
    );
  }
  output.write('\n');
}

// ──────────────── First-run install prompt ────────────────
// Surface a friendly offer during the `brevo login` / `brevo app init` flows
// so users don't have to discover `brevo skill install` themselves. We keep
// this conservative: TTY only, never under --json, and a dedicated opt-out
// env var so users who don't want any prompts can mute it independently of
// the version-update banner.

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
    logInfo(`  ${messages.SKILL_PROMPT_DECLINED(CLI.SKILL_INSTALL(BREVO_CLI_SKILL))}\n`);
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
  // Already installed → nothing to offer. The update banner handles upgrades.
  if (skillService.isInstalled(name)) return true;
  return false;
}
