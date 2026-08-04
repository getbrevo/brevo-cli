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

// Wire shape for POST /v3/app-store/apps/{app_id}/upload. One deliberate
// quirk remains vs OAuthApp: the request's version field is named app_version
// (not version) — confirmed, intentional, do not "fix" it. Everything else is
// aligned (BEX-355 contract): redirect URIs are redirect_uris like every other
// endpoint, and distribution_type is top-level, matching the response and
// OAuthApp — it is an app-level attribute, not an OAuth setting. It is sent
// but immutable: the server 422s when it differs from the stored app, and the
// CLI additionally fast-fails on drift before uploading.
export interface UploadAppPayload {
  app_id: string;
  name: string;
  logo_uri: string;
  app_version: string;
  distribution_type: 'public' | 'private';
  auth: {
    scopes: string[];
    redirect_uris: string[];
  };
}

export interface UploadAppResponse {
  app_id: string;
  name: string;
  logo_uri?: string;
  // The bumped version lives in `version` — confirmed against the BO source
  // (app-store-bo-be cliUploadAppResponse), which emits `version` (+ optional
  // `display_version`), same as the app object everywhere else. `app_version`
  // is request-side naming only; tolerate it here as a fallback so a server
  // build that ever mirrors the request key can't silently drop the bump.
  version?: string;
  app_version?: string;
  display_version?: string;
  // Top-level, same as the request (locked, server-confirmed contract). No
  // server build has ever emitted it inside the response's auth block.
  distribution_type?: 'public' | 'private';
  // The auth key is always present, but scopes/redirect_uris come back null
  // (not absent, not []) when the stored snapshot has no OAuth block, e.g.
  // UI-only apps. Treat null as "absent" — never iterate them directly.
  auth: {
    scopes?: string[] | null;
    redirect_uris?: string[] | null;
  };
}
