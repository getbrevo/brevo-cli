import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { messages } from '../lang/en';
import { CliError } from '../lib/errors';
import { EXIT_CODES } from '../lib/exit-codes';
import { isNewer } from '../lib/update-notifier';
import { CLI_VERSION, SKILLS_BUNDLE_DIR, getSkill as getBundledSkill } from '../skills';
import {
  CatalogFetchError,
  CatalogFetchOptions,
  CatalogInvalidError,
  CatalogMcp,
  CatalogSkill,
  SKILL_MARKER_FILE,
  SkillCatalog,
  SkillFile,
  SkillPlatform,
  catalogUrl,
  isSafeRelativePath,
  CATALOG_NOTICE_TIMEOUT_MS,
  fetchCatalog,
  fetchSkillFiles,
  hashFiles,
  isCatalogCacheStale,
  noteCatalogAttempt,
  readCatalogCache,
} from './skill-catalog';

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

/** The agents `brevo skill install` targets when `--agent` is omitted. */
export const DEFAULT_SKILL_AGENTS: readonly SkillAgent[] = ['claude'];

/** The catalog platform each agent runs on; a skill lists the platforms it is written for. */
export const AGENT_PLATFORM: Record<SkillAgent, SkillPlatform> = {
  claude: 'claude',
  codex: 'openai',
  gemini: 'gemini',
};

/** The one skill the CLI ships itself, so it can be installed with no network. */
export const BUNDLED_SKILL_NAME = 'brevo-cli';

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

interface SkillTargetSpec {
  /** The agents that read this directory. */
  agents: readonly SkillAgent[];
  root: () => string;
}

const SKILL_TARGETS: readonly SkillTargetSpec[] = [
  { agents: ['claude'], root: getClaudeSkillsRoot },
  { agents: ['codex', 'gemini'], root: getAgentsSkillsRoot },
];

interface SkillTarget {
  root: string;
  /** The requested agents this directory serves (a subset of the directory's readers). */
  agents: SkillAgent[];
}

/**
 * Parses `--agent`: a comma-separated list of agents, or `all`. Omitted means
 * the default (Claude Code).
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
function targetsFor(agents: readonly SkillAgent[]): SkillTarget[] {
  return SKILL_TARGETS.flatMap((t) => {
    const served = t.agents.filter((a) => agents.includes(a));
    return served.length ? [{ root: t.root(), agents: served }] : [];
  });
}

function allTargets(): SkillTarget[] {
  return SKILL_TARGETS.map((t) => ({ root: t.root(), agents: [...t.agents] }));
}

// ──────────────── Install marker ────────────────
// A `.brevo-skill.json` file inside each installed skill records what was
// installed and where it came from. `uninstall` trusts it and nothing else, so
// the CLI never deletes a directory the user dropped into a skills folder by
// hand; `check` compares its hash against the files on disk.
//
// `source` tells the two origins apart: `brevo-skills` is a catalog install at
// a release, `brevo-cli` is the bundled copy (the pre-catalog installer wrote
// the same value, so an older install is read as a bundled one and migrated to
// the catalog on the next update).

const MARKER_FILE = SKILL_MARKER_FILE;

export type SkillSource = 'brevo-skills' | 'brevo-cli';

export interface SkillMarker {
  name: string;
  version: string;
  /** The brevo-skills release the files came from; absent for a bundled install. */
  release?: string;
  /** Hash of the installed files per the catalog contract; absent on pre-catalog installs. */
  sha256?: string;
  installedAt: string;
  source: SkillSource;
}

function readMarker(skillDir: string): SkillMarker | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(skillDir, MARKER_FILE), 'utf-8'));
    if (
      raw &&
      typeof raw === 'object' &&
      typeof raw.name === 'string' &&
      typeof raw.version === 'string' &&
      (raw.source === 'brevo-skills' || raw.source === 'brevo-cli')
    ) {
      return {
        name: raw.name,
        version: raw.version,
        release: typeof raw.release === 'string' ? raw.release : undefined,
        sha256: typeof raw.sha256 === 'string' ? raw.sha256 : undefined,
        installedAt: typeof raw.installedAt === 'string' ? raw.installedAt : '',
        source: raw.source,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function writeMarker(skillDir: string, marker: SkillMarker): void {
  fs.writeFileSync(
    path.join(skillDir, MARKER_FILE),
    JSON.stringify(marker, null, 2) + '\n',
    'utf-8',
  );
}

/** Every marked skill directory directly under `root`. */
function installedIn(root: string): { dir: string; marker: SkillMarker }[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory())
    .flatMap((e) => {
      const dir = path.join(root, e.name);
      const marker = readMarker(dir);
      return marker ? [{ dir, marker }] : [];
    });
}

/** Hash of what is on disk, by the catalog's contract, so `check` can compare it to the marker. */
function hashInstalledDir(skillDir: string): string {
  const files: SkillFile[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
      else if (entry.isFile() && rel !== MARKER_FILE) {
        files.push({ path: rel, bytes: fs.readFileSync(path.join(dir, entry.name)) });
      }
    }
  };
  walk(skillDir, '');
  return hashFiles(files);
}

