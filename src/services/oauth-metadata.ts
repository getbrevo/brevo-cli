import { OAUTH_WELL_KNOWN_URL } from '../lib/constants';
import { ApiError, CliError, ErrorCode } from '../lib/errors';
import { messages } from '../lang/en';

export async function fetchSupportedScopes(): Promise<string[]> {
  let response: Response;
  try {
    response = await fetch(OAUTH_WELL_KNOWN_URL, { method: 'GET' });
  } catch {
    throw new ApiError(
      messages.OAUTH_METADATA_FETCH_FAILED(OAUTH_WELL_KNOWN_URL, 0),
      0,
      ErrorCode.NETWORK_ERROR,
    );
  }

  if (!response.ok) {
    throw new ApiError(
      messages.OAUTH_METADATA_FETCH_FAILED(OAUTH_WELL_KNOWN_URL, response.status),
      response.status,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new CliError(messages.OAUTH_METADATA_MISSING_SCOPES);
  }

  if (
    !body ||
    typeof body !== 'object' ||
    !Array.isArray((body as Record<string, unknown>).scopes_supported) ||
    !((body as Record<string, unknown>).scopes_supported as unknown[]).every(
      (s) => typeof s === 'string',
    )
  ) {
    throw new CliError(messages.OAUTH_METADATA_MISSING_SCOPES);
  }

  return (body as { scopes_supported: string[] }).scopes_supported;
}
