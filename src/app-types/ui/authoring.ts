/**
 * UI-app authoring for `brevo app create` (BEX-290).
 *
 * Extracted from `create.ts` as-is: this module owns everything between the app-type
 * answer being `ui` and the created-app box being printed — the extension-point registry
 * reads, the placement prompts, the `surface_point_list` entries built from the rows that
 * came back, and the UI-app summary box. `create.ts` keeps the shared create flow (name,
 * distribution, directory, the POST and its retry) and calls into the two exports below.
 *
 * Only `resolveUiApp` and `renderCreatedUiApp` are public. Everything else is an
 * implementation detail of the prompt flow and is deliberately not exported — the
 * registry-shaped helpers in particular (`toUsableRows`, `rowSupportsExtensionType`) are
 * only correct in the order this flow calls them.
 */
import inquirer from 'inquirer';
import { EXTENSION_TYPE_ACTION_LINK } from '../../lib/constants';
import { messages } from '../../lang/en';
import { CliError } from '../../lib/errors';
import {
  validateUiApp,
  validateUiAppLabel,
  validateUiAppMoreInfo,
  validateUiAppUrl,
} from '../../lib/validators';
import { printBox, createSpinner, indentChoices } from '../../lib/ui';
import { appService } from '../../container';
import { CreateAppResponse, SurfacePointEntry, SurfacePointRow, UiApp } from '../../types';
import { formatPlacementLines } from './fields';

// UI-app configuration (BEX-290) — this is step 4b of the `app create` flow, replacing the
//     redirect-URL step for UI apps. Prompt order, and why:
//
//       1. integration type → sets `extension_type`. Asked FIRST because it is the
//                             decision a partner arrives with, because it decides which
//                             single URL question is asked at the end, and because both
//                             registry reads narrow by it (`?extension_type=`, BEX-422) —
//                             only pages and slots enabled for the chosen type are offered.
//       2. record page      → single-select of the registry's own location list.
//       3. placement        → single-select of real registry rows on that page.
//       4. label            → menu entry text / card CTA, for THAT placement.
//       5. more_info        → optional supporting line, for THAT placement.
//       6. redirect link    → the destination, for THAT placement.
//
//     Five questions, one optional, and two registry reads that ask for different things:
//     `surface-points/locations` for the pages, then `surface-points?location=<csv>` for
//     the placements on the page that was picked. The pages are never derived from a full
//     row read — the registry answers that question directly.
//
//     ONE page, ONE placement (BEX-426). The CTA fields — label, more_info and the
//     destination URL — live on each `surface_point_list` entry now, so authoring N
//     placements interactively would mean re-asking three questions per placement.
//     The flow instead authors exactly one complete entry and the created-app box points
//     at `app-config.json` for more: additional placements are added by hand as further
//     `surface_point_list` entries (each with its own label/URL) and pushed with
//     `brevo app upload`, whose endpoint validates every entry against the registry.
//     The old page multi-select (and the per-page prompt loop it fanned into) went with
//     this change; so did the dropped-pages warning, which existed only because several
//     picked pages could each turn out to offer nothing for the chosen type.
//
//     The old kind-then-place pair is also gone: kind is a property of a slot, not a
//     question — a partner picking "Header menu" has already said they want a menu entry
//     — and asking it up front made cards and menu entries mutually exclusive within one
//     app, which the platform does not require. The record-context prompt is gone too:
//     context is seeded per placement from that row's `default_context_field`.
//
//     Placement choices are read from the platform's extension-point registry (BEX-361),
//     fetch-only with NO local-mirror fallback, so a partner can never author a slot the
//     platform doesn't have. Only `actionLink` is offered at the integration-type
//     prompt: the `iframeExtension` choice (previously shown disabled as "coming soon")
//     was removed 2026-08-19 until iframe authoring is ready, though the upload endpoint
//     still accepts a hand-edited block — see validateUiApp.
//
//     The collected block is the app snapshot the platform stores, verbatim, so there is
//     no vocabulary translation between what a partner authors and what the platform
//     renders.

/**
 * Question name for the placement prompt, kept in the `placement:<location>` shape it had
 * when there was one prompt per picked page — the flow answers by question name, and the
 * name still says which page the answer belongs to.
 */
