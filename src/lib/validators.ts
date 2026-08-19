import { CliError } from './errors';
import {
  LEGACY_ALL_SCOPE,
  EXTENSION_TYPE_ACTION_LINK,
  EXTENSION_TYPE_IFRAME,
  UPLOADABLE_LINK_TARGETS,
} from './constants';

const APP_NAME_MAX_LENGTH = 48;
const APP_NAME_REGEX = /^[a-zA-Z0-9 ._\-\u00C0-\u024F]+$/;

/**
 * Validate an app name: alphanumeric, spaces, hyphens, dots, underscores,
 * and accented/extended Latin characters only. Max 48 characters.
 * Returns true if valid, or an error string for inquirer prompts.
 */
export function validateAppName(name: string): true | string {
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'App name cannot be empty.';
  if (trimmed.length > APP_NAME_MAX_LENGTH) {
    return `App name must be at most ${APP_NAME_MAX_LENGTH} characters (got ${trimmed.length}).`;
  }
  if (!APP_NAME_REGEX.test(trimmed)) {
    return 'App name can only contain letters, numbers, spaces, hyphens, dots, underscores, and accented characters.';
  }
  return true;
}

/**
 * Validate a free-text y/n answer, empty meaning "take the default".
 *
 * Shared rather than local to one command because two commands ask this shape of
 * question in two files (`app create`'s "add another redirect URL?" and the
 * scaffold-a-feature confirm both `app create` and `app scaffold` use), and they
 * must accept exactly the same spellings.
 */
export function validateYesNo(input: string): true | string {
  const val = String(input).toLowerCase().trim();
  if (val === 'y' || val === 'yes' || val === 'n' || val === 'no' || val === '') {
    return true;
  }
  return 'Please enter y or n';
}

/**
 * Validate that a value is one of the allowed options.
 * Throws CliError with a user-friendly message if invalid.
 */
export function validateEnum(
  value: string | undefined,
  allowed: readonly string[],
  flagName: string,
): void {
  if (value && !allowed.includes(value)) {
    throw new CliError(`Invalid ${flagName} "${value}". Must be one of: ${allowed.join(', ')}.`);
  }
}

/**
 * Validate that a string is a valid HTTP/HTTPS URL.
 * Throws CliError if the format is invalid.
 */
export function validateUrl(value: string | undefined, fieldName: string): void {
  if (!value) return;
  // Reject whitespace and commas early — Node's URL parser silently percent-encodes
  // spaces, so "http://a/cb, http://b/cb" parses as a single valid URL. That has let
  // comma-separated values sneak into redirect_uris as one corrupted entry.
  if (/[\s,]/.test(value)) {
    throw new CliError(
      `Invalid ${fieldName}: "${value}" contains whitespace or a comma. Pass each URL with a separate --redirect-uri flag.`,
    );
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('bad protocol');
    }
  } catch {
    throw new CliError(`Invalid ${fieldName}: "${value}" is not a valid HTTP/HTTPS URL.`);
  }
}

/**
 * Commander.js collect function for repeatable --redirect-uri flags.
 * Validates each URL and accumulates into an array.
 */
export function collectUrls(value: string, previous: string[] = []): string[] {
  validateUrl(value, 'redirect URL');
  return [...previous, value];
}

// OAuth scope tokens are split on commas and whitespace at every boundary
// (app-config.json reads and --scope flag values) so a user can write either
// "crm:read crm:write" or "crm:read, crm:write" or one --scope per token and
// the CLI behaves the same. RFC 6749 §3.3 already mandates space-separation in
// authorization requests, so the split is consistent with the protocol; the
// comma is a convenience for users editing JSON arrays.
const SCOPE_TOKEN_REGEX = /^[A-Za-z0-9][A-Za-z0-9:_.-]*$/;
const SCOPE_SPLIT_REGEX = /[\s,]+/;

/**
 * Split a scope string or array of strings into individual scope tokens.
 * Handles embedded commas/whitespace, trims, drops empties, dedupes.
 * Does NOT validate token format — use `validateScopes` for that.
 */
export function splitScopes(input: string | string[] | undefined | null): string[] {
  if (input == null) return [];
  const values = Array.isArray(input) ? input : [input];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    if (typeof v !== 'string') continue;
    for (const token of v.split(SCOPE_SPLIT_REGEX)) {
      if (!token) continue;
      if (seen.has(token)) continue;
      seen.add(token);
      out.push(token);
    }
  }
  return out;
}

