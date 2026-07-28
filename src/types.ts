export interface AccountResponse {
  email: string;
  companyName?: string;
  firstName?: string;
  lastName?: string;
  organization_id: string;
  user_id: number;
}

// ──────────────── UI apps (BEX-290) ────────────────
// A UI app is a *type* of app, not a separate entity: it shares the app record,
// credentials, and version lifecycle with OAuth apps, and adds a `ui_app` block
// describing where and how it renders inside Brevo.
//
// Field names follow the UIApp Support Spec verbatim (`type: 'link'`,
// `properties.surface`, `trigger.externalUrl`, `contextProperties`). The
// Extension Points ADR names the same concepts differently (`action_link`,
// `location`/`section`, `redirectLink`) — the app-store backend is the
// validation authority, so if it rejects these names this is the single place
// to remap them.
//
// Only `type: 'link'` with `trigger.type: 'link'` — the "action link" — is
// authorable by the CLI today. The rest of the union is typed so future variants
// (modal cards, widgets, cloud functions) don't need a reshape, and so a
// hand-edited config carrying them round-trips instead of being dropped.
export type UiAppType = 'link' | 'card' | 'widget' | 'function';
export type UiAppSurface = 'contact' | 'deal' | 'company' | 'object';
export type UiAppTriggerType = 'link' | 'modal';
export type UiAppPlacement = 'sidebar' | 'center';

export interface UiAppTrigger {
  type: UiAppTriggerType;
  externalUrl: string;
  label: string;
}

export interface UiAppProperties {
  surface: UiAppSurface;
  title: string;
  description: string;
  /** Card/widget only — absent for action links, which render in an action menu. */
  placement?: UiAppPlacement;
  contextProperties: string[];
  trigger: UiAppTrigger;
}

export interface UiApp {
  type: UiAppType;
  properties: UiAppProperties;
  /** Modal cards only (future scope). */
  modal?: { width: number; height: number };
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
  // Present only for UI apps, and only once the server echoes the block back on
  // reads. Absent for OAuth apps and on server builds that don't return it yet.
  ui_app?: UiApp;
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
  // Sent only for UI apps (BEX-290). OAuth apps must never carry this key —
  // earlier CLI versions guaranteed it was never sent at all, and the OAuth
  // payload shape is unchanged from that contract.
  ui_app?: UiApp;
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
  auth: {
    distribution_type?: 'public' | 'private';
    scopes?: string[];
    redirect_urls?: string[];
  };
  // Echoed back for UI apps so the local config can be reconciled with whatever
  // the server normalized. Tolerated as absent: server builds that accept
  // `ui_app` on write but don't return it leave the locally-sent block in place.
  ui_app?: UiApp;
}
