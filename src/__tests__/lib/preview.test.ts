import { CliError } from '../../lib/errors';
import { messages } from '../../lang/en';
import {
  FEATURE_STAGE,
  assertFeatureAvailable,
  isFeatureAvailable,
  type FeatureStage,
  type PreviewFeature,
} from '../../lib/preview';

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

/**
 * Run a block with `feature` temporarily staged `'preview'`.
 *
 * **Every row is `'ga'` today**, so the refusal path has no real subject — public
 * distribution and the review lifecycle were the last two gated features and shipped at
 * public-apps GA (BEX-405). The gate itself is kept deliberately (see `lib/preview.ts`:
 * it is the shape the next unreleased feature arrives in), and machinery nobody tests is
 * machinery that will not work when it is next needed — so these tests keep exercising
 * it against a simulated gated row.
 *
 * Mutating the table is honest here rather than a hack: flipping a row is the exact edit
 * a release engineer makes, `as const` is a type-level assertion and does not freeze the
 * object at runtime, and `isFeatureAvailable` re-reads it per call so nothing needs
 * re-importing. Restored in a `finally` so one test can never leak into the next.
 */
function withGatedFeature<T>(feature: PreviewFeature, run: () => T): T {
  const table = FEATURE_STAGE as unknown as Record<PreviewFeature, FeatureStage>;
  const original = table[feature];
  table[feature] = 'preview';
  try {
    return run();
  } finally {
    table[feature] = original;
  }
}

describe('lib/preview', () => {
  describe('FEATURE_STAGE', () => {
    // Guards the intent of the current release state: everything has shipped. UI apps
    // (the create choice and install/uninstall) went GA at BEX-290; public distribution
    // and its review lifecycle followed at BEX-405. When a feature is next held back,
    // this is the assertion that fails and points at the GA checklist.
    it('matches the released feature set', () => {
      expect(FEATURE_STAGE).toEqual({
        'account-install': 'ga',
        'review-lifecycle': 'ga',
        'ui-app-type': 'ga',
        'public-distribution': 'ga',
      });
    });

    // Stated separately from the table above so the reason a published build now carries
    // the whole surface is written down, not inferred from four string literals.
    it('gates nothing — every feature has shipped', () => {
      expect(Object.values(FEATURE_STAGE).every((stage) => stage === 'ga')).toBe(true);
    });
  });

  describe('a published (public) build', () => {
    asBuild(false);

    it('reports every preview-staged feature as unavailable, and every GA one as available', () => {
      for (const [feature, stage] of Object.entries(FEATURE_STAGE)) {
        expect(isFeatureAvailable(feature as PreviewFeature)).toBe(stage === 'ga');
      }
    });

    it('makes every shipped feature available', () => {
      for (const feature of Object.keys(FEATURE_STAGE)) {
        expect(isFeatureAvailable(feature as PreviewFeature)).toBe(true);
      }
    });

    it('refuses a gated feature with a typed CliError and exit code 1', () => {
      withGatedFeature('public-distribution', () => {
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
    });

    it('does not refuse a shipped feature', () => {
      expect(() => assertFeatureAvailable('public-distribution')).not.toThrow();
      expect(() => assertFeatureAvailable('review-lifecycle')).not.toThrow();
    });

    // The whole point of moving the flag to build time. If any of these re-enabled the
    // gate, the guard would be a runtime one again and the surface would have to ship
    // in order to be revealable. Asserted against a simulated gated row, because a
    // shipped feature is available either way and so could not tell the two apart.
    it.each([
      ['BREVO_ENABLE_PREVIEW', '1'],
      ['BREVO_PREVIEW', '1'],
      ['BREVO_PREVIEW_BUILD', '1'],
    ])('cannot be unlocked by %s=%s', (name, value) => {
      const original = process.env[name];
      process.env[name] = value;
      try {
        withGatedFeature('review-lifecycle', () => {
          expect(isFeatureAvailable('review-lifecycle')).toBe(false);
        });
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
      withGatedFeature('review-lifecycle', () => {
        isFeatureAvailable('review-lifecycle');
      });
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

    it('reports every feature as available', () => {
      for (const feature of Object.keys(FEATURE_STAGE)) {
        expect(isFeatureAvailable(feature as PreviewFeature)).toBe(true);
      }
    });

    // A preview build is a superset, never a replacement: it must reveal a gated feature
    // rather than merely agreeing with a table that happens to be all-GA.
    it('reveals a gated feature', () => {
      withGatedFeature('review-lifecycle', () => {
        expect(isFeatureAvailable('review-lifecycle')).toBe(true);
        expect(() => assertFeatureAvailable('review-lifecycle')).not.toThrow();
      });
    });

    it('does not refuse', () => {
      expect(() => assertFeatureAvailable('review-lifecycle')).not.toThrow();
    });
  });

  // The suite runs as a preview build (jest.setup.js). Asserted on the global rather than
  // through `isFeatureAvailable`, which now answers true in either build for every real
  // feature and so cannot distinguish them — this is a guard against the setup file
  // drifting from what these tests assume, and it has to read the thing that drifted.
  describe('the suite default', () => {
    it('runs as a preview build', () => {
      expect(globalThis.__BREVO_PREVIEW__).toBe(true);
    });
  });
});