/**
 * Validate that each scope is a well-formed token.
 * Throws CliError with a user-facing message if any scope is invalid.
 */
export function validateScopes(scopes: string[]): void {
  for (const scope of scopes) {
    if (!SCOPE_TOKEN_REGEX.test(scope)) {
      throw new CliError(
        `Invalid scope: "${scope}" — scopes can only contain letters, numbers, ':', '_', '.', '-'.`,
      );
    }
  }
}

/**
 * Commander.js collect function for repeatable --scope flags.
 * Splits each value on commas/whitespace, validates the resulting tokens,
 * and accumulates into an array (deduplicated against previous values).
 */
export function collectScopes(value: string, previous: string[] = []): string[] {
  const tokens = splitScopes(value);
  if (tokens.length === 0) {
    throw new CliError('Invalid scope: value cannot be empty.');
  }
  validateScopes(tokens);
  const out = [...previous];
  for (const t of tokens) {
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

/**
 * Returns true iff the scope list contains the deprecated legacy 'all' scope.
 * Every code path that warns or blocks on the legacy scope calls this helper —
 * no scattered string literals (BEX-214).
 */
// Accepts null as well as undefined: the app-store read path returns `scopes: null`
// for an app with no OAuth block, and both mean "no scopes" here.
export function containsLegacyAllScope(scopes: string[] | null | undefined): boolean {
  return scopes?.includes(LEGACY_ALL_SCOPE) ?? false;
}

// ──────────────── UI apps (BEX-290) ────────────────

/**
 * Whether an HTTP(S) URL is safe as a UI-app destination.
 *
 * The extensibility UI kit drops any non-http(s) `redirect_link` outright
 * (`isHttpUrl` in its shared utils), so anything else would be authored and then
 * silently ignored. On top of that, Brevo opens this URL from an authenticated
 * CRM page, so plain http would downgrade the session — https is required, with
 * the loopback exemption the rest of the CLI grants so partners can point at a
 * local dev server while building.
 */
function isSafeUiAppUrl(parsed: URL): boolean {
  if (parsed.protocol === 'https:') return true;
  return (
    parsed.protocol === 'http:' &&
    (parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '::1')
  );
}

/**
 * Validate a UI-app destination URL. Returns `true` or an error string, so it can
 * back an inquirer `validate` directly as well as the upload-time check.
 */
export function validateUiAppUrl(value: string): true | string {
  const trimmed = value.trim();
  if (!trimmed) return 'URL cannot be empty.';
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return `Invalid URL: "${trimmed}" is not a valid URL.`;
  }
  if (!isSafeUiAppUrl(parsed)) {
    return `Invalid URL: "${trimmed}" must use https:// (http:// is allowed only for localhost).`;
  }
  return true;
}

// Length ceilings for the two authored text fields. Both are enforced server-side, so
// without a local check the partner gets an opaque 400 from the upload endpoint — exactly
// the failure mode this pre-flight exists to prevent. `label` shares the app-name ceiling
// because it occupies the same one-line menu row.
const UI_APP_LABEL_MAX_LENGTH = 48;
const UI_APP_MORE_INFO_MAX_LENGTH = 255;

/**
 * Validate a UI-app `label` — the menu entry's text on an `.action` slot, the card's CTA
 * button text on a `.widget` slot. Returns `true` or an error string, so it can back an
 * inquirer `validate` directly.
 */
export function validateUiAppLabel(value: string): true | string {
  const trimmed = value.trim();
  if (!trimmed) return 'Label cannot be empty.';
  if (trimmed.length > UI_APP_LABEL_MAX_LENGTH) {
    return `Label must be at most ${UI_APP_LABEL_MAX_LENGTH} characters (got ${trimmed.length}).`;
  }
  return true;
}

/**
 * Validate a UI-app `more_info` — the menu entry's `subText`, the card's description.
 * Optional, so blank passes; only the length ceiling is enforced.
 */
export function validateUiAppMoreInfo(value: string): true | string {
  const trimmed = value.trim();
  if (trimmed.length > UI_APP_MORE_INFO_MAX_LENGTH) {
    return `More info must be at most ${UI_APP_MORE_INFO_MAX_LENGTH} characters (got ${trimmed.length}).`;
  }
  return true;
}

/**
 * Validate the SHAPE of a `surface_point_list` entry's slot name — present and
 * non-blank. Whether the name is registered is deliberately NOT checked here.
 *
 * The registry is the platform's, and only the platform can answer against it
 * without lagging. `app upload` sends the block and the upload endpoint checks
 * every name against `extension_points` in one read, answering 400 with the
 * offending names (`checkExtensionPoints`, BEX-361). `app create` cannot author
 * an unregistered name in the first place: every entry it writes is built from a
 * row the registry just returned.
 *
 * The failure this guards against is still real — the platform DROPS an
 * unregistered name, so a near-miss renders nothing with a 200 — but a local
 * allow-list was the wrong place to catch it. It could only ever be a stale
 * copy, and it failed in both directions: rejecting a slot the platform had added,
 * and passing one the platform had removed.
 *
 * Note the value is the registry's `surface_point_name` slug
 * (`contact-details-header-menu`), not the dotted grammar name — see
 * `SurfacePointEntry.surface_point_name`. Shape-only means the two are indistinguishable
 * here; only the registry can tell them apart, which is another reason not to try.
 */
export function validateSurfacePoint(point: string): true | string {
  const trimmed = String(point ?? '').trim();
  if (!trimmed) return 'Surface point cannot be empty.';
  return true;
}

/**
 * The extension types the CLI can author. `legacyComponent` is absent by design: it is
 * the pre-extensibility interpreter path, driven by the UI kit's own config registry
 * rather than by a snapshot, and never partner-authored.
 *
 * The pre-BEX-350 snake_case spellings are absent too — the CLI only ever writes
 * canonical camelCase, even though the server still accepts the old spellings inbound.
 */
const AUTHORABLE_EXTENSION_TYPES: readonly string[] = [
  EXTENSION_TYPE_ACTION_LINK,
  EXTENSION_TYPE_IFRAME,
] as const;

/**
 * Validate one placement's `context` list: field names must be non-empty and unique.
 *
 * Shape only. Whether the platform actually ALLOWS a given name is not checkable locally —
 * the allow-list lives on that extension-point registry row — so it is checked server-side
 * at upload, where the 400 enumerates the allowed set. `brevo app create` never produces a
 * disallowed name anyway: it seeds each entry from the row's own `default_context_field`,
 * which the registry keeps inside the row's allow-list.
 */
export function validateUiAppContext(fields: readonly string[]): true | string {
  const seen = new Set<string>();
  for (const field of fields) {
    const trimmed = String(field ?? '').trim();
    if (!trimmed) return 'Context field names cannot be empty.';
    if (seen.has(trimmed)) return `Duplicate context field "${trimmed}".`;
    seen.add(trimmed);
  }
  return true;
}

/**
 * `String()` for a field read out of a hand-edited `app-config.json`, type-narrowed first.
 *
 * Every field of `ui_app` arrives as `unknown`, and a bare `String(value)` on an object or
 * array yields Object's default stringification — `'[object Object]'`. That is a non-blank
 * string, so it sails through the "cannot be empty" checks below and lets an object reach
 * the wire under a field the server expects to be text. Anything that is not a primitive is
 * therefore treated as absent, so the field's own message fires instead.
 *
 * Narrowed by listing what IS accepted rather than excluding objects, because TypeScript
 * does not subtract from `unknown`: after `if (typeof value === 'object') return ''` the
 * else-branch is still `unknown`, so `String(value)` there is the very call this exists to
 * avoid. A JSON document holds no symbols or functions, so nothing reachable is lost.
 */
function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return '';
}

