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

interface SSEParseState {
  currentEvent: string | undefined;
  currentData: string[];
}

/** Extract a human-readable error message from an API error response object. */
function extractErrorMessage(obj: Record<string, unknown>): string | undefined {
  if (typeof obj.message === 'string') return obj.message;
  if (typeof obj.error === 'string') return obj.error;
  return undefined;
}

/** Perform the initial SSE fetch, wrapping network failures into `ApiError`. */
async function performSSEFetch(
  deps: SSEStreamDeps,
  method: 'POST' | 'PATCH',
  path: string,
  body?: unknown,
): Promise<Response> {
  const authHeader = deps.getAuthHeader();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    ...buildCliHeaders(authHeader),
    ...authHeader,
  };
  const url = `${deps.baseUrl}${path}`;
  try {
    return await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      // Deadline for the entire stream, not an idle timeout between events.
      // AI generation can legitimately take a while; 120s is a safety net
      // against orphaned connections, not a latency budget.
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    const apiErr = new ApiError(messages.ERR_NETWORK, 0, ErrorCode.NETWORK_ERROR);
    (apiErr as Error).cause = err;
    throw apiErr;
  }
}

/** Read the error body from a non-OK response and throw an appropriate `ApiError`. */
async function handleSSEErrorResponse(response: Response): Promise<never> {
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
      const msg = extractErrorMessage(obj);
      if (msg) errorMessage = msg;
    }
  } catch (e) {
    if (e instanceof ApiError) throw e;
    // keep default message
  }
  throw new ApiError(errorMessage, response.status);
}

/** Read one chunk from the stream reader, wrapping connection errors into `ApiError`. */
async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<Uint8Array | null> {
  try {
    const { done, value } = await reader.read();
    return done ? null : (value ?? null);
  } catch (err) {
    // Connection terminated mid-stream (e.g. server closed, timeout, network drop).
    const apiErr = new ApiError(messages.ERR_NETWORK, 0, ErrorCode.NETWORK_ERROR);
    (apiErr as Error).cause = err;
    throw apiErr;
  }
}

/**
 * Process a single SSE line. Returns an `SSEEvent` when a blank line dispatches
 * the accumulated event, or `null` otherwise.
 */
function processSSELine(line: string, state: SSEParseState): SSEEvent | null {
  if (line === '' || line === '\r') {
    if (state.currentData.length > 0) {
      const event: SSEEvent = {
        event: state.currentEvent,
        data: state.currentData.join('\n'),
      };
      state.currentEvent = undefined;
      state.currentData = [];
      return event;
    }
    state.currentEvent = undefined;
    state.currentData = [];
    return null;
  }

  const stripped = line.endsWith('\r') ? line.slice(0, -1) : line;
  if (stripped.startsWith('event:')) {
    state.currentEvent = stripped.slice(6).trim();
  } else if (stripped.startsWith('data:')) {
    state.currentData.push(stripped.slice(5).trimStart());
  }
  // Ignore `id:`, `retry:`, comments (`:`) — not needed for this use case.
  return null;
}

/** Flush any remaining data as a final event. */
function flushSSEState(state: SSEParseState): SSEEvent | null {
  if (state.currentData.length > 0) {
    return { event: state.currentEvent, data: state.currentData.join('\n') };
  }
  return null;
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
  const response = await performSSEFetch(deps, method, path, body);

  if (!response.ok) {
    await handleSSEErrorResponse(response);
  }

  if (!response.body) {
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const state: SSEParseState = { currentEvent: undefined, currentData: [] };

  try {
    while (true) {
      const chunk = await readChunk(reader);
      if (!chunk) break;

      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      // The last element may be an incomplete line — keep it in the buffer.
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const event = processSSELine(line, state);
        if (event) yield event;
      }
    }

    // Flush any remaining data if the stream ended without a trailing blank line.
    const trailing = flushSSEState(state);
    if (trailing) yield trailing;
  } finally {
    reader.releaseLock();
  }
}
