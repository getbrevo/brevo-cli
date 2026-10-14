import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { messages } from '../lang/en';
import { CliError } from '../lib/errors';

// ──────────────── Where the catalog lives ────────────────
// The brevo-skills repo publishes `catalog.json` as a release asset, so the
// latest catalog has a stable URL and a pinned one is addressed by its tag.
// Skill files are read from the tagged tree, never from a branch, so what the
// catalog's sha256 describes is exactly what gets downloaded.
//
// Both roots are overridable so tests and forks can point the CLI at a stub:
// BREVO_SKILLS_CATALOG_URL replaces the catalog URL outright (latest and
// pinned alike — a fork serving one file has no release to address), and
// BREVO_SKILLS_FILES_URL replaces the raw-files base in front of
// `/v<release>/<path>/<file>`.

const RELEASES_BASE = 'https://github.com/getbrevo/brevo-skills/releases';
const RAW_FILES_BASE = 'https://raw.githubusercontent.com/getbrevo/brevo-skills';

/** Same budget as the npm update check: the catalog must never hold a command up. */
export const CATALOG_FETCH_TIMEOUT_MS = 2000;

/** The cached latest catalog counts as fresh for this long (auto-refresh reads it). */
export const CATALOG_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

const CATALOG_CACHE_FILE = 'skills-catalog.json';

export function catalogUrl(release?: string, env: NodeJS.ProcessEnv = process.env): string {
  const override = env.BREVO_SKILLS_CATALOG_URL?.trim();
  if (override) return override;
  return release
    ? `${RELEASES_BASE}/download/v${release}/catalog.json`
    : `${RELEASES_BASE}/latest/download/catalog.json`;
}

export function skillFileUrl(
  release: string,
  skillPath: string,
  file: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const base = (env.BREVO_SKILLS_FILES_URL?.trim() || RAW_FILES_BASE).replace(/\/+$/, '');
  return `${base}/v${release}/${skillPath}/${file}`;
}

export function getCatalogCachePath(env: NodeJS.ProcessEnv = process.env): string {
  const dir = env.BREVO_CONFIG_HOME || path.join(os.homedir(), '.brevo');
  return path.join(dir, CATALOG_CACHE_FILE);
}

// ──────────────── Catalog shape ────────────────

export type SkillPlatform = 'claude' | 'openai' | 'gemini';

export interface CatalogMcp {
  serverName: string;
  endpoints: Partial<Record<SkillPlatform, string>>;
}

export interface CatalogSkill {
  name: string;
  version: string;
  summary: string;
  status?: string;
  role?: string;
  /** Installed on every `brevo skill install`, whatever was named (the router). */
  default: boolean;
  platforms: SkillPlatform[];
  /** Oldest CLI the skill's instructions are written for; newer than ours means skip. */
  min_cli_version?: string;
  /** Directory in the tagged tree the files are read from. */
  path: string;
  /** Relative to `path`; the files the installer writes and the hash covers. */
  files: string[];
  /** Hex sha256 over the files, see {@link hashFiles}. */
  sha256: string;
}

export interface SkillCatalog {
  /** The release the catalog describes — the `v<version>` tag the files are read at. */
  version: string;
  plugin?: string;
  /** Absent in catalogs built before the installer existed; `--mcp` then has nothing to register. */
  mcp?: CatalogMcp;
  skills: CatalogSkill[];
}

export interface CatalogCache {
  /** When `catalog` was fetched; 0 when no fetch has ever succeeded. */
  fetchedAt: number;
  /** The last fetch attempt, successful or not, so an offline machine is not retried on every command. */
  attemptedAt: number;
  url: string;
  /** Absent when no fetch has succeeded yet, or the cached copy no longer validates. */
  catalog?: SkillCatalog;
}

/** Thrown when the catalog could not be reached or did not answer in time. */
export class CatalogFetchError extends CliError {
  constructor(
    public readonly url: string,
    public readonly reason: string,
  ) {
    super(messages.SKILL_CATALOG_UNREACHABLE(url, reason));
    this.name = 'CatalogFetchError';
  }
}

/** Thrown when a fetched (or cached) catalog does not have the shape installers rely on. */
export class CatalogInvalidError extends CliError {
  constructor(public readonly problem: string) {
    super(messages.SKILL_CATALOG_INVALID(problem));
    this.name = 'CatalogInvalidError';
  }
}

const PLATFORMS: readonly SkillPlatform[] = ['claude', 'openai', 'gemini'];
const SHA256_RE = /^[0-9a-f]{64}$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

/** The marker the installer writes next to a skill's files; a catalog may not ship one. */
export const SKILL_MARKER_FILE = '.brevo-skill.json';

// One path segment. Deliberately narrow: letters, digits, dot, underscore and
// dash. Backslashes, colons (drive letters), control characters and anything
// a shell or a Windows path parser could read as structure are refused.
const PATH_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