/**
 * Is a field that must be ABSENT actually present?
 *
 * Distinct from `asText(value).trim() !== ''` on purpose: these are the "cannot be combined
 * with" checks, where a non-string value is still something the partner wrote and still
 * travels to the wire, so it must be reported rather than read as an empty string and
 * waved through. Only a genuinely blank string counts as absent.
 */
function isPresentField(value: unknown): boolean {
  if (value === undefined) return false;
  return typeof value !== 'string' || value.trim() !== '';
}

/**
 * Fully validate a `ui_app` block before it is sent to the server.
 *
 * The block is the app snapshot the platform stores, verbatim.
 * Every field below is optional on the wire — the backend degrades a malformed or
 * absent snapshot to "not yet migrated" rather than erroring — which means the
 * serving path will NOT tell a partner their extension is unrenderable. This
 * pre-flight is therefore deliberately stricter than the wire: it requires the fields
 * each type actually needs to render, and rejects combinations the consumers silently
 * discard.
 *
 * Throws CliError on the first problem found.
 */
export function validateUiApp(uiApp: unknown): void {
  if (!uiApp || typeof uiApp !== 'object') {
    throw new CliError(
      'app-config.json has an invalid "ui_app" block — expected an object. Fix the file, or recreate the app with `brevo app create` and choose "UI app".',
    );
  }
  const block = uiApp as Record<string, unknown>;
  const extensionType = asText(block.extension_type);

  if (!AUTHORABLE_EXTENSION_TYPES.includes(extensionType)) {
    throw new CliError(
      `Unsupported ui_app.extension_type "${extensionType}". Must be one of: ${AUTHORABLE_EXTENSION_TYPES.join(', ')}.`,
    );
  }

  rejectPreBex290Fields(block);

  validateSurfacePointList(block.surface_point_list);

  const labelCheck = validateUiAppLabel(asText(block.label));
  if (labelCheck !== true) throw new CliError(`ui_app.label: ${labelCheck}`);

  const moreInfoCheck = validateUiAppMoreInfo(asText(block.more_info));
  if (moreInfoCheck !== true) throw new CliError(`ui_app.more_info: ${moreInfoCheck}`);

  if (extensionType === EXTENSION_TYPE_IFRAME) {
    validateIframeExtensionFields(block);
  } else {
    validateActionLinkFields(block);
  }
}