const PLACEMENT_QUESTION_PREFIX = 'placement:';

/**
 * A registry row whose three slot segments are guaranteed present — either served
 * decomposed (the BEX-361 contract) or backfilled from the slot name — and which
 * carries the `surface_point_name` slug an entry is authored by.
 */
interface UsableSurfacePoint extends SurfacePointRow {
  location_name: string;
  section_name: string;
  component_type: string;
  surface_point_name: string;
}

/**
 * Turn raw registry rows into offerable ones, dropping any that can't be placed.
 *
 * A row with no `surface_point_name` is dropped as well: that column is what an entry is
 * authored by (see `buildSurfacePointList`), it is nullable in the registry, and the
 * platform's own lookup skips a NULL — so offering such a row could only ever produce a
 * placement its upload rejects.
 */
function toUsableRows(rows: SurfacePointRow[]): UsableSurfacePoint[] {
  const usable: UsableSurfacePoint[] = [];
  for (const row of rows) {
    const segments = row.extension_point_name.split('.');
    const [locationToken, placeToken, kindToken] = segments.length === 3 ? segments : ['', '', ''];
    const location = (row.location_name ?? '').trim() || locationToken;
    const section = (row.section_name ?? '').trim() || placeToken;
    const component = (row.component_type ?? '').trim() || kindToken;
    const slug = (row.surface_point_name ?? '').trim();
    if (!location || !section || !component || !slug) continue;
    usable.push({
      ...row,
      location_name: location,
      section_name: section,
      component_type: component,
      surface_point_name: slug,
    });
  }
  return usable;
}

/**
 * Whether a registry row can actually host the chosen extension type.
 *
 * The server filters too since BEX-422 (`?extension_type=` on both registry reads, and a
 * disabled slot is absent from the catalogue entirely), but this CLIENT-side check stays:
 * a server predating the filter ignores the parameter, and the unfiltered retry in
 * `fetchSurfacePointsForPages` deliberately drops it. `extension_type_list` (fed by the
 * wire's `enabled_extension_types` since BEX-422) and `status` are each honoured only when
 * the row declares them: a registry seeded before either column existed must stay usable,
 * and treating a missing column as a rejection would empty the prompt.
 *
 * Without this check the unfiltered fetch reintroduces exactly the failure the whole flow
 * exists to prevent — a partner authors a slot that cannot serve their type, upload 200s,
 * and the slot renders nothing.
 */
function rowSupportsExtensionType(row: SurfacePointRow, extensionType: string): boolean {
  if (row.status?.trim() && row.status.trim() !== 'active') {
    return false;
  }
  const types = row.extension_type_list;
  if (!types || types.length === 0) return true;
  return types.includes(extensionType);
}

/**
 * Load the record pages, for the page prompt.
 *
 * Reads the registry's own location list (`GET .../surface-points/locations`) rather than
 * pulling every row and reducing it to the distinct locations: the pages are the
 * registry's answer, not the CLI's inference from whichever rows came back, and the prompt
 * doesn't wait on the full registry to show three choices.
 *
 * Fetch-only by decision: a failure aborts UI-app creation with an actionable message
 * rather than falling back to a local list — offering a page the platform doesn't actually
 * have would reproduce exactly the silent-drop failure this flow exists to prevent.
 *
 * The chosen extension type IS consulted here since BEX-422: `?extension_type=` narrows
 * the answer to the pages that still have at least one slot enabled for it, so the prompt
 * cannot offer a page whose every placement the row read then hides. A server predating
 * the filter ignores the parameter — the row read's own type check still catches that
 * case, one prompt later than ideal but never wrongly.
 */
async function fetchRecordPageLocations(extensionType: string): Promise<string[]> {
  const spinner = createSpinner(messages.APP_CREATE_UI_PAGES_SPINNER);
  let locations: string[];
  try {
    locations = await appService.fetchSurfacePointLocations(extensionType);
  } catch {
    throw new CliError(messages.APP_CREATE_UI_POINTS_FETCH_FAILED);
  } finally {
    spinner.stop();
  }

  if (locations.length === 0) {
    throw new CliError(messages.APP_CREATE_UI_POINTS_EMPTY);
  }
  return locations;
}

