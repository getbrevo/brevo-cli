import { CLI_VERSION_HEADERS, CLI_VERSION_STATUS } from './constants';
import { CliVersionStatus, VersionSignal } from '../types';

/**
 * Minimal shape of what `parseVersionSignal` reads. `Headers` satisfies it;
 * so does a plain object in a test, without constructing a fetch Response.
 */
export interface HeaderReader {
  get(name: string): string | null | undefined;
}

// Plain semver only, optionally `v`-prefixed, with optional prerelease/build.
// The version is display-only here — the backend owns the verdict — but a
// malformed value would still end up printed, so it is dropped rather than
// shown. The length cap keeps a hostile proxy from feeding a pathological
// string into the regex.
const SEMVER_RE = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const MAX_VERSION_LEN = 64;

const KNOWN_STATUSES = new Set<string>(Object.values(CLI_VERSION_STATUS));

export function parseHeaderVersion(raw: string | null | undefined): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim();
  if (!value || value.length > MAX_VERSION_LEN) return undefined;
  return SEMVER_RE.test(value) ? value : undefined;
}

/**
 * Validate the verdict against the set this build understands.
 *
 * An unrecognised value is treated as absent rather than as a failure. That is
 * what lets the backend introduce a new status later without blocking or
 * confusing clients that predate it — and it means a garbled header can never
 * be read as "unsupported".
 */
export function parseHeaderStatus(raw: string | null | undefined): CliVersionStatus | undefined {
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim().toLowerCase();
  return KNOWN_STATUSES.has(value) ? (value as CliVersionStatus) : undefined;
}

/**
 * Extract the backend's verdict from a response's headers.
 *
 * Never throws: absent or malformed headers yield `undefined`, which callers
 * treat as "keep whatever was already known".
 */
export function parseVersionSignal(headers: HeaderReader | undefined | null): VersionSignal {
  if (!headers || typeof headers.get !== 'function') return {};
  return {
    latestVersion: parseHeaderVersion(headers.get(CLI_VERSION_HEADERS.LATEST)),
    status: parseHeaderStatus(headers.get(CLI_VERSION_HEADERS.STATUS)),
  };
}

export function hasVersionSignal(signal: VersionSignal): boolean {
  return Boolean(signal.latestVersion ?? signal.status);
}

/**
 * Merge a newly observed signal over what is already known.
 *
 * Only present fields overwrite: a response carrying just the status must not
 * erase a version learned a moment earlier.
 */
export function mergeVersionSignal(base: VersionSignal, next: VersionSignal): VersionSignal {
  return {
    latestVersion: next.latestVersion ?? base.latestVersion,
    status: next.status ?? base.status,
  };
}

export function isUnsupported(signal: VersionSignal): boolean {
  return signal.status === CLI_VERSION_STATUS.UNSUPPORTED;
}

export function isOutdated(signal: VersionSignal): boolean {
  return signal.status === CLI_VERSION_STATUS.OUTDATED;
}

/** True when there is something worth telling the user about. */
export function needsNotice(signal: VersionSignal): boolean {
  return isUnsupported(signal) || isOutdated(signal);
}
