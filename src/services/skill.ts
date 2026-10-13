import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { messages } from '../lang/en';
import { CliError } from '../lib/errors';
import { SKILL_CATALOG, SKILLS_BUNDLE_DIR, SkillEntry, getSkill } from '../skills';

// ──────────────── Agents and target directories ────────────────
// Every supported agent reads skills in the Agent Skills format (a folder with
// SKILL.md); they differ only in where they look. Claude Code reads
// `~/.claude/skills/<name>/`. Codex reads `~/.agents/skills/<name>/`, and Gemini
// CLI reads the same directory (its interoperable alias of `~/.gemini/skills/`,
// which takes precedence), so one copy there serves both.
//
// Each root is overridable (BREVO_CLAUDE_HOME, BREVO_AGENTS_HOME) so tests can
// target a temp directory without monkey-patching `os.homedir`.

export const SKILL_AGENTS = ['claude', 'codex', 'gemini'] as const;
export type SkillAgent = (typeof SKILL_AGENTS)[number];

/** The agents `brevo skill:cli install` targets when `--agent` is omitted. */
export const DEFAULT_SKILL_AGENTS: readonly SkillAgent[] = ['claude'];

export function getClaudeSkillsRoot(): string {
  const override = process.env.BREVO_CLAUDE_HOME;
  if (override?.trim()) {
    return path.join(override, 'skills');
  }
  return path.join(os.homedir(), '.claude', 'skills');
}

export function getAgentsSkillsRoot(): string {
  const override = process.env.BREVO_AGENTS_HOME;
  if (override?.trim()) {
    return path.join(override, 'skills');
  }
  return path.join(os.homedir(), '.agents', 'skills');
}

interface SkillTarget {
  /** The agents that read this directory. */
  agents: readonly SkillAgent[];
  root: () => string;
}

const SKILL_TARGETS: readonly SkillTarget[] = [
  { agents: ['claude'], root: getClaudeSkillsRoot },
  { agents: ['codex', 'gemini'], root: getAgentsSkillsRoot },
];

/**
 * Parses `--agent`: a comma-separated list of agents, or `all`. Omitted means
 * the default (Claude Code), which keeps `brevo skill:cli install` unchanged.
 */
export function parseSkillAgents(value?: string): SkillAgent[] {
  if (value === undefined) return [...DEFAULT_SKILL_AGENTS];
  const names = value
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  if (names.length === 0) {
    throw new CliError(messages.SKILL_UNKNOWN_AGENT(value, SKILL_AGENTS.join(', ')));
  }
  if (names.includes('all')) return [...SKILL_AGENTS];
  for (const name of names) {
    if (!(SKILL_AGENTS as readonly string[]).includes(name)) {
      throw new CliError(messages.SKILL_UNKNOWN_AGENT(name, SKILL_AGENTS.join(', ')));
    }
  }
  return SKILL_AGENTS.filter((a) => names.includes(a));
}

/** The directories to write for these agents, each with the requested agents it serves. */
function targetsFor(agents: readonly SkillAgent[]): { root: string; agents: SkillAgent[] }[] {
  return SKILL_TARGETS.flatMap((t) => {
    const served = t.agents.filter((a) => agents.includes(a));
    return served.length ? [{ root: t.root(), agents: served }] : [];
  });
}

function allTargets(): { root: string; agents: SkillAgent[] }[] {
  return SKILL_TARGETS.map((t) => ({ root: t.root(), agents: [...t.agents] }));
}

// ──────────────── Install marker ────────────────
// A `.brevo-skill.json` file inside each installed skill records the version
// and source. It lets the auto-refresh pass decide whether a refresh is needed
// and lets `brevo skill:cli uninstall` confirm we only delete directories the CLI
// created — never something the user dropped in a skills directory manually.

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
  /** The agents that read `path`. */
  agents: SkillAgent[];
}

export interface UninstallResult {
  name: string;
  path: string;
  agents: SkillAgent[];
}

