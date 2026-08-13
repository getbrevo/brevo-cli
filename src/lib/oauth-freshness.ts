import { Command } from 'commander';
import { commandRequiresAuth } from './auth-guard';
import { AuthCred, OauthTokensToStore } from './config';
import { AuthExpiredError } from './errors';

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
  /**
   * Classifies a refresh failure: true when the refresh *token* was refused
   * rather than the request merely failing to land. Injected instead of
   * imported because the only thing that can answer it — `RefreshError` — lives
   * in `services/`, and `lib/` never imports `services/`. `bin/index.ts`
   * supplies the real predicate.
   *
   * Omitted, every failure counts as transient, which is exactly the
   * best-effort behaviour this module shipped with.
   */
  isTerminal?: (err: unknown) => boolean;
  /**
   * Runs once, immediately before the `AuthExpiredError`, to clear the dead
   * credentials. Separate from the throw so this module doesn't have to know
   * where credentials live.
   */
  onTerminal?: () => void;
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
 * Best-effort for a failure that says nothing about the session — a network
 * blip, a 5xx, an unwritable credentials file. Those are handed to `onError`
 * for debug logging and swallowed, so they never block the command the user
 * actually asked for.
 *
 * **A refused refresh token is not one of those.** When `isTerminal` recognises
 * the failure, the session is over and no later request can rescue it, so this
 * clears the credentials and throws `AuthExpiredError` at the caller. As a
 * `preAction` hook that lands before the command body — i.e. before a long
 * interactive flow asks its first question, rather than after its last. Without
 * it `brevo app create` collected six answers, sent them, and only then
 * discovered the session had already been unusable when it started.
 *
 * The reactive `onAuthFailure` handler in `bin/index.ts` still covers the case
 * this one cannot see: a token the server rejects while the stored `expiresAt`
 * still looks fresh.
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
    if (deps.isTerminal?.(err)) {
      deps.onTerminal?.();
      throw new AuthExpiredError();
    }
    deps.onError?.(err);
    return false;
  }
}

// Registers the proactive refresh as a `preAction` hook, gated to exactly the
// commands the auth guard protects — local-only commands (`login`, `logout`,
// `skill:cli …`) must keep working offline, so they never trigger a network
// call. Register after `installAuthGuard` so an unauthenticated invocation
// still fails fast on the guard.
//
// A terminal failure propagates out of the hook, which Commander turns into a
// rejected `parseAsync` — the command body never runs. That is the point: the
// message has to beat the first prompt.
export function installProactiveOauthRefresh(program: Command, deps: OauthFreshnessDeps): void {
  program.hook('preAction', async (thisCommand, actionCommand) => {
    if (!commandRequiresAuth(thisCommand, actionCommand)) return;
    await ensureFreshOauthToken(deps);
  });
}
