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
