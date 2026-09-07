/**
 * The UI-app discriminators.
 *
 * A LEAF module: it imports nothing at runtime, only erased `import type`s. That is a
 * deliberate constraint, not an accident of size.
 *
 *   - `lib/config.ts` re-exports these as `isUiAppConfig` / `isUiAppRecord`, so it can depend
 *     on `app-types` without `app-types` depending back on it.
 *   - Half the command test suites mock `lib/config` with only the handful of functions they
 *     use. When the app-type registry read its predicates from there, every one of those
 *     mocks silently made detection `undefined` — `app submit`'s whole suite failed on
 *     `isUiAppRecord is not a function`. Keeping the predicates out of a mocked module means
 *     type detection can't be accidentally stubbed out by a test that wasn't thinking about
 *     it.
 */
// `import type` only — erased at compile time, so importing from `lib/config` here creates no
// runtime dependency and therefore no cycle when `lib/config` re-exports these.
import type { ProjectConfig } from '../../lib/config';
import type { OAuthApp } from '../../types';

/** The app-record fields detection needs. Partial: a server record may omit any of them. */
export type AppRecordLike = Partial<
  Pick<OAuthApp, 'ui_app' | 'client_id' | 'redirect_uris' | 'brevo_function'>
>;

/** The config fields detection needs. */
export type AppConfigLike = Pick<ProjectConfig, 'ui_app'>;

/**
 * Whether a project config describes a UI app rather than an OAuth app.
 *
 * The presence of the `ui_app` block is the discriminator, matching the wire contract; the
 * `app_type` key is informational only and never consulted. Every branch that needs to distinguish the app types goes
 * through here (or the registry that wraps it), so the discriminator can change in one place
 * if the backend later requires an explicit type field.
 */
export function isUiAppConfigShape(config: AppConfigLike | null | undefined): boolean {
  return !!config?.ui_app;
}

/**
 * Whether a *server* app record describes a UI app. The record counterpart to
 * {@link isUiAppConfigShape}.
 *
 * The echoed `ui_app` block is the reliable signal, but it is not always there:
 * `GET /v3/app-store/apps` (the list) returns no `ui_app` key at all today, and even the
 * single-app read only carries it on server builds that echo it back. So this falls back to
 * the absence of *every* piece of OAuth material — a UI app sends no `auth` block, so the
 * server has no client_id and no callbacks to return, and answers `client_id: ""` with
 * `redirect_uris: null`.
 *
 * Deliberately requires BOTH to be empty. A record with a client_id but no callbacks is a
 * half-configured OAuth app, not a UI app, and must keep rendering as one.
 *
 * The fallback can go once the list echoes `ui_app` (tracked in the branch-local
 * `docs.md` — see CLAUDE.md → Working docs).
 */
export function isUiAppRecordShape(app: AppRecordLike | null | undefined): boolean {
  if (!app) return false;
  if (app.ui_app) return true;
  return !app.client_id && !app.redirect_uris?.length;
}
