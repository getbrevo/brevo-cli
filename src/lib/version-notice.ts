import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { messages } from '../lang/en';
import { sanitizeErrorMessage, looksLikeHtml } from '../api/client';
import { renderBox, shouldSkipCheck } from './update-notifier';
import { color, COLOR_RED } from './logger';
import { hasVersionSignal, isUnsupported, mergeVersionSignal, needsNotice } from './version-signal';
import { CLI_NOTICE_CODES, CLI_VERSION_STATUS, SKIP_VERSION_GATE_ENV } from './constants';
import { CliVersionUnsupportedError } from './errors';
import {
  CliInfoQuery,
  CliVersionStatus,
  VersionNotice,
  VersionNoticeCache,
  VersionSignal,
} from '../types';

const CACHE_FILE = 'cli-notice.json';

// The CLI owns the TTL because the v1 `/cli/info` response carries no
// `cache_ttl_seconds`.
export const NOTICE_TTL_MS = 24 * 60 * 60 * 1000;

// `message` is server-supplied text headed for a terminal. Clamping bounds how
// much screen a hostile or broken backend can take, on top of the control-char
// stripping below.
export const MAX_NOTICE_MESSAGE_LEN = 200;

const KNOWN_NOTICE_CODES = new Set<string>(Object.values(CLI_NOTICE_CODES));

export function isKnownNoticeCode(code: unknown): code is string {
  return typeof code === 'string' && KNOWN_NOTICE_CODES.has(code);
}

/**
 * Make server-supplied notice text safe to print.
 *
 * Three separate concerns, in order: reject anything that looks like a gateway
 * HTML page (an SSO proxy in front of `/cli/info` must never be rendered as a
 * notice), strip ANSI/control sequences that could reposition the cursor or
 * fake a prompt, then flatten to a single clamped line so a payload cannot
 * break out of the notice or scroll the screen.
 */
export function sanitizeNoticeMessage(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  if (looksLikeHtml(raw)) return undefined;
  const oneLine = sanitizeErrorMessage(raw).replace(/\s+/g, ' ').trim();
  if (!oneLine) return undefined;
  return oneLine.length > MAX_NOTICE_MESSAGE_LEN
    ? oneLine.slice(0, MAX_NOTICE_MESSAGE_LEN)
    : oneLine;
}

export function getNoticeCachePath(
  override?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (override) return override;
  const dir = env.BREVO_CONFIG_HOME || path.join(os.homedir(), '.brevo');
  return path.join(dir, CACHE_FILE);
}

function parseCachedStatus(raw: unknown): CliVersionStatus | undefined {
  return typeof raw === 'string' && (Object.values(CLI_VERSION_STATUS) as string[]).includes(raw)
    ? (raw as CliVersionStatus)
    : undefined;
}

/**
 * Read the cached verdict, or `undefined` when it cannot be trusted.
 *
 * The `cliVersion` check is the most important rule here: a cache written by a
 * different build carries a verdict about the version the user just upgraded
 * away from. Discarding it wholesale guarantees a freshly upgraded CLI is never
 * blocked by its predecessor's verdict.
 */
export function readNoticeCache(
  cachePath: string,
  cliVersion: string,
): VersionNoticeCache | undefined {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    if (!raw || typeof raw !== 'object') return undefined;
    const c = raw as Record<string, unknown>;
    if (c.cliVersion !== cliVersion) return undefined;
    if (typeof c.fetchedAt !== 'number' || !Number.isFinite(c.fetchedAt)) return undefined;

    const cached = c.notice as VersionNotice | undefined;
    const notice =
      cached && typeof cached === 'object' && isKnownNoticeCode(cached.code)
        ? {
            code: cached.code,
            // Re-sanitize on read: the file is user-writable, so trusting what
            // was written earlier would move the trust boundary to the disk.
            message: sanitizeNoticeMessage(cached.message) ?? '',
          }
        : undefined;

    return {
      cliVersion,
      latestVersion: typeof c.latestVersion === 'string' ? c.latestVersion : undefined,
      status: parseCachedStatus(c.status),
      notice: notice?.message ? notice : undefined,
      fetchedAt: c.fetchedAt,
      ttlMs:
        typeof c.ttlMs === 'number' && Number.isFinite(c.ttlMs) && c.ttlMs > 0
          ? c.ttlMs
          : NOTICE_TTL_MS,
    };
  } catch {
    // Missing or corrupt — indistinguishable from absent, by design.
    return undefined;
  }
}