/** The registry read, narrowed or not, reduced to `null` on failure so callers can retry. */
async function readSurfacePointRows(
  locations?: readonly string[],
  extensionType?: string,
): Promise<SurfacePointRow[] | null> {
  try {
    return await appService.fetchSurfacePoints(locations, extensionType);
  } catch {
    return null;
  }
}

/**
 * Load the placements for the pages the partner picked — the only ROW read in the flow.
 *
 * `?location=<comma-separated>` narrows server-side, and the response is narrowed again
 * locally, so an endpoint that ignores the filter needs no special case.
 *
 * A read that fails, or that covers fewer of the picked pages than were asked for, is
 * RETRIED unfiltered — no location AND no extension_type filter, so a build that 400s on
 * either parameter is absorbed the same way. Both symptoms point at the filter rather
 * than at an empty registry — an early build may 400 on `?location=` or honour only the
 * first CSV value — and the
 * location list this run was built from already proved those pages exist. Aborting instead
 * would throw away the page answer the partner just gave, which they cannot be re-asked
 * for. The retry's rows are filtered to the picked pages too, so nothing broader leaks
 * into the prompt, and a page still missing afterwards is genuinely empty for this type.
 */
async function fetchSurfacePointsForPages(
  locations: readonly string[],
  extensionType: string,
): Promise<UsableSurfacePoint[]> {
  const onPickedPages = (rows: SurfacePointRow[]) =>
    toUsableRows(rows).filter((row) => locations.includes(row.location_name));
  const pagesCovered = (rows: UsableSurfacePoint[]) =>
    new Set(rows.map((row) => row.location_name)).size;

  const spinner = createSpinner(messages.APP_CREATE_UI_POINTS_SPINNER);
  let usable: UsableSurfacePoint[];
  try {
    const narrowed = await readSurfacePointRows(locations, extensionType);
    usable = onPickedPages(narrowed ?? []);
    if (narrowed === null || pagesCovered(usable) < locations.length) {
      const unfiltered = await readSurfacePointRows();
      if (unfiltered === null && narrowed === null) {
        throw new CliError(messages.APP_CREATE_UI_POINTS_FETCH_FAILED);
      }
      const fallback = onPickedPages(unfiltered ?? []);
      if (pagesCovered(fallback) > pagesCovered(usable)) usable = fallback;
    }
  } finally {
    spinner.stop();
  }

  const hostable = usable.filter((row) => rowSupportsExtensionType(row, extensionType));
  if (hostable.length === 0) {
    // Two distinct dead ends: the registry has rows for these pages but none can serve the
    // chosen type (fix: a different integration type), or it has none at all (fix: wait
    // for a seed). The location list said the pages exist, so either is a surprise worth
    // naming precisely.
    throw new CliError(
      usable.length > 0
        ? messages.APP_CREATE_UI_POINTS_NONE_FOR_TYPE(extensionType)
        : messages.APP_CREATE_UI_POINTS_EMPTY,
    );
  }
  return hostable;
}

/**
 * Label for one placement: the registry's own `section_name` and `component_type`,
 * joined and otherwise untouched.
 *
 * Deliberately NOT prettified. A CLI-owned map used to turn `headerMenu` into
 * `Header "More" (•••) menu` and `action` into `menu entry`, which meant every row the
 * registry gained had a second, CLI-owned name to keep in step — and an unmapped one fell
 * back to the raw token anyway, so the prompt mixed two vocabularies. Showing the API's
 * own values is what makes the choice verifiable against the registry. Same reasoning as
 * the page prompt above, which shows `location_name` verbatim; do not reintroduce a map
 * for either.
 *
 * NOT row.surface_point_name — that column holds the authoring slug
 * (`contactDetails.header.menu`), which is the choice's VALUE, not its label.
 */
function placementLabel(row: UsableSurfacePoint): string {
  return `${row.section_name} — ${row.component_type}`;
}

