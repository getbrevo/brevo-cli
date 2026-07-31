import { CliError } from './errors';
import {
  LEGACY_ALL_SCOPE,
  EXTENSION_POINTS,
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
export function containsLegacyAllScope(scopes: string[] | undefined): boolean {
  return scopes?.includes(LEGACY_ALL_SCOPE) ?? false;
}

// ──────────────── UI apps (BEX-290) ────────────────

/**
 * Whether an HTTP(S) URL is safe as a UI-app destination.
 *
 * The extensibility UI kit drops any non-http(s) `redirectLink` outright
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

/** Validate a UI-app heading. Returns `true` or an error string. */
export function validateUiAppHeading(value: string): true | string {
  return value.trim() ? true : 'Heading cannot be empty.';
}

/**
 * Validate a `surfacePointList` entry against the known registry.
 *
 * This is the highest-value local check in the UI-app flow. The backend silently
 * DROPS an authored value with no registry entry, and the UI kit matches by exact
 * string equality — so a near-miss like `contact.headerMenu.action` or
 * `contactDetails.headerMenu.widget` produces an empty slot, a 200, and no error
 * anywhere. Catching it here is the only place a partner gets told.
 */
export function validateSurfacePoint(point: string): true | string {
  const trimmed = String(point ?? '').trim();
  if (!trimmed) return 'Extension point cannot be empty.';
  if (EXTENSION_POINTS.includes(trimmed)) return true;
  return `Unknown extension point "${trimmed}". Must be one of: ${EXTENSION_POINTS.join(', ')}.`;
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
 * Validate a `context` list: field names must be non-empty and unique. Returns `true` or
 * an error string, so it can back an inquirer `validate` directly.
 *
 * Whether the platform actually ALLOWS a given name is not checkable locally — the
 * allow-list lives on the extension-point registry row — so that check happens
 * server-side at upload, where the 400 enumerates the allowed set.
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

/** Parse a comma-separated context answer into trimmed field names. */
export function parseUiAppContext(value: string): string[] {
  return String(value ?? '')
    .split(',')
    .map((field) => field.trim())
    .filter((field) => field.length > 0);
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
  const extensionType = String(block.extensionType ?? '');

  if (!AUTHORABLE_EXTENSION_TYPES.includes(extensionType)) {
    throw new CliError(
      `Unsupported ui_app.extensionType "${extensionType}". Must be one of: ${AUTHORABLE_EXTENSION_TYPES.join(', ')}.`,
    );
  }

  validateSurfacePointList(block.surfacePointList);

  const headingCheck = validateUiAppHeading(String(block.heading ?? ''));
  if (headingCheck !== true) throw new CliError(`ui_app.heading: ${headingCheck}`);

  if (extensionType === EXTENSION_TYPE_IFRAME) {
    validateIframeExtensionFields(block);
  } else {
    validateActionLinkFields(block);
  }

  if (block.context !== undefined) {
    if (!Array.isArray(block.context)) {
      throw new CliError('ui_app.context must be an array of field names, e.g. ["contactId"].');
    }
    const contextCheck = validateUiAppContext(block.context.map((field) => String(field)));
    if (contextCheck !== true) throw new CliError(`ui_app.context: ${contextCheck}`);
  }
}

/**
 * Validate the slot list. Both extension types render on both kinds — a widget slot gets
 * a card, an action slot a menu entry — so the only rules are that the list is non-empty,
 * every name is registered, and no name repeats.
 */
function validateSurfacePointList(points: unknown): void {
  if (!Array.isArray(points) || points.length === 0) {
    throw new CliError(
      'ui_app.surfacePointList must list at least one extension point (e.g. ["contactDetails.headerMenu.action"]). An empty list makes the platform fall back to its default widget slots, which is unlikely to be where you want the app.',
    );
  }
  for (const point of points) {
    const check = validateSurfacePoint(String(point));
    if (check !== true) throw new CliError(`ui_app.surfacePointList: ${check}`);
  }
  if (new Set(points.map((p) => String(p).trim())).size !== points.length) {
    throw new CliError('ui_app.surfacePointList contains duplicate extension points.');
  }
}

function validateActionLinkFields(block: Record<string, unknown>): void {
  const urlCheck = validateUiAppUrl(String(block.redirectLink ?? ''));
  if (urlCheck !== true) throw new CliError(`ui_app.redirectLink: ${urlCheck}`);

  // _self is refused server-side for now, so accepting it here would only move the
  // failure to upload time. See UPLOADABLE_LINK_TARGETS.
  if (
    block.linkTarget !== undefined &&
    !UPLOADABLE_LINK_TARGETS.includes(String(block.linkTarget))
  ) {
    throw new CliError(
      `Invalid ui_app.linkTarget "${String(block.linkTarget)}". Must be one of: ${UPLOADABLE_LINK_TARGETS.join(', ')}.`,
    );
  }

  // The UI kit keeps `modalIframeUrl` only for an `iframeExtension` item, so one
  // carried by an actionLink is dropped without a word. Reject rather than let a
  // partner ship a URL that will never open.
  if (block.modalIframeUrl !== undefined && String(block.modalIframeUrl).trim()) {
    throw new CliError(
      `ui_app.modalIframeUrl is only used by "${EXTENSION_TYPE_IFRAME}" extensions and is ignored for "${EXTENSION_TYPE_ACTION_LINK}". Remove it, or use redirectLink instead.`,
    );
  }
}

function validateIframeExtensionFields(block: Record<string, unknown>): void {
  const urlCheck = validateUiAppUrl(String(block.modalIframeUrl ?? ''));
  if (urlCheck !== true) throw new CliError(`ui_app.modalIframeUrl: ${urlCheck}`);

  // Refused because the two delivery paths disagree about which URL wins: the
  // widget-card path pairs strictly by extensionType and opens the modal, while the
  // header-menu path routes on redirectLink first and never opens it. The same app would
  // behave differently depending on the slot it rendered on.
  if (block.redirectLink !== undefined && String(block.redirectLink).trim()) {
    throw new CliError(
      `ui_app.redirectLink cannot be combined with "${EXTENSION_TYPE_IFRAME}": a menu entry would follow the redirect instead of opening the modal, while a card would open the modal. Remove it, or use "${EXTENSION_TYPE_ACTION_LINK}" instead.`,
    );
  }

  // linkTarget only governs where a redirectLink opens; a modal embeds its URL.
  if (block.linkTarget !== undefined && String(block.linkTarget).trim()) {
    throw new CliError(
      `ui_app.linkTarget has no effect on "${EXTENSION_TYPE_IFRAME}" extensions, which embed their URL in a modal rather than navigating to it. Remove it.`,
    );
  }
}

/**
 * Parse and validate an `<account-id>` argument for `app deploy` / `app remove`.
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
