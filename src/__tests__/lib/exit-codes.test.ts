import { EXIT_CODES } from '../../lib/exit-codes';

describe('EXIT_CODES', () => {
  it('should have SUCCESS as 0', () => {
    expect(EXIT_CODES.SUCCESS).toBe(0);
  });

  it('should have ERROR as 1', () => {
    expect(EXIT_CODES.ERROR).toBe(1);
  });

  it('should have ABORTED as 2', () => {
    expect(EXIT_CODES.ABORTED).toBe(2);
  });

  it('should have AUTH_FAILURE as 3', () => {
    expect(EXIT_CODES.AUTH_FAILURE).toBe(3);
  });

  it('should have NETWORK_ERROR as 4', () => {
    expect(EXIT_CODES.NETWORK_ERROR).toBe(4);
  });

  it('should have NOT_FOUND as 5', () => {
    expect(EXIT_CODES.NOT_FOUND).toBe(5);
  });

  it('should be readonly', () => {
    const codes = { ...EXIT_CODES };
    expect(codes).toEqual({
      SUCCESS: 0,
      ERROR: 1,
      ABORTED: 2,
      AUTH_FAILURE: 3,
      NETWORK_ERROR: 4,
      NOT_FOUND: 5,
    });
  });
});
