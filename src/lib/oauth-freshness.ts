import { Command } from 'commander';
import { commandRequiresAuth } from './auth-guard';
import { AuthCred, OauthTokensToStore } from './config';

type OauthCred = Extract<AuthCred, { kind: 'oauth' }>;

// Refresh this far ahead of `expiresAt`. Covers clock skew between the CLI host
// and the IdP plus the round-trip of the request the token is about to be used
// for, so a token that would expire mid-flight is replaced first.
export const OAUTH_REFRESH_SKEW_MS = 60_000;

export interface OauthFreshnessDeps {
  getAuthCred: () => AuthCred | undefined;
  refresh: (refreshToken: string) => Promise<OauthTokensToStore>;
  persist: (tokens: OauthTokensToStore) => void;
  now?: () => number;
  skewMs?: number;
  onError?: (err: unknown) => void;
}

// True when `auth` is an OAuth credential whose access token is expired or
// about to be. Doubles as a type guard so callers get the narrowed credential
// (and its `refreshToken`) without a cast.
export function shouldRefreshOauth(
  auth: AuthCred | undefined,
  now: number,
  skewMs: number = OAUTH_REFRESH_SKEW_MS,
): auth is OauthCred {
  if (auth?.kind !== 'oauth') return false;
  if (!auth.refreshToken) return false;
  if (!Number.isFinite(auth.expiresAt)) return false;
  return auth.expiresAt - skewMs <= now;
}

/**
 * Proactively swap a near-expiry OAuth access token for a fresh one.
 *
 * Best-effort by design: every failure is swallowed (and handed to `onError`
 * for debug logging) so a transient network blip or an unwritable credentials
 * file never blocks the command the user actually asked for. The reactive
 * `onAuthFailure` handler in `bin/index.ts` remains the single source of truth
 * for clearing credentials when the refresh token is genuinely dead.
 *
 * Returns true only when a new token was fetched and persisted.
 */
export async function ensureFreshOauthToken(deps: OauthFreshnessDeps): Promise<boolean> {
  const auth = deps.getAuthCred();
  const now = deps.now ? deps.now() : Date.now();

  if (!shouldRefreshOauth(auth, now, deps.skewMs)) return false;

  try {
    deps.persist(await deps.refresh(auth.refreshToken));
    return true;
  } catch (err) {
    deps.onError?.(err);
    return false;
  }
}

// Registers the proactive refresh as a `preAction` hook, gated to exactly the
// commands the auth guard protects — local-only commands (`login`, `logout`,
// `skill:cli …`) must keep working offline, so they never trigger a network
// call. Register after `installAuthGuard` so an unauthenticated invocation
// still fails fast on the guard.
export function installProactiveOauthRefresh(program: Command, deps: OauthFreshnessDeps): void {
  program.hook('preAction', async (thisCommand, actionCommand) => {
    if (!commandRequiresAuth(thisCommand, actionCommand)) return;
    await ensureFreshOauthToken(deps);
  });
}