/**
 * Refuse the pre-BEX-290 field names with a migration hint rather than a mystery.
 *
 * These are a local diagnostic and claim nothing about how the upload endpoint treats an
 * unmigrated block. They earn their place on the message alone: `label`, `more_info` and a
 * per-placement `context` are the only names any consumer reads, so a config written by an
 * earlier build of this branch is wrong whatever the server does with it, and the generic
 * "label cannot be empty" the checks below pre-empt points at the wrong thing — the label
 * IS there, under its old name.
 *
 * No read-path alias, deliberately, for the same reason the snake_case rename didn't get
 * one: UI apps aren't live, so there is no partner config in the wild to migrate. These
 * files only exist on developer machines, and a two-line rename is cheaper to explain than
 * an alias map that has to be removed later.
 */
function rejectPreBex290Fields(block: Record<string, unknown>): void {
  if (block.heading !== undefined) {
    throw new CliError(
      "ui_app.heading was renamed to ui_app.label (it is the menu entry's text and the card's CTA). Rename the field in app-config.json.",
    );
  }
  if (block.subheading !== undefined) {
    throw new CliError(
      "ui_app.subheading was renamed to ui_app.more_info (it is the menu entry's second line and the card's description). Rename the field in app-config.json.",
    );
  }
  if (block.context !== undefined) {
    throw new CliError(
      'ui_app.context is no longer a top-level field — record context is now per placement. Move each field list into the matching `surface_point_list` entry, e.g. [{ "surface_point_name": "contact-details-header-menu", "context": ["recordId"] }].',
    );
  }
}

/**
 * Validate the slot list. Both extension types render on both kinds — a widget slot gets
 * a card, an action slot a menu entry — so the rules are that the list is non-empty, every
 * entry is an object naming a slot, no slot repeats, and each entry's `context` (when
 * present) is a well-formed list of field names.
 *
 * Shape only: whether a name is registered, and whether its context is within that slot's
 * allow-list, are both the upload endpoint's answer to give (see `validateSurfacePoint`).
 */