/** A catalog file that may not be written where it points. The skill is skipped, like a hash mismatch. */
export class UnsafeSkillPathError extends CliError {
  constructor(
    public readonly skill: string,
    public readonly file: string,
  ) {
    super(messages.SKILL_UNSAFE_PATH(skill, file), EXIT_CODES.ERROR);
    this.name = 'UnsafeSkillPathError';
  }
}

function isSymlink(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Where one skill file lands, or a throw. The catalog validated the path as
 * plain segments already; this is the second layer, at the one place bytes
 * reach the disk, and it does not trust the first: the resolved destination
 * must stay under the skill directory, and no existing component between the
 * two may be a symbolic link (a link inside a user-authored directory, or the
 * directory itself, would carry the write somewhere else).
 */
export function resolveSkillFileDestination(skillDir: string, skill: string, file: string): string {
  if (!isSafeRelativePath(file)) throw new UnsafeSkillPathError(skill, file);
  const root = path.resolve(skillDir);
  const segments = file.split('/');
  const dest = path.resolve(root, ...segments);
  if (!dest.startsWith(root + path.sep)) throw new UnsafeSkillPathError(skill, file);
  if (isSymlink(root)) throw new UnsafeSkillPathError(skill, file);
  let cursor = root;
  for (const segment of segments) {
    cursor = path.join(cursor, segment);
    if (isSymlink(cursor)) throw new UnsafeSkillPathError(skill, file);
  }
  return dest;
}

function writeSkillFiles(
  skillDir: string,
  skill: string,
  files: readonly SkillFile[],
  replace: boolean,
): void {
  // A directory the CLI owns is replaced whole, so a file dropped from the
  // skill does not linger; one it does not own only gets the skill's files
  // written over it. Every destination is checked before anything is removed
  // or written, so a refused file leaves the directory exactly as it was.
  if (replace) fs.rmSync(skillDir, { recursive: true, force: true });
  const destinations = files.map((file) => resolveSkillFileDestination(skillDir, skill, file.path));
  fs.mkdirSync(skillDir, { recursive: true });
  files.forEach((file, i) => {
    const dest = destinations[i]!;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, file.bytes);
  });
}

// ──────────────── Lock file ────────────────
// `~/.brevo/skills.lock.json` records, per skills directory, what the CLI
// installed there, from which release, and whether it is pinned. The markers
// are the source of truth for what is on disk; the lock is where a pin lives,
// because a pin is a decision about the directory, not a property of the files.

const LOCK_FILE = 'skills.lock.json';

export interface LockedSkill {
  version: string;
  release?: string;
  /** The release `update` and auto-refresh stay on until `--pin latest` clears it. */
  pin?: string;
  source: SkillSource;
}

export interface LockedDirectory {
  agents: SkillAgent[];
  skills: Record<string, LockedSkill>;
}

export interface SkillLock {
  version: 1;
  directories: Record<string, LockedDirectory>;
}

export function getSkillLockPath(env: NodeJS.ProcessEnv = process.env): string {
  const dir = env.BREVO_CONFIG_HOME || path.join(os.homedir(), '.brevo');
  return path.join(dir, LOCK_FILE);
}

export function readSkillLock(env: NodeJS.ProcessEnv = process.env): SkillLock {
  try {
    const raw = JSON.parse(fs.readFileSync(getSkillLockPath(env), 'utf-8'));
    if (raw && typeof raw === 'object' && raw.directories && typeof raw.directories === 'object') {
      const directories: Record<string, LockedDirectory> = {};
      for (const [dir, entry] of Object.entries(raw.directories as Record<string, unknown>)) {
        if (!entry || typeof entry !== 'object') continue;
        const e = entry as { agents?: unknown; skills?: unknown };
        const skills: Record<string, LockedSkill> = {};
        if (e.skills && typeof e.skills === 'object') {
          for (const [name, s] of Object.entries(e.skills as Record<string, unknown>)) {
            if (!s || typeof s !== 'object') continue;
            const ls = s as Record<string, unknown>;
            if (typeof ls.version !== 'string') continue;
            skills[name] = {
              version: ls.version,
              release: typeof ls.release === 'string' ? ls.release : undefined,
              pin: typeof ls.pin === 'string' ? ls.pin : undefined,
              source: ls.source === 'brevo-cli' ? 'brevo-cli' : 'brevo-skills',
            };
          }
        }
        directories[dir] = {
          agents: Array.isArray(e.agents)
            ? e.agents.filter((a): a is SkillAgent =>
                (SKILL_AGENTS as readonly string[]).includes(a),
              )
            : [],
          skills,
        };
      }
      return { version: 1, directories };
    }
  } catch {
    // Missing or corrupt: start from the markers.
  }
  return { version: 1, directories: {} };
}

