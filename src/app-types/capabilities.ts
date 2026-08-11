/**
 * Which features apply to which apps.
 *
 * Two axes, and they are ORTHOGONAL — this is the whole reason the matrix exists rather than
 * a method on the app type. `review-lifecycle` follows *distribution* (only a public app can
 * be submitted for review); `account-install` follows *app type* (only a UI app is installed
 * into an account). Collapsing them into one hierarchy produces a `PublicUiApp` class and a
 * combinatorial mess.
 *
 * Before this file the rule lived in exactly two places, neither of them executable: prose in
 * `bin/index.ts`'s help text ("App-review commands (public apps only)") and the same claim in
 * the agent docs. The only code that enforced any of it was one hand-rolled check in
 * `submit.ts`. A table makes the rule enumerable, which is what lets the help groupings and
 * the docs be generated from it instead of hand-maintained.
 */
import { CliError } from '../lib/errors';
import type { AppTypeId } from './contract';

export type Distribution = 'private' | 'public';

export type Capability =
  /** OAuth credentials exist: `app credentials`, `app start`, the oauth scaffold feature. */
  | 'oauth-flow'
  /** Callback URLs are required and validated. OAuth-only — a UI app has none. */
  | 'redirect-uris'
  /** There is local code to generate. A UI app runs on the partner's own infra. */
  | 'scaffold-feature'
  /** `app deploy` / `app rollback` — per-account availability. */
  | 'account-install'
  /** `app submit` / `app status` / `app withdraw`. */
  | 'review-lifecycle';

/**
 * The matrix. Read it as: "an app of THIS type, distributed THIS way, supports these."
 *
 * `review-lifecycle` is present exactly when distribution is `public`, for both types. That
 * equivalence is load-bearing: `app submit`'s existing gate is literally
 * `distribution_type !== 'public'`, and routing it through this table has to keep answering
 * the same way for every combination. If you ever make review-lifecycle type-dependent,
 * `submit.ts`'s message and exit code change with it — treat that as user-visible.
 */
const MATRIX: Readonly<Record<AppTypeId, Readonly<Record<Distribution, readonly Capability[]>>>> = {
  oauth: {
    private: ['oauth-flow', 'redirect-uris', 'scaffold-feature'],
    public: ['oauth-flow', 'redirect-uris', 'scaffold-feature', 'review-lifecycle'],
  },
  ui: {
    // A UI app has no OAuth block, so no credentials, no callbacks, and nothing to
    // scaffold locally. Its one lifecycle verb is the per-account install.
    private: ['account-install'],
    public: ['account-install', 'review-lifecycle'],
  },
} as const;

export function capabilitiesFor(
  type: AppTypeId,
  distribution: Distribution,
): readonly Capability[] {
  return MATRIX[type][distribution];
}

export function supports(
  type: AppTypeId,
  distribution: Distribution,
  capability: Capability,
): boolean {
  return capabilitiesFor(type, distribution).includes(capability);
}

/**
 * Enforce a capability, with the CALLER's message.
 *
 * The message is a parameter rather than derived from the capability on purpose. Each command
 * already has a specific, tested error string (`APP_SUBMIT_NOT_PUBLIC`, and its exit code),
 * and scripts may match on it — `CLAUDE.md` counts changed error messages and exit codes as
 * user-visible. So the matrix single-sources the *decision* while every command keeps the
 * *wording* it shipped with. A generic "this app doesn't support X" message would be tidier
 * and would silently break callers.
 */
export function assertCapability(
  type: AppTypeId,
  distribution: Distribution,
  capability: Capability,
  message: string,
): void {
  if (!supports(type, distribution, capability)) {
    throw new CliError(message);
  }
}
