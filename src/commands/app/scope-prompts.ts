import inquirer from 'inquirer';
import { CLI } from '../../lib/constants';
import {
  INTENSITY_BOLD,
  INTENSITY_DIM,
  intensity,
  logDebug,
  logInfo,
  logWarn,
} from '../../lib/logger';
import { createSpinner, indentChoices } from '../../lib/ui';
import { containsLegacyAllScope, splitScopes, validateScopes } from '../../lib/validators';
import { messages } from '../../lang/en';
import {
  fetchSupportedScopes,
  groupScopesByCategory,
  ScopeEntry,
} from '../../services/oauth-metadata';
import { isSectionSelection, registerSectionCheckbox } from './section-checkbox';

/**
 * Collecting the scopes for an M2M app — the picker, its fallback, and the one check both
 * answers go through.
 *
 * Separate from `create.ts` so the module that owns `inquirer` and the catalog read is not
 * the 1200-line command; separate from `services/oauth-metadata.ts` so that service stays
 * a prompt-free leaf its non-interactive callers (`app available-scopes --json`, the
 * `--web` page) can import without pulling `inquirer` in.
 */

/**
 * The question name for the multi-select, and the name the free-text fallback does NOT use.
 *
 * They differ on purpose: the two prompts answer the same question with different shapes
 * (an array of catalog names vs a typed string), so a test — and the `answerPrompts`
 * harness, which is keyed by name — can say which path it exercised.
 */
export const SCOPE_PICKER_QUESTION = 'scopes';
export const SCOPE_INPUT_QUESTION = 'scopesRaw';

/** Rows shown at once. The catalog is ~34 selectable scopes; the whole list would scroll off. */
const PAGE_SIZE = 15;

/**
 * Checkbox chrome inquirer 8 renders left of a label, plus the gutter `indentChoices` adds,
 * plus the two columns a scope row is inset from its section row.
 */
const CHOICE_CHROME = 10;

/** Below this, a blurb is more truncation than description — show the bare name instead. */
const MIN_DESCRIPTION_ROOM = 24;

/**
 * Resolve a raw checkbox answer — scope names, section headings, or both — to scope names.
 *
 * Ordered by the catalog and de-duplicated, so picking a section *and* one of its scopes is
 * one grant rather than two, and the resulting list reads in the same order the prompt did
 * regardless of what was clicked first.
 *
 * Headings only reach here on the fallback prompt: the cascading one ticks a section's
 * scopes for real and answers with those, so its values are already names. Both shapes go
 * through this one function so the two prompts cannot resolve to different grants, and so
 * `validate` can run on the raw answer either way — unexpanded, `checkScopeList` would
 * reject a heading as a malformed scope name.
 */
function expandSelection(selected: readonly unknown[], entries: readonly ScopeEntry[]): string[] {
  const names = new Set<string>();
  const sections = new Set<string>();
  for (const value of selected) {
    if (typeof value === 'string') names.add(value);
    else if (isSectionSelection(value)) sections.add(value.section);
  }
  return entries
    .filter((entry) => names.has(entry.name) || sections.has(entry.category))
    .map((entry) => entry.name);
}

/**
 * The one check every M2M scope list passes, whichever prompt (or flag) produced it.
 *
 * Returns inquirer's `true | string` rather than throwing: a prompt that throws aborts the
 * command instead of re-asking. `create.ts` turns the string into a `CliError` on the flag
 * path, where there is nobody to re-ask.
 *
 * The legacy `all` scope is refused here rather than being left to `app upload`, which is
 * where an OAuth app meets that check — an M2M app never reaches an upload, so this is the
 * only chance to catch it. It cannot come from the picker (the catalog publishes `all`
 * under its own `magic_scopes` key, never as a selectable scope), but it can be typed.
 */