/**
 * True for a `/`-joined relative path whose every segment is a plain name:
 * not `.` or `..`, not empty (no leading, trailing or doubled slashes), not the
 * installer's own marker. Files and skill paths are joined onto the user's
 * home directory, so this check is the one that keeps a catalog from writing
 * outside the skill directory — the write site checks again.
 */
export function isSafeRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  const segments = value.split('/');
  return segments.every(
    (segment) =>
      PATH_SEGMENT_RE.test(segment) &&
      segment !== '.' &&
      segment !== '..' &&
      segment !== SKILL_MARKER_FILE,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function validateSkill(raw: unknown, index: number): CatalogSkill {
  const where = `skills[${index}]`;
  if (!isRecord(raw)) throw new CatalogInvalidError(`${where} is not an object`);
  const { name, version, path: skillPath, files, sha256, platforms } = raw;
  if (typeof name !== 'string' || !SKILL_NAME_RE.test(name)) {
    throw new CatalogInvalidError(`${where}.name is missing or not a skill name`);
  }
  if (typeof version !== 'string' || !VERSION_RE.test(version)) {
    throw new CatalogInvalidError(`${name}: version is missing or not semver`);
  }
  if (!isSafeRelativePath(skillPath)) {
    throw new CatalogInvalidError(`${name}: path is missing or not a relative path`);
  }
  if (!isStringArray(files) || files.length === 0) {
    throw new CatalogInvalidError(`${name}: files is missing or empty`);
  }
  for (const file of files) {
    if (!isSafeRelativePath(file)) {
      throw new CatalogInvalidError(`${name}: file "${file}" is not a relative path`);
    }
  }
  if (typeof sha256 !== 'string' || !SHA256_RE.test(sha256)) {
    throw new CatalogInvalidError(`${name}: sha256 is missing or not a hex sha256`);
  }
  if (!isStringArray(platforms)) {
    throw new CatalogInvalidError(`${name}: platforms is missing`);
  }
  if (raw.min_cli_version !== undefined) {
    if (typeof raw.min_cli_version !== 'string' || !VERSION_RE.test(raw.min_cli_version)) {
      throw new CatalogInvalidError(`${name}: min_cli_version is not semver`);
    }
  }
  return {
    name,
    version,
    summary: typeof raw.summary === 'string' ? raw.summary : '',
    status: typeof raw.status === 'string' ? raw.status : undefined,
    role: typeof raw.role === 'string' ? raw.role : undefined,
    default: raw.default === true,
    // Unknown platform names are dropped rather than rejected: a catalog that
    // adds a platform this CLI predates must still install for the ones it knows.
    platforms: platforms.filter((p): p is SkillPlatform =>
      (PLATFORMS as readonly string[]).includes(p),
    ),
    min_cli_version: raw.min_cli_version as string | undefined,
    path: skillPath,
    files: [...files],
    sha256,
  };
}

function validateMcp(raw: unknown): CatalogMcp | undefined {
  if (!isRecord(raw)) return undefined;
  if (typeof raw.serverName !== 'string' || !raw.serverName) return undefined;
  const endpoints: Partial<Record<SkillPlatform, string>> = {};
  if (isRecord(raw.endpoints)) {
    for (const platform of PLATFORMS) {
      const url = raw.endpoints[platform];
      if (typeof url === 'string' && /^https:\/\//.test(url)) endpoints[platform] = url;
    }
  }
  return { serverName: raw.serverName, endpoints };
}

/**
 * Check a parsed catalog has what the installer needs. Throws
 * {@link CatalogInvalidError} naming the first problem; the message is what the
 * user sees, so it names the skill and the field rather than a JSON pointer.
 */
export function validateCatalog(raw: unknown): SkillCatalog {
  if (!isRecord(raw)) throw new CatalogInvalidError('not a JSON object');
  if (typeof raw.version !== 'string' || !VERSION_RE.test(raw.version)) {
    throw new CatalogInvalidError('version is missing or not semver');
  }
  if (!Array.isArray(raw.skills)) throw new CatalogInvalidError('skills is missing');
  const skills = raw.skills.map(validateSkill);
  const seen = new Set<string>();
  for (const skill of skills) {
    if (seen.has(skill.name)) throw new CatalogInvalidError(`${skill.name} is listed twice`);
    seen.add(skill.name);
  }
  return {
    version: raw.version,
    plugin: typeof raw.plugin === 'string' ? raw.plugin : undefined,
    mcp: validateMcp(raw.mcp),
    skills,
  };
}

// ──────────────── Hash contract ────────────────

export interface SkillFile {
  /** Relative to the skill directory, forward slashes. */
  path: string;
  bytes: Buffer;
}

/**
 * The catalog's `sha256`: one digest over every shipped file, each fed as
 * `<relative path>\0<bytes>\0`, in sorted path order. The separators keep a
 * file's name and its contents from being read as one another's, and sorting
 * makes the result independent of the order the files were listed or fetched.
 */
export function hashFiles(files: readonly SkillFile[]): string {
  const hash = crypto.createHash('sha256');
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const file of sorted) {
    hash.update(file.path, 'utf-8');
    hash.update(Buffer.from([0]));
    hash.update(file.bytes);
    hash.update(Buffer.from([0]));
  }
  return hash.digest('hex');
}

// ──────────────── Cache ────────────────

export function readCatalogCache(env: NodeJS.ProcessEnv = process.env): CatalogCache | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(getCatalogCachePath(env), 'utf-8'));
  } catch {
    // Missing or unreadable: every caller treats that as "no cache".
    return undefined;
  }
  if (
    !isRecord(raw) ||
    typeof raw.fetchedAt !== 'number' ||
    !Number.isFinite(raw.fetchedAt) ||
    typeof raw.url !== 'string'
  ) {
    return undefined;
  }
  let catalog: SkillCatalog | undefined;
  try {
    catalog = raw.catalog === undefined ? undefined : validateCatalog(raw.catalog);
  } catch {
    // A cached copy that no longer validates is dropped; the timestamps still count.
    catalog = undefined;
  }
  const attemptedAt =
    typeof raw.attemptedAt === 'number' && Number.isFinite(raw.attemptedAt)
      ? raw.attemptedAt
      : raw.fetchedAt;
  return { fetchedAt: raw.fetchedAt, attemptedAt, url: raw.url, catalog };
}

