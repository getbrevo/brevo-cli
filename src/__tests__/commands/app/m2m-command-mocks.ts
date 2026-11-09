/**
 * Shared factories for the `jest.mock` boilerplate the M2M command tests repeat.
 *
 * Not a mock directory — each test file still declares its own `jest.mock(...)` calls
 * inline (per the testing conventions in CLAUDE.md); these factories only build the
 * module shapes those inline declarations return, so the shape is written once. The
 * duplication was flagged by Sonar's new-code duplication gate on PR #133: the identical
 * ui/container blocks in `token.test.ts` and `secret-rotate.test.ts` were one wording
 * change away from drifting apart.
 *
 * `jest.mock` factories are hoisted above imports, so test files must reach these via
 * `require('./m2m-command-mocks')` inside the factory callback, not via a top-level
 * import.
 */

/** `lib/ui` with `createSpinner` replaced by a spy that hands back a stub spinner. */
export function uiWithSpinnerSpy(): Record<string, unknown> {
  return {
    ...jest.requireActual('../../../lib/ui'),
    createSpinner: jest.fn(() => ({ update: jest.fn(), stop: jest.fn() })),
  };
}

/** The container members every app-command test stubs identically. */
export function baseContainerServices(): Record<string, unknown> {
  return {
    accountService: {
      validateApiKey: jest.fn(),
      getAccount: jest.fn(),
    },
    client: {},
  };
}
