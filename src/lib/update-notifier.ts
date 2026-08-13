import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { messages } from '../lang/en';
import { color, COLOR_RED } from './logger';

const REGISTRY_URL = (name: string): string =>
  `https://registry.npmjs.org/${encodeURIComponent(name).replace('%40', '@')}/latest`;

const TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 2000;
const NOTIFY_WAIT_MS = 1500;

const CACHE_FILE = 'update-check.json';

export interface PkgInfo {
  name: string;
  version: string;
}

export interface UpdateCheckCache {
  latest: string;
  lastChecked: number;
}

export interface UpdateNotifierOptions {
  pkg: PkgInfo;
  argv?: readonly string[];
  env?: NodeJS.ProcessEnv;
  isTTY?: boolean;
  cachePath?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  ttlMs?: number;
  fetchTimeoutMs?: number;
}

function getCachePath(override?: string, env: NodeJS.ProcessEnv = process.env): string {
  if (override) return override;
  const dir = env.BREVO_CONFIG_HOME || path.join(os.homedir(), '.brevo');
  return path.join(dir, CACHE_FILE);
}

// True when the banner must print before parseAsync runs, either because
// Commander exits synchronously (bare `brevo`, --help, --version) and would
// bypass the post-run notify, or because the command starts a long interactive
// flow where users should see the upgrade up front.
export function shouldShowBannerBefore(argv: readonly string[]): boolean {
  const args = argv.slice(2);
  if (args.length === 0) return true;
  if (args.includes('--help') || args.includes('-h')) return true;
  if (args.includes('--version') || args.includes('-V')) return true;
  return args[0] === 'app' && (args[1] === 'init' || args[1] === 'create');
}

export function shouldSkipCheck(opts: UpdateNotifierOptions): boolean {
  const env = opts.env ?? process.env;
  const argv = opts.argv ?? process.argv;
  const isTTY = opts.isTTY ?? Boolean(process.stdout.isTTY);

  if (env.CI === 'true' || env.CI === '1') return true;
  if (!isTTY) return true;
  if (env.NO_UPDATE_NOTIFIER === '1' || env.NO_UPDATE_NOTIFIER === 'true') return true;
  if (env.BREVO_NO_UPDATE_NOTIFIER === '1' || env.BREVO_NO_UPDATE_NOTIFIER === 'true') return true;
  if (argv.includes('--no-update-notifier')) return true;

  return false;
}

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string;
}

function parseVersion(v: string): ParsedVersion | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(v.trim());
  if (!match?.[1] || !match?.[2] || !match?.[3]) return undefined;
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
    prerelease: match[4] ?? '',
  };
}

// Numeric identifiers are compared numerically and always rank below
// non-numeric ones (semver §11.4).
function comparePrereleaseIdentifiers(ai: string, bi: string): number {
  if (ai === bi) return 0;
  const aNum = /^\d+$/.test(ai);
  const bNum = /^\d+$/.test(bi);
  if (aNum && bNum) {
    const diff = Number.parseInt(ai, 10) - Number.parseInt(bi, 10);
    if (diff === 0) return 0;
    return diff > 0 ? 1 : -1;
  }
  if (aNum) return -1;
  if (bNum) return 1;
  return ai > bi ? 1 : -1;
}

// Per semver §11.4: split on '.', compare identifiers; a longer prerelease
// set outranks a shorter one when the leading identifiers match.
function comparePrerelease(a: string, b: string): number {
  if (a === b) return 0;
  const aParts = a.split('.');
  const bParts = b.split('.');
  const len = Math.min(aParts.length, bParts.length);
  for (let i = 0; i < len; i++) {
    const cmp = comparePrereleaseIdentifiers(aParts[i] ?? '', bParts[i] ?? '');
    if (cmp !== 0) return cmp;
  }
  if (aParts.length === bParts.length) return 0;
  return aParts.length > bParts.length ? 1 : -1;
}

