import { EXIT_CODES } from './exit-codes';

export class CliError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number = EXIT_CODES.ERROR,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

export class AbortError extends CliError {
  constructor() {
    super('Aborted.', EXIT_CODES.ABORTED);
    this.name = 'AbortError';
  }
}

export class AuthExpiredError extends CliError {
  constructor() {
    super('Your session has expired. Run `brevo login` to sign in again.', EXIT_CODES.AUTH_FAILURE);
    this.name = 'AuthExpiredError';
  }
}

export enum ErrorCode {
  AUTH_INVALID = 'AUTH_INVALID',
  AUTH_EXPIRED = 'AUTH_EXPIRED',
  ACCESS_DENIED = 'ACCESS_DENIED',
  APP_NOT_FOUND = 'APP_NOT_FOUND',
  REDIRECT_INVALID = 'REDIRECT_INVALID',
  PORT_IN_USE = 'PORT_IN_USE',
  NETWORK_ERROR = 'NETWORK_ERROR',
  RATE_LIMITED = 'RATE_LIMITED',
  APP_LIMIT_REACHED = 'APP_LIMIT_REACHED',
  REGISTRY_ERROR = 'REGISTRY_ERROR',
  AUTH_GATEWAY = 'AUTH_GATEWAY',
}

export class ApiError extends CliError {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly errorCode?: ErrorCode,
    public readonly apiCode?: string,
  ) {
    super(message, statusToExitCode(statusCode));
    this.name = 'ApiError';
  }
}

function statusToExitCode(status: number): number {
  if (status === 0) return EXIT_CODES.NETWORK_ERROR;
  if (status === 401) return EXIT_CODES.AUTH_FAILURE;
  if (status === 403) return EXIT_CODES.ERROR;
  if (status === 404) return EXIT_CODES.NOT_FOUND;
  return EXIT_CODES.ERROR;
}

/**
 * Recognise the platform's per-account Unleash rollout gate on iframe-extension
 * authoring: bo-be's `validateIframeDistribution` (app-store-bo-be#404) refuses an
 * `iframeExtension` block with a 400 naming the flag `app-store-bo-be-iframe-extension`
 * when it is off for the calling client, judged BEFORE the private-only rule.
 *
 * A translation, not a local guard — `app create` and `app upload` both need it (the
 * flag guards both write paths), so it lives here rather than duplicated in each command:
 * `CLAUDE.md`'s standing rule is that the CLI must not mirror per-account platform policy
 * locally, and the private-only rule that IS answerable offline already lives in
 * `uiAppType.validateConfig` — this one genuinely cannot, since only the server knows
 * the flag's state.
 *
 * Narrowed on the flag's own name rather than the sentence around it — the flag name is
 * the stable part of the message, so a reworded sentence still matches.
 */
export function isIframeExtensionDisabledRefusal(err: unknown): err is ApiError {
  return (
    err instanceof ApiError &&
    err.statusCode === 400 &&
    err.message.includes('app-store-bo-be-iframe-extension')
  );
}
