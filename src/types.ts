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

// ──────────────── CLI version status (BEX-370) ────────────────

/**
 * The backend's verdict on the calling CLI.
 *
 * The backend already knows the caller's version — the CLI sends
 * `User-Agent: brevo-cli/<version> (<os>)` on every request — so it applies its
 * own support policy and returns a decision. The CLI performs no version
 * comparison of its own; that policy can then change without a CLI release.
 */
export type CliVersionStatus = 'ok' | 'outdated' | 'unsupported';

/**
 * What the backend advertised on a response. Both fields are optional by
 * contract: absent means "no new information", so the CLI keeps what it already
 * believed rather than changing state.
 */
export interface VersionSignal {
  latestVersion?: string;
  status?: CliVersionStatus;
}

/** Raw v1 body of `GET /v3/app-store/cli/info`. Every field is untrusted. */
export interface CliInfoResponse {
  code?: string;
  message?: string;
}

/** A validated, sanitized notice ready to render. */
export interface VersionNotice {
  code: string;
  message: string;
}

/** Query sent to `/cli/info`; purely informational for the backend today. */
export interface CliInfoQuery {
  reason: string;
  currentVersion: string;
  latestVersion?: string;
  status?: CliVersionStatus;
  os: string;
}

/** On-disk shape of `~/.brevo/cli-notice.json`. */
export interface VersionNoticeCache {
  /** The CLI version that wrote this entry. A mismatch invalidates it wholesale. */
  cliVersion: string;
  latestVersion?: string;
  status?: CliVersionStatus;
  notice?: VersionNotice;
  fetchedAt: number;
  ttlMs: number;
}
