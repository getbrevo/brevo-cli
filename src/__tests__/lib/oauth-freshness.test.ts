import { Command } from 'commander';
import {
  OAUTH_REFRESH_SKEW_MS,
  shouldRefreshOauth,
  ensureFreshOauthToken,
  installProactiveOauthRefresh,
  OauthFreshnessDeps,
} from '../../lib/oauth-freshness';
import { AuthCred, OauthTokensToStore } from '../../lib/config';

const NOW = 1_800_000_000_000;

function oauthCred(overrides: Partial<Extract<AuthCred, { kind: 'oauth' }>> = {}): AuthCred {
  return {
    kind: 'oauth',
    accessToken: 'access-token-test',
    refreshToken: 'refresh-token-test',
    expiresAt: NOW + 60 * 60 * 1000,
    tokenType: 'Bearer',
    ...overrides,
  };
}

const refreshedTokens: OauthTokensToStore = {
  accessToken: 'new-access-token-test',
  refreshToken: 'new-refresh-token-test',
  expiresIn: 3600,
  tokenType: 'Bearer',
};

/** Deps with a near-expiry oauth cred by default, so the refresh path fires. */
function makeDeps(overrides: Partial<OauthFreshnessDeps> = {}): {
  deps: OauthFreshnessDeps;
  refresh: jest.Mock;
  persist: jest.Mock;
  onError: jest.Mock;
} {
  const refresh = jest.fn().mockResolvedValue(refreshedTokens);
  const persist = jest.fn();
  const onError = jest.fn();
  const deps: OauthFreshnessDeps = {
    getAuthCred: () => oauthCred({ expiresAt: NOW + 1000 }),
    refresh,
    persist,
    onError,
    now: () => NOW,
    ...overrides,
  };
  return { deps, refresh, persist, onError };
}

/** Minimal commander Command stub with an optional parent, as seen by the preAction hook. */
function mockCommand(name: string, parentName?: string): Command {
  return {
    name: () => name,
    ...(parentName ? { parent: { name: () => parentName } } : {}),
  } as unknown as Command;
}

/** Install the hook on a fresh program and run it under the given argv. */
async function runHook(
  argv: string[],
  actionCommand: Command,
  deps: OauthFreshnessDeps,
): Promise<void> {
  const program = new Command();
  program.name('brevo');
  installProactiveOauthRefresh(program, deps);

  const hooks = (program as unknown as { _lifeCycleHooks?: { preAction?: unknown[] } })
    ._lifeCycleHooks?.preAction;
  if (!hooks || hooks.length === 0) throw new Error('preAction hook was not registered');

  const originalArgv = process.argv;
  process.argv = argv;
  try {
    await (hooks[0] as (a: Command, b: Command) => Promise<void>)(program, actionCommand);
  } finally {
    process.argv = originalArgv;
  }
}

describe('shouldRefreshOauth', () => {
  it('should return false when there are no credentials', () => {
    expect(shouldRefreshOauth(undefined, NOW)).toBe(false);
  });

  it('should return false for api-key credentials', () => {
    expect(shouldRefreshOauth({ kind: 'api-key', apiKey: 'xkeysib-test-key' }, NOW)).toBe(false);
  });

  it('should return false while the access token is comfortably valid', () => {
    expect(shouldRefreshOauth(oauthCred(), NOW)).toBe(false);
  });

  it('should return false just outside the skew buffer', () => {
    const auth = oauthCred({ expiresAt: NOW + OAUTH_REFRESH_SKEW_MS + 1 });
    expect(shouldRefreshOauth(auth, NOW)).toBe(false);
  });

  it('should return true at the edge of the skew buffer', () => {
    const auth = oauthCred({ expiresAt: NOW + OAUTH_REFRESH_SKEW_MS });
    expect(shouldRefreshOauth(auth, NOW)).toBe(true);
  });

  it('should return true when the access token is inside the skew buffer', () => {
    expect(shouldRefreshOauth(oauthCred({ expiresAt: NOW + 1000 }), NOW)).toBe(true);
  });

  it('should return true when the access token has already expired', () => {
    expect(shouldRefreshOauth(oauthCred({ expiresAt: NOW - 60_000 }), NOW)).toBe(true);
  });

  it('should honour a custom skew buffer', () => {
    const auth = oauthCred({ expiresAt: NOW + 5 * 60 * 1000 });
    expect(shouldRefreshOauth(auth, NOW)).toBe(false);
    expect(shouldRefreshOauth(auth, NOW, 10 * 60 * 1000)).toBe(true);
  });

  it('should return false without a refresh token', () => {
    expect(shouldRefreshOauth(oauthCred({ expiresAt: NOW, refreshToken: '' }), NOW)).toBe(false);
  });

  it('should return false when expiresAt is not a finite number', () => {
    expect(shouldRefreshOauth(oauthCred({ expiresAt: Number.NaN }), NOW)).toBe(false);
  });
});

