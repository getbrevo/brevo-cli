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
  version?: string;
  // Review-submission form for public apps (BEX-221); absent for private apps.
  google_form_link?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Lifecycle states for an app's review process, mirroring the server-side
 * `app_submission_states.state` enum (BEX-318). Kept as a union for reference;
 * `AppStateResponse.state` stays a plain string so a server-added state never
 * breaks the read path — the CLI maps unknown states to a generic message.
 */
export type AppState =
  | 'configured'
  | 'submitted'
  | 'in_review'
  | 'approved'
  | 'rejected'
  | 'changes_requested';

export interface AppStateResponse {
  // Optional: the read path tolerates a missing/empty state and normalizes it
  // to an "unknown" sentinel (see src/commands/app/status.ts).
  state?: string;
}

export interface CreateAppResponse {
  app_id: string;
  name: string;
  client_id: string;
  client_secret: string;
  distribution_type?: 'public' | 'private';
  redirect_uris: string[];
  logo_uri?: string;
  version?: string;
  created_at: string;
  updated_at: string;
}

// Wire shape for POST /v3/app-store/apps/{app_id}/upload — deliberately
// distinct from OAuthApp: distribution_type nests under auth (OAuthApp keeps
// it top-level), the version field is named app_version (not version), and
// redirect URLs are redirect_urls (not redirect_uris like every other
// endpoint). These are confirmed, intentional quirks of this one endpoint —
// do not "fix" them to match OAuthApp's naming.
export interface UploadAppPayload {
  app_id: string;
  name: string;
  logo_uri: string;
  app_version: string;
  auth: {
    distribution_type: 'public' | 'private';
    scopes: string[];
    redirect_urls: string[];
  };
}

export interface UploadAppResponse {
  app_id: string;
  name: string;
  logo_uri?: string;
  // The bumped version lives in `app_version` per the locked upload contract,
  // but tolerate `version` too: some server builds mirror the app object (which
  // uses `version` everywhere else — see OAuthApp). Reading both means a new
  // version is never silently dropped just because of which key the server used.
  app_version?: string;
  version?: string;
  // Top-level in the response (locked, server-confirmed contract) — only the
  // *request* nests distribution_type under auth. No server build has ever
  // emitted it inside the response's auth block.
  distribution_type?: 'public' | 'private';
  // The auth key is always present, but scopes/redirect_urls come back null
  // (not absent, not []) when the stored snapshot has no OAuth block, e.g.
  // UI-only apps. Treat null as "absent" — never iterate them directly.
  auth: {
    scopes?: string[] | null;
    redirect_urls?: string[] | null;
  };
}
