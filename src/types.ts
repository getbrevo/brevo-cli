export interface AccountResponse {
  email: string;
  companyName?: string;
  firstName?: string;
  lastName?: string;
  organization_id: string;
  user_id: number;
  /**
   * The account-type discriminator, VERIFIED against a live corporate account
   * (2026-08-21 — this was the last assumed wire contract). `'corporate'` marks a
   * master account that owns sub-accounts; anything else takes the plain branch.
   *
   * Optional on purpose: a response without the field degrades to "plain account",
   * which resolves deterministically and never prompts. That is the safe default —
   * mistaking a master account for a plain one costs a "pass the account ID
   * explicitly" round trip, while the reverse would prompt a user who has nothing
   * to pick from.
   */
  type?: string;
}

/**
 * One row of `GET /v3/corporate/subAccount` (BEX-290). `id` is the numeric
 * sub-account ID, so a picker selection needs no follow-up lookup — it is exactly
 * what `deploy_client_id` wants. `createdAt` and `groups` are returned but unused.
 */
export interface SubAccount {
  id: number;
  companyName?: string;
  active?: boolean;
}

export interface SubAccountsResponse {
  count: number;
  subAccounts: SubAccount[];
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
 *
 * There is deliberately no `extension_point_name` here. The platform derives the dotted
 * name from the slug at create/upload and stores it on its own copy of the entry; it is
 * server-managed and never echoed back, so nothing writes it into `app-config.json`.
 */
export interface SurfacePointEntry {
  /**
   * The registry's `surface_point_name` slug for the slot — e.g.
   * `contactDetails.header.menu`. Named for the registry COLUMN it must match, which is
   * the point of the field name: the entry key and the `WHERE` clause read the same.
   *
   * NOT the `<location>.<place>.<kind>` name of the BEX-350 grammar
   * (`contactDetails.headerMenu.action`). The slug is dotted too since the rename away
   * from kebab-case (`contact-details-header-menu`), which makes the two easier than
   * ever to confuse. Both identify the same registry row, 1:1, and
   * both travel under names built from the words "surface point" — but only the slug is
   * authorable. The platform resolves an authored entry with
   * `WHERE surface_point_name = ANY(...)` and then serves that row's dotted
   * `extension_point_name` to the frontend as `extensionPoint`, which is where the grammar
   * shows up and why it is easy to write here by mistake.
   *
   * Spelling is part of the contract: an authored value with no registry row is a 400 from
   * `app upload` (`checkExtensionPoints`), and on the read path the backend *drops* it —
   * an empty slot, no error, still a 200.
   */
  surface_point_name: string;
  context?: string[];
  /**
   * The entry's own text: the menu entry's label on an `.action` slot, the card's CTA
   * button text on a `.widget` slot. Per placement since BEX-426 — an app on three slots
   * can label each differently. Required in practice (`validateUiApp` refuses an empty
   * one on every entry) but optional at the type level because the read path tolerates
   * a partial block.
   */
  label?: string;
  /**
   * Supporting text: the menu entry's `subText`, the card's description. Optional —
   * the kit renders it only when set. Per placement since BEX-426.
   */
  more_info?: string;
  /**
   * Destination for an `actionLink` — per placement since BEX-426, because a different
   * slot usually wants a different deep link. Required on every entry of an `actionLink`
   * app; refused on an `iframeExtension` (see the validator for why the two URLs cannot
   * coexist).
   */
  redirect_link?: string;
  /**
   * `iframeExtension` only — the URL the modal embeds. Per placement since BEX-426.
   * Refused on an `actionLink`, where the kit would silently drop it.
   */
  modal_iframe_url?: string;
  /**
   * Where THIS entry's `redirect_link` opens. It followed the CTA fields off the block
   * root because it qualifies a per-entry destination — a root value could only ever say
   * one thing about every slot.
   *
   * Still NOT authored into `app-config.json`: `brevo app upload` injects `_blank` onto
   * each `actionLink` entry, `brevo app create` never writes it, and the write-back strips
   * it back out. On the type because the payload carries it and the server now echoes it
   * per entry. Absent on an `iframeExtension` entry, which embeds its URL rather than
   * navigating to it.
   */
  link_target?: LinkTarget;
  /**
   * Optional card size for the widget card THIS placement renders, at the same level
   * as `context` for the same reason: per placement, so two slots can size their cards
   * differently. Each axis is a CSS length string — "<positive integer>px" sizes the axis
   * absolutely, "<1-100>%" sizes it relative to the host slot's box. At least one axis is
   * required when the object is authored at all; an omitted axis stays on the host slot's
   * default.
   *
   * A request to SHRINK, never to grow: the record page clamps the card to its column
   * (max-width 100%), so this can reduce the card's footprint but never overflow the host
   * layout. Absent means the host slot's default size applies entirely (BEX-416).
   */
  size?: { width?: string; height?: string };
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
 * Everything but `extension_point_name` is optional because the read path tolerates partial
 * rows (see `fetchSurfacePoints`) — a registry seeded before a column existed still yields
 * usable prompts.
 */
export interface SurfacePointRow {
  /**
   * Slot name in the `<location>.<place>.<kind>` grammar, straight from the registry's
   * `extension_point_name` column. This is what the UI kit eventually renders as
   * `extensionPoint` — it is NOT what an entry is authored by. See `surface_point_name`.
   *
   * Served as `surface_point` until BEX-290, which was the only field here not named after
   * its column and named the one thing it must not be confused with. Nothing uses that
   * spelling any more.
   */
  extension_point_name: string;
  /**
   * The registry's own identifier for the slot — an authoring SLUG
   * (`contactDetails.header.menu`), NOT display text. Never render it to a partner: the
   * prompt labels each row as `section_name — component_type`, the registry's own values.
   *
   * This is the AUTHORING identity: the value `app create` writes into a
   * `surface_point_list` entry — under this same key, which is the point — and the only
   * one the platform's lookup matches. Optional because the column is nullable — a row
   * without it cannot be authored and is dropped from the prompt (`toUsableRows`).
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
  /**
   * The slot's default card size (BEX-461) — a SEED exactly like `default_context_field`:
   * `brevo app create` writes it into a new entry's `size` when the developer authors
   * none, and the entry's own value is then what upload validates and the platform
   * serves. `null`/absent when the slot declares no default; only widget rows can carry
   * one (the registry's CHECK refuses it on an action slot, which has no card geometry).
   * Axes follow the per-entry `size` grammar the registry CHECK enforces at seed time,
   * so seeding from it cannot author a config the CLI's own upload rejects.
   */
  default_size?: { width?: string; height?: string } | null;
  /** Which `extension_type` values this slot can serve. */
  extension_type_list?: string[];
  /** Registry lifecycle marker; anything other than `active` is not offerable. */
  status?: string;
}

/**
 * The row as it may arrive on the wire, before normalization.
 *
 * Both spellings are tolerated on read; the two candidate namings are the registry's
 * column names (above) and the pre-BEX-361 draft's `extension_point` / `location` /
 * `place` / `kind` / `supported_extension_types`. Keying strictly on either one would
 * fail CLOSED against the other: every row gets dropped, and the partner is told the
 * registry "has not been seeded" — pointing them at a data problem that doesn't exist.
 * The tolerance was added while the endpoint was specified but not built; BEX-361 has
 * since shipped and the row shape is confirmed from the deployed handlers, so the alias
 * branch is cleanup-ready — tracked in `docs.md` (repo root) → *CLI cleanups now
 * unblocked*.
 */
export interface RawSurfacePointRow extends Partial<SurfacePointRow> {
  extension_point?: string;
  location?: string;
  place?: string;
  kind?: string;
  supported_extension_types?: string[];
  /**
   * What the endpoint actually serves since BEX-422: the `extension_type` values currently
   * authorable on the slot (the registry's `enabled_extension_types` column — never empty
   * on the wire, a slot with an empty list is disabled and not served at all). Normalized
   * onto `extension_type_list`, the CLI's own field for the same fact.
   */
  enabled_extension_types?: string[];
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
   * NOTE (BEX-426): `label`, `more_info`, `redirect_link`, `modal_iframe_url` and
   * `link_target` are deliberately NOT fields of this block any more — they live on each
   * `surface_point_list` entry, so two placements can carry different copy, different
   * destinations and their own link target. `validateUiApp` refuses the root spellings by
   * name with a migration hint, and so does the server (`supersededUIAppKeys`). Only
   * `extension_type` (the validation-spec selector for the whole block) and the
   * server-managed `version` below stay at the root.
   */
  /** Snapshot version, surfaced at the manifest item root. Server-managed. */
  version?: string;
}

export interface OAuthApp {
  app_id: string;
  name: string;
  client_id: string;
  client_secret?: string;
  distribution_type?: 'public' | 'private';
  // Null — not absent, not [] — on any app with no OAuth block, i.e. every UI
  // app: it sends no `auth`, so the server has no callbacks or scopes to return.
  // Nullable rather than optional because that is what the wire does, and the
  // compiler is the only thing that catches the next unguarded iteration. Same
  // handling as `UploadAppResponse.auth`: treat null as "absent".
  redirect_uris: string[] | null;
  scopes?: string[] | null;
  logo_uri?: string;
  version?: string;
  // Review-submission form for public apps (BEX-221); absent for private apps.
  google_form_link?: string;
  // Present only for UI apps. Confirmed echoed by GET /cli/apps/{id}, which sources
  // it from the latest app_versions snapshot in the same wire shape upload binds.
  // Absent for OAuth apps and on server builds that predate the block.
  ui_app?: UiApp;
  // Optional because no deployed handler sends them: `cliOAuthAppResponse` (the
  // struct behind both the credential-reveal and the update response) declares
  // neither. Nothing in `src/` reads them. Declaring them required was the same
  // class of type-lie that hid BEX-405 — a required field the server never sends
  // reads as `undefined` at every call site without the compiler objecting.
  created_at?: string;
  updated_at?: string;
}

/**
 * Lifecycle states for an app's review process, mirroring the server-side
 * `app_submission_states.state` enum (BEX-318). Kept as a union for reference;
 * `AppStateResponse.state` stays a plain string so a server-added state never
 * breaks the read path — the CLI maps unknown states to a generic message.
 *
 * The backend (BEX-382) renamed the initial state `configured` → `draft` (the
 * server migration renames every existing row, so `configured` no longer appears
 * on the wire) and made `draft` the state an app enters at creation; this CLI
 * change (BEX-383) reads the new value.
 */
export type AppState =
  | 'draft'
  | 'submitted'
  | 'in_review'
  | 'approved'
  | 'rejected'
  | 'changes_requested';

export interface AppStateResponse {
  // Optional: the read path tolerates a missing/empty state and normalizes it
  // to an "unknown" sentinel (see src/commands/app/status.ts).
  state?: string;
  // Submittability (BEX-383), meaningful only for public apps — the server
  // computes it from the app's latest snapshot. `submittable` is true exactly
  // when `missing_fields` is empty; `missing_fields` lists the server field keys
  // still required (e.g. `logoLink`, `oauth.scopes`). Both are optional so an
  // older server that omits them is tolerated — `app submit` only gates on an
  // explicit `submittable === false`.
  submittable?: boolean;
  missing_fields?: string[];
  // Human-readable status message the server computes for the current state.
  // Optional so an older server that omits it falls back to the CLI's canned
  // per-state copy (APP_STATUS_MESSAGE); a blank string falls back too.
  message?: string;
}

/**
 * Response shape for POST /v3/app-store/apps, AFTER `createApp` has flattened it.
 *
 * The OAuth fields are optional, and that is the contract, not laziness. Two
 * independent reasons:
 *
 * 1. A UI app sends no `auth` block and gets none back — it has no client ID, no
 *    secret and no callbacks by construction.
 * 2. The platform's nested-contract handler echoes the request's nesting, so they
 *    arrive under `auth` rather than at the top level. `createApp` lifts them (see
 *    `flattenCreateAuth`), tolerating both shapes.
 *
 * They were declared required and flat before, which is exactly why (2) shipped
 * unnoticed: every read site compiled clean while reading `undefined`. Keep them
 * optional so the compiler keeps asking.
 */
export interface CreateAppResponse {
  app_id: string;
  name: string;
  client_id?: string;
  client_secret?: string;
  distribution_type?: 'public' | 'private';
  redirect_uris?: string[];
  scopes?: string[];
  logo_uri?: string;
  version?: string;
  // Same reasoning as `OAuthApp`, and here it is provable rather than incidental:
  // `cliCreatePublicResponse` is a closed struct of
  // {app_id, name, logo_uri, version, distribution_type, auth?, ui_app?} — there is
  // no timestamp on the create response at all.
  created_at?: string;
  updated_at?: string;
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
  // Confirmed live (2026-08-12, production): create and upload both accepted
  // the omission. Always present for OAuth apps. Same block, same semantics
  // on the create request (unified payload structure).
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
  // Each entry's `link_target` is stripped from this echo before the write-back
  // (BEX-290, moved per entry by BEX-426) — the server defaults it to `_blank`
  // and echoes it on every `actionLink` entry, and the CLI deliberately does not
  // author it, so echoing it straight through would silently re-add to
  // app-config.json the one field the file is not supposed to carry.
  ui_app?: UiApp;
}

// ──────────────── CLI update notice (BEX-370) ────────────────

/** Raw v1 body of `GET /cli/info`. Every field is untrusted. */
export interface CliInfoResponse {
  upgrade_message?: string;
  is_blocked?: boolean;
}

/** The validated form of that body. */
export interface CliInfo {
  /** Sanitized display line, or undefined when nothing usable came back. */
  upgradeMessage?: string;
  /**
   * True only when the API explicitly said so. Anything else — absent, a
   * non-boolean, a failed request — is false, so the CLI can only ever be
   * blocked by a deliberate answer, never by a mistake or an outage.
   */
  isBlocked: boolean;
}

/**
 * Query sent to `/cli/info`. Informational only — the CLI has already decided an
 * update is available by the time it asks, so nothing here drives the response.
 */
export interface CliInfoQuery {
  cliVersion: string;
  reason: string;
}
