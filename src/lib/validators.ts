import { CliError } from './errors';
import { LEGACY_ALL_SCOPE, UI_APP_DESCRIPTION_MAX_LENGTH, UI_APP_SURFACES } from './constants';

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
 * Brevo opens this URL from an authenticated CRM page, so plain http would
 * downgrade the user's session over the wire. https is required, with the same
 * loopback exemption the rest of the CLI grants (see `isLocalHttpAllowed` in
 * lib/constants) so partners can point a UI app at a local dev server while
 * building it.
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
 * Validate a UI-app destination URL. Returns `true` or an error string, so it
 * can back an inquirer `validate` directly as well as the upload-time check.
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

/**
 * Validate a UI-app title. Returns `true` or an error string.
 */
export function validateUiAppTitle(value: string): true | string {
  return value.trim() ? true : 'Title cannot be empty.';
}

/**
 * Validate a UI-app description against the spec's tooltip length cap.
 * Returns `true` or an error string.
 */
export function validateUiAppDescription(value: string): true | string {
  const trimmed = value.trim();
  if (!trimmed) return 'Description cannot be empty.';
  if (trimmed.length > UI_APP_DESCRIPTION_MAX_LENGTH) {
    return `Description must be at most ${UI_APP_DESCRIPTION_MAX_LENGTH} characters (got ${trimmed.length}).`;
  }
  return true;
}

/**
 * Fully validate a `ui_app` block before it is sent to the server.
 *
 * The app-store backend is the validation authority; this is a local pre-flight
 * so a partner gets a precise, offline error instead of an opaque 4xx. Throws
 * CliError on the first problem found.
 *
 * Only the action-link shape (`type: 'link'`, `trigger.type: 'link'`) is
 * accepted: the other union members are typed for round-tripping and future
 * scope, but the CLI must not push a config the platform cannot render yet.
 */
export function validateUiApp(uiApp: unknown): void {
  if (!uiApp || typeof uiApp !== 'object') {
    throw new CliError(
      'app-config.json has an invalid "ui_app" block — expected an object. Fix the file, or recreate the app with `brevo app create --type ui`.',
    );
  }
  const block = uiApp as Record<string, unknown>;

  if (block.type !== 'link') {
    throw new CliError(
      `Unsupported ui_app.type "${String(block.type)}". Only "link" (action link) can be uploaded today — modal cards, widgets, and cloud functions are not available yet.`,
    );
  }

  const props = block.properties;
  if (!props || typeof props !== 'object') {
    throw new CliError('app-config.json is missing "ui_app.properties".');
  }
  const properties = props as Record<string, unknown>;

  if (typeof properties.surface !== 'string' || !UI_APP_SURFACES.includes(properties.surface)) {
    throw new CliError(
      `Invalid ui_app.properties.surface "${String(properties.surface)}". Must be one of: ${UI_APP_SURFACES.join(', ')}.`,
    );
  }

  const titleCheck = validateUiAppTitle(String(properties.title ?? ''));
  if (titleCheck !== true) throw new CliError(`ui_app.properties.title: ${titleCheck}`);

  const descCheck = validateUiAppDescription(String(properties.description ?? ''));
  if (descCheck !== true) throw new CliError(`ui_app.properties.description: ${descCheck}`);

  const contextProperties = properties.contextProperties;
  if (
    !Array.isArray(contextProperties) ||
    contextProperties.length === 0 ||
    contextProperties.some((p) => typeof p !== 'string' || !p.trim())
  ) {
    throw new CliError(
      'ui_app.properties.contextProperties must be a non-empty array of record attribute names (e.g. ["firstname", "email"]).',
    );
  }

  const trig = properties.trigger;
  if (!trig || typeof trig !== 'object') {
    throw new CliError('app-config.json is missing "ui_app.properties.trigger".');
  }
  const trigger = trig as Record<string, unknown>;

  if (trigger.type !== 'link') {
    throw new CliError(
      `Unsupported ui_app.properties.trigger.type "${String(trigger.type)}". Only "link" is available today — the "modal" trigger is not supported yet.`,
    );
  }

  const urlCheck = validateUiAppUrl(String(trigger.externalUrl ?? ''));
  if (urlCheck !== true) {
    throw new CliError(`ui_app.properties.trigger.externalUrl: ${urlCheck}`);
  }

  if (typeof trigger.label !== 'string' || !trigger.label.trim()) {
    throw new CliError(
      'ui_app.properties.trigger.label cannot be empty — it is the text shown in the record action menu.',
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
