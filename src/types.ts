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
// The partner-authored text is two fields, `label` and `more_info`, and each one is
// rendered in two places:
//
//   - `label`     — the menu entry's text on an `.action` slot, and the CTA button's
//                   text on a `.widget` slot's card.
//   - `more_info` — the menu entry's `subText` on an `.action` slot, and the card's
//                   description on a `.widget` slot.
//
// A widget card's TITLE has no field: it is the *app name*. That is the only piece of
// rendered text a partner changes by renaming the app rather than by editing this block.
//
// (Before BEX-290 these two were named `heading`/`subheading` and the menu entry was
// labelled with the app name. Both changed together: the menu entry is now labelled from
// `label`, so a per-action label IS authorable and the old "there is nothing to author"
// note no longer holds.)
//
// The record context an app receives IS partly authorable, via each slot entry's
// `context` — but only downwards. The ceiling is that extension-point registry row's
// allow-list, chosen by the platform; `context` narrows it and can never widen it.

/**
 * The delivery path an extension renders through. camelCase per BEX-350, matching
 * the extension-point grammar; the pre-BEX-350 snake_case spellings are not
 * accepted (see the note on the constants in `lib/constants.ts`).
 *
 * - `actionLink` — a redirect-only CTA driven by `redirect_link`. The only type
 *   the CLI authors today.
 * - `iframeExtension` — opens `modal_iframe_url` in a modal iframe. The UI kit
 *   keeps `modal_iframe_url` *only* for this type, so authoring one on any other
 *   type is silently dropped.
 * - `legacyComponent` — the pre-extensibility interpreter path used by earlier
 *   integrations. Never CLI-authored; listed so a hand-edited config round-trips.
 */
export type ExtensionType = 'actionLink' | 'iframeExtension' | 'legacyComponent';

/**
 * Where an `actionLink` redirect opens. The UI kit falls back to `_blank` for an
 * absent or unrecognised value, but the CLI always writes one explicitly.
 */
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
 * A slot in the BEX-350 grammar `<location>.<place>.<kind>` — e.g.
 * `contactDetails.headerMenu.action`. Named for the field it types
 * (`surface_point_list`); the platform calls the same value `extensionPoint` when
 * it serves it back on the manifest.
 *
 * Casing and spelling are part of the contract: the UI kit matches
 * `extensionPoint` by exact string equality against the platform's
 * extension-point registry, and the backend *drops* an authored value with no
 * registry entry. Both failures are silent — an empty slot, no error, still a
 * 200 — which is why the CLI validates locally against the known registry.
 */
export type SurfacePoint = string;

/**
 * One entry of `surface_point_list`: a slot, plus the record-context field names this app
 * wants forwarded to it *on that slot*.
 *
 * Nested rather than a single top-level `context` array because the allow-list is a
 * property of the registry ROW, not of the app: a deal page and a contact page can expose
 * different fields, and one flat list cannot express "recordId on the contact page,
 * recordId + recordName on the deal page".
 *
 * `context` is a REQUEST to narrow, never a grant: the platform intersects it with that
 * slot's own allow-list, so an app can only ever receive fewer fields than the slot
 * permits. Absent or empty means "no narrowing" — the slot's whole allow-list is
 * forwarded. `brevo app create` seeds it from the row's `default_context_field`.
 *
 * The fields reach the partner's endpoint as QUERY PARAMETERS on `redirect_link` — there
 * is no path templating, so an app cannot receive `/contacts/123`; it must read params.
 */
export interface SurfacePointEntry {
  surface_point: SurfacePoint;
  context?: string[];
}