/**
 * Ask which record page the app appears on, then where on that page it appears —
 * both single-selects, so the flow authors exactly ONE placement (BEX-426).
 *
 * One page because the CTA fields are per-entry now (see the module comment): each
 * additional placement would cost its own label/URL round of questions, so extra
 * placements are hand-authored in `app-config.json` instead, where all the fields sit
 * together in one entry. One placement per page remains the CLI's authoring model —
 * the PLATFORM does not enforce it (its upload only rejects a duplicate slot), so a
 * hand-edited config listing two spots on one page still uploads.
 *
 * Every choice is a real registry row and the answer maps straight back to it, so the
 * authored values are never string-composed client-side. The page choice is the
 * registry's `location_name` verbatim, label and value alike. Placement choice VALUES
 * are the row's `surface_point_name` slug — the authoring identity (see
 * `buildSurfacePointList`) — while their visible label is built from the decomposed
 * segments.
 */
async function promptSurfacePoint(
  locations: readonly string[],
  extensionType: string,
): Promise<UsableSurfacePoint[]> {
  // Pages — the registry's locations verbatim, in server order. Deliberately NOT renamed
  // for display: the CLI used to show `contactDetails` as `contact` through a local map
  // (with a strip-`Details` fallback for anything unmapped), which meant the prompt could
  // disagree with the platform and every page the registry gains had a second, CLI-owned
  // name to keep in step. Showing the registry's own token is what makes the choice
  // verifiable against the API.
  const { surface } = await inquirer.prompt([
    {
      type: 'list',
      name: 'surface',
      message: messages.APP_CREATE_UI_SURFACE_PROMPT,
      choices: indentChoices(locations.map((location) => ({ name: location, value: location }))),
    },
  ]);
  // Resolved against the registry's list rather than taken as answered, so nothing that
  // isn't a real location can reach the row read.
  const page = locations.find((location) => location === String(surface ?? '').trim());
  const rows = await fetchSurfacePointsForPages(page ? [page] : [], extensionType);
  // The picked page produced no offerable rows: `fetchSurfacePointsForPages` has already
  // thrown the precise error (none-for-type vs empty registry), so this line is
  // unreachable in practice — it only guards a stubbed fetch in tests.
  const forPage = rows.filter((row) => row.location_name === page);

  const question = `${PLACEMENT_QUESTION_PREFIX}${page}`;
  const answer = await inquirer.prompt([
    {
      type: 'list',
      name: question,
      message: messages.APP_CREATE_UI_PLACEMENT_PAGE_PROMPT(page ?? ''),
      // A page offering one placement still asks, rather than being chosen silently:
      // it is a single keypress either way, and the partner sees where the app lands.
      choices: indentChoices(
        forPage.map((row) => ({
          name: placementLabel(row),
          value: row.surface_point_name,
        })),
      ),
    },
  ]);
  const chosen = String(answer[question] ?? '').trim();
  // A `list` always resolves to one of its choices, so there is no empty case to guard
  // in a real run — this only skips a stubbed prompt that answered nothing.
  return forPage.filter((row) => row.surface_point_name === chosen);
}

/**
 * Ask what the app integrates as. Only Link (`actionLink`) is offered — the Iframe
 * choice (previously a disabled "coming soon" entry) was removed 2026-08-19 until
 * iframe authoring is ready. The question is still asked with one choice, same as the
 * gated app-type and distribution prompts: the user is told what they are getting
 * rather than having it applied silently.
 */
async function promptIntegrationType(): Promise<UiApp['extension_type']> {
  const { integrationType } = await inquirer.prompt([
    {
      type: 'list',
      name: 'integrationType',
      message: messages.APP_CREATE_UI_INTEGRATION_PROMPT,
      choices: indentChoices([
        {
          name: messages.APP_CREATE_UI_INTEGRATION_EXTERNAL_LINK,
          value: EXTENSION_TYPE_ACTION_LINK,
        },
      ]),
    },
  ]);
  return integrationType as UiApp['extension_type'];
}

/**
 * Collect the `ui_app` block interactively. Only reachable when the app-type
 * prompt returned `ui`, which already implies an interactive terminal — so every
 * field is asked for, with no flag or default fallback path. (That also means
 * the fetch spinner never needs a `silent` option: the UI path is unreachable
 * under `--json`.)
 */