function writeSkillLock(lock: SkillLock, env: NodeJS.ProcessEnv = process.env): void {
  const lockPath = getSkillLockPath(env);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n', 'utf-8');
}

function lockEntry(lock: SkillLock, root: string, agents: readonly SkillAgent[]): LockedDirectory {
  const existing = lock.directories[root] ?? { agents: [], skills: {} };
  existing.agents = SKILL_AGENTS.filter((a) => existing.agents.includes(a) || agents.includes(a));
  lock.directories[root] = existing;
  return existing;
}

function lockedPin(lock: SkillLock, root: string, name: string): string | undefined {
  return lock.directories[root]?.skills[name]?.pin;
}

// ──────────────── Bundled fallback ────────────────
// The CLI keeps shipping `agent-context/SKILL.md`: it is the source the skills
// repo syncs from and the README's manual install path. When the catalog cannot
// be fetched, `skill install brevo-cli` installs that copy with the CLI version
// as its version, hashed by the same contract so `check` can still verify it.

function readBundledFiles(): SkillFile[] {
  const entry = getBundledSkill(BUNDLED_SKILL_NAME);
  if (!entry) return [];
  return entry.files.map((file) => ({
    path: file,
    bytes: fs.readFileSync(path.join(SKILLS_BUNDLE_DIR, entry.subdir, file)),
  }));
}

function bundledCatalog(): SkillCatalog {
  const files = readBundledFiles();
  const entry = getBundledSkill(BUNDLED_SKILL_NAME);
  return {
    version: CLI_VERSION,
    skills: entry
      ? [
          {
            name: entry.name,
            version: CLI_VERSION,
            summary: entry.description,
            default: false,
            platforms: ['claude', 'openai', 'gemini'],
            path: '',
            files: [...entry.files],
            sha256: hashFiles(files),
          },
        ]
      : [],
  };
}

// ──────────────── Results ────────────────

export type InstallStatus = 'installed' | 'updated' | 'already-installed' | 'skipped';

export type SkipReason =
  | 'platform'
  | 'min-cli-version'
  | 'hash-mismatch'
  | 'download-failed'
  | 'unsafe-path'
  | 'not-installed'
  | 'not-in-catalog'
  | 'pinned';

export interface InstallResult {
  name: string;
  version: string;
  /** The release the files came from; absent for the bundled copy. */
  release?: string;
  status: InstallStatus;
  path: string;
  /** The agents that read `path`. */
  agents: SkillAgent[];
  previousVersion?: string;
  reason?: SkipReason;
  /** Human-readable detail for a skip: the version to upgrade to, the hash that differed. */
  detail?: string;
}

export interface InstallRun {
  results: InstallResult[];
  /** The release installed from, or undefined when only the bundled copy was used. */
  release?: string;
  source: 'network' | 'bundled';
  dryRun: boolean;
  /** True when a skill was refused for integrity or download reasons: the command exits 1. */
  failed: boolean;
  mcp?: CatalogMcp;
  warnings: string[];
}

export interface UninstallResult {
  name: string;
  path: string;
  agents: SkillAgent[];
  status: 'removed' | 'not-installed';
}

export interface InstalledSkill {
  name: string;
  version: string;
  release?: string;
  source: SkillSource;
  path: string;
  agents: SkillAgent[];
  pin?: string;
  latestVersion?: string;
  outdated: boolean;
}

export interface AvailableSkill {
  name: string;
  version: string;
  summary: string;
  platforms: SkillPlatform[];
  default: boolean;
  minCliVersion?: string;
}

export interface CatalogState {
  release?: string;
  source: 'network' | 'cache' | 'none';
  error?: string;
}

export interface ListResult {
  installed: InstalledSkill[];
  available: AvailableSkill[];
  catalog: CatalogState;
}

export interface CheckResult extends InstalledSkill {
  /** The on-disk hash differs from the marker's. Never true for a marker with no hash. */
  tampered: boolean;
  /** No hash to compare against (a pre-catalog install). */
  unverified: boolean;
}

export interface CheckRun {
  results: CheckResult[];
  catalog: CatalogState;
  /** False when any skill is outdated or tampered: the command exits 1. */
  ok: boolean;
}

export interface SkillServiceOptions extends CatalogFetchOptions {
  env?: NodeJS.ProcessEnv;
}