export function compareVersions(current: string, latest: string): number {
  const c = parseVersion(current);
  const l = parseVersion(latest);
  if (!c || !l) return 0;
  if (l.major !== c.major) return l.major - c.major;
  if (l.minor !== c.minor) return l.minor - c.minor;
  if (l.patch !== c.patch) return l.patch - c.patch;
  if (c.prerelease && !l.prerelease) return 1;
  if (!c.prerelease && l.prerelease) return -1;
  return comparePrerelease(l.prerelease, c.prerelease);
}

export function isNewer(current: string, latest: string): boolean {
  return compareVersions(current, latest) > 0;
}

// True when `latest` is at least one full major version ahead of `current`.
// Used to gate the blocking force-update banner — a new major release is the
// signal that the installed CLI may no longer be supported by the backend.
export function isMajorBehind(current: string, latest: string): boolean {
  const c = parseVersion(current);
  const l = parseVersion(latest);
  if (!c || !l) return false;
  return l.major > c.major;
}

export function readCache(cachePath: string): UpdateCheckCache | undefined {
  try {
    const raw = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    if (
      raw &&
      typeof raw === 'object' &&
      typeof raw.latest === 'string' &&
      typeof raw.lastChecked === 'number' &&
      Number.isFinite(raw.lastChecked)
    ) {
      return { latest: raw.latest, lastChecked: raw.lastChecked };
    }
  } catch {
    // missing or corrupt — caller treats as no cache
  }
  return undefined;
}

export function writeCache(cachePath: string, cache: UpdateCheckCache): void {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf-8');
  } catch {
    // non-fatal — banner still works from in-memory value
  }
}

