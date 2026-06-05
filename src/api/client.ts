import { ApiError, ErrorCode } from '../lib/errors';
import { logHttp, logHttpResponse, logDebug } from '../lib/logger';
import { buildCliHeaders, buildAuthMethodHeader } from '../lib/telemetry';
import { messages } from '../lang/en';

interface RequestOptions {
  method: string;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  skipAuth?: boolean;
  authHeader?: Record<string, string>;
}

type AuthFailureHandler = () => Promise<void>;

export interface ApiClientDeps {
  baseUrl: string;
  getAuthHeader: () => Record<string, string> | undefined;
}

const MAX_RETRIES = 3;
const DEFAULT_RETRY_AFTER_SECONDS = 5;
const MAX_RETRY_AFTER_SECONDS = 300;

const apiCodeMessages: Record<string, string> = {
  APP_LIMIT_REACHED: messages.APP_CREATE_LIMIT_REACHED,
  REGISTRY_ERROR: messages.ERR_REGISTRY,
};

function resolveErrorMessage(apiCode: string | undefined, fallback: string): string {
  if (apiCode && apiCode in apiCodeMessages) {
    return apiCodeMessages[apiCode]!;
  }
  return fallback;
}

// Server-provided `retry-after` is untrusted input. Cap it to avoid indefinite
// waits from a malicious or misconfigured server, and reject NaN/negatives
// which would otherwise turn into a 0ms tight retry loop.
export function parseRetryAfter(header: string | null): number {
  if (!header) return DEFAULT_RETRY_AFTER_SECONDS;
  const parsed = Number.parseInt(header, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_RETRY_AFTER_SECONDS;
  return Math.min(parsed, MAX_RETRY_AFTER_SECONDS);
}

// Sanitize untrusted server-provided error strings before they reach the terminal:
// strip ANSI escape sequences and non-printable control characters that could
// reposition the cursor, clear the screen, or inject fake prompts.
export function sanitizeErrorMessage(msg: string): string {
  return (
    msg
      // ANSI CSI/OSC escape sequences
      // eslint-disable-next-line no-control-regex
      .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
      // eslint-disable-next-line no-control-regex
      .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, '')
      // C0 + DEL + C1 control chars, keeping \t \n \r.
      // Includes 0x80–0x9F so 8-bit CSI (0x9B) / OSC (0x9D) introducers
      // are stripped alongside their 7-bit ESC-prefixed equivalents.
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '')
  );
}

// Detect HTML bodies returned by auth gateways (Cloudflare Access, SSO proxies).
// Matches case-insensitively and runs regardless of response status, since
// gateways frequently return HTML on 401/403 as well as 2xx.
function looksLikeHtml(s: string): boolean {
  const lower = s.toLowerCase();
  return lower.includes('<!doctype html') || lower.includes('<html');
}

function parseResponseData(text: string, status: number): Record<string, unknown> {
  let data: Record<string, unknown> = {};
  try {
    const parsed: unknown = text ? JSON.parse(text) : {};
    if (parsed !== null && typeof parsed === 'object') {
      data = parsed as Record<string, unknown>;
    }
  } catch {
    if (looksLikeHtml(text)) {
      throw new ApiError(messages.ERR_AUTH_GATEWAY, status, ErrorCode.AUTH_GATEWAY);
    }
    data = { message: text };
  }

  if (typeof data.message === 'string' && looksLikeHtml(data.message)) {
    throw new ApiError(messages.ERR_AUTH_GATEWAY, status, ErrorCode.AUTH_GATEWAY);
  }
  return data;
}

function throwResponseError(data: Record<string, unknown>, status: number): never {
  const apiCode = typeof data.code === 'string' ? data.code : undefined;
  const rawFallback =
    typeof data.message === 'string' && data.message
      ? data.message
      : `Request failed with status ${status}`;
  const fallback = sanitizeErrorMessage(rawFallback);
  const message = resolveErrorMessage(apiCode, fallback);
  throw new ApiError(message, status, mapErrorCode(status, apiCode), apiCode);
}

