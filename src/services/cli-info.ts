import { API_BASE, ENDPOINTS } from '../lib/constants';
import { isKnownNoticeCode, sanitizeNoticeMessage } from '../lib/version-notice';
import { CliInfoQuery, CliInfoResponse, VersionNotice } from '../types';

// Budget for the whole call. The notice is cosmetic, so the user waits at most
// this long for nicer wording before the local text is used instead.
const CLI_INFO_TIMEOUT_MS = 1500;

export interface FetchCliInfoOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function buildUrl(baseUrl: string, query: CliInfoQuery): string {
  const params = new URLSearchParams({
    reason: query.reason,
    current_version: query.currentVersion,
    os: query.os,
  });
  if (query.latestVersion) params.set('latest_version', query.latestVersion);
  if (query.status) params.set('status', query.status);
  return `${baseUrl}${ENDPOINTS.CLI_INFO}?${params.toString()}`;
}

/**
 * Fetch the display copy for a version notice.
 *
 * Deliberately a standalone `fetch` rather than `client.get()`. `/cli/info` is
 * unauthenticated, and routing it through `ApiClient` would attach the auth
 * header and feed any 401 into `onAuthFailure` — which can clear stored
 * credentials and prompt for a new API key. A cosmetic lookup must never be
 * able to log the user out.
 *
 * Fails soft in every direction: timeout, non-2xx, HTML from a gateway,
 * malformed JSON, or an unrecognised `code` all return `undefined`, and the
 * caller falls back to local wording. It cannot influence severity, so the
 * worst case is a less specific message.
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