export async function resolveUiApp(): Promise<UiApp> {
  // Integration type first: it is the decision a partner arrives with, and it decides
  // which registry rows can host the app at all.
  const extensionType = await promptIntegrationType();
  const locations = await fetchRecordPageLocations(extensionType);
  const selectedRows = await promptSurfacePoint(locations, extensionType);

  const { label } = await inquirer.prompt([
    {
      type: 'input',
      name: 'label',
      message: messages.APP_CREATE_UI_LABEL_PROMPT,
      validate: validateUiAppLabel,
    },
  ]);

  const { more_info } = await inquirer.prompt([
    {
      type: 'input',
      name: 'more_info',
      message: messages.APP_CREATE_UI_MORE_INFO_PROMPT,
      validate: validateUiAppMoreInfo,
    },
  ]);

  const { url } = await inquirer.prompt([
    {
      type: 'input',
      name: 'url',
      message: messages.APP_CREATE_UI_REDIRECT_LINK_PROMPT,
      validate: validateUiAppUrl,
    },
  ]);

  const uiApp: UiApp = {
    extension_type: extensionType,
    // One entry for the selected placement, seeded from THAT row's
    // `default_context_field`. Context is not prompted: the allow-list and its default
    // are properties of the registry row, chosen by the platform, and asking a partner
    // to pick from a list they can only narrow was a question with no good wrong answer.
    // A row that declares no default gets no `context` key, which means "no narrowing".
    //
    // The CTA answers land ON the entry (BEX-426): label, more_info and the destination
    // are per-placement fields, so the block's root carries only `extension_type`.
    // `more_info` is omitted rather than written empty — the kit only renders it when
    // set, and an empty string would show up as a spurious diff on every upload.
    surface_point_list: buildSurfacePointList(selectedRows, {
      contextFor: (row) => row.default_context_field ?? [],
      label: String(label ?? '').trim(),
      more_info: String(more_info ?? '').trim(),
      redirect_link: String(url ?? '').trim(),
    }),
    // No link_target: `brevo app upload` injects `_blank`. See the field's note in
    // types.ts — the server refuses `_self`, so a field in the file would only
    // invite a partner to edit it into a value that 400s.
  };

  // Belt and braces: the per-prompt validators cover each answer in isolation,
  // but nothing else checks the assembled block. Shape only — the slot names came
  // straight off registry rows, so there is nothing local left to check them
  // against, and the upload endpoint is the authority either way.
  validateUiApp(uiApp);
  return uiApp;
}

/**
 * Turn selected registry rows into `surface_point_list` entries, deduplicated by slot
 * and keeping registry order (which is deterministic server-side, so the upload diff
 * doesn't churn).
 *
 * The authored value is the row's `surface_point_name` SLUG (`contactDetails.header.menu`),
 * NOT its dotted `extension_point_name` (`contactDetails.headerMenu.action`). The two are 1:1
 * on the registry row and easy to confuse — the dotted name is what the UI kit ultimately
 * renders — but they are not interchangeable here: the platform resolves an authored entry
 * by `surface_point_name` (`FindByNames`, a `WHERE surface_point_name = ANY(...)` read) and
 * serves the row's dotted `extension_point_name` back to the frontend as `extensionPoint`.
 * Authoring the dotted name matches no row, which is a 400 from `app upload`
 * (`checkExtensionPoints`) and a silently dropped slot on the read path. The entry key is
 * `surface_point_name` for exactly that reason: it names the column it is matched against,
 * so row field and entry field are the same word and the copy across is trivially right.
 *
 * `contextFor` decides each entry's own context; an empty result omits the key rather
 * than writing `[]`, which would read as "narrow to nothing" instead of "no narrowing".
 *
 * The CTA fields land on every entry (BEX-426) — in practice the flow selects one
 * placement, but the same answers on each would also be the right seed for several: a
 * partner who wants them to differ edits the entries in `app-config.json`, which is the
 * documented path to more placements anyway. `more_info` is omitted when blank, same
 * contract as `context`.
 */