describe('ensureFreshOauthToken', () => {
  it('should refresh and persist a near-expiry token', async () => {
    const { deps, refresh, persist, onError } = makeDeps();

    await expect(ensureFreshOauthToken(deps)).resolves.toBe(true);
    expect(refresh).toHaveBeenCalledWith('refresh-token-test');
    expect(persist).toHaveBeenCalledWith(refreshedTokens);
    expect(onError).not.toHaveBeenCalled();
  });

  it('should do nothing while the token is still valid', async () => {
    const { deps, refresh, persist } = makeDeps({ getAuthCred: () => oauthCred() });

    await expect(ensureFreshOauthToken(deps)).resolves.toBe(false);
    expect(refresh).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it('should do nothing for api-key credentials', async () => {
    const { deps, refresh } = makeDeps({
      getAuthCred: () => ({ kind: 'api-key', apiKey: 'xkeysib-test-key' }),
    });

    await expect(ensureFreshOauthToken(deps)).resolves.toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('should do nothing when there are no credentials', async () => {
    const { deps, refresh } = makeDeps({ getAuthCred: () => undefined });

    await expect(ensureFreshOauthToken(deps)).resolves.toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('should swallow refresh failures and report them to onError', async () => {
    const err = new Error('network down');
    const { deps, persist, onError } = makeDeps({ refresh: jest.fn().mockRejectedValue(err) });

    await expect(ensureFreshOauthToken(deps)).resolves.toBe(false);
    expect(persist).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(err);
  });

  it('should swallow persist failures', async () => {
    const err = new Error('EROFS: read-only file system');
    const { deps, onError } = makeDeps({
      persist: jest.fn(() => {
        throw err;
      }),
    });

    await expect(ensureFreshOauthToken(deps)).resolves.toBe(false);
    expect(onError).toHaveBeenCalledWith(err);
  });

  it('should not require an onError handler', async () => {
    const { deps } = makeDeps({
      refresh: jest.fn().mockRejectedValue(new Error('boom')),
      onError: undefined,
    });

    await expect(ensureFreshOauthToken(deps)).resolves.toBe(false);
  });

  it('should fall back to the real clock when no now() is injected', async () => {
    const { deps, refresh } = makeDeps({
      now: undefined,
      getAuthCred: () => oauthCred({ expiresAt: Date.now() + 1000 }),
    });

    await expect(ensureFreshOauthToken(deps)).resolves.toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('installProactiveOauthRefresh', () => {
  it('should refresh before an authenticated command runs', async () => {
    const { deps, refresh, persist } = makeDeps();

    await runHook(['node', 'brevo', 'app', 'list'], mockCommand('list', 'app'), deps);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith(refreshedTokens);
  });

  it('should skip commands the auth guard does not protect', async () => {
    const { deps, refresh } = makeDeps();

    await runHook(['node', 'brevo', 'login'], mockCommand('login'), deps);
    await runHook(['node', 'brevo', 'logout'], mockCommand('logout'), deps);
    await runHook(
      ['node', 'brevo', 'skill:cli', 'install'],
      mockCommand('install', 'skill:cli'),
      deps,
    );
    await runHook(
      ['node', 'brevo', 'app', 'available-scopes'],
      mockCommand('available-scopes', 'app'),
      deps,
    );

    expect(refresh).not.toHaveBeenCalled();
  });

  it('should skip --help and --version invocations', async () => {
    const { deps, refresh } = makeDeps();

    await runHook(['node', 'brevo', 'app', 'list', '--help'], mockCommand('list', 'app'), deps);
    await runHook(['node', 'brevo', '--version'], mockCommand('list', 'app'), deps);

    expect(refresh).not.toHaveBeenCalled();
  });

  it('should never block the command when the refresh fails', async () => {
    const { deps, persist } = makeDeps({
      refresh: jest.fn().mockRejectedValue(new Error('login service unreachable')),
    });

    await expect(
      runHook(['node', 'brevo', 'app', 'list'], mockCommand('list', 'app'), deps),
    ).resolves.toBeUndefined();
    expect(persist).not.toHaveBeenCalled();
  });
});