function mapErrorCode(status: number, apiCode?: string): ErrorCode | undefined {
  if (apiCode === 'APP_LIMIT_REACHED') return ErrorCode.APP_LIMIT_REACHED;
  if (apiCode === 'REGISTRY_ERROR') return ErrorCode.REGISTRY_ERROR;

  switch (status) {
    case 401:
      return ErrorCode.AUTH_INVALID;
    case 403:
      return ErrorCode.ACCESS_DENIED;
    case 404:
      return ErrorCode.APP_NOT_FOUND;
    case 429:
      return ErrorCode.RATE_LIMITED;
    default:
      return undefined;
  }
}

export class ApiClient {
  private onAuthFailure?: AuthFailureHandler;

  constructor(private readonly deps: ApiClientDeps) {}

  setOnAuthFailure(handler: AuthFailureHandler): void {
    this.onAuthFailure = handler;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>({ method: 'GET', path });
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>({ method: 'POST', path, body });
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>({ method: 'PATCH', path, body });
  }

  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>({ method: 'PUT', path, body });
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>({ method: 'DELETE', path });
  }

  getWithKey<T>(path: string, apiKey: string): Promise<T> {
    return this.request<T>({
      method: 'GET',
      path,
      skipAuth: true,
      authHeader: { 'api-key': apiKey },
    });
  }

  getWithBearer<T>(path: string, accessToken: string, tokenType = 'Bearer'): Promise<T> {
    return this.request<T>({
      method: 'GET',
      path,
      skipAuth: true,
      authHeader: { Authorization: `${tokenType} ${accessToken}` },
    });
  }

  private buildHeaders(opts: RequestOptions): Record<string, string> {
    const explicitAuth: Record<string, string> | undefined = opts.authHeader;
    const authHeader = explicitAuth ?? (opts.skipAuth ? undefined : this.deps.getAuthHeader());

    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...buildCliHeaders(),
      ...buildAuthMethodHeader(authHeader),
      ...opts.headers,
      ...authHeader,
    };
  }

  private async performFetch(
    url: string,
    opts: RequestOptions,
    headers: Record<string, string>,
  ): Promise<Response> {
    try {
      return await fetch(url, {
        method: opts.method,
        headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      const apiErr = new ApiError(messages.ERR_NETWORK, 0, ErrorCode.NETWORK_ERROR);
      (apiErr as Error).cause = err;
      throw apiErr;
    }
  }

  private async request<T>(opts: RequestOptions, isRetry = false, retryCount = 0): Promise<T> {
    const url = `${this.deps.baseUrl}${opts.path}`;
    const headers = this.buildHeaders(opts);

    logHttp(opts.method, opts.path);
    const response = await this.performFetch(url, opts, headers);
    logHttpResponse(response.status, opts.path);

    if (response.status === 401 && !isRetry && !opts.skipAuth) {
      if (this.onAuthFailure) {
        await this.onAuthFailure();
        return this.request<T>(opts, true, retryCount);
      }
      throw new ApiError(messages.AUTH_EXPIRED, 401, ErrorCode.AUTH_EXPIRED);
    }

    if (response.status === 429) {
      if (retryCount >= MAX_RETRIES) {
        throw new ApiError('Rate limited — max retries exceeded.', 429, ErrorCode.RATE_LIMITED);
      }
      const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
      process.stderr.write(`  ${messages.ERR_RATE_LIMITED(retryAfter)}\n`);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      return this.request<T>(opts, isRetry, retryCount + 1);
    }

    if (response.status === 502 && retryCount < 1) {
      await new Promise((r) => setTimeout(r, 2000));
      return this.request<T>(opts, isRetry, retryCount + 1);
    }

    const text = await response.text();
    const data = parseResponseData(text, response.status);

    logDebug(`response ${opts.path}`, data);

    if (!response.ok) {
      throwResponseError(data, response.status);
    }

    return data as T;
  }
}
