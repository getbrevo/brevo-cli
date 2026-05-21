import { OAUTH_SCOPES_URL } from '../lib/constants';
import { ApiError, CliError, ErrorCode } from '../lib/errors';
import { messages } from '../lang/en';

export interface ScopeEntry {
  name: string;
  category: string;
  apiEndpoints: string[];
}

interface RawScope {
  name?: unknown;
  category?: unknown;
  api_endpoints?: unknown;
  is_oidc_reserved?: unknown;
}

export async function fetchSupportedScopes(): Promise<ScopeEntry[]> {
  let response: Response;
  try {
    response = await fetch(OAUTH_SCOPES_URL, { method: 'GET' });
  } catch {
    throw new ApiError(
      messages.OAUTH_METADATA_FETCH_FAILED(OAUTH_SCOPES_URL, 0),
      0,
      ErrorCode.NETWORK_ERROR,
    );
  }

  if (!response.ok) {
    throw new ApiError(
      messages.OAUTH_METADATA_FETCH_FAILED(OAUTH_SCOPES_URL, response.status),
      response.status,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new CliError(messages.OAUTH_METADATA_MISSING_SCOPES);
  }

  if (!body || typeof body !== 'object' || !Array.isArray((body as { scopes?: unknown }).scopes)) {
    throw new CliError(messages.OAUTH_METADATA_MISSING_SCOPES);
  }

  const rawScopes = (body as { scopes: unknown[] }).scopes as RawScope[];

  return rawScopes
    .filter(
      (
        s,
      ): s is {
        name: string;
        category: string;
        api_endpoints?: unknown;
        is_oidc_reserved?: unknown;
      } =>
        !!s &&
        typeof s === 'object' &&
        typeof s.name === 'string' &&
        typeof s.category === 'string' &&
        s.is_oidc_reserved !== true,
    )
    .map((s) => ({
      name: s.name,
      category: s.category,
      apiEndpoints: Array.isArray(s.api_endpoints)
        ? s.api_endpoints.filter((e): e is string => typeof e === 'string')
        : [],
    }));
}