/**
 * One registry row from `GET /v3/app-store/surface-points` (BEX-361), normalized.
 *
 * Field names follow the registry's own columns: the server serves the slot name and its
 * three decomposed segments (`location_name` / `section_name` / `component_type`) so the
 * CLI never re-implements the grammar. Note `section_name` and `component_type` rather
 * than "place" and "kind" — those are the CLI's own vocabulary for the same two segments,
 * kept in `ExtensionPlace`/`ExtensionKind` and in the prompt labels, but the wire uses the
 * column names.
 *
 * `allowed_context_field` and `default_context_field` are field NAMES only, never values.
 * Everything but `surface_point` is optional because the read path tolerates partial rows
 * (see `fetchSurfacePoints`) — a registry seeded before a column existed still yields
 * usable prompts.
 */
export interface SurfacePointRow {
  /** Slot name in the `<location>.<place>.<kind>` grammar — the wire identity. */
  surface_point: string;
  /**
   * The registry's own identifier for the slot — a kebab-case SLUG
   * (`contact-details-header-menu`), NOT display text. Never render it to a partner: the
   * prompt labels come from `EXTENSION_PLACE_LABELS` in `lib/constants.ts`.
   */
  surface_point_name?: string;
  location_name?: string;
  section_name?: string;
  component_type?: string;
  /** Where in the product the slot lives, e.g. a CRM record-detail URL shape. */
  url_pattern?: string;
  /** The CEILING: every context field name this slot is able to forward. */
  allowed_context_field?: string[];
  /**
   * The SEED: what `brevo app create` writes into a new entry's `context`. A subset of
   * `allowed_context_field` — the registry enforces that, so a default can never exceed
   * the ceiling and make the CLI author a config its own upload rejects.
   */
  default_context_field?: string[];
  /** Which `extension_type` values this slot can serve. */
  extension_type_list?: string[];
  /** Registry lifecycle marker; anything other than `active` is not offerable. */
  status?: string;
}

/**
 * The row as it may arrive on the wire, before normalization.
 *
 * Both spellings are tolerated on read because the endpoint is specified but NOT BUILT
 * (see `RELEASE-CHECKLIST.md` → Before UI-apps GA), and the two candidate namings are the
 * registry's column names (above) and the pre-BEX-361 draft's `extension_point` /
 * `location` / `place` / `kind` / `supported_extension_types`. Keying strictly on either
 * one would fail CLOSED against the other: every row gets dropped, and the partner is told
 * the registry "has not been seeded" — pointing them at a data problem that doesn't exist.
 * Cheap to tolerate now, and the alias branch can go once the endpoint ships.
 */
export interface RawSurfacePointRow extends Partial<SurfacePointRow> {
  extension_point?: string;
  location?: string;
  place?: string;
  kind?: string;
  supported_extension_types?: string[];
}

/** Wire shape of GET /v3/app-store/surface-points (BEX-361). */
export interface SurfacePointsResponse {
  surface_points: RawSurfacePointRow[];
  count?: number;
}

/**
 * Wire shape of GET /v3/app-store/surface-points/locations (BEX-361): the registry's
 * distinct `location_name` values, e.g.
 * `{ locations: ['companyDetails', 'contactDetails', 'dealDetails'], count: 3 }`.
 *
 * Bare strings, not rows — which is all the record-page prompt needs, and the reason
 * `app create` asks for them instead of deriving them from a full registry read.
 */
export interface SurfacePointLocationsResponse {
  locations: string[];
  count?: number;
}