export interface InstallOptions extends SkillServiceOptions {
  agents?: readonly SkillAgent[];
  /** A release to install from instead of the latest; `latest` clears a recorded pin. */
  pin?: string;
  force?: boolean;
  dryRun?: boolean;
}

// ──────────────── Helpers ────────────────

function unknownSkillMessage(name: string, catalog: SkillCatalog): string {
  return messages.SKILL_UNKNOWN(name, catalog.skills.map((s) => s.name).join(', '));
}

function selectSkills(catalog: SkillCatalog, names: readonly string[]): CatalogSkill[] {
  const unique = [...new Set(names)];
  for (const name of unique) {
    if (!catalog.skills.some((s) => s.name === name)) {
      throw new CliError(unknownSkillMessage(name, catalog));
    }
  }
  // Catalog order, so output is stable whatever order the names were typed in.
  return catalog.skills.filter((s) => s.default || unique.length === 0 || unique.includes(s.name));
}

/** The `--pin` value as a release to fetch: `latest` and omitted both mean the latest. */
function pinnedRelease(pin: string | undefined): string | undefined {
  if (!pin || pin.toLowerCase() === 'latest') return undefined;
  return pin.replace(/^v/, '');
}

function fitsPlatform(skill: CatalogSkill, agents: readonly SkillAgent[]): boolean {
  return agents.some((a) => skill.platforms.includes(AGENT_PLATFORM[a]));
}

function needsNewerCli(skill: CatalogSkill): boolean {
  return Boolean(skill.min_cli_version) && isNewer(CLI_VERSION, skill.min_cli_version!);
}

/**
 * An installed copy is outdated when its version differs from the catalog's,
 * or when it is a bundled copy the catalog can replace. "Differs" rather than
 * "older" so a pin to an earlier release, or a catalog that rolled a skill
 * back, is honoured too.
 */
function isOutdated(marker: SkillMarker, latest: CatalogSkill): boolean {
  return marker.source !== 'brevo-skills' || marker.version !== latest.version;
}

function lockedFromMarker(marker: SkillMarker, pin: string | undefined): LockedSkill {
  return { version: marker.version, release: marker.release, pin, source: marker.source };
}

/** Downloads once per skill, verifies the hash, and remembers the answer for every directory. */
class SkillDownloads {
  private readonly cache = new Map<
    string,
    Promise<
      { files: SkillFile[] } | { reason: 'hash-mismatch' | 'download-failed'; detail: string }
    >
  >();

  constructor(
    private readonly release: string | undefined,
    private readonly bundled: boolean,
    private readonly opts: CatalogFetchOptions,
  ) {}

  get(
    skill: CatalogSkill,
  ): Promise<
    { files: SkillFile[] } | { reason: 'hash-mismatch' | 'download-failed'; detail: string }
  > {
    let pending = this.cache.get(skill.name);
    if (!pending) {
      pending = this.load(skill);
      this.cache.set(skill.name, pending);
    }
    return pending;
  }

