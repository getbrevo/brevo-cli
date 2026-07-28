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
// This block IS the app snapshot the platform stores, field for field: the
// manifest endpoint parses exactly this shape and projects a subset of it into
// each manifest item's `app_configs`, which the extensibility UI kit renders.
// Verified against both of those consumers (BEX-308 / BEX-350).
//
// Deliberately NOT the UIApp Support Spec's `properties`/`trigger` shape: nothing
// on either side of the platform reads those names. Keeping the CLI's authored
// file 1:1 with the consumed shape means there is no mapping layer to drift.
//
// Two fields the spec described have no counterpart in the implementation and are
// therefore not authorable:
//   - a per-action label — the menu entry is labelled with the *app name*, so
//     there is nothing to author.
//   - `contextProperties` — the record context an action receives is an allow-list
//     on the extension-point registry entry, i.e. a property of the slot, chosen
//     by the platform, not declared by the partner.

/**
 * The delivery path an extension renders through.
 *
 * - `action_link` — a redirect-only CTA driven by `redirectLink`. The only type
 *   the CLI authors today.
 * - `iframe_extension` — opens `modalIframeUrl` in a modal iframe. The UI kit
 *   keeps `modalIframeUrl` *only* for this type, so authoring one on any other
 *   type is silently dropped.
 * - `legacy_component` — the pre-extensibility interpreter path used by earlier
 *   integrations. Never CLI-authored; listed so a hand-edited config round-trips.
 */
export type ExtensionType = 'action_link' | 'iframe_extension' | 'legacy_component';

/** Where an `action_link` redirect opens. The backend defaults this to `_blank`. */
export type LinkTarget = '_blank' | '_self';

/**
 * A CRM record page an extension can mount on — the `location` segment of a slot
 * name, and the same value a host fetches its manifest with.
 */
export type ExtensionLocation = 'contactDetails' | 'companyDetails' | 'dealDetails';

/**
 * The `place` segment of a slot name: the slot's ROLE within a location, not a
 * layout coordinate (columns stack on mobile, so a redesign that moved one would
 * otherwise invalidate every registration).
 */
export type ExtensionPlace =
  | 'overviewAttributes'
  | 'overviewMain'
  | 'overviewSidebar'
  | 'headerMenu';

/** The `kind` segment: `widget` mounts a widget, `action` yields a menu entry. */
export type ExtensionKind = 'widget' | 'action';

/**
 * A slot name in the BEX-350 grammar `<location>.<place>.<kind>` — e.g.
 * `contactDetails.headerMenu.action`.
 *
 * Casing and spelling are part of the contract: the UI kit matches
 * `extensionPoint` by exact string equality against the platform's
 * extension-point registry, and the backend *drops* an authored name with no
 * registry entry. Both
 * failures are silent — an empty slot, no error, still a 200 — which is why the
 * CLI validates names locally against the known registry.
 */
export type ExtensionPointName = string;

export interface UiApp {
  extensionType: ExtensionType;
  /**
   * The slots this app mounts on. An app may target several (e.g. the same action
   * link on contact, company and deal pages). An empty/absent list makes the
   * backend fall back to a default widget slot list, which is not what an
   * action-link author wants — so the CLI always writes at least one.
   */
  surfacePointList: ExtensionPointName[];
  /** Primary CTA text rendered by the kit. */
  heading?: string;
  /** Secondary CTA text rendered beneath the heading. */
  subheading?: string;
  /** Destination for an `action_link`. Non-http(s) values are dropped by the kit. */
  redirectLink?: string;
  /** `action_link` only. Written explicitly rather than relying on the server default. */
  linkTarget?: LinkTarget;
  /** `iframe_extension` only — dropped by the kit for any other type. Not authorable yet. */
  modalIframeUrl?: string;
  /** Snapshot version, surfaced at the manifest item root. Server-managed. */
  version?: string;
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
  // Present only for UI apps, and only once the server echoes the snapshot back
  // on reads. Absent for OAuth apps and on server builds that don't return it.
  snapshot?: UiApp;
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
  //
  // Named `snapshot` after the app snapshot the manifest read path parses.
  // ⚠️ The write path is the one part of this contract that does not exist on the
  // platform yet, so this key is an assumption — the shape is confirmed against
  // its consumers, only the transport is not. Tracked in RELEASE-CHECKLIST.md.
  snapshot?: UiApp;
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
  // the server normalized (notably `linkTarget`, which it defaults to `_blank`).
  // Tolerated as absent: server builds that accept the snapshot on write but
  // don't return it leave the locally-sent block in place.
  snapshot?: UiApp;
}
