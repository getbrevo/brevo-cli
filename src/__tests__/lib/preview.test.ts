import { CliError } from '../../lib/errors';
import { messages } from '../../lang/en';

jest.mock('../../lib/config', () => ({
  getEmail: jest.fn(),
}));

import { getEmail } from '../../lib/config';
import {
  FEATURE_STAGE,
  PREVIEW_ENV_VAR,
  assertFeatureAvailable,
  isFeatureAvailable,
  isPreviewUnlocked,
} from '../../lib/preview';

const mockedGetEmail = getEmail as jest.Mock;

describe('lib/preview', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // The suite-wide setup file unlocks the gate so feature tests don't depend on
    // who is logged in (see jest.setup.js). These tests are about the gate itself,
    // so they start from genuinely locked and opt in per case.
    delete process.env[PREVIEW_ENV_VAR];
    mockedGetEmail.mockReturnValue(undefined);
  });

  afterAll(() => {
    process.env[PREVIEW_ENV_VAR] = '1';
  });

  describe('isPreviewUnlocked', () => {
    // Logged out is the state a fresh install is in, and the state every help
    // render must survive. It has to be the locked answer, not an error.
    it('is locked when there is no cached email', () => {
      expect(isPreviewUnlocked()).toBe(false);
    });

    it('is locked for an external account', () => {
      mockedGetEmail.mockReturnValue('partner@example.com');
      expect(isPreviewUnlocked()).toBe(false);
    });

    it.each(['dev@brevo.com', 'dev@sendinblue.com'])('is unlocked for %s', (email) => {
      mockedGetEmail.mockReturnValue(email);
      expect(isPreviewUnlocked()).toBe(true);
    });

    // Emails are case-insensitive in practice and the stored value is whatever the
    // API returned, so the comparison normalizes rather than trusting the casing.
    it('matches the internal domains case-insensitively and ignores surrounding space', () => {
      mockedGetEmail.mockReturnValue('  DEV@Brevo.COM  ');
      expect(isPreviewUnlocked()).toBe(true);
    });

    // The check is `endsWith('@brevo.com')`, not `includes('brevo.com')`: a lookalike
    // domain must not pass, or the guardrail is decorative.
    it.each([
      'attacker@brevo.com.evil.test',
      'brevo.com@example.com',
      'devbrevo.com',
      'dev@notbrevo.com',
    ])('is locked for the lookalike %s', (email) => {
      mockedGetEmail.mockReturnValue(email);
      expect(isPreviewUnlocked()).toBe(false);
    });

    it.each(['1', 'true'])('is unlocked by %s in the opt-in env var', (value) => {
      process.env[PREVIEW_ENV_VAR] = value;
      expect(isPreviewUnlocked()).toBe(true);
    });

    // Matches how BREVO_NO_UPDATE_NOTIFIER and BREVO_NO_SKILL_AUTOREFRESH are read:
    // an explicit '1'/'true', not any non-empty value. `=0` must not mean "on".
    it.each(['0', 'false', '', 'yes'])('stays locked for the env value %p', (value) => {
      process.env[PREVIEW_ENV_VAR] = value;
      expect(isPreviewUnlocked()).toBe(false);
    });

    it('does not need the network or the API', () => {
      mockedGetEmail.mockReturnValue('dev@brevo.com');
      isPreviewUnlocked();
      // The whole point of reading the cached credential: help must render while
      // logged out and before any request, and a slow API must never change the gate.
      expect(mockedGetEmail).toHaveBeenCalledTimes(1);
    });
  });

  describe('isFeatureAvailable', () => {
    // Guards the intent of this release: all four are pre-GA. When one ships, this
    // assertion is the thing that fails and points at the GA checklist.
    it('reports every gated feature as preview', () => {
      expect(FEATURE_STAGE).toEqual({
        'account-install': 'preview',
        'review-lifecycle': 'preview',
        'ui-app-type': 'preview',
        'public-distribution': 'preview',
      });
    });

    it('is false for every preview feature while locked', () => {
      for (const feature of Object.keys(FEATURE_STAGE)) {
        expect(isFeatureAvailable(feature as keyof typeof FEATURE_STAGE)).toBe(false);
      }
    });

    it('is true for every preview feature once unlocked', () => {
      mockedGetEmail.mockReturnValue('dev@brevo.com');
      for (const feature of Object.keys(FEATURE_STAGE)) {
        expect(isFeatureAvailable(feature as keyof typeof FEATURE_STAGE)).toBe(true);
      }
    });
  });

  describe('assertFeatureAvailable', () => {
    it('throws a CliError naming the reason when locked', () => {
      expect(() => assertFeatureAvailable('review-lifecycle')).toThrow(CliError);
      expect(() => assertFeatureAvailable('review-lifecycle')).toThrow(
        messages.PREVIEW_FEATURE_UNAVAILABLE,
      );
    });

    // Exit code 1, not 0: scripts branch on it.
    it('exits non-zero', () => {
      try {
        assertFeatureAvailable('review-lifecycle');
        throw new Error('expected a refusal');
      } catch (err) {
        expect((err as CliError).exitCode).toBe(1);
      }
    });

    // The message must not name the env var or the internal-account exception: an
    // end user can use neither, so mentioning them only invites an attempt.
    it('does not leak the escape hatches', () => {
      expect(messages.PREVIEW_FEATURE_UNAVAILABLE).not.toContain(PREVIEW_ENV_VAR);
      expect(messages.PREVIEW_FEATURE_UNAVAILABLE).not.toContain('brevo.com');
    });

    it('does not throw once unlocked', () => {
      mockedGetEmail.mockReturnValue('dev@brevo.com');
      expect(() => assertFeatureAvailable('review-lifecycle')).not.toThrow();
    });
  });
});
