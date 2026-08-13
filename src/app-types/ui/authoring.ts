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
import {
  DEFAULT_UI_APP_SURFACE,
  EXTENSION_KIND_ACTION,
  EXTENSION_KIND_WIDGET,
  EXTENSION_PLACE_LABELS,
  EXTENSION_TYPE_ACTION_LINK,
  EXTENSION_TYPE_IFRAME,
  UI_APP_SURFACE_TO_LOCATION,
} from '../../lib/constants';
import { logWarn } from '../../lib/logger';
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
//       1. link or iframe   → sets `extension_type`. Asked FIRST because it is the
//                             decision a partner arrives with, and because it decides
//                             which single URL question is asked at the end. It does NOT
//                             filter the placement list.
//       2. record pages     → multi-select of the registry's own location list.
//       3. placements       → ONE prompt of real registry rows, grouped by page.
//       4. label            → menu entry text / card CTA.
//       5. more_info        → optional supporting line.
//       6. redirect link    → the destination.
//
//     Five questions, one optional, and two registry reads that ask for different things:
//     `surface-points/locations` for the pages, then `surface-points?location=<csv>` for
//     the placements on the pages that were picked. The pages are never derived from a full
//     row read — the registry answers that question directly. The old kind-then-place pair is
//     gone: kind is a property of a slot, not a question — a partner picking "Header
//     menu" has already said they want a menu entry — and asking it up front made cards
//     and menu entries mutually exclusive within one app, which the platform does not
//     require. The record-context prompt is gone too: context is seeded per placement
//     from that row's `default_context_field`.
//
//     Placement choices are read from the platform's extension-point registry (BEX-361),
//     fetch-only with NO local-mirror fallback, so a partner can never author a slot the
//     platform doesn't have. Only `actionLink` is selectable at the integration-type
//     prompt: `iframeExtension` shows as a disabled "coming soon" choice rather than
//     being hidden (the upload endpoint still accepts a hand-edited block — see
//     validateUiApp).
//
//     The collected block is the app snapshot the platform stores, verbatim, so there is
//     no vocabulary translation between what a partner authors and what the platform
//     renders.

/**
 * Question-name prefix for the per-page placement prompts: one prompt per picked page,
 * each named `placement:<location>`. Naming them apart is what keeps a page's answer on
 * that page — the flow answers by question name throughout.
 */
const PLACEMENT_QUESTION_PREFIX = 'placement:';

/** Reverse of UI_APP_SURFACE_TO_LOCATION, for labelling fetched locations. */
const LOCATION_TO_UI_APP_SURFACE: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(UI_APP_SURFACE_TO_LOCATION).map(([surface, location]) => [location, surface]),
);

/**
 * Friendly prompt value for a fetched location token: the known `contact` /
 * `company` / `deal` names where the mapping exists, otherwise derived by
 * stripping a trailing `Details` (`orderDetails` → `order`), raw token as the
 * last resort. Values only need to be stable within one prompt run — the wire
 * identity is always the row's `extension_point_name`.
 */
function surfaceValueForLocation(location: string): string {
  const known = LOCATION_TO_UI_APP_SURFACE[location];
  if (known) return known;
  const stripped = location.endsWith('Details') ? location.slice(0, -'Details'.length) : location;
  return stripped || location;
}

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
 * Checked CLIENT-side rather than by asking the server to filter, because both extension
 * types render on both kinds and a server-side type filter would hide authorable
 * placements. `extension_type_list` and `status` are each honoured only when the row
 * declares them: a registry seeded before either column existed must stay usable, and
 * treating a missing column as a rejection would empty the prompt.
 *
 * Without this check the unfiltered fetch reintroduces exactly the failure the whole flow
 * exists to prevent — a partner authors a slot that cannot serve their type, upload 200s,
 * and the slot renders nothing.
 */