export function writeCatalogCache(cache: CatalogCache, env: NodeJS.ProcessEnv = process.env): void {
  try {
    const cachePath = getCatalogCachePath(env);
    fs.mkdirSync(path.dirname(cachePath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2) + '\n', 'utf-8');
  } catch {
    // Non-fatal: the next command fetches again.
  }
}

/** Record a failed fetch so the next commands do not each wait on the same dead network. */
export function noteCatalogAttempt(
  url: string,
  now: number = Date.now(),
  env: NodeJS.ProcessEnv = process.env,
): void {
  const existing = readCatalogCache(env);
  writeCatalogCache(
    {
      fetchedAt: existing?.fetchedAt ?? 0,
      attemptedAt: now,
      url: existing?.url ?? url,
      catalog: existing?.catalog,
    },
    env,
  );
}

/** True when nothing has been fetched, or attempted, within `maxAgeMs`. */
export function isCatalogCacheStale(
  cache: CatalogCache | undefined,
  now: number = Date.now(),
  maxAgeMs: number = CATALOG_CACHE_MAX_AGE_MS,
): boolean {
  if (!cache) return true;
  return now - Math.max(cache.fetchedAt, cache.attemptedAt) > maxAgeMs;
}

// ──────────────── Fetching ────────────────

export interface CatalogFetchOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}

async function fetchWithTimeout(
  url: string,
  opts: CatalogFetchOptions,
): Promise<{ ok: true; res: Response } | { ok: false; reason: string }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? CATALOG_FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json, text/plain, */*' },
      redirect: 'follow',
    });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    return { ok: true, res };
  } catch (err) {
    if (controller.signal.aborted) return { ok: false, reason: 'timed out' };
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch and validate the catalog for `release`, or the latest one. The latest
 * catalog is written to the cache on success; a pinned one is not, because the
 * cache answers "what is current" and a pin is deliberately not that.
 *
 * Throws {@link CatalogFetchError} when the network does not deliver and
 * {@link CatalogInvalidError} when what it delivered is not a catalog. Callers
 * decide what to do with the cache in each case.
 */
export async function fetchCatalog(
  release?: string,
  opts: CatalogFetchOptions = {},
): Promise<SkillCatalog> {
  const env = opts.env ?? process.env;
  const url = catalogUrl(release, env);
  const result = await fetchWithTimeout(url, opts);
  if (!result.ok) throw new CatalogFetchError(url, result.reason);

  let body: unknown;
  try {
    body = await result.res.json();
  } catch {
    throw new CatalogInvalidError('not JSON');
  }
  const catalog = validateCatalog(body);
  if (release && catalog.version !== release) {
    throw new CatalogInvalidError(`release ${release} served catalog ${catalog.version}`);
  }
  if (!release) {
    const now = opts.now ? opts.now() : Date.now();
    writeCatalogCache({ fetchedAt: now, attemptedAt: now, url, catalog }, env);
  }
  return catalog;
}

/**
 * Download one skill's files from the tagged tree, in the catalog's file order.
 * The caller hashes them and refuses a mismatch; this only moves bytes.
 */
export async function fetchSkillFiles(
  skill: CatalogSkill,
  release: string,
  opts: CatalogFetchOptions = {},
): Promise<SkillFile[]> {
  const env = opts.env ?? process.env;
  const files: SkillFile[] = [];
  for (const file of skill.files) {
    const url = skillFileUrl(release, skill.path, file, env);
    const result = await fetchWithTimeout(url, opts);
    if (!result.ok) throw new CatalogFetchError(url, result.reason);
    files.push({ path: file, bytes: Buffer.from(await result.res.arrayBuffer()) });
  }
  return files;
}