export interface OutdatedSkill {
  name: string;
  installedVersion: string;
  latestVersion: string;
  path: string;
}

function installAt(
  entry: SkillEntry,
  target: { root: string; agents: SkillAgent[] },
  force: boolean,
): InstallResult {
  const targetDir = path.join(target.root, entry.name);
  const marker = readMarker(targetDir);

  if (marker && !force) {
    return {
      name: entry.name,
      version: marker.version,
      status: 'already-installed',
      path: targetDir,
      agents: target.agents,
    };
  }

  copySkillFiles(entry, targetDir);
  writeMarker(targetDir, entry);

  return {
    name: entry.name,
    version: entry.version,
    status: marker ? 'overwritten' : 'installed',
    path: targetDir,
    agents: target.agents,
  };
}

export const skillService = {
  /**
   * Installed skills, in any agent's directory, whose marker version is behind
   * the bundled catalog. Pure file reads — safe to call on every CLI invocation
   * for auto-refresh.
   */
  getOutdatedSkills(): OutdatedSkill[] {
    return allTargets().flatMap((target) =>
      SKILL_CATALOG.flatMap((entry) => {
        const targetDir = path.join(target.root, entry.name);
        const marker = readMarker(targetDir);
        if (!marker) return [];
        if (marker.version === entry.version) return [];
        return [
          {
            name: entry.name,
            installedVersion: marker.version,
            latestVersion: entry.version,
            path: targetDir,
          },
        ];
      }),
    );
  },

  /** True when the named skill is installed for any agent (marker present). */
  isInstalled(name: string): boolean {
    const entry = getSkill(name);
    if (!entry) return false;
    return allTargets().some((t) => readMarker(path.join(t.root, entry.name)) !== null);
  },

  /** Installs one skill for the given agents (default: Claude Code), one result per directory. */
  install(
    name: string,
    options: { force?: boolean; agents?: readonly SkillAgent[] } = {},
  ): InstallResult[] {
    const entry = getSkill(name);
    if (!entry) {
      throw new CliError(unknownSkillMessage(name));
    }
    const agents = options.agents ?? DEFAULT_SKILL_AGENTS;
    return targetsFor(agents).map((target) => installAt(entry, target, Boolean(options.force)));
  },

  installAll(options: { force?: boolean; agents?: readonly SkillAgent[] } = {}): InstallResult[] {
    return SKILL_CATALOG.flatMap((entry) => this.install(entry.name, options));
  },

  /**
   * Removes the skills the CLI installed. With `agents`, only from their
   * directories; without, from every agent's directory. Only directories that
   * carry the CLI's marker are touched.
   */
  uninstallAll(options: { agents?: readonly SkillAgent[] } = {}): UninstallResult[] {
    const targets = options.agents ? targetsFor(options.agents) : allTargets();
    return targets.flatMap((target) =>
      SKILL_CATALOG.flatMap((entry) => {
        const targetDir = path.join(target.root, entry.name);
        if (!readMarker(targetDir)) return [];
        fs.rmSync(targetDir, { recursive: true, force: true });
        return [{ name: entry.name, path: targetDir, agents: target.agents }];
      }),
    );
  },

  /** Rewrites one installed copy (the directory of an outdated skill) from the bundle. */
  reinstallAt(name: string, skillDir: string): void {
    const entry = getSkill(name);
    if (!entry) throw new CliError(unknownSkillMessage(name));
    installAt(entry, { root: path.dirname(skillDir), agents: [] }, true);
  },

  /**
   * Refresh installed skills whose marker version drifts from the bundled
   * catalog, in every agent directory they were installed into. Pure local
   * file ops — safe to call after every CLI invocation. Errors during the
   * refresh emit a single error line and never throw, so a broken refresh
   * can't block the user's actual command.
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
        this.reinstallAt(s.name, s.path);
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

  // CI runners shouldn't have surprise mutations to the user's skill directories.
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