function validateSurfacePointList(entries: unknown): void {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new CliError(
      'ui_app.surface_point_list must list at least one placement (e.g. [{ "surface_point_name": "contact-details-header-menu", "context": ["recordId"] }]). An empty list makes the platform fall back to its default widget slots, which is unlikely to be where you want the app.',
    );
  }
  const names: string[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new CliError(
        'ui_app.surface_point_list entries must be objects, e.g. { "surface_point_name": "contact-details-header-menu", "context": ["recordId"] }. A bare string is the pre-BEX-290 shape.',
      );
    }
    const row = entry as Record<string, unknown>;
    const check = validateSurfacePoint(asText(row.surface_point_name));
    if (check !== true) throw new CliError(`ui_app.surface_point_list: ${check}`);
    const name = asText(row.surface_point_name).trim();
    names.push(name);

    if (row.context !== undefined) {
      if (!Array.isArray(row.context)) {
        throw new CliError(
          `ui_app.surface_point_list["${name}"].context must be an array of field names, e.g. ["recordId"].`,
        );
      }
      const contextCheck = validateUiAppContext(row.context.map(asText));
      if (contextCheck !== true) {
        throw new CliError(`ui_app.surface_point_list["${name}"].context: ${contextCheck}`);
      }
    }
  }
  if (new Set(names).size !== names.length) {
    throw new CliError('ui_app.surface_point_list contains duplicate extension points.');
  }
}

function validateActionLinkFields(block: Record<string, unknown>): void {
  const urlCheck = validateUiAppUrl(asText(block.redirect_link));
  if (urlCheck !== true) throw new CliError(`ui_app.redirect_link: ${urlCheck}`);

  // _self is refused server-side for now, so accepting it here would only move the
  // failure to upload time. See UPLOADABLE_LINK_TARGETS.
  if (
    block.link_target !== undefined &&
    !UPLOADABLE_LINK_TARGETS.includes(asText(block.link_target))
  ) {
    throw new CliError(
      `Invalid ui_app.link_target "${asText(block.link_target)}". Must be one of: ${UPLOADABLE_LINK_TARGETS.join(', ')}.`,
    );
  }

  // The UI kit keeps `modal_iframe_url` only for an `iframeExtension` item, so one
  // carried by an actionLink is dropped without a word. Reject rather than let a
  // partner ship a URL that will never open.
  if (isPresentField(block.modal_iframe_url)) {
    throw new CliError(
      `ui_app.modal_iframe_url is only used by "${EXTENSION_TYPE_IFRAME}" extensions and is ignored for "${EXTENSION_TYPE_ACTION_LINK}". Remove it, or use redirect_link instead.`,
    );
  }
}

function validateIframeExtensionFields(block: Record<string, unknown>): void {
  const urlCheck = validateUiAppUrl(asText(block.modal_iframe_url));
  if (urlCheck !== true) throw new CliError(`ui_app.modal_iframe_url: ${urlCheck}`);

  // Refused because the two delivery paths disagree about which URL wins: the
  // widget-card path pairs strictly by extension_type and opens the modal, while the
  // header-menu path routes on redirect_link first and never opens it. The same app would
  // behave differently depending on the slot it rendered on.
  if (isPresentField(block.redirect_link)) {
    throw new CliError(
      `ui_app.redirect_link cannot be combined with "${EXTENSION_TYPE_IFRAME}": a menu entry would follow the redirect instead of opening the modal, while a card would open the modal. Remove it, or use "${EXTENSION_TYPE_ACTION_LINK}" instead.`,
    );
  }

  // link_target only governs where a redirect_link opens; a modal embeds its URL.
  if (isPresentField(block.link_target)) {
    throw new CliError(
      `ui_app.link_target has no effect on "${EXTENSION_TYPE_IFRAME}" extensions, which embed their URL in a modal rather than navigating to it. Remove it.`,
    );
  }
}

/**
 * Parse and validate an explicit `[account-id]` argument for `app deploy` /
 * `app rollback`. Only reached when the positional was actually given — an omitted
 * one is resolved from the authenticated account instead, never routed through here.
 * Brevo account IDs are numeric; accept a trimmed digit string.
 */
export function parseAccountId(value: string): string {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    throw new CliError('Invalid account ID: value cannot be empty.');
  }
  if (!/^\d+$/.test(trimmed)) {
    throw new CliError(`Invalid account ID: "${trimmed}" is not a numeric Brevo account ID.`);
  }
  return trimmed;
}

/**
 * Validate that a value is a positive integer.
 * Throws CliError if the value is not a valid positive integer.
 */
export function parsePositiveInt(value: string, flagName: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new CliError(`Invalid ${flagName}: "${value}" is not a positive integer.`);
  }
  return n;
}

/**
 * Parse and validate a `--app-id` flag value.
 * Accepts any non-empty trimmed string (numeric or UUID).
 */
export function parseAppId(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new CliError('Invalid --app-id: value cannot be empty.');
  }
  return trimmed;
}
