/**
 * The pre-GA gate (BEX-405).
 *
 * Public app distribution is built in this repo but **not live on the Brevo
 * platform**. The published package must not expose it: not in help, not to a direct
 * invocation, and — because the guard is applied at build time — not in the shipped
 * code at all. `scripts/build.mjs` eliminates every gated branch and tree-shakes the
 * command modules only those branches referenced. (UI apps — the *UI app* create
 * choice and `app install` / `app uninstall` — went GA and ship in every build; their
 * rows below are flipped to `'ga'` and their modules are referenced live.)
 *
 * ## Why this has no runtime escape hatch
 *
 * The first version of this gate unlocked on an `@brevo.com` / `@sendinblue.com`
 * account or an opt-in env var, mirroring the clause the agent docs used to carry.
 * Both were removed when the flag moved to build time. A compile-time guard that any
 * user can switch back on is a runtime guard wearing a costume — and worse, it has to
 * ship the surface in order to be able to reveal it, which defeats the point of
 * building it out. Internal testing is `PREVIEW=1 yarn link:dev`, which produces a
 * genuinely different artifact.
 *
 * That also means this is no longer "a guardrail, not a security boundary": there is
 * nothing client-side left to bypass. The Brevo API remains the real authority and
 * refuses the gated feature per account independently (`400 invalid_parameter` on a
 * public create), so the two layers are the build and the server, with nothing in
 * between for a user to talk their way past.
 *
 * ## One table for readiness — but GA is a sequence, not one edit
 *
 * `FEATURE_STAGE` is the only place a feature's readiness is *stated*. Help filtering,
 * the runtime refusal, the command registry and the two `app create` prompts all read
 * it through `isFeatureAvailable`. Flipping a row to `'ga'` is necessary but NOT
 * sufficient for a command: gated definitions live in `commands/preview-definitions.ts`
 * and gated help sections sit behind `__BREVO_PREVIEW__`, a *build* flag, so both must
 * be moved/unwrapped by hand in the same change — UI-apps GA (BEX-290) touched 17 files
 * doing exactly that. The full sequence is the GA runbook, `RELEASE-CHECKLIST.md` on
 * `feature_set-brevo-cli-v2` → *Before public-apps GA*.
 *
 * Two of the four names are `Capability` values from `app-types/capabilities.ts`,
 * deliberately: commands already declare `requires` in `commands/definitions.ts`, so
 * command gating falls straight out of the field that is already there. The other two
 * gate a prompt choice and a flag value, neither of which is a command.
 */
import { CliError } from './errors';
import { messages } from '../lang/en';

export type PreviewFeature =
  /** `app install` / `app uninstall`. Also a `Capability`. */
  | 'account-install'
  /** `app submit` / `app status` / `app withdraw`. Also a `Capability`. */
  | 'review-lifecycle'
  /** The *UI app* choice in `app create`'s app-type prompt. */
  | 'ui-app-type'
  /** `app create --distribution public`. */
  | 'public-distribution';

export type FeatureStage = 'ga' | 'preview';

/**
 * Readiness per feature. Flipping a row to `'ga'` is the first step of releasing it —
 * a gated *command* also needs its definition moved out of `preview-definitions.ts`
 * and its help section unwrapped, see the header.
 *
 * Everything not listed here is GA by construction — absence from this table is not a
 * gate, so a new command is public unless someone opts it in.
 */
export const FEATURE_STAGE: Readonly<Record<PreviewFeature, FeatureStage>> = {
  'account-install': 'ga',
  'review-lifecycle': 'preview',
  'ui-app-type': 'ga',
  'public-distribution': 'preview',
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
 */
export function isFeatureAvailable(feature: PreviewFeature): boolean {
  return FEATURE_STAGE[feature] === 'ga' || __BREVO_PREVIEW__;
}

/**
 * Refuse a gated feature.
 *
 * One message for all four, unlike `assertCapability` in `app-types/capabilities.ts`,
 * which takes the caller's wording so each command keeps the error string it shipped
 * with. Not an inconsistency: those are existing contracts a script may match on,
 * while this is new surface with no callers to break, and it answers a different
 * question ("this feature isn't released") than a capability error does ("this app
 * doesn't support that").
 *
 * Reachable in a published build only through `app create --distribution public` —
 * the flag parses before the gate sees it, so the value has to be refused rather than
 * hidden. Every gated *command* is gone from the binary and never reaches here.
 */
export function assertFeatureAvailable(feature: PreviewFeature): void {
  if (isFeatureAvailable(feature)) return;
  throw new CliError(messages.PREVIEW_FEATURE_UNAVAILABLE);
}
