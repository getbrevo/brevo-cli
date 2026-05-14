import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { messages } from '../lang/en';
import { CliError } from '../lib/errors';
import { SKILL_CATALOG, SKILLS_BUNDLE_DIR, SkillEntry, getSkill } from '../skills';

// ──────────────── Target directory ────────────────
// Claude Code reads skills from `~/.claude/skills/<name>/`. The path is
// overridable via BREVO_CLAUDE_HOME so tests (and future Cursor support)
// can target a different root without monkey-patching `os.homedir`.

export function getClaudeSkillsRoot(): string {
  const override = process.env.BREVO_CLAUDE_HOME;
  if (override && override.trim()) {
    return path.join(override, 'skills');
  }
  return path.join(os.homedir(), '.claude', 'skills');
}

function getSkillTargetDir(name: string): string {
  return path.join(getClaudeSkillsRoot(), name);
}

// ──────────────── Install marker ────────────────
// A `.brevo-skill.json` file inside each installed skill records the version
// and source. It lets the auto-refresh pass decide whether a refresh is needed
// and lets `brevo skill:cli uninstall` confirm we only delete directories the CLI
// created — never something the user dropped in `~/.claude/skills/` manually.

const MARKER_FILE = '.brevo-skill.json';

interface SkillMarker {
  name: string;
  version: string;
  installedAt: string;
  source: 'brevo-cli';
}

function readMarker(skillDir: string): SkillMarker | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(skillDir, MARKER_FILE), 'utf-8'));
    if (
      raw &&
      typeof raw === 'object' &&
      typeof raw.name === 'string' &&
      typeof raw.version === 'string' &&
      raw.source === 'brevo-cli'
    ) {
      return {
        name: raw.name,
        version: raw.version,
        installedAt: typeof raw.installedAt === 'string' ? raw.installedAt : '',
        source: 'brevo-cli',
      };
    }
    return null;
  } catch {
    return null;
  }
}

function writeMarker(skillDir: string, entry: SkillEntry): void {
  const marker: SkillMarker = {
    name: entry.name,
    version: entry.version,
    installedAt: new Date().toISOString(),
    source: 'brevo-cli',
  };
  fs.writeFileSync(
    path.join(skillDir, MARKER_FILE),
    JSON.stringify(marker, null, 2) + '\n',
    'utf-8',
  );
}

// ──────────────── File copy ────────────────

function copySkillFiles(entry: SkillEntry, targetDir: string): void {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const relative of entry.files) {
    const src = path.join(SKILLS_BUNDLE_DIR, entry.subdir, relative);
    const dest = path.join(targetDir, relative);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

// ──────────────── Public API ────────────────

export type InstallStatus = 'installed' | 'already-installed' | 'overwritten';

export interface InstallResult {
  name: string;
  version: string;
  status: InstallStatus;
  path: string;
}

export interface UninstallResult {
  name: string;
  path: string;
}

export interface OutdatedSkill {
  name: string;
  installedVersion: string;
  latestVersion: string;
}

export const skillService = {
  /**
   * Installed skills whose marker version is behind the bundled catalog.
   * Pure file read — safe to call on every CLI invocation for auto-refresh.
   */
  getOutdatedSkills(): OutdatedSkill[] {
    return SKILL_CATALOG.flatMap((entry) => {
      const marker = readMarker(getSkillTargetDir(entry.name));
      if (!marker) return [];
      if (marker.version === entry.version) return [];
      return [
        {
          name: entry.name,
          installedVersion: marker.version,
          latestVersion: entry.version,
        },
      ];
    });
  },

  /** True when the named skill is installed (marker present). */
  isInstalled(name: string): boolean {
    const entry = getSkill(name);
    if (!entry) return false;
    return readMarker(getSkillTargetDir(entry.name)) !== null;
  },

  install(name: string, options: { force?: boolean } = {}): InstallResult {
    const entry = getSkill(name);
    if (!entry) {
      throw new CliError(unknownSkillMessage(name));
    }

    const targetDir = getSkillTargetDir(entry.name);
    const marker = readMarker(targetDir);

    if (marker && !options.force) {
      return {
        name: entry.name,
        version: marker.version,
        status: 'already-installed',
        path: targetDir,
      };
    }

    copySkillFiles(entry, targetDir);
    writeMarker(targetDir, entry);

    return {
      name: entry.name,
      version: entry.version,
      status: marker ? 'overwritten' : 'installed',
      path: targetDir,
    };
  },

  installAll(options: { force?: boolean } = {}): InstallResult[] {
    return SKILL_CATALOG.map((entry) => this.install(entry.name, options));
  },

  uninstallAll(): UninstallResult[] {
    return SKILL_CATALOG.flatMap((entry) => {
      const targetDir = getSkillTargetDir(entry.name);
      if (!readMarker(targetDir)) return [];
      fs.rmSync(targetDir, { recursive: true, force: true });
      return [{ name: entry.name, path: targetDir }];
    });
  },

  /**
   * Refresh installed skills whose marker version drifts from the bundled
   * catalog. Pure local file ops — safe to call after every CLI invocation.
   * Errors during the refresh emit a single error line and never throw,
   * so a broken refresh can't block the user's actual command.
   */
  autoRefreshOutdated(opts: AutoRefreshOptions = {}): void {
    if (shouldSkipAutoRefresh(opts)) return;

    let outdated: OutdatedSkill[];
    try {
      outdated = this.getOutdatedSkills();
    } catch {
      return;
    }
    if (outdated.length === 0) return;

    const output = opts.output ?? process.stderr;
    for (const s of outdated) {
      try {
        this.install(s.name, { force: true });
        output.write(
          `  ${messages.SKILL_AUTOREFRESHED(s.name, s.installedVersion, s.latestVersion)}\n`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        output.write(`  ${messages.SKILL_AUTOREFRESH_FAILED(s.name, msg)}\n`);
      }
    }
  },
};

export type SkillService = typeof skillService;

// ──────────────── Auto-refresh skip rules ────────────────
// Exported as a free function for direct unit-testing without instantiating
// the whole service. Mirrors update-notifier's `shouldSkipCheck` shape.

export interface AutoRefreshOptions {
  argv?: readonly string[];
  env?: NodeJS.ProcessEnv;
  output?: NodeJS.WriteStream;
}

export function shouldSkipAutoRefresh(opts: AutoRefreshOptions = {}): boolean {
  const env = opts.env ?? process.env;
  const argv = opts.argv ?? process.argv;

  // CI runners shouldn't have surprise mutations to ~/.claude.
  if (env.CI === 'true' || env.CI === '1') return true;
  // --json callers want deterministic, machine-readable output.
  if (argv.includes('--json')) return true;
  // The user is already managing skills — let their explicit command do the work.
  if (argv.length > 2 && argv[2] === 'skill:cli') return true;
  // Dedicated opt-out for users who hand-edit their installed SKILL.md and
  // don't want it clobbered on the next `brevo` run.
  if (env.BREVO_NO_SKILL_AUTOREFRESH === '1' || env.BREVO_NO_SKILL_AUTOREFRESH === 'true') {
    return true;
  }
  return false;
}

function unknownSkillMessage(name: string): string {
  const available = SKILL_CATALOG.map((s) => s.name).join(', ');
  return `Unknown skill "${name}". Available: ${available}`;
}
