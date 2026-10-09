import { OAUTH_SCOPES_URL } from '../lib/constants';
import { ApiError, CliError, ErrorCode } from '../lib/errors';
import { messages } from '../lang/en';

export interface ScopeEntry {
  name: string;
  category: string;
  apiEndpoints: string[];
  /**
   * The IdP's own English label and blurb for this scope, when it publishes them.
   *
   * Optional because they are presentation, not identity: every consumer must still work
   * from `name` alone, which is the only field the catalog guarantees and the only one
   * that goes on the wire. The scope picker shows the blurb beside the name; the
   * `available-scopes` text list deliberately does not, so its output stays what it was.
   */
  displayName?: string;
  description?: string;
  /**
   * The English label for `category`, from the response's own top-level `categories` list.
   *
   * Deliberately sourced from the API rather than a local key→label map: a CLI-owned
   * prettify table can only lag the catalog, exactly as `app-types/ui/authoring.ts` says
   * about placement labels. Absent when the response lists no matching category.
   */
  categoryLabel?: string;
}

interface RawScope {
  name?: unknown;
  category?: unknown;
  api_endpoints?: unknown;
  is_oidc_reserved?: unknown;
  display_name?: unknown;
  description?: unknown;
}

/**
 * Pull the English string out of one of the catalog's localized maps.
 *
 * Every label in the response is a `{ de, en, es, fr, it, pt }` object. The CLI is
 * English-only (`src/lang/en.ts` is the single string source), so this reads `en` and
 * gives up rather than falling back to another language — a French blurb in an otherwise
 * English prompt reads as a bug, and a missing one is merely a shorter row.
 */
function englishText(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const en = (value as { en?: unknown }).en;
  return typeof en === 'string' && en.length > 0 ? en : undefined;
}

/** `categories: [{ key, display_name }]` → `key → English label`, skipping malformed rows. */
function readCategoryLabels(body: unknown): Map<string, string> {
  const labels = new Map<string, string>();
  const raw = (body as { categories?: unknown }).categories;
  if (!Array.isArray(raw)) return labels;
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const key = (row as { key?: unknown }).key;
    const label = englishText((row as { display_name?: unknown }).display_name);
    if (typeof key === 'string' && label) labels.set(key, label);
  }
  return labels;
}

/**
 * Group scopes under their category, in the order the catalog first mentions each one.
 *
 * Shared so the terminal list and the scope picker can never disagree about the grouping
 * (the `--web` page does its own, in browser JS, which is unavoidable). Insertion order is
 * the IdP's ordering — the CLI does not re-sort, for the same reason it does not relabel.
 */
export function groupScopesByCategory(entries: readonly ScopeEntry[]): Map<string, ScopeEntry[]> {
  const byCategory = new Map<string, ScopeEntry[]>();
  for (const entry of entries) {
    const list = byCategory.get(entry.category);
    if (list) {
      list.push(entry);
    } else {
      byCategory.set(entry.category, [entry]);
    }
  }
  return byCategory;
}

export async function fetchSupportedScopes(): Promise<ScopeEntry[]> {
  let response: Response;
  try {
    response = await fetch(OAUTH_SCOPES_URL, { method: 'GET' });
  } catch {
    throw new ApiError(
      messages.OAUTH_METADATA_FETCH_FAILED(OAUTH_SCOPES_URL, 0),
      0,
      ErrorCode.NETWORK_ERROR,
    );
  }

  if (!response.ok) {
    throw new ApiError(
      messages.OAUTH_METADATA_FETCH_FAILED(OAUTH_SCOPES_URL, response.status),
      response.status,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new CliError(messages.OAUTH_METADATA_MISSING_SCOPES);
  }

  if (!body || typeof body !== 'object' || !Array.isArray((body as { scopes?: unknown }).scopes)) {
    throw new CliError(messages.OAUTH_METADATA_MISSING_SCOPES);
  }

  const rawScopes = (body as { scopes: unknown[] }).scopes as RawScope[];
  const categoryLabels = readCategoryLabels(body);

  return rawScopes
    .filter(
      (
        s,
      ): s is {
        name: string;
        category: string;
        api_endpoints?: unknown;
        is_oidc_reserved?: unknown;
        display_name?: unknown;
        description?: unknown;
      } =>
        !!s &&
        typeof s === 'object' &&
        typeof s.name === 'string' &&
        typeof s.category === 'string' &&
        s.is_oidc_reserved !== true,
    )
    .map((s) => ({
      name: s.name,
      category: s.category,
      apiEndpoints: Array.isArray(s.api_endpoints)
        ? s.api_endpoints.filter((e): e is string => typeof e === 'string')
        : [],
      ...pickOptional('displayName', englishText(s.display_name)),
      ...pickOptional('description', englishText(s.description)),
      ...pickOptional('categoryLabel', categoryLabels.get(s.category)),
    }));
}

/** Keep an absent label absent rather than present-and-`undefined`, so `toEqual` stays honest. */
function pickOptional<K extends string>(
  key: K,
  value: string | undefined,
): Record<K, string> | Record<string, never> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, string>);
}
