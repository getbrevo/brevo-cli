/**
 * The pre-GA gate (BEX-405).
 *
 * Public app distribution and UI apps are both shipped in this CLI but **not live on
 * the Brevo platform**. Until BEX-405 the only thing keeping a user — or their AI
 * agent — out of them was a notice in `agent-context/SKILL.md` / `AGENTS.md`, which
 * works exactly as far as the agent's cooperation goes and no further. This module
 * is the runtime half: gated surface is hidden from every help screen and refused
 * when invoked.
 *
 * **This is a guardrail, not a security boundary**, and `CLAUDE.md` is explicit
 * about it: the check runs client-side, anyone can build from source or call the API
 * directly, and real enforcement belongs on the API. What it stops is *accidental*
 * use — a partner, or an agent acting for one, creating an app they can do nothing
 * with.
 *
 * ## One table, so GA is one edit
 *
 * `FEATURE_STAGE` is the only place a feature's readiness is stated. Help filtering,
 * the runtime refusal, and the `app create` prompt all read it, so flipping a row to
 * `'ga'` releases that feature everywhere at once — no second list to find. See
 * `RELEASE-CHECKLIST.md` → *Before public-apps GA* / *Before UI-apps GA* for the
 * removal pass.
 *
 * Two of the four names are `Capability` values from `app-types/capabilities.ts`, and
 * that is deliberate rather than coincidental: commands already declare `requires` in
 * `commands/definitions.ts`, so command gating falls straight out of the field that
 * is already there. The other two are not capabilities — they gate a prompt choice
 * and a flag value, neither of which is a command.
 */
import { CliError } from './errors';
import { getEmail } from './config';
import { messages } from '../lang/en';

export type PreviewFeature =
  /** `app deploy` / `app rollback`. Also a `Capability`. */
  | 'account-install'
  /** `app submit` / `app status` / `app withdraw`. Also a `Capability`. */
  | 'review-lifecycle'
  /** The *UI app* choice in `app create`'s app-type prompt. */
  | 'ui-app-type'
  /** `app create --distribution public`. */
  | 'public-distribution';

export type FeatureStage = 'ga' | 'preview';

/**
 * Readiness per feature. Flip a row to `'ga'` to release it.
 *
 * Everything not listed here is GA by construction — absence from this table is not a
 * gate, so a new command is public unless someone opts it in.
 */
export const FEATURE_STAGE: Readonly<Record<PreviewFeature, FeatureStage>> = {
  'account-install': 'preview',
  'review-lifecycle': 'preview',
  'ui-app-type': 'preview',
  'public-distribution': 'preview',
} as const;

/**
 * Accounts that may use preview features regardless of stage.
 *
 * Same rule the agent docs already carry in their *Exception — internal Brevo
 * accounts* clause, and for the same reason: gating on the account domain rather than
 * on the user's say-so keeps it objective — an end user cannot talk their way past
 * it, while dogfooding and QA are unaffected.
 */
const INTERNAL_EMAIL_DOMAINS = ['@brevo.com', '@sendinblue.com'] as const;

/** Opt-in override, for CI and for QA runs against a non-Brevo test account. */
export const PREVIEW_ENV_VAR = 'BREVO_ENABLE_PREVIEW';

function envOptIn(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[PREVIEW_ENV_VAR] === '1' || env[PREVIEW_ENV_VAR] === 'true';
}

/**
 * Is the caller allowed to use preview features?
 *
 * Deliberately **synchronous and offline**. The email comes from the credentials
 * already cached at `~/.brevo/credentials.json` (`getEmail()`), not from a `whoami`
 * round-trip, for three reasons: help output must render before any network call and
 * while logged out; a network hop on every invocation to decide what to *print* is
 * indefensible; and a gate that fails when the API is slow would be worse than no
 * gate. Logged out ⇒ locked, which is the safe direction.
 */
export function isPreviewUnlocked(): boolean {
  if (envOptIn()) return true;
  const email = getEmail()?.trim().toLowerCase();
  if (!email) return false;
  return INTERNAL_EMAIL_DOMAINS.some((domain) => email.endsWith(domain));
}

/** Is this specific feature usable right now — either GA, or unlocked for this caller? */
export function isFeatureAvailable(feature: PreviewFeature): boolean {
  return FEATURE_STAGE[feature] === 'ga' || isPreviewUnlocked();
}

/**
 * Refuse a gated feature.
 *
 * One message for all four, unlike `assertCapability` in `app-types/capabilities.ts`,
 * which takes the caller's wording so each command keeps the error string it shipped
 * with. The distinction matters and is not an inconsistency: those messages are
 * *existing* contracts a script may match on, whereas this refusal is new surface with
 * no callers to break — and it answers a different question ("this feature isn't
 * released") than a capability error does ("this app doesn't support that"). The two
 * gates also never fire on the same run: this one runs first, so `app submit` reaches
 * its own not-public refusal byte-identical to before.
 */
export function assertFeatureAvailable(feature: PreviewFeature): void {
  if (isFeatureAvailable(feature)) return;
  throw new CliError(messages.PREVIEW_FEATURE_UNAVAILABLE);
}
