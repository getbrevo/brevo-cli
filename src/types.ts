export interface AccountResponse {
  email: string;
  companyName?: string;
  firstName?: string;
  lastName?: string;
  organization_id: string;
  user_id: number;
}

export interface OAuthApp {
  app_id: string;
  name: string;
  client_id: string;
  client_secret?: string;
  distribution_type?: 'public' | 'private';
  redirect_uris: string[];
  scopes?: string[];
  logo_uri?: string;
  created_at: string;
  updated_at: string;
}

export interface CreateAppResponse {
  app_id: string;
  name: string;
  client_id: string;
  client_secret: string;
  distribution_type?: 'public' | 'private';
  redirect_uris: string[];
  logo_uri?: string;
  created_at: string;
  updated_at: string;
}

// ──────────────── CLI update notice (BEX-370) ────────────────

/** Raw v1 body of `GET /v3/app-store/cli/info`. Every field is untrusted. */
export interface CliInfoResponse {
  code?: string;
  message?: string;
}

/** A validated, sanitized notice line ready to render. */
export interface VersionNotice {
  code: string;
  message: string;
}

/**
 * Query sent to `/cli/info`. Informational only — the CLI has already decided an
 * update is available by the time it asks, so nothing here drives the response.
 */
export interface CliInfoQuery {
  cliVersion: string;
  reason: string;
}
