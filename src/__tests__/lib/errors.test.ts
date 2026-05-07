import { ApiError, CliError, AbortError, ErrorCode } from '../../lib/errors';

describe('ErrorCode', () => {
  it('should define all expected error codes', () => {
    expect(ErrorCode.AUTH_INVALID).toBe('AUTH_INVALID');
    expect(ErrorCode.AUTH_EXPIRED).toBe('AUTH_EXPIRED');
    expect(ErrorCode.APP_NOT_FOUND).toBe('APP_NOT_FOUND');
    expect(ErrorCode.REDIRECT_INVALID).toBe('REDIRECT_INVALID');
    expect(ErrorCode.PORT_IN_USE).toBe('PORT_IN_USE');
    expect(ErrorCode.NETWORK_ERROR).toBe('NETWORK_ERROR');
    expect(ErrorCode.RATE_LIMITED).toBe('RATE_LIMITED');
    expect(ErrorCode.APP_LIMIT_REACHED).toBe('APP_LIMIT_REACHED');
  });
});

describe('ApiError', () => {
  it('should create an error with message and status code', () => {
    const err = new ApiError('Not found', 404);
    expect(err.message).toBe('Not found');
    expect(err.statusCode).toBe(404);
    expect(err.errorCode).toBeUndefined();
    expect(err.name).toBe('ApiError');
  });

  it('should create an error with optional error code', () => {
    const err = new ApiError('Unauthorized', 401, ErrorCode.AUTH_INVALID);
    expect(err.message).toBe('Unauthorized');
    expect(err.statusCode).toBe(401);
    expect(err.errorCode).toBe(ErrorCode.AUTH_INVALID);
  });

  it('should create an error with optional api code', () => {
    const err = new ApiError(
      'Limit reached',
      403,
      ErrorCode.APP_LIMIT_REACHED,
      'APP_LIMIT_REACHED',
    );
    expect(err.apiCode).toBe('APP_LIMIT_REACHED');
    expect(err.errorCode).toBe(ErrorCode.APP_LIMIT_REACHED);
  });

  it('should be an instance of Error', () => {
    const err = new ApiError('test', 500);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ApiError);
  });
});

describe('AbortError', () => {
  it('should have message "Aborted." and ABORTED exit code', () => {
    const err = new AbortError();
    expect(err.message).toBe('Aborted.');
    expect(err.exitCode).toBe(2);
    expect(err.name).toBe('AbortError');
  });

  it('should be an instance of CliError and Error', () => {
    const err = new AbortError();
    expect(err).toBeInstanceOf(CliError);
    expect(err).toBeInstanceOf(Error);
  });
});

describe('AuthExpiredError', () => {
  it('is a CliError with the AUTH_FAILURE exit code and a helpful message', () => {
    const { AuthExpiredError, CliError } = require('../../lib/errors');
    const { EXIT_CODES } = require('../../lib/exit-codes');
    const err = new AuthExpiredError();
    expect(err).toBeInstanceOf(CliError);
    expect(err.exitCode).toBe(EXIT_CODES.AUTH_FAILURE);
    expect(err.message).toMatch(/session.*expired/i);
  });
});
