import { APP_STORE_BASE, ENDPOINTS } from '../lib/constants';
import { sanitizeErrorMessage, looksLikeHtml } from '../api/client';
import { CliInfoQuery, CliInfoResponse } from '../types';

// Budget for the whole call. The notice is cosmetic and the banner is already
// going to be shown, so the user waits at most this long for nicer wording
// before the local text is used instead.
const CLI_INFO_TIMEOUT_MS = 1500;

// `message` is server-supplied text headed for a terminal. Clamping bounds how
// much screen a hostile or broken backend can take, on top of the control-char
// stripping below.
const MAX_NOTICE_MESSAGE_LEN = 200;

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
 * A standalone `fetch` against the app-store service, deliberately not
 * `client.get()`. Two reasons: the endpoint is unauthenticated and lives off the
 * v3 gateway, and routing it through `ApiClient` would attach credentials and
 * feed any 401 into `onAuthFailure` — which can clear stored credentials and
 * prompt for a new API key. A cosmetic lookup must never be able to log the
 * user out.
 *
 * Fails soft in every direction: timeout, non-2xx, HTML from a gateway,
 * malformed JSON, or an unrecognised `code` all return `undefined`, and the
 * caller falls back to local wording. The banner itself is decided from the npm
 * check, so this can never create or suppress a notice — only reword one.
 */
export async function fetchCliInfo(
  query: CliInfoQuery,
  opts: FetchCliInfoOptions = {},
): Promise<string | undefined> {
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

    // Nothing about the body is trusted beyond being a usable string: it is
    // rejected outright if it looks like HTML, then stripped of control
    // sequences, flattened and clamped. Anything unusable yields undefined and
    // the caller falls back to local wording.
    return sanitizeNoticeMessage(body.upgrade_message);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