export function writeNoticeCache(cachePath: string, cache: VersionNoticeCache): void {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf-8');
  } catch {
    // Non-fatal: an unwritable cache costs a refetch next run, nothing more.
  }
}

/** Only the wording ages. The verdict stays valid past the TTL. */
export function isNoticeStale(cache: VersionNoticeCache | undefined, now: number): boolean {
  if (!cache?.notice) return true;
  return now - cache.fetchedAt > cache.ttlMs;
}

/**
 * Render the notice: a red explanation line, then the box.
 *
 * The explanation sits *outside* the box on purpose. It is the one dynamic line
 * — server-supplied when `/cli/info` answered, local wording otherwise — while
 * everything inside the box is fixed, locally-owned text. Keeping the two apart
 * means the box never changes width because of what a server returned.
 *
 * Colour goes through `logger.color`, so it is dropped under `NO_COLOR` or when
 * the stream is not a terminal. The message is already sanitized to a single
 * escape-free clamped line, so wrapping it in a colour code cannot let it break
 * out of the sequence.
 */
export function formatVersionNotice(
  status: CliVersionStatus,
  current: string,
  latest: string | undefined,
  pkgName: string,
  serverMessage?: string,
): string {
  const title =
    status === CLI_VERSION_STATUS.UNSUPPORTED
      ? messages.CLI_VERSION_UNSUPPORTED(current)
      : messages.UPDATE_AVAILABLE(current, latest ?? '');

  const explanation = serverMessage ?? messages.CLI_VERSION_NOTICE_FALLBACK;

  const box = renderBox([
    title,
    messages.FORCE_UPDATE_HINT,
    messages.UPDATE_RUN(pkgName),
    messages.UPDATE_RUN_YARN(pkgName),
    messages.UPDATE_RUN_BREW,
  ]);

  return `\n  ${color(COLOR_RED, explanation)}\n${box}`;
}

export type FetchNotice = (query: CliInfoQuery) => Promise<VersionNotice | undefined>;

export interface VersionGateDeps {
  cliVersion: string;
  pkgName: string;
  cachePath?: string;
  env?: NodeJS.ProcessEnv;
  argv?: readonly string[];
  isTTY?: boolean;
  now?: () => number;
  ttlMs?: number;
  os?: string;
  /** Injected so the gate is testable without network. */
  fetchNotice?: FetchNotice;
}

export interface VersionGate {
  status(): CliVersionStatus | undefined;
  /** True when the command must not run. */
  shouldBlock(): boolean;
  /** True when a notice should be printed (respects the notice opt-outs). */
  shouldNotify(): boolean;
  /** Fold in a signal observed on a live response. Throws when it newly blocks. */
  record(signal: VersionSignal): void;
  /** Build the notice, fetching wording when the cached copy is stale. */
  render(): Promise<string | undefined>;
  /** `--json` error envelope for a blocked run. */
  jsonEnvelope(): Record<string, unknown>;
  signal(): VersionSignal;
}

/**
 * Applies the backend's verdict about this CLI version.
 *
 * The CLI does no version comparison of its own: the backend already knows the
 * caller's version from the `User-Agent` on every request, so it owns the
 * support policy and simply returns a decision. That policy can then change
 * without a CLI release.
 *
 * Ordering is the tricky part. The verdict arrives *from* a response, but the
 * gate has to precede the command — so a cached verdict gates at startup with
 * no network at all, and a verdict discovered mid-run throws from inside
 * `ApiClient.request`, before the command has written anything.
 */
