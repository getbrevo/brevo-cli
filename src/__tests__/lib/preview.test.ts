import { CliError } from '../../lib/errors';
import { messages } from '../../lang/en';
import { FEATURE_STAGE, assertFeatureAvailable, isFeatureAvailable } from '../../lib/preview';

/**
 * Run a block as a given build state would.
 *
 * `isFeatureAvailable` reads `__BREVO_PREVIEW__` per call, so setting the global is
 * enough — no module re-import. That is deliberate: an earlier version captured the
 * flag in a module constant, which made the gate untestable without `isolateModules`
 * and, worse, meant an importing module froze the value at load. Only the *elimination*
 * sites (`definitions.ts`, `help.ts`) still need re-importing, because they read the
 * global at module scope; `preview-gate.test.ts` covers those.
 */
function asBuild(previewBuild: boolean): void {
  beforeEach(() => {
    globalThis.__BREVO_PREVIEW__ = previewBuild;
  });
  afterEach(() => {
    globalThis.__BREVO_PREVIEW__ = true;
  });
}

describe('lib/preview', () => {
  describe('FEATURE_STAGE', () => {
    // Guards the intent of this release: all four are pre-GA. When one ships, this is
    // the assertion that fails and points at the GA checklist.
    it('lists every gated feature as preview', () => {
      expect(FEATURE_STAGE).toEqual({
        'account-install': 'preview',
        'review-lifecycle': 'preview',
        'ui-app-type': 'preview',
        'public-distribution': 'preview',
        'brevo-function-type': 'preview',
      });
    });
  });

  describe('a published (public) build', () => {
    asBuild(false);

    it('reports every preview feature as unavailable', () => {
      for (const feature of Object.keys(FEATURE_STAGE)) {
        expect(isFeatureAvailable(feature as keyof typeof FEATURE_STAGE)).toBe(false);
      }
    });

    it('refuses with a typed CliError and exit code 1', () => {
      expect(() => assertFeatureAvailable('public-distribution')).toThrow(CliError);
      try {
        assertFeatureAvailable('public-distribution');
        throw new Error('expected a refusal');
      } catch (err) {
        expect((err as CliError).name).toBe('CliError');
        expect((err as CliError).message).toBe(messages.PREVIEW_FEATURE_UNAVAILABLE);
        expect((err as CliError).exitCode).toBe(1);
      }
    });

    // The whole point of moving the flag to build time. If any of these re-enabled the
    // gate, the guard would be a runtime one again and the surface would have to ship
    // in order to be revealable.
    it.each([
      ['BREVO_ENABLE_PREVIEW', '1'],
      ['BREVO_PREVIEW', '1'],
      ['BREVO_PREVIEW_BUILD', '1'],
    ])('cannot be unlocked by %s=%s', (name, value) => {
      const original = process.env[name];
      process.env[name] = value;
      try {
        expect(isFeatureAvailable('review-lifecycle')).toBe(false);
      } finally {
        if (original === undefined) delete process.env[name];
        else process.env[name] = original;
      }
    });

    // The account-based escape hatch was removed with the env var. The gate must not
    // read credentials at all — a build-time flag that consults who you are logged in
    // as is a runtime flag.
    it('does not consult the logged-in account', () => {
      const config = require('../../lib/config');
      const spy = jest.spyOn(config, 'getEmail');
      isFeatureAvailable('review-lifecycle');
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    // Not named in the refusal: an end user can act on neither, so mentioning either
    // would only invite an attempt.
    it('does not leak the build flag in the message', () => {
      expect(messages.PREVIEW_FEATURE_UNAVAILABLE).not.toMatch(/PREVIEW|brevo\.com/i);
    });
  });

  describe('a preview build (PREVIEW=1)', () => {
    asBuild(true);

    it('reports every preview feature as available', () => {
      for (const feature of Object.keys(FEATURE_STAGE)) {
        expect(isFeatureAvailable(feature as keyof typeof FEATURE_STAGE)).toBe(true);
      }
    });

    it('does not refuse', () => {
      expect(() => assertFeatureAvailable('review-lifecycle')).not.toThrow();
    });
  });

  // The suite runs as a preview build (jest.setup.js), so the directly imported
  // bindings should agree with the preview gate — a guard against the setup file
  // drifting from what these tests assume.
  describe('the suite default', () => {
    it('runs as a preview build', () => {
      expect(isFeatureAvailable('review-lifecycle')).toBe(true);
      expect(() => assertFeatureAvailable('account-install')).not.toThrow();
    });
  });
});
