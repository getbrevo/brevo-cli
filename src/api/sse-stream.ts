import { ApiError, ErrorCode } from '../lib/errors';
import { buildCliHeaders } from '../lib/telemetry';
import { messages } from '../lang/en';

export interface SSEStreamDeps {
  baseUrl: string;
  getAuthHeader: () => Record<string, string> | undefined;
}

export interface SSEEvent {
  event?: string;
  data: string;
}

/**
 * Async generator that streams SSE events from a given endpoint.
 *
 * Standalone from `ApiClient` because SSE requires reading an incremental
 * `text/event-stream` body — `ApiClient.request()` reads the whole response
 * as text and JSON-parses it, which blocks until the stream ends and then
 * fails to parse. A `stream()` method on `ApiClient` would bypass all of
 * `request()`'s retry / auth-refresh / rate-limit handling, so a separate
 * module is cleaner than a method that silently skips half its class.
 */
export async function* sseStream(
  deps: SSEStreamDeps,
  method: 'POST' | 'PATCH',
  path: string,
  body?: unknown,
): AsyncGenerator<SSEEvent> {
  const authHeader = deps.getAuthHeader();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    ...buildCliHeaders(authHeader),
    ...authHeader,
  };

  const url = `${deps.baseUrl}${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    const apiErr = new ApiError(messages.ERR_NETWORK, 0, ErrorCode.NETWORK_ERROR);
    (apiErr as Error).cause = err;
    throw apiErr;
  }

  if (!response.ok) {
    let errorMessage = `Request failed with status ${response.status}`;
    try {
      const text = await response.text();
      const data: unknown = text ? JSON.parse(text) : {};
      if (data && typeof data === 'object') {
        const obj = data as Record<string, unknown>;
        // Map stable API codes to CLI messages (mirrors apiCodeMessages in client.ts).
        if (obj.code === 'feature_not_enabled') {
          throw new ApiError(messages.ERR_FEATURE_NOT_ENABLED, response.status);
        }
        const msg =
          typeof obj.message === 'string'
            ? obj.message
            : typeof obj.error === 'string'
              ? obj.error
              : undefined;
        if (msg) errorMessage = msg;
      }
    } catch (e) {
      if (e instanceof ApiError) throw e;
      // keep default message
    }
    throw new ApiError(errorMessage, response.status);
  }

  if (!response.body) {
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent: string | undefined;
  let currentData: string[] = [];

  try {
    while (true) {
      let chunk: { done: boolean; value?: Uint8Array };
      try {
        chunk = await reader.read();
      } catch (err) {
        // Connection terminated mid-stream (e.g. server closed, timeout, network drop).
        const apiErr = new ApiError(messages.ERR_NETWORK, 0, ErrorCode.NETWORK_ERROR);
        (apiErr as Error).cause = err;
        throw apiErr;
      }
      const { done, value } = chunk;
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      // The last element may be an incomplete line — keep it in the buffer.
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line === '' || line === '\r') {
          // Blank line = event dispatch
          if (currentData.length > 0) {
            yield {
              event: currentEvent,
              data: currentData.join('\n'),
            };
          }
          currentEvent = undefined;
          currentData = [];
          continue;
        }

        const stripped = line.endsWith('\r') ? line.slice(0, -1) : line;

        if (stripped.startsWith('event:')) {
          currentEvent = stripped.slice(6).trim();
        } else if (stripped.startsWith('data:')) {
          currentData.push(stripped.slice(5).trimStart());
        }
        // Ignore `id:`, `retry:`, comments (`:`) — not needed for this use case.
      }
    }

    // Flush any remaining data if the stream ended without a trailing blank line.
    if (currentData.length > 0) {
      yield {
        event: currentEvent,
        data: currentData.join('\n'),
      };
    }
  } finally {
    reader.releaseLock();
  }
}