export async function fetchLatestVersion(
  name: string,
  opts?: UpdateNotifierOptions,
): Promise<string | undefined> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const timeoutMs = opts?.fetchTimeoutMs ?? FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(REGISTRY_URL(name), {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return undefined;
    const json = (await res.json()) as { version?: unknown };
    return typeof json.version === 'string' ? json.version : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

// Renders the lines into a bordered box, auto-sized to the longest line.
function renderBox(lines: string[]): string {
  const inner = Math.max(...lines.map((l) => l.length)) + 4;
  const top = '╭' + '─'.repeat(inner) + '╮';
  const bot = '╰' + '─'.repeat(inner) + '╯';
  const pad = (s: string): string => '  ' + s + ' '.repeat(inner - s.length - 2);
  return ['', `  ${top}`, ...lines.map((l) => `  │${pad(l)}│`), `  ${bot}`, ''].join('\n');
}

// The notice line sits *outside* the box on purpose. It is the one dynamic
// line — server-supplied when /cli/info answered, local wording otherwise —
// while everything inside the box is fixed, locally-owned text. Keeping the two
// apart means the box never changes width because of what a server returned.
//
// Colour goes through logger.color, so it is dropped under NO_COLOR or when the
// stream is not a terminal. The message is already sanitized to a single
// escape-free clamped line, so wrapping it in a colour code cannot let it break
// out of the sequence.
function withNotice(box: string, serverMessage?: string): string {
  const line = serverMessage ?? messages.CLI_VERSION_NOTICE_FALLBACK;
  return `\n  ${color(COLOR_RED, line)}\n${box}`;
}

export function formatBanner(
  current: string,
  latest: string,
  name: string,
  serverMessage?: string,
): string {
  return withNotice(
    renderBox([
      messages.UPDATE_AVAILABLE(current, latest),
      messages.UPDATE_RUN(name),
      messages.UPDATE_RUN_YARN(name),
      messages.UPDATE_RUN_BREW,
    ]),
    serverMessage,
  );
}

export function formatForceUpdateBanner(
  current: string,
  latest: string,
  name: string,
  serverMessage?: string,
): string {
  return withNotice(
    renderBox([
      messages.FORCE_UPDATE_REQUIRED(current, latest),
      messages.FORCE_UPDATE_HINT,
      messages.UPDATE_RUN(name),
      messages.UPDATE_RUN_YARN(name),
      messages.UPDATE_RUN_BREW,
    ]),
    serverMessage,
  );
}

/**
 * Banner for a run the API has blocked. When the npm check knows the latest
 * version this is the ordinary force-update banner; otherwise it drops the
 * version line, since there is no honest value to put in it. Either way every
 * line inside the box is one the CLI already showed.
 */
export function formatBlockedBanner(
  current: string,
  latest: string | undefined,
  name: string,
  serverMessage?: string,
): string {
  if (latest) return formatForceUpdateBanner(current, latest, name, serverMessage);
  return withNotice(
    renderBox([
      messages.FORCE_UPDATE_HINT,
      messages.UPDATE_RUN(name),
      messages.UPDATE_RUN_YARN(name),
      messages.UPDATE_RUN_BREW,
    ]),
    serverMessage,
  );
}

export interface UpdateCheckHandle {
  cachedLatest?: string;
  pending: Promise<void>;
  /** Set once a banner has been written, so repeat calls are no-ops. */
  notified?: boolean;
  /**
   * The notice line to render above the box, set by the caller from the API
   * response. Deliberately in-memory only and never persisted: the wording is
   * fetched fresh on every run, so a reworded message reaches users immediately
   * rather than after a cache expires.
   */
  notice?: string;
}

export function startUpdateCheck(opts: UpdateNotifierOptions): UpdateCheckHandle {
  if (shouldSkipCheck(opts)) {
    return { pending: Promise.resolve() };
  }

  const cachePath = getCachePath(opts.cachePath, opts.env);
  const now = opts.now ? opts.now() : Date.now();
  const ttl = opts.ttlMs ?? TTL_MS;
  const cache = readCache(cachePath);

  const stale = !cache || now - cache.lastChecked > ttl;
  if (!stale) {
    return { cachedLatest: cache?.latest, pending: Promise.resolve() };
  }

  const handle: UpdateCheckHandle = {
    cachedLatest: cache?.latest,
    pending: Promise.resolve(),
  };
  handle.pending = (async () => {
    const latest = await fetchLatestVersion(opts.pkg.name, opts);
    if (latest) {
      // Prefer the freshly fetched version so first-run users (no cache)
      // and stale-cache users see the banner without waiting another run.
      handle.cachedLatest = latest;
      writeCache(cachePath, { latest, lastChecked: now });
    }
  })();

  return handle;
}

// Idempotent: safe to call from every exit path. The first call that actually
// writes the banner marks the handle, and later calls become no-ops.
export async function notifyUpdate(
  handle: UpdateCheckHandle,
  pkg: PkgInfo,
  output: NodeJS.WriteStream = process.stderr,
  waitMs: number = NOTIFY_WAIT_MS,
): Promise<void> {
  if (handle.notified) return;

  await Promise.race([
    handle.pending,
    new Promise<void>((resolve) => setTimeout(resolve, waitMs).unref?.()),
  ]);

  if (handle.cachedLatest && isNewer(pkg.version, handle.cachedLatest)) {
    handle.notified = true;
    output.write(formatBanner(pkg.version, handle.cachedLatest, pkg.name, handle.notice) + '\n');
  }
}

// Blocking force-update gate. When the latest npm version is a full major
// version ahead of the installed one, writes the force-update banner and
// returns true so the caller can stop before running the command.
//
// Fails open: if the version check was skipped (CI / non-TTY / opt-out, in
// which case the handle has no cachedLatest) or the fetch hasn't resolved
// within waitMs, returns false so a slow or unreachable npm registry never
// blocks the user.
export async function enforceMinVersion(
  handle: UpdateCheckHandle,
  pkg: PkgInfo,
  output: NodeJS.WriteStream = process.stderr,
  waitMs: number = NOTIFY_WAIT_MS,
): Promise<boolean> {
  await Promise.race([
    handle.pending,
    new Promise<void>((resolve) => setTimeout(resolve, waitMs).unref?.()),
  ]);

  if (handle.cachedLatest && isMajorBehind(pkg.version, handle.cachedLatest)) {
    output.write(
      formatForceUpdateBanner(pkg.version, handle.cachedLatest, pkg.name, handle.notice) + '\n',
    );
    return true;
  }
  return false;
}