export function checkScopeList(scopes: readonly string[]): true | string {
  if (scopes.length === 0) return messages.APP_CREATE_M2M_SCOPES_EMPTY;
  try {
    validateScopes([...scopes]);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  if (containsLegacyAllScope([...scopes])) return messages.LEGACY_ALL_SCOPE_DEPRECATED_BLOCK;
  return true;
}

/**
 * Validate a comma-or-whitespace-separated scope list the way inquirer wants it.
 *
 * Splitting first (commas AND whitespace, de-duplicated) is what makes the flag and the
 * free-text prompt agree with each other, and `checkScopeList` is what makes both agree
 * with the picker.
 */
export function validateM2mScopesInput(input: string): true | string {
  return checkScopeList(splitScopes(input));
}

/**
 * The catalog read, reduced to `null` on failure so the caller can fall back.
 *
 * Deliberately unlike the UI-app placement read, which aborts: a placement the registry
 * does not know is dropped silently by the platform, so guessing one is unsafe, whereas a
 * scope is format-checked locally and typing scope names is already a supported answer
 * (`--scopes` does exactly that). An IdP hiccup must not stop an app being created.
 *
 * An EMPTY catalog is treated the same as an unreadable one — a picker with no choices is
 * a dead end, and the partner may well know the scope names it failed to list.
 */
async function readScopeCatalog(quiet: boolean): Promise<ScopeEntry[] | null> {
  const spinner = createSpinner(messages.APP_CREATE_M2M_SCOPES_PICKER_SPINNER, { silent: quiet });
  try {
    const entries = await fetchSupportedScopes();
    if (entries.length > 0) return entries;
    // Read fine, listed nothing. Same dead end, but say which one happened — telling
    // someone the catalog could not be loaded sends them to check their network.
    if (!quiet) logWarn(messages.APP_SCOPES_EMPTY);
    return null;
  } catch (err) {
    logDebug('scope catalog read failed', { message: (err as Error).message });
    if (!quiet) logWarn(messages.APP_CREATE_M2M_SCOPES_CATALOG_UNAVAILABLE(CLI.APP_SCOPES));
    return null;
  } finally {
    spinner.stop();
  }
}

/**
 * `name  description`, with the descriptions in one column and clipped to the terminal.
 *
 * inquirer neither wraps nor truncates a choice label, so a long blurb on a narrow
 * terminal folds into a second line and the list stops reading as rows. Clipping keeps one
 * scope per line; the full text is a `brevo app available-scopes --web` away.
 */
function scopeChoiceLabel(entry: ScopeEntry, nameWidth: number): string {
  if (!entry.description) return entry.name;
  const columns =
    process.stdout.columns && process.stdout.columns > 0 ? process.stdout.columns : 80;
  const room = columns - nameWidth - CHOICE_CHROME;
  if (room < MIN_DESCRIPTION_ROOM) return entry.name;
  const description =
    entry.description.length > room
      ? `${entry.description.slice(0, room - 1)}…`
      : entry.description;
  return `${entry.name.padEnd(nameWidth)}  ${description}`;
}

/**
 * Category headings from the catalog's own labels, and one choice per scope.
 *
 * `value` is always the bare scope name — the label is presentation and must never be what
 * travels. Headings fall back to the raw category key when the response labels no such
 * category, which is also what `app available-scopes` prints.
 */
function buildScopeChoices(entries: readonly ScopeEntry[]): unknown[] {
  const nameWidth = Math.max(...entries.map((entry) => entry.name.length));
  const choices: unknown[] = [];
  for (const [category, scopes] of groupScopesByCategory(entries)) {
    const label = scopes[0]?.categoryLabel ?? category;
    if (scopes.length > 1) {
      choices.push({
        // Bold label, dim count: a heading carries the same checkbox as everything else, so
        // weight is what separates it from the scopes indented beneath it. Both close on the
        // intensity reset, never a full one — see `intensity`, and note inquirer colours the
        // pointed row around whatever this string contains.
        name: `${intensity(INTENSITY_BOLD, label)} ${intensity(
          INTENSITY_DIM,
          messages.APP_CREATE_M2M_SCOPES_SECTION_ALL(scopes.length),
        )}`,
        value: { section: category },
        section: category,
        // Only the fallback prompt echoes a heading, and only there does it stand for
        // anything: the cascading one ticks the scopes themselves, so they echo on their
        // own and the heading is left out of the answer entirely.
        short: scopes.map((scope) => scope.name).join(', '),
      });
    } else {
      // Nothing to select in bulk: a lone scope's own row already is the whole section, so
      // the heading stays an inert separator rather than a second way to click one thing.
      choices.push(new inquirer.Separator(label));
    }
    for (const scope of scopes) {
      choices.push({
        // Inset from the section row above it, so the hierarchy still reads once the
        // heading is a checkbox like everything else.
        name: `  ${scopeChoiceLabel(scope, nameWidth)}`,
        value: scope.name,
        short: scope.name,
        // Read by the cascade to find a heading's members. inquirer's `Choice` copies every
        // own property, so this survives onto the row it renders.
        section: scope.category,
      });
    }
  }
  return choices;
}

/**
 * Pick M2M scopes from the IdP's live catalog.
 *
 * Resolves to `null` — no prompt shown — when the catalog cannot be read, which is the
 * caller's signal to ask for the names instead. Nothing is pre-selected: an M2M grant has
 * no consent screen to review it, so the partner naming every scope is the least-privilege
 * default (the same reason the free-text prompt is not pre-filled with `DEFAULT_SCOPES`).
 *
 * A category can be taken whole by selecting its heading, which ticks every scope under it
 * so the selection is on screen and any one of them can be unticked again — the heading is
 * a shortcut, not a value (see `section-checkbox.ts`). Either way this resolves to real
 * scope names, so nothing downstream knows sections exist. inquirer's built-in `<a>`
 * (toggle all) keeps working alongside it.
 *
 * `quiet` silences the spinner and both notices, for the same reason `resolveM2mScopes`
 * threads it: under `--json` the output has to stay one parseable document. Like there, it
 * is defensive — no reachable path prompts with `jsonMode` set — and the prompt itself is
 * deliberately NOT suppressed by it, because silently choosing scopes on a partner's
 * behalf is the one thing this flow must never do.
 */
export async function promptScopeSelection(quiet = false): Promise<string[] | null> {
  const entries = await readScopeCatalog(quiet);
  if (entries === null) return null;

  if (!quiet) logInfo(messages.APP_CREATE_M2M_SCOPES_FIXED);
  // A plain `checkbox` if the cascading one could not be registered: a heading then stays a
  // value that `expandSelection` resolves, rather than one that ticks its scopes on screen.
  const promptType = registerSectionCheckbox() ?? 'checkbox';
  const answer = await inquirer.prompt([
    {
      type: promptType,
      name: SCOPE_PICKER_QUESTION,
      message: messages.APP_CREATE_M2M_SCOPES_PICKER_PROMPT,
      choices: indentChoices(buildScopeChoices(entries)),
      pageSize: PAGE_SIZE,
      loop: false,
      validate: (selected: unknown) =>
        checkScopeList(expandSelection(Array.isArray(selected) ? selected : [], entries)),
    },
  ]);

  const picked = answer[SCOPE_PICKER_QUESTION];
  return expandSelection(Array.isArray(picked) ? picked : [], entries);
}
