import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { messages } from '../lang/en';
import { skillService } from '../services/skill';

// ──────────────── One-shot banner ────────────────
// Surfaces the Claude Code skill exactly once per machine on a non-skill-related
// `brevo` invocation, then records it so we never nag again. Mirrors the
// posture of `update-notifier.ts`: fail-soft, env-aware, fully injectable for
// tests. Lives in `~/.brevo/` (a directory the CLI already owns) rather than
// `~/.claude/` (which is Claude Code's territory).

const CACHE_FILE = 'skill-banner.json';
const BREVO_CLI_SKILL_NAME = 'brevo-cli';

export interface SkillBannerOptions {
  argv?: readonly string[];
  env?: NodeJS.ProcessEnv;
  isTTY?: boolean;
  output?: NodeJS.WriteStream;
  cachePath?: string;
  now?: () => string;
}

interface BannerState {
  shown: true;
  shownAt: string;
}

function getCachePath(override?: string, env: NodeJS.ProcessEnv = process.env): string {
  if (override) return override;
  const dir = env.BREVO_CONFIG_HOME || path.join(os.homedir(), '.brevo');
  return path.join(dir, CACHE_FILE);
}

function readBannerState(cachePath: string): BannerState | undefined {
  try {
    const raw = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    if (raw && typeof raw === 'object' && raw.shown === true) {
      return {
        shown: true,
        shownAt: typeof raw.shownAt === 'string' ? raw.shownAt : '',
      };
    }
  } catch {
    // missing or corrupt — caller treats as "never shown"
  }
  return undefined;
}

function writeBannerState(cachePath: string, now: string): void {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true, mode: 0o700 });
    const state: BannerState = { shown: true, shownAt: now };
    fs.writeFileSync(cachePath, JSON.stringify(state, null, 2), 'utf-8');
  } catch {
    // non-fatal — at worst the banner shows again next run
  }
}

export function shouldSkipBanner(opts: SkillBannerOptions = {}): boolean {
  const env = opts.env ?? process.env;
  const argv = opts.argv ?? process.argv;
  const isTTY = opts.isTTY ?? Boolean(process.stdout.isTTY);

  // CI runners and scripts can't act on a banner. Skip and don't burn the
  // "shown" flag — let it surface the first time a human sees the CLI.
  if (env.CI === 'true' || env.CI === '1') return true;
  if (!isTTY) return true;
  // --json callers consume stdout/stderr programmatically; a banner would
  // corrupt the contract.
  if (argv.includes('--json')) return true;
  // Already managing skills — they know it exists.
  if (argv.length > 2 && argv[2] === 'skill:cli') return true;
  // Already shown once on this machine.
  const cachePath = getCachePath(opts.cachePath, env);
  if (readBannerState(cachePath)) return true;
  // Already installed — no point nudging.
  if (skillService.isInstalled(BREVO_CLI_SKILL_NAME)) return true;
  return false;
}

function formatBanner(): string {
  const line1 = messages.SKILL_BANNER_LINE_1;
  const line2 = messages.SKILL_BANNER_LINE_2;
  const line3 = messages.SKILL_BANNER_LINE_3;
  const inner = Math.max(line1.length, line2.length, line3.length) + 4;
  const top = '╭' + '─'.repeat(inner) + '╮';
  const bot = '╰' + '─'.repeat(inner) + '╯';
  const pad = (s: string): string => '  ' + s + ' '.repeat(inner - s.length - 2);
  return [
    '',
    `  ${top}`,
    `  │${pad(line1)}│`,
    `  │${pad(line2)}│`,
    `  │${pad(line3)}│`,
    `  ${bot}`,
    '',
    '',
  ].join('\n');
}

export function maybeShowSkillBanner(opts: SkillBannerOptions = {}): void {
  if (shouldSkipBanner(opts)) return;

  const output = opts.output ?? process.stderr;
  output.write(formatBanner());

  const cachePath = getCachePath(opts.cachePath, opts.env ?? process.env);
  const nowFn = opts.now ?? (() => new Date().toISOString());
  writeBannerState(cachePath, nowFn());
}