  private async load(
    skill: CatalogSkill,
  ): Promise<
    { files: SkillFile[] } | { reason: 'hash-mismatch' | 'download-failed'; detail: string }
  > {
    let files: SkillFile[];
    if (this.bundled) {
      files = readBundledFiles();
    } else {
      try {
        files = await fetchSkillFiles(skill, this.release!, this.opts);
      } catch (err) {
        return {
          reason: 'download-failed',
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    }
    const actual = hashFiles(files);
    if (actual !== skill.sha256) {
      return { reason: 'hash-mismatch', detail: messages.SKILL_HASH_DETAIL(skill.sha256, actual) };
    }
    return { files };
  }
}

async function latestCatalogOrCache(
  opts: SkillServiceOptions,
): Promise<{ catalog?: SkillCatalog; state: CatalogState }> {
  const env = opts.env ?? process.env;
  try {
    const catalog = await fetchCatalog(undefined, opts);
    return { catalog, state: { release: catalog.version, source: 'network' } };
  } catch (err) {
    const cached = readCatalogCache(env)?.catalog;
    const error = err instanceof Error ? err.message : String(err);
    if (cached) {
      return { catalog: cached, state: { release: cached.version, source: 'cache', error } };
    }
    return { state: { source: 'none', error } };
  }
}

// ──────────────── Public API ────────────────

export const skillService = {
  /**
   * Install the named skills, or every skill in the catalog when none is named,
   * for the given agents. Skills marked `default` in the catalog are always
   * included. Each skill's files are downloaded once, hashed, and written only
   * when the hash matches; a mismatch skips that skill and marks the run failed.
   */
  async install(names: readonly string[], options: InstallOptions = {}): Promise<InstallRun> {
    const env = options.env ?? process.env;
    const agents = options.agents ?? DEFAULT_SKILL_AGENTS;
    const targets = targetsFor(agents);
    const warnings: string[] = [];
    const pin = pinnedRelease(options.pin);

    let catalog: SkillCatalog;
    let source: 'network' | 'bundled' = 'network';
    try {
      catalog = await fetchCatalog(pin, options);
    } catch (err) {
      if (err instanceof CatalogInvalidError) throw err;
      const fetchErr = err as CatalogFetchError;
      const onlyBundled = names.length > 0 && names.every((n) => n === BUNDLED_SKILL_NAME);
      if (!onlyBundled) {
        const cached = readCatalogCache(env);
        throw new CliError(
          messages.SKILL_CATALOG_UNREACHABLE_INSTALL(
            fetchErr.url ?? catalogUrl(pin, env),
            fetchErr.reason ?? fetchErr.message,
            cached?.catalog?.version,
          ),
        );
      }
      catalog = bundledCatalog();
      source = 'bundled';
      warnings.push(messages.SKILL_OFFLINE_FALLBACK(fetchErr.url ?? catalogUrl(pin, env)));
    }

    const release = source === 'network' ? catalog.version : undefined;
    const skills = selectSkills(catalog, names);
    const downloads = new SkillDownloads(release, source === 'bundled', options);
    const lock = readSkillLock(env);
    const results: InstallResult[] = [];
    let failed = false;

    for (const target of targets) {
      const locked = options.dryRun ? undefined : lockEntry(lock, target.root, target.agents);
      for (const skill of skills) {
        const skillDir = path.join(target.root, skill.name);
        const base = {
          name: skill.name,
          version: skill.version,
          release,
          path: skillDir,
          agents: target.agents,
        };
        if (!fitsPlatform(skill, target.agents)) {
          results.push({
            ...base,
            status: 'skipped',
            reason: 'platform',
            detail: skill.platforms.join(', '),
          });
          continue;
        }
        if (needsNewerCli(skill)) {
          results.push({
            ...base,
            status: 'skipped',
            reason: 'min-cli-version',
            detail: skill.min_cli_version,
          });
          continue;
        }
        const marker = readMarker(skillDir);
        const current =
          marker !== null &&
          marker.version === skill.version &&
          marker.sha256 === skill.sha256 &&
          marker.source === (source === 'bundled' ? 'brevo-cli' : 'brevo-skills');
        if (current && !options.force) {
          results.push({ ...base, status: 'already-installed' });
          if (locked) locked.skills[skill.name] = lockedFromMarker(marker, pin);
          continue;
        }
        const status: InstallStatus = marker ? 'updated' : 'installed';
        if (options.dryRun) {
          results.push({ ...base, status, previousVersion: marker?.version });
          continue;
        }
        const download = await downloads.get(skill);
        if ('reason' in download) {
          failed = true;
          results.push({
            ...base,
            status: 'skipped',
            reason: download.reason,
            detail: download.detail,
          });
          continue;
        }
        try {
          writeSkillFiles(skillDir, skill.name, download.files, marker !== null);
        } catch (err) {
          if (!(err instanceof UnsafeSkillPathError)) throw err;
          failed = true;
          results.push({ ...base, status: 'skipped', reason: 'unsafe-path', detail: err.file });
          continue;
        }
        const markerSource: SkillSource = source === 'bundled' ? 'brevo-cli' : 'brevo-skills';
        writeMarker(skillDir, {
          name: skill.name,
          version: skill.version,
          release,
          sha256: skill.sha256,
          installedAt: new Date().toISOString(),
          source: markerSource,
        });
        locked!.skills[skill.name] = { version: skill.version, release, pin, source: markerSource };
        results.push({ ...base, status, previousVersion: marker?.version });
      }
    }

    if (!options.dryRun) {
      try {
        writeSkillLock(lock, env);
      } catch (err) {
        warnings.push(
          messages.SKILL_LOCK_WRITE_FAILED(err instanceof Error ? err.message : String(err)),
        );
      }
    }

    return {
      results,
      release,
      source,
      dryRun: Boolean(options.dryRun),
      failed,
      mcp: catalog.mcp,
      warnings,
    };
  },

  /**
   * Reinstall the installed skills (the named ones, or all) whose version is
   * behind the catalog, for the given agents. A pinned skill stays on its
   * release until `--pin latest`; `--pin <release>` moves it. `--force`
   * reinstalls even when nothing is behind.
   */
  async update(names: readonly string[], options: InstallOptions = {}): Promise<InstallRun> {
    const env = options.env ?? process.env;
    const agents = options.agents ?? DEFAULT_SKILL_AGENTS;
    const targets = targetsFor(agents);
    const lock = readSkillLock(env);
    const wanted = new Set(names);
    const results: InstallResult[] = [];
    const warnings: string[] = [];
    let failed = false;

    // One catalog per release in play: the latest, plus each pin.
    const catalogs = new Map<string | undefined, SkillCatalog>();
    const downloads = new Map<string | undefined, SkillDownloads>();
    const catalogFor = async (release: string | undefined): Promise<SkillCatalog> => {
      let catalog = catalogs.get(release);
      if (!catalog) {
        try {
          catalog = await fetchCatalog(release, options);
        } catch (err) {
          if (err instanceof CatalogInvalidError) throw err;
          const fetchErr = err as CatalogFetchError;
          throw new CliError(
            messages.SKILL_CATALOG_UNREACHABLE_INSTALL(
              fetchErr.url ?? catalogUrl(release, env),
              fetchErr.reason ?? fetchErr.message,
              readCatalogCache(env)?.catalog?.version,
            ),
          );
        }
        catalogs.set(release, catalog);
        downloads.set(release, new SkillDownloads(catalog.version, false, options));
      }
      return catalog;
    };

    const seen = new Set<string>();
    for (const target of targets) {
      const installed = installedIn(target.root).filter(
        ({ marker }) => wanted.size === 0 || wanted.has(marker.name),
      );
      const locked = options.dryRun ? undefined : lockEntry(lock, target.root, target.agents);
      for (const { dir, marker } of installed) {
        seen.add(marker.name);
        const pin =
          options.pin !== undefined
            ? pinnedRelease(options.pin)
            : lockedPin(lock, target.root, marker.name);
        const catalog = await catalogFor(pin);
        const skill = catalog.skills.find((s) => s.name === marker.name);
        const base = {
          name: marker.name,
          version: skill?.version ?? marker.version,
          release: catalog.version,
          path: dir,
          agents: target.agents,
          previousVersion: marker.version,
        };
        if (!skill) {
          results.push({ ...base, status: 'skipped', reason: 'not-in-catalog' });
          continue;
        }
        if (!isOutdated(marker, skill) && !options.force) {
          results.push({ ...base, status: 'already-installed' });
          if (locked) locked.skills[marker.name] = lockedFromMarker(marker, pin);
          continue;
        }
        if (needsNewerCli(skill)) {
          results.push({
            ...base,
            status: 'skipped',
            reason: 'min-cli-version',
            detail: skill.min_cli_version,
          });
          continue;
        }
        if (options.dryRun) {
          results.push({ ...base, status: 'updated' });
          continue;
        }
        const download = await downloads.get(pin)!.get(skill);
        if ('reason' in download) {
          failed = true;
          results.push({
            ...base,
            status: 'skipped',
            reason: download.reason,
            detail: download.detail,
          });
          continue;
        }
        try {
          writeSkillFiles(dir, skill.name, download.files, true);
        } catch (err) {
          if (!(err instanceof UnsafeSkillPathError)) throw err;
          failed = true;
          results.push({ ...base, status: 'skipped', reason: 'unsafe-path', detail: err.file });
          continue;
        }
        writeMarker(dir, {
          name: skill.name,
          version: skill.version,
          release: catalog.version,
          sha256: skill.sha256,
          installedAt: new Date().toISOString(),
          source: 'brevo-skills',
        });
        locked!.skills[skill.name] = {
          version: skill.version,
          release: catalog.version,
          pin,
          source: 'brevo-skills',
        };
        results.push({ ...base, status: 'updated' });
      }
    }

    for (const name of wanted) {
      if (!seen.has(name)) {
        results.push({
          name,
          version: '',
          status: 'skipped',
          reason: 'not-installed',
          path: '',
          agents: [...agents],
        });
      }
    }

    if (!options.dryRun) {
      try {
        writeSkillLock(lock, env);
      } catch (err) {
        warnings.push(
          messages.SKILL_LOCK_WRITE_FAILED(err instanceof Error ? err.message : String(err)),
        );
      }
    }

    const latest = catalogs.get(undefined);
    return {
      results,
      release: latest?.version ?? [...catalogs.values()][0]?.version,
      source: 'network',
      dryRun: Boolean(options.dryRun),
      failed,
      mcp: latest?.mcp,
      warnings,
    };
  },

  /**
   * Remove the named skills, or every skill the CLI installed, from the given
   * agents' directories (every directory when `agents` is omitted). Only
   * directories carrying the CLI's marker are touched; a name without one is
   * reported as not installed by the CLI and left alone.
   */
  uninstall(
    names: readonly string[],
    options: { agents?: readonly SkillAgent[]; env?: NodeJS.ProcessEnv } = {},
  ): UninstallResult[] {
    const env = options.env ?? process.env;
    const targets = options.agents ? targetsFor(options.agents) : allTargets();
    const lock = readSkillLock(env);
    const results: UninstallResult[] = [];
    const wanted = [...new Set(names)];

    for (const target of targets) {
      const installed = new Map(installedIn(target.root).map((i) => [i.marker.name, i.dir]));
      const candidates = wanted.length ? wanted : [...installed.keys()];
      for (const name of candidates) {
        const dir = installed.get(name);
        if (!dir) {
          // A named skill with no marker here: whether the directory is the
          // user's own or absent, it is reported and left alone.
          results.push({
            name,
            path: path.join(target.root, name),
            agents: target.agents,
            status: 'not-installed',
          });
          continue;
        }
        fs.rmSync(dir, { recursive: true, force: true });
        delete lock.directories[target.root]?.skills[name];
        results.push({ name, path: dir, agents: target.agents, status: 'removed' });
      }
    }

    try {
      writeSkillLock(lock, env);
    } catch {
      // The markers are gone, which is what uninstall promised; the lock catches up on the next install.
    }
    return results;
  },

  /** Installed skills per directory (from the markers and the lock), and what the catalog offers. */
  async list(options: SkillServiceOptions = {}): Promise<ListResult> {
    const env = options.env ?? process.env;
    const lock = readSkillLock(env);
    const { catalog, state } = await latestCatalogOrCache(options);

    const installed = allTargets().flatMap((target) =>
      installedIn(target.root).map(({ dir, marker }) => {
        const latest = catalog?.skills.find((s) => s.name === marker.name);
        return {
          name: marker.name,
          version: marker.version,
          release: marker.release,
          source: marker.source,
          path: dir,
          agents: target.agents,
          pin: lockedPin(lock, target.root, marker.name),
          latestVersion: latest?.version,
          outdated: latest ? isOutdated(marker, latest) : false,
        };
      }),
    );

    const available = (catalog?.skills ?? []).map((s) => ({
      name: s.name,
      version: s.version,
      summary: s.summary,
      platforms: s.platforms,
      default: s.default,
      minCliVersion: s.min_cli_version,
    }));

    return { installed, available, catalog: state };
  },

  /** Report outdated and tampered skills without changing anything. */
  async check(options: SkillServiceOptions = {}): Promise<CheckRun> {
    const { installed, catalog } = await this.list(options);
    const results: CheckResult[] = installed.map((skill) => {
      const marker = readMarker(skill.path);
      const sha256 = marker?.sha256;
      let tampered = false;
      if (sha256) {
        try {
          tampered = hashInstalledDir(skill.path) !== sha256;
        } catch {
          tampered = true;
        }
      }
      return { ...skill, tampered, unverified: !sha256 };
    });
    return {
      results,
      catalog,
      ok: results.every((r) => !r.outdated && !r.tampered),
    };
  },

  /**
   * After any command: when the catalog cache is older than 12 hours, refetch
   * it and, by default, print one line naming the installed, unpinned skills
   * that are behind it and the command that updates them. With
   * BREVO_SKILL_AUTOREFRESH=1 those skills are reinstalled instead, one line
   * per skill. Nothing is fetched when no skill is installed. Network failures
   * are silent, and a failed attempt is recorded so an offline machine does
   * not wait on every command. Never throws.
   */
  async autoRefreshOutdated(opts: AutoRefreshOptions = {}): Promise<void> {
    if (shouldSkipAutoRefresh(opts)) return;
    const env = opts.env ?? process.env;
    const output = opts.output ?? process.stderr;
    const now = opts.now ? opts.now() : Date.now();
    const reinstall = wantsAutoReinstall(env);

    let installed: { dir: string; marker: SkillMarker; agents: SkillAgent[]; root: string }[];
    try {
      installed = allTargets().flatMap((t) =>
        installedIn(t.root).map((i) => ({ ...i, agents: t.agents, root: t.root })),
      );
    } catch {
      return;
    }
    if (installed.length === 0) return;
    if (!isCatalogCacheStale(readCatalogCache(env), now)) return;

    let catalog: SkillCatalog;
    try {
      catalog = await fetchCatalog(undefined, {
        ...opts,
        env,
        timeoutMs: opts.timeoutMs ?? CATALOG_NOTICE_TIMEOUT_MS,
      });
    } catch {
      try {
        noteCatalogAttempt(catalogUrl(undefined, env), now, env);
      } catch {
        // Nothing to do: the next command tries again.
      }
      refreshBundledCopies(installed, output, reinstall);
      return;
    }

    const lock = readSkillLock(env);
    const behind = installed.flatMap(({ dir, marker, root }) => {
      if (lockedPin(lock, root, marker.name)) return [];
      const skill = catalog.skills.find((s) => s.name === marker.name);
      if (!skill || !isOutdated(marker, skill) || needsNewerCli(skill)) return [];
      return [{ dir, marker, root, skill }];
    });
    if (!reinstall) {
      if (behind.length > 0)
        output.write(`  ${messages.SKILL_UPDATES_AVAILABLE(updatesLine(behind))}\n`);
      return;
    }

    const downloads = new SkillDownloads(catalog.version, false, { ...opts, env });
    for (const { dir, marker, root, skill } of behind) {
      try {
        const download = await downloads.get(skill);
        if ('reason' in download) {
          output.write(`  ${messages.SKILL_AUTOREFRESH_FAILED(marker.name, download.detail)}\n`);
          continue;
        }
        writeSkillFiles(dir, skill.name, download.files, true);
        writeMarker(dir, {
          name: skill.name,
          version: skill.version,
          release: catalog.version,
          sha256: skill.sha256,
          installedAt: new Date().toISOString(),
          source: 'brevo-skills',
        });
        const locked = lockEntry(lock, root, []);
        locked.skills[skill.name] = {
          version: skill.version,
          release: catalog.version,
          source: 'brevo-skills',
        };
        output.write(
          `  ${messages.SKILL_AUTOREFRESHED(marker.name, marker.version, skill.version)}\n`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        output.write(`  ${messages.SKILL_AUTOREFRESH_FAILED(marker.name, msg)}\n`);
      }
    }
    try {
      writeSkillLock(lock, env);
    } catch {
      // The markers carry the truth; the lock catches up on the next install.
    }
  },
};

/** One `name (vOld → vNew)` per skill, each installed copy listed once. */
function updatesLine(
  behind: readonly { marker: SkillMarker; skill: { version: string } }[],
): string {
  const seen = new Set<string>();
  return behind
    .filter(({ marker }) => !seen.has(marker.name) && seen.add(marker.name))
    .map(({ marker, skill }) => `${marker.name} (v${marker.version} → v${skill.version})`)
    .join(', ');
}

/**
 * The pre-catalog behaviour, kept for the offline case: a bundled copy of the
 * CLI's own skill whose version is behind the running CLI is rewritten from
 * the bundle, or, by default, named in the update notice. Pure local file ops.
 */
function refreshBundledCopies(
  installed: readonly { dir: string; marker: SkillMarker }[],
  output: NodeJS.WriteStream,
  reinstall: boolean,
): void {
  const bundled = bundledCatalog().skills[0];
  if (!bundled) return;
  const stale = installed.filter(
    ({ marker }) =>
      marker.name === BUNDLED_SKILL_NAME &&
      marker.source === 'brevo-cli' &&
      marker.version !== CLI_VERSION,
  );
  if (!reinstall) {
    if (stale.length > 0) {
      const behind = stale.map((s) => ({ ...s, skill: bundled }));
      output.write(`  ${messages.SKILL_UPDATES_AVAILABLE(updatesLine(behind))}\n`);
    }
    return;
  }
  for (const { dir, marker } of stale) {
    try {
      writeSkillFiles(dir, bundled.name, readBundledFiles(), true);
      writeMarker(dir, {
        name: bundled.name,
        version: bundled.version,
        sha256: bundled.sha256,
        installedAt: new Date().toISOString(),
        source: 'brevo-cli',
      });
      output.write(
        `  ${messages.SKILL_AUTOREFRESHED(marker.name, marker.version, bundled.version)}\n`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      output.write(`  ${messages.SKILL_AUTOREFRESH_FAILED(marker.name, msg)}\n`);
    }
  }
}

export type SkillService = typeof skillService;

// ──────────────── Auto-refresh skip rules ────────────────
// Exported as a free function for direct unit-testing without instantiating
// the whole service. Mirrors update-notifier's `shouldSkipCheck` shape.

export interface AutoRefreshOptions extends CatalogFetchOptions {
  argv?: readonly string[];
  env?: NodeJS.ProcessEnv;
  output?: NodeJS.WriteStream;
}

/** BREVO_SKILL_AUTOREFRESH=1 reinstalls outdated skills after a command instead of only naming them. */
export function wantsAutoReinstall(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.BREVO_SKILL_AUTOREFRESH === '1' || env.BREVO_SKILL_AUTOREFRESH === 'true';
}

export function shouldSkipAutoRefresh(opts: AutoRefreshOptions = {}): boolean {
  const env = opts.env ?? process.env;
  const argv = opts.argv ?? process.argv;

  // CI runners shouldn't have surprise mutations to the user's skill directories.
  if (env.CI === 'true' || env.CI === '1') return true;
  // --json callers want deterministic, machine-readable output.
  if (argv.includes('--json')) return true;
  // The user is already managing skills — let their explicit command do the work.
  if (argv.length > 2 && (argv[2] === 'skill' || argv[2] === 'skill:cli')) return true;
  // Dedicated opt-out: no catalog fetch and no notice at all.
  if (env.BREVO_NO_SKILL_AUTOREFRESH === '1' || env.BREVO_NO_SKILL_AUTOREFRESH === 'true') {
    return true;
  }
  return false;
}
