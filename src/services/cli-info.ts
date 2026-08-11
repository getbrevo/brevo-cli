import { API_BASE, ENDPOINTS, CLI_NOTICE_CODES } from '../lib/constants';
import { sanitizeErrorMessage, looksLikeHtml } from '../api/client';
import { CliInfoQuery, CliInfoResponse, VersionNotice } from '../types';

// Budget for the whole call. The notice is cosmetic and the banner is already
// going to be shown, so the user waits at most this long for nicer wording
// before the local text is used instead.
const CLI_INFO_TIMEOUT_MS = 1500;

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
 *
 * Returns `undefined` when nothing usable survives, which callers treat as
 * "fall back to local wording".
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

export interface FetchCliInfoOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function buildUrl(baseUrl: string, query: CliInfoQuery): string {
  const params = new URLSearchParams({
    cli_version: query.cliVersion,
    reason: query.reason,
  });
  return `${baseUrl}${ENDPOINTS.CLI_INFO}?${params.toString()}`;
}

/**
 * Fetch the display copy for the update notice.
 *
 * Deliberately a standalone `fetch` rather than `client.get()`. `/cli/info` is
 * unauthenticated, and routing it through `ApiClient` would attach the auth
 * header and feed any 401 into `onAuthFailure` — which can clear stored
 * credentials and prompt for a new API key. A cosmetic lookup must never be
 * able to log the user out.
 *
 * Fails soft in every direction: timeout, non-2xx, HTML from a gateway,
 * malformed JSON, or an unrecognised `code` all return `undefined`, and the
 * caller falls back to local wording. The banner itself is decided from the npm
 * check, so this can never create or suppress a notice — only reword one.
 */
export async function fetchCliInfo(
  query: CliInfoQuery,
  opts: FetchCliInfoOptions = {},
): Promise<VersionNotice | undefined> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? CLI_INFO_TIMEOUT_MS);
  try {
    const res = await fetchImpl(buildUrl(opts.baseUrl ?? API_BASE, query), {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return undefined;

    const body = (await res.json()) as CliInfoResponse | null;
    if (!body || typeof body !== 'object') return undefined;

    // The code is validated before the message is trusted at all: an
    // unrecognised key means we do not know what this text is claiming, so it
    // is not rendered.
    if (!isKnownNoticeCode(body.code)) return undefined;

    const message = sanitizeNoticeMessage(body.message);
    if (!message) return undefined;

    return { code: body.code, message };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
