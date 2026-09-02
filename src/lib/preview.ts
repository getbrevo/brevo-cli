/**
 * The pre-GA gate (BEX-405) — **currently holding nothing back.**
 *
 * Every row in `FEATURE_STAGE` is `'ga'`. Public app distribution and the review
 * lifecycle (`app submit` / `app status` / `app withdraw`) were the last two gated
 * features and shipped at public-apps GA; UI apps went GA before them (BEX-290). So
 * today this module is a no-op that every build folds away, kept deliberately rather
 * than deleted: it is the shape the next unreleased feature is meant to arrive in, and
 * re-deriving it from scratch is how the traps below get rediscovered the hard way.
 *
 * Tearing the machinery down completely is tracked as follow-up work in `docs.md`
 * → *Part 2*. Until then, leave it in place with all rows `'ga'`.
 *
 * ## What the gate does when a row is `'preview'`
 *
 * The published package must not expose an unreleased feature: not in help, not to a
 * direct invocation, and — because the guard is applied at build time — not in the
 * shipped code at all. `scripts/build.mjs` sets `__BREVO_PREVIEW__` false for a public
 * build, eliminating every gated branch and tree-shaking the command modules only those
 * branches referenced, then asserts on its own output that they really are gone.
 *
 * ## Why this has no runtime escape hatch
 *
 * The first version of this gate unlocked on an `@brevo.com` / `@sendinblue.com`
 * account or an opt-in env var, mirroring a clause the agent docs used to carry. Both
 * were removed when the flag moved to build time. A compile-time guard that any user
 * can switch back on is a runtime guard wearing a costume — and worse, it has to ship
 * the surface in order to be able to reveal it, which defeats the point of building it
 * out. Internal testing is `PREVIEW=1 yarn link:dev`, a genuinely different artifact.
 * **Do not add one back.**
 *
 * ## One table for readiness — but GA is a sequence, not one edit
 *
 * `FEATURE_STAGE` is the only place a feature's readiness is *stated*. Help filtering,
 * the runtime refusal, the command registry and the `app create` prompts all read it
 * through `isFeatureAvailable`. Flipping a row to `'ga'` is necessary but NOT
 * sufficient, and both halves of that trap are worth knowing before gating anything new:
 *
 * - **A gated command needs its definition out of reach of a live import.** Gated
 *   entries lived in `commands/preview-definitions.ts`, referenced from
 *   `definitions.ts` behind `__BREVO_PREVIEW__` — inline, the import would be a live
 *   reference and the command would ship, unreachable but present.
 * - **`__BREVO_PREVIEW__` is the OUTER authority, above this table.** A gated help
 *   section or prompt branch wrapped in the build flag stays hidden in a published
 *   build no matter what `FEATURE_STAGE` says, so the wrapper has to come off by hand
 *   in the same change. Both UI-apps GA and public-apps GA hit exactly this.
 *
 * Object literals need the same treatment for a different reason: esbuild cannot prune
 * a property from one, so gated strings, `CLI.*` references and `ENDPOINTS` paths were
 * split into their own modules (`lang/preview-messages.ts`, `lib/preview-constants.ts`)
 * and spread in behind the flag — otherwise `strings` on the published binary read back
 * the whole unreleased feature set. All three modules emptied at public-apps GA and
 * were deleted; recreate them the same way if a feature is ever gated again.
 *
 * Two of the four names are `Capability` values from `app-types/capabilities.ts`,
 * deliberately: commands already declare `requires` in `commands/definitions.ts`, so
 * command gating falls straight out of the field that is already there. The other two
 * gate a prompt choice and a flag value, neither of which is a command.
 */
import { CliError } from './errors';
import { messages } from '../lang/en';

export type PreviewFeature =
  /** `app install` / `app uninstall`. Also a `Capability`. GA at BEX-290. */
  | 'account-install'
  /** `app submit` / `app status` / `app withdraw`. Also a `Capability`. GA at BEX-405. */
  | 'review-lifecycle'
  /** The *UI app* choice in `app create`'s app-type prompt. GA at BEX-290. */
  | 'ui-app-type'
  /** `app create --distribution public`. GA at BEX-405. */
  | 'public-distribution';

export type FeatureStage = 'ga' | 'preview';

/**
 * Readiness per feature. **All rows are `'ga'` — nothing is gated today.**
 *
 * Flipping a row to `'preview'` is the first step of holding a feature back, not the
 * whole of it: see the header for the two traps (`preview-definitions.ts` and the
 * `__BREVO_PREVIEW__` wrapper) that a stage lookup alone does not reach.
 *
 * Everything not listed here is GA by construction — absence from this table is not a
 * gate, so a new command is public unless someone opts it in.
 */
export const FEATURE_STAGE: Readonly<Record<PreviewFeature, FeatureStage>> = {
  'account-install': 'ga',
  'review-lifecycle': 'ga',
  'ui-app-type': 'ga',
  'public-distribution': 'ga',
} as const;

/**
 * Is this feature usable in this build — either released, or built with `PREVIEW=1`?
 *
 * Reads the build global directly rather than a module-level constant, for two reasons.
 * esbuild substitutes it here, so a published build folds this to
 * `FEATURE_STAGE[feature] === 'ga'` with no runtime flag left. And under jest the read
 * happens per call, which is what lets a test flip build states without re-importing
 * every module that has already captured a constant — the bug that a `PREVIEW_BUILD`
 * export caused when this was first written.
 *
 * With every row `'ga'` this answers true unconditionally. The call sites are kept so
 * that flipping a row back to `'preview'` is a one-line change rather than a rewrite.
 */
export function isFeatureAvailable(feature: PreviewFeature): boolean {
  return FEATURE_STAGE[feature] === 'ga' || __BREVO_PREVIEW__;
}

/**
 * Refuse a gated feature.
 *
 * One message for all four, unlike `assertCapability` in `app-types/capabilities.ts`,
 * which takes the caller's wording so each command keeps the error string it shipped
 * with. Not an inconsistency: those were existing contracts a script may match on,
 * while this answers a different question ("this feature isn't released") than a
 * capability error does ("this app doesn't support that").
 *
 * **Unreachable while every row is `'ga'`.** Its last live path was
 * `app create --distribution public`, which had to be refused rather than hidden
 * because the flag parses before the gate sees it; that value is now accepted. Kept for
 * the next gated flag value or prompt choice — a gated *command* never reaches here,
 * being absent from the binary entirely.
 */
export function assertFeatureAvailable(feature: PreviewFeature): void {
  if (isFeatureAvailable(feature)) return;
  throw new CliError(messages.PREVIEW_FEATURE_UNAVAILABLE);
}