function buildSurfacePointList(
  rows: UsableSurfacePoint[],
  fields: {
    contextFor: (row: UsableSurfacePoint) => string[];
    label: string;
    more_info: string;
    redirect_link: string;
  },
): SurfacePointEntry[] {
  const entries: SurfacePointEntry[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.surface_point_name)) continue;
    seen.add(row.surface_point_name);
    const context = fields
      .contextFor(row)
      .map((field) => String(field).trim())
      .filter(Boolean);
    entries.push({
      surface_point_name: row.surface_point_name,
      ...(context.length ? { context } : {}),
      label: fields.label,
      ...(fields.more_info ? { more_info: fields.more_info } : {}),
      redirect_link: fields.redirect_link,
    });
  }
  return entries;
}

/**
 * Build the URL Brevo will actually open for a placement, with placeholder values for the
 * record-context fields.
 *
 * Uses `URL`/`URLSearchParams` rather than string concatenation because `redirect_link`
 * may already carry a query string or a fragment: params must merge into an existing `?`
 * and be inserted BEFORE any `#`, which is exactly what the UI kit's own builder does.
 * A hand-rolled `url + '?' + params` gets both wrong, and a wrong example is worse than no
 * example when the whole point is showing the partner the exact shape.
 *
 * Placeholder values are SCREAMING_SNAKE of the field name — URL-safe, so nothing is
 * percent-encoded into noise, and obviously not a real value.
 */
function buildExampleContextUrl(redirectLink: string, context: readonly string[]): string | null {
  let url: URL;
  try {
    url = new URL(redirectLink);
  } catch {
    return null;
  }
  for (const field of context) {
    url.searchParams.set(field, field.replaceAll(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase());
  }
  return url.toString();
}

/**
 * The example-URL lines for the created-app box, or none at all.
 *
 * Built from the FIRST placement that declares both a context and its own
 * `redirect_link` (the two live on the same entry since BEX-426): entries can differ,
 * but one example makes the point without turning the box into a list. Nothing is
 * printed when no placement declares a context — the entry's plain `redirect link` line
 * above already says everything there is to say in that case.
 */
function renderExampleContextUrlLines(uiApp: UiApp): string[] {
  const withContext = uiApp.surface_point_list.find(
    (entry) => entry.context?.length && entry.redirect_link,
  );
  if (!withContext) return [];
  const example = buildExampleContextUrl(withContext.redirect_link!, withContext.context ?? []);
  if (!example) return [];
  return [
    '',
    `${messages.APP_CREATE_UI_BOX_EXAMPLE_URL_LABEL}`,
    `  ${example}`,
    messages.APP_CREATE_UI_BOX_EXAMPLE_URL_NOTE,
  ];
}

// UI apps get their own summary box: there is no OAuth callback to list, and the
// placement/trigger fields are what the partner actually needs to verify.
export function renderCreatedUiApp(
  result: CreateAppResponse,
  appName: string,
  uiApp: UiApp,
  logoUri?: string,
): void {
  const boxLines = [
    `App name:       ${appName}`,
    `App ID:         ${result.app_id}`,
    // No Client ID / Client secret rows: a UI app sends no `auth` block and gets
    // none back, so those rows could only ever render empty. They used to print
    // `Client ID: undefined` next to a hidden-secret placeholder for a secret that
    // does not exist — a credential form with nothing in it.
    `Extension type: ${uiApp.extension_type}`,
    // Each placement carries its own record context, label and destination (BEX-426),
    // so everything per-entry prints together under the placement — shared "Label:" /
    // "Redirect link:" rows would hide that entries can differ. The value formatting is
    // shared with the upload diff and `app list` (see ./fields); only the label and the
    // continuation padding are this box's own.
    ...formatPlacementLines(uiApp).map(
      (line, i) => `${i === 0 ? 'Placement:      ' : '                '}${line}`,
    ),
    ...(logoUri ? [`Logo URL:       ${logoUri}`] : []),
    ...(result.version ? [`App version:    ${result.version}`] : []),
    // Record context reaches the partner's endpoint as query parameters and nothing
    // else — no path templating — so show the exact URL shape rather than leaving
    // them to discover it from a request log after the fact.
    ...renderExampleContextUrlLines(uiApp),
    '',
    messages.APP_CREATE_UI_BOX_LABEL_NOTE(uiApp.surface_point_list[0]?.label ?? '', appName),
    messages.APP_CREATE_UI_BOX_HINT,
  ];
  printBox(messages.APP_CREATE_UI_BOX_TITLE, boxLines);
}