function rowSupportsExtensionType(row: SurfacePointRow, extensionType: string): boolean {
  if (row.status !== undefined && row.status.trim() && row.status.trim() !== 'active') {
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
 * The chosen extension type is deliberately NOT consulted here, and could not be: a list
 * of location names carries no `extension_type_list` to check. A page whose every
 * placement is un-hostable therefore reaches this prompt and is dropped — with a warning —
 * once the rows are read. See `promptSurfacePointList`.
 */
async function fetchRecordPageLocations(): Promise<string[]> {
  const spinner = createSpinner(messages.APP_CREATE_UI_PAGES_SPINNER);
  let locations: string[];
  try {
    locations = await appService.fetchSurfacePointLocations();
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
): Promise<SurfacePointRow[] | null> {
  try {
    return await appService.fetchSurfacePoints(locations);
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
 * RETRIED unfiltered. Both are symptoms of the filter rather than of an empty registry —
 * an early build may 400 on `?location=` or honour only the first CSV value — and the
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
    const narrowed = await readSurfacePointRows(locations);
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

/** Partner-facing label for one placement: the page region, plus the shape it renders as. */
function placementLabel(row: UsableSurfacePoint): string {
  // NOT row.surface_point_name — that column holds a kebab-case slug
  // (`contact-details-header-menu`), not display text. See EXTENSION_PLACE_LABELS.
  const place = EXTENSION_PLACE_LABELS[row.section_name] ?? row.section_name;
  if (row.component_type === EXTENSION_KIND_ACTION) {
    return `${place} — ${messages.APP_CREATE_UI_PLACEMENT_MENU_SUFFIX}`;
  }
  if (row.component_type === EXTENSION_KIND_WIDGET) {
    return `${place} — ${messages.APP_CREATE_UI_PLACEMENT_CARD_SUFFIX}`;
  }
  return `${place} — ${row.component_type}`;
}

/**
 * Ask which record pages the app appears on, then — one single-select prompt per page —
 * where on each of them it appears.
 *
 * ONE placement per page: an app takes a single spot on a record page, so the per-page
 * prompt is a `list`, not a `checkbox`. That makes the rule structural rather than a
 * validation message, and it is why this asks N prompts instead of one grouped
 * multi-select (which is what it did before, and which let one page collect several
 * spots). Note the PLATFORM does not enforce this — its upload only rejects a duplicate
 * slot — so a hand-edited config listing two spots on one page still uploads. The rule is
 * the CLI's authoring model, not a wire constraint.
 *
 * Every choice is a real registry row and the answer maps straight back to it, so the
 * authored values are never string-composed client-side. Choice VALUES are the row's
 * `surface_point_name` slug — the authoring identity (see `buildSurfacePointList`) —
 * while the visible label is built from the decomposed segments.
 */
async function promptSurfacePointList(
  locations: readonly string[],
  extensionType: string,
): Promise<UsableSurfacePoint[]> {
  // Pages — the registry's locations in server order, shown under their friendly names.
  const surfaceChoices = locations.map((location) => ({
    name: surfaceValueForLocation(location),
    value: surfaceValueForLocation(location),
    location,
  }));
  const { surfaces } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'surfaces',
      message: messages.APP_CREATE_UI_SURFACE_PROMPT,
      choices: indentChoices(surfaceChoices.map(({ name, value }) => ({ name, value }))),
      // Only pre-select the default page when the registry actually offers it.
      default: surfaceChoices.some((choice) => choice.value === DEFAULT_UI_APP_SURFACE)
        ? [DEFAULT_UI_APP_SURFACE]
        : [],
      validate: (picked: unknown[]) => picked.length > 0 || messages.APP_CREATE_UI_SURFACE_REQUIRED,
    },
  ]);
  const pickedSurfaces = (surfaces as string[]) ?? [];
  const pickedLocations = surfaceChoices
    .filter((choice) => pickedSurfaces.includes(choice.value))
    .map((choice) => choice.location);

  const rows = await fetchSurfacePointsForPages(pickedLocations, extensionType);

  // One group per picked page that the registry actually offers a spot on — each becomes
  // its own prompt below.
  const grouped: Array<{ location: string; rows: UsableSurfacePoint[] }> = [];
  for (const location of pickedLocations) {
    const forLocation = rows.filter((row) => row.location_name === location);
    if (forLocation.length > 0) grouped.push({ location, rows: forLocation });
  }
  // A picked page the narrowed read produced no rows for is REPORTED and dropped, never
  // enforced. Enforcing it made the prompt unsatisfiable: `validate` demanded a spot on a
  // page with no choice to tick, so every answer was refused — including ticking nothing —
  // and Ctrl-C was the only way out, discarding the name, distribution and type answers
  // already given. This happens for real when the endpoint honours only the first value of
  // the `location` CSV, or when a page's rows all come back inactive.
  const dropped = pickedLocations.filter(
    (location) => !grouped.some((group) => group.location === location),
  );
  if (dropped.length > 0) {
    logWarn(messages.APP_CREATE_UI_PLACEMENT_PAGES_DROPPED(dropped.map(surfaceValueForLocation)));
  }

  // One prompt per page, each named for its location so an answer can never land on the
  // wrong page — the same reason the rest of this flow answers by question name.
  const picked = new Set<string>();
  for (const group of grouped) {
    const question = `${PLACEMENT_QUESTION_PREFIX}${group.location}`;
    const answer = await inquirer.prompt([
      {
        type: 'list',
        name: question,
        message: messages.APP_CREATE_UI_PLACEMENT_PAGE_PROMPT(
          surfaceValueForLocation(group.location),
        ),
        // A page offering one placement still asks, rather than being chosen silently:
        // it is a single keypress either way, and the partner sees where the app lands.
        choices: indentChoices(
          group.rows.map((row) => ({
            name: placementLabel(row),
            value: row.surface_point_name,
          })),
        ),
      },
    ]);
    const chosen = String(answer[question] ?? '').trim();
    // A `list` always resolves to one of its choices, so there is no empty case to guard
    // in a real run — this only skips a stubbed prompt that answered nothing.
    if (chosen) picked.add(chosen);
  }

  // Registry order, not answer order, so the authored list is deterministic and the upload
  // diff doesn't churn on a re-run that picked the same slots in a different sequence.
  return rows.filter((row) => picked.has(row.surface_point_name));
}

/**
 * Ask whether the app is a link or an iframe. Only Link (`actionLink`) is selectable —
 * Iframe is rendered as a disabled "coming soon" choice so partners see the roadmap
 * without being able to author a block the kit can't serve yet.
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
        {
          name: messages.APP_CREATE_UI_INTEGRATION_MODAL_IFRAME,
          value: EXTENSION_TYPE_IFRAME,
          disabled: messages.APP_CREATE_UI_INTEGRATION_COMING_SOON,
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
  const locations = await fetchRecordPageLocations();
  const selectedRows = await promptSurfacePointList(locations, extensionType);

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
    // One entry per selected placement, deduplicated by slot name, each seeded from
    // THAT row's `default_context_field`. Not prompted: the allow-list and its default
    // are properties of the registry row, chosen by the platform, and asking a partner
    // to pick from a list they can only narrow was a question with no good wrong answer.
    // A row that declares no default gets no `context` key, which means "no narrowing".
    surface_point_list: buildSurfacePointList(
      selectedRows,
      (row) => row.default_context_field ?? [],
    ),
    label: String(label ?? '').trim(),
    // Omitted rather than written empty: the kit only renders it when set, and an
    // empty string would show up as a spurious diff on every upload.
    ...(String(more_info ?? '').trim() ? { more_info: String(more_info).trim() } : {}),
    redirect_link: String(url ?? '').trim(),
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
 * The authored value is the row's `surface_point_name` SLUG (`contact-details-header-menu`),
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
 */
function buildSurfacePointList(
  rows: UsableSurfacePoint[],
  contextFor: (row: UsableSurfacePoint) => string[],
): SurfacePointEntry[] {
  const entries: SurfacePointEntry[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.surface_point_name)) continue;
    seen.add(row.surface_point_name);
    const context = contextFor(row)
      .map((field) => String(field).trim())
      .filter(Boolean);
    entries.push({
      surface_point_name: row.surface_point_name,
      ...(context.length ? { context } : {}),
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
 * Built from the FIRST placement that declares a context: entries can differ, but they are
 * seeded from the registry and in practice all carry the same fields, so one example makes
 * the point without turning the box into a list. Nothing is printed when no placement
 * declares a context — the plain `redirect_link` row above already says everything there
 * is to say in that case.
 */
function renderExampleContextUrlLines(uiApp: UiApp): string[] {
  const withContext = uiApp.surface_point_list.find((entry) => entry.context?.length);
  if (!withContext || !uiApp.redirect_link) return [];
  const example = buildExampleContextUrl(uiApp.redirect_link, withContext.context ?? []);
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
    // Each placement carries its own record context, so they print together — a
    // single shared "Record context" row would hide that they can differ. The value
    // formatting is shared with the upload diff and `app list` (see ./fields); only the
    // label and the continuation padding are this box's own.
    ...formatPlacementLines(uiApp).map(
      (line, i) => `${i === 0 ? 'Placement:      ' : '                '}${line}`,
    ),
    `Label:          ${uiApp.label ?? ''}`,
    ...(uiApp.more_info ? [`More info:      ${uiApp.more_info}`] : []),
    `Redirect link:  ${uiApp.redirect_link ?? ''}`,
    ...(logoUri ? [`Logo URL:       ${logoUri}`] : []),
    ...(result.version ? [`App version:    ${result.version}`] : []),
    // Record context reaches the partner's endpoint as query parameters and nothing
    // else — no path templating — so show the exact URL shape rather than leaving
    // them to discover it from a request log after the fact.
    ...renderExampleContextUrlLines(uiApp),
    '',
    messages.APP_CREATE_UI_BOX_LABEL_NOTE(uiApp.label ?? '', appName),
    messages.APP_CREATE_UI_BOX_HINT,
  ];
  printBox(messages.APP_CREATE_UI_BOX_TITLE, boxLines);
}