export function createVersionGate(deps: VersionGateDeps): VersionGate {
  const env = deps.env ?? process.env;
  const now = (): number => (deps.now ? deps.now() : Date.now());
  const cachePath = getNoticeCachePath(deps.cachePath, env);

  const cache = readNoticeCache(cachePath, deps.cliVersion);
  let current: VersionSignal = { latestVersion: cache?.latestVersion, status: cache?.status };
  let notice: VersionNotice | undefined = cache?.notice;
  let noticeFetchedAt = cache?.fetchedAt ?? 0;
  let blockAnnounced = false;

  // Emergency bypass for a mistaken backend rollout. Deliberately not
  // documented as a routine opt-out.
  const gateBypassed = (): boolean =>
    env[SKIP_VERSION_GATE_ENV] === '1' || env[SKIP_VERSION_GATE_ENV] === 'true';

  const persist = (): void => {
    writeNoticeCache(cachePath, {
      cliVersion: deps.cliVersion,
      latestVersion: current.latestVersion,
      status: current.status,
      notice,
      fetchedAt: noticeFetchedAt,
      ttlMs: deps.ttlMs ?? NOTICE_TTL_MS,
    });
  };

  const buildError = (): CliVersionUnsupportedError =>
    new CliVersionUnsupportedError(
      notice?.message ?? messages.CLI_VERSION_UNSUPPORTED(deps.cliVersion),
      {
        currentVersion: deps.cliVersion,
        latestVersion: current.latestVersion,
        upgrade: messages.CLI_VERSION_UPGRADE_COMMAND(deps.pkgName),
      },
    );

  return {
    signal: () => ({ ...current }),
    status: () => current.status,

    shouldBlock: () => isUnsupported(current) && !gateBypassed(),

    // The notice opt-outs (CI, non-TTY, NO_UPDATE_NOTIFIER, --no-update-notifier)
    // suppress the *notice* only. They never suppress a block: with an
    // authoritative backend verdict, a CI job on a dead version would otherwise
    // fail later on real API errors with a far worse message.
    shouldNotify: () => {
      if (!needsNotice(current)) return false;
      if (isUnsupported(current)) return true;
      return !shouldSkipCheck({
        pkg: { name: deps.pkgName, version: deps.cliVersion },
        env,
        argv: deps.argv,
        isTTY: deps.isTTY,
      });
    },

    record: (incoming: VersionSignal) => {
      if (!hasVersionSignal(incoming)) return;
      current = mergeVersionSignal(current, incoming);
      persist();

      // Abort the run the first time a block is discovered, from inside the
      // request that discovered it — before the command writes files or
      // reports success.
      if (isUnsupported(current) && !gateBypassed() && !blockAnnounced) {
        blockAnnounced = true;
        throw buildError();
      }
    },

    render: async (): Promise<string | undefined> => {
      if (!needsNotice(current) || !current.status) return undefined;

      if (
        deps.fetchNotice &&
        isNoticeStale(
          { cliVersion: deps.cliVersion, notice, fetchedAt: noticeFetchedAt, ttlMs: NOTICE_TTL_MS },
          now(),
        )
      ) {
        const fetched = await deps.fetchNotice({
          reason: 'version_mismatch',
          currentVersion: deps.cliVersion,
          latestVersion: current.latestVersion,
          status: current.status,
          os: deps.os ?? 'other',
        });
        if (fetched) {
          notice = fetched;
          noticeFetchedAt = now();
          persist();
        }
      }

      return formatVersionNotice(
        current.status,
        deps.cliVersion,
        current.latestVersion,
        deps.pkgName,
        notice?.message,
      );
    },

    jsonEnvelope: () => ({
      error: {
        code: 'CLI_VERSION_UNSUPPORTED',
        message: buildError().message,
        current_version: deps.cliVersion,
        latest_version: current.latestVersion,
        upgrade: messages.CLI_VERSION_UPGRADE_COMMAND(deps.pkgName),
      },
    }),
  };
}