export interface UiApp {
  extension_type: ExtensionType;
  /**
   * The slots this app mounts on. An app may target several (e.g. the same action
   * link on contact, company and deal pages). An empty/absent list makes the
   * backend fall back to a default widget slot list, which is not what an
   * action-link author wants — so the CLI always writes at least one.
   */
  surface_point_list: SurfacePointEntry[];
  /**
   * The app's own text: the menu entry's label on an `.action` slot, the card's CTA
   * button text on a `.widget` slot. Required in practice — `validateUiApp` refuses an
   * empty one — but optional at the type level because the read path tolerates a
   * partial block (the backend degrades a malformed snapshot rather than erroring).
   */
  label?: string;
  /**
   * Supporting text: the menu entry's `subText` on an `.action` slot, the card's
   * description on a `.widget` slot. Optional — the kit renders it only when set.
   *
   * Not a hover tooltip: `ActionListItem` in the design system destructures a fixed
   * prop list with no rest-spread, so a native `title` attribute never reaches the DOM.
   * It is always-visible second-line text, which is also the accessible choice.
   */
  more_info?: string;
  /**
   * Destination for an `actionLink`. Non-http(s) values are dropped by the kit.
   * Refused on an `iframeExtension`: the widget-card path opens `modal_iframe_url`
   * while the header-menu path routes on `redirect_link` first, so an app carrying
   * both behaves differently depending on which slot renders it.
   */
  redirect_link?: string;
  /**
   * `actionLink` only, and NOT authored into `app-config.json` (BEX-290): `brevo app
   * upload` injects `_blank` into the payload, and `brevo app create` never writes it.
   * There was never a choice to make — the server refuses `_self` — so a field in the
   * file only invited a partner to edit it into a value that 400s.
   *
   * Still on the type for two reasons: the upload payload carries it, and the server's
   * `ui_app` echo may carry it back. The write-back strips it so it cannot creep back
   * into the file, and the upload diff ignores it so its presence server-side is not
   * reported as local drift.
   */
  link_target?: LinkTarget;
  /** `iframeExtension` only — dropped by the kit for any other type. */
  modal_iframe_url?: string;
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
  // Present only for UI apps, and only once the server echoes the ui_app block
  // back on reads. Absent for OAuth apps and on server builds that don't return it.
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

// Wire shape for POST /v3/app-store/apps/{app_id}/upload. Fully aligned with
// the create request (unified payload structure): OAuth fields travel inside
// the `auth` block on both endpoints, and the version field is named `version`
// like the response and every app object (the historical `app_version` request
// key is gone — the server accepts `version` as part of this alignment).
// distribution_type is top-level, matching the response and OAuthApp — it is
// an app-level attribute, not an OAuth setting. It is sent but immutable: the
// server 422s when it differs from the stored app, and the CLI additionally
// fast-fails on drift before uploading.
export interface UploadAppPayload {
  app_id: string;
  name: string;
  logo_uri: string;
  version: string;
  distribution_type: 'public' | 'private';
  // Absent for UI apps: their config carries an empty `auth: {}` and no
  // OAuth block travels on the wire — the key is omitted, not sent empty.
  // ASSUMED contract until the server side ships (RELEASE-CHECKLIST.md →
  // Before UI-apps GA). Always present for OAuth apps. Same block, same
  // semantics on the create request (unified payload structure).
  auth?: {
    scopes: string[];
    redirect_uris: string[];
  };
  // Sent only for UI apps (BEX-290). OAuth apps must never carry this key —
  // earlier CLI versions guaranteed it was never sent at all, and the OAuth
  // payload shape is unchanged from that contract.
  //
  // Named `ui_app` — the same key the block carries in app-config.json and
  // inside the platform's stored app snapshot, where "snapshot" means the whole
  // stored config and this block is only its UI subset. The platform's upload
  // endpoint (app-store-bo-be POST /cli/apps/{id}/upload) binds this key
  // strictly and rejects unknown keys with a 400, so any other name fails loudly
  // instead of being silently dropped.
  ui_app?: UiApp;
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
  // Echoed back for UI apps so the local config can be reconciled with whatever
  // the server normalized. Tolerated as absent: server builds that accept the
  // block on write but don't return it leave the locally-sent block in place.
  //
  // `link_target` is stripped from this echo before the write-back (BEX-290) —
  // the server defaults it to `_blank`, and the CLI deliberately stopped
  // authoring it, so echoing it straight through would silently re-add to
  // app-config.json the one field the file is not supposed to carry.
  ui_app?: UiApp;
}
