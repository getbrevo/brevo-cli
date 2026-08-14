import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { APP_STORE_BASE, ENDPOINTS } from '../lib/constants';
import { sanitizeErrorMessage, looksLikeHtml } from '../api/client';
import { CliInfo, CliInfoQuery, CliInfoResponse } from '../types';

// Budget for the whole call. The notice is cosmetic and the banner is already
// going to be shown, so the user waits at most this long for nicer wording
// before the local text is used instead.
const CLI_INFO_TIMEOUT_MS = 1500;

// `message` is server-supplied text headed for a terminal. Clamping bounds how
// much screen a hostile or broken backend can take, on top of the control-char
// stripping below.
const MAX_NOTICE_MESSAGE_LEN = 200;

// The whole response (notice + block verdict) is cached for 15 minutes so a
// healthy fleet of invocations doesn't hit the app-store service on every
// single command. Short enough that a reworded notice or a new block reaches
// users the same working session rather than after the old 12h npm-style TTL.
const CLI_INFO_CACHE_TTL_MS = 15 * 60 * 1000;
const CLI_INFO_CACHE_FILE = 'cli-info-cache.json';

interface CliInfoCache {
  cliVersion: string;
  info: CliInfo;
  lastChecked: number;
}

function getCliInfoCachePath(env: NodeJS.ProcessEnv): string {
  const dir = env.BREVO_CONFIG_HOME || path.join(os.homedir(), '.brevo');
  return path.join(dir, CLI_INFO_CACHE_FILE);
}

function readCliInfoCache(cachePath: string): CliInfoCache | undefined {
  try {
    const raw = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    if (
      raw &&
      typeof raw === 'object' &&
      typeof raw.cliVersion === 'string' &&
      typeof raw.lastChecked === 'number' &&
      Number.isFinite(raw.lastChecked) &&
      raw.info &&
      typeof raw.info === 'object' &&
      typeof raw.info.isBlocked === 'boolean'
    ) {
      return {
        cliVersion: raw.cliVersion,
        lastChecked: raw.lastChecked,
        info: {
          isBlocked: raw.info.isBlocked,
          upgradeMessage:
            typeof raw.info.upgradeMessage === 'string' ? raw.info.upgradeMessage : undefined,
        },
      };
    }
  } catch {
    // missing or corrupt — caller treats as a cache miss
  }
  return undefined;
}

function writeCliInfoCache(cachePath: string, cache: CliInfoCache): void {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf-8');
  } catch {
    // non-fatal — the next invocation just re-fetches
  }
}

/**
 * Make server-supplied notice text safe to print.
 *
 * Three separate concerns, in order: reject anything that looks like a gateway
 * HTML page (an SSO proxy in front of `/cli/info` must never be rendered as a
 * notice), strip ANSI/control sequences that could reposition the cursor or
 * fake a prompt, then flatten to a single clamped line so a payload cannot
 * break out of the notice or scroll the screen.
 *
 * Returns `undefined` when nothing usable survives, which callers treat as
 * "fall back to local wording".
 */
function sanitizeNoticeMessage(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  if (looksLikeHtml(raw)) return undefined;
  const oneLine = sanitizeErrorMessage(raw).replace(/\s+/g, ' ').trim();
  if (!oneLine) return undefined;
  return oneLine.length > MAX_NOTICE_MESSAGE_LEN
    ? oneLine.slice(0, MAX_NOTICE_MESSAGE_LEN)
    : oneLine;
}

export interface FetchCliInfoOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  // Cache overrides — tests point these at a scratch directory / clock rather
  // than touching the real ~/.brevo cache or the system clock.
  cachePath?: string;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  ttlMs?: number;
}

function buildUrl(baseUrl: string, query: CliInfoQuery): string {
  const params = new URLSearchParams({
    cli_version: query.cliVersion,
    reason: query.reason,
  });
  return `${baseUrl}${ENDPOINTS.CLI_INFO}?${params.toString()}`;
}

/**
 * Fetch the display copy and block verdict for this run, from a 15-minute cache
 * when there is a fresh one.
 *
 * A standalone `fetch` against the app-store service, deliberately not
 * `client.get()`. Two reasons: the endpoint is unauthenticated and lives off the
 * v3 gateway, and routing it through `ApiClient` would attach credentials and
 * feed any 401 into `onAuthFailure` — which can clear stored credentials and
 * prompt for a new API key. A cosmetic lookup must never be able to log the
 * user out.
 *
 * The cache is keyed to `cliVersion`: a fresh install or upgrade always gets a
 * live check rather than inheriting a verdict computed for a different
 * version, even if that entry hasn't hit its TTL yet. Only a successful
 * response is written back — a failed call (timeout, non-2xx, malformed body)
 * leaves any existing cache entry alone and returns `undefined` for this run,
 * so an outage never extends the effective staleness window.
 *
 * Fails soft in every direction: timeout, non-2xx, HTML from a gateway,
 * malformed JSON, or an unrecognised `code` all return `undefined`, and the
 * caller falls back to local wording. The banner itself is decided from the npm
 * check, so this can never create or suppress a notice — only reword one.
 */
export async function fetchCliInfo(
  query: CliInfoQuery,
  opts: FetchCliInfoOptions = {},
): Promise<CliInfo | undefined> {
  const env = opts.env ?? process.env;
  const cachePath = opts.cachePath ?? getCliInfoCachePath(env);
  const now = opts.now ? opts.now() : Date.now();
  const ttlMs = opts.ttlMs ?? CLI_INFO_CACHE_TTL_MS;

  const cached = readCliInfoCache(cachePath);
  if (cached && cached.cliVersion === query.cliVersion && now - cached.lastChecked <= ttlMs) {
    return cached.info;
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? CLI_INFO_TIMEOUT_MS);
  try {
    const res = await fetchImpl(buildUrl(opts.baseUrl ?? APP_STORE_BASE, query), {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return undefined;

    const body = (await res.json()) as CliInfoResponse | null;
    if (!body || typeof body !== 'object') return undefined;

    const info: CliInfo = {
      // Nothing about the text is trusted beyond being usable: rejected outright
      // if it looks like HTML, then stripped of control sequences, flattened and
      // clamped. Unusable text yields undefined and the caller falls back to
      // local wording.
      upgradeMessage: sanitizeNoticeMessage(body.upgrade_message),
      // Strict equality, not truthiness: a string "false", a 1, or any other
      // stray value must not stop someone working.
      isBlocked: body.is_blocked === true,
    };

    writeCliInfoCache(cachePath, { cliVersion: query.cliVersion, info, lastChecked: now });

    return info;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
