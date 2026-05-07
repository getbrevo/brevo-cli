export interface RefreshedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
  scope?: string;
}

export class RefreshError extends Error {
  constructor(
    message: string,
    public readonly unauthorized: boolean,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'RefreshError';
  }
}

export async function refreshAccessToken(
  refreshToken: string,
  proxyUrl: string,
): Promise<RefreshedTokens> {
  let res: Response;
  try {
    res = await fetch(`${proxyUrl}/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new RefreshError('Could not reach the Brevo login service.', false, err);
  }

  if (!res.ok) {
    throw new RefreshError(`Token refresh failed (${res.status}).`, res.status === 401);
  }

  let body: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
    scope?: string;
  };
  try {
    body = (await res.json()) as typeof body;
  } catch (err) {
    throw new RefreshError('Malformed refresh response from login service.', false, err);
  }

  if (
    !body.access_token ||
    typeof body.access_token !== 'string' ||
    typeof body.expires_in !== 'number' ||
    !Number.isFinite(body.expires_in) ||
    body.expires_in <= 0 ||
    !body.token_type ||
    typeof body.token_type !== 'string'
  ) {
    throw new RefreshError('Malformed refresh response from login service.', false);
  }

  // refresh_token rotation is optional (proxies often only mint a new one
  // when the old one is close to expiry). When the field is present it must
  // be a non-empty string — `??` would let an empty string slip through and
  // get persisted as a permanently-broken refresh token.
  let resolvedRefreshToken = refreshToken;
  if (body.refresh_token !== undefined) {
    if (typeof body.refresh_token !== 'string' || body.refresh_token.length === 0) {
      throw new RefreshError('Malformed refresh response from login service.', false);
    }
    resolvedRefreshToken = body.refresh_token;
  }

  return {
    accessToken: body.access_token,
    refreshToken: resolvedRefreshToken,
    expiresIn: body.expires_in,
    tokenType: body.token_type,
    scope: body.scope,
  };
}
