/**
 * UI-app authoring for `brevo app create` (BEX-290).
 *
 * Extracted from `create.ts` as-is: this module owns everything between the app-type
 * answer being `ui` and the created-app box being printed — the extension-point registry
 * reads, the placement prompts, the `surface_point_list` entries built from the rows that
 * came back, and the UI-app summary box. `create.ts` keeps the shared create flow (name,
 * distribution, directory, the POST and its retry) and calls into the two exports below.
 *
 * `resolveUiApp`, `resolveUiAppNonInteractive`, `renderCreatedUiApp` and
 * `buildSurfacePointList` are public. Everything else is an implementation detail of
 * the prompt flow and is deliberately not exported — the registry-shaped helpers in
 * particular (`toUsableRows`, `rowSupportsExtensionType`) are only correct in the
 * order this flow calls them.
 */
import inquirer from 'inquirer';
import {
  DEFAULT_MODAL_SIZE,
  EXTENSION_TYPE_ACTION_LINK,
  EXTENSION_TYPE_IFRAME,
} from '../../lib/constants';
import { messages } from '../../lang/en';
import { CliError } from '../../lib/errors';
import {
  validateUiApp,
  validateUiAppCardHeight,
  validateUiAppLabel,
  validateUiAppMoreInfo,
  validateUiAppSizeAxis,
  validateUiAppUrl,
} from '../../lib/validators';
import { printBox, createSpinner, indentChoices } from '../../lib/ui';
import { isFeatureAvailable } from '../../lib/preview';
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
//       6. destination URL  → for THAT placement: `redirect_link` for a Link,
//                             `iframe_href` for an Iframe — the type picked at
//                             step 1 decides which single URL question this is.
//
//     An Iframe is then asked how it PRESENTS, which a Link never is — each of the three
//     questions on a narrower set of placements than the one before it:
//
//       7. layout           → widget slots only: inline in the card, or a modal off its
//                             CTA. An action slot's menu entry opens a modal by
//                             definition, so there would be one honest answer.
//       8. modal size       → every entry that actually opens a modal, which includes that
//                             menu entry and excludes an `inline` card.
//       9. card height      → `inline` only: the card IS the embedded page there, so its
//                             height is the partner's call rather than the slot's.
//                             Pre-filled from the row's `default_size`.
//
//     Five questions for a Link, one optional, and two registry reads that ask for
//     different things:
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
//     platform doesn't have. Both uploadable types are offered at the integration-type
//     prompt since the iframe-extension launch — Iframe only on a PRIVATE app, because
//     iframe extensions are private-only in v1 (the same rule `validateConfig` and the
//     platform enforce; the choice is hidden rather than shown disabled, so the prompt
//     never advertises a combination every layer refuses).
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
 * Ask what the app integrates as: a Link (`actionLink`) always, an Iframe
 * (`iframeExtension`) only on a private app in a build that has the feature — iframe
 * extensions are private-only in v1, and the choice is HIDDEN rather than shown disabled:
 * a disabled entry would advertise a combination the CLI validator and the platform both
 * refuse, which is a roadmap hint about a rule, not a feature. On a public app the
 * question is still asked with its one choice, same as the gated app-type and distribution
 * prompts: the user is told what they are getting rather than having it applied silently.
 */
async function promptIntegrationType(offerIframe: boolean): Promise<UiApp['extension_type']> {
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
        // ELIMINATION SITE — the raw global rather than `isFeatureAvailable` alone, so
        // esbuild folds the whole branch away on a published build and the choice's label
        // (which lives in `preview-messages.ts` for exactly this reason) leaves the bundle
        // with it. `isFeatureAvailable` stays alongside it so `FEATURE_STAGE` remains the
        // one place the feature's readiness is stated — same pairing as the gated
        // `--distribution public` choice in `app create`.
        ...(__BREVO_PREVIEW__ && isFeatureAvailable('ui-iframe-type') && offerIframe
          ? [
              {
                name: messages.APP_CREATE_UI_INTEGRATION_MODAL_IFRAME,
                value: EXTENSION_TYPE_IFRAME,
              },
            ]
          : []),
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
 *
 * `distribution` is the answer the create flow already collected; it gates the Iframe
 * choice (private-only in v1) rather than being re-asked or inferred here.
 */
export async function resolveUiApp(distribution: string): Promise<UiApp> {
  // Integration type first: it is the decision a partner arrives with, and it decides
  // which registry rows can host the app at all.
  const extensionType = await promptIntegrationType(distribution === 'private');
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

  // ONE URL question either way — the integration type decides which field it answers.
  // A Link's destination opens in a new tab (`redirect_link`); an Iframe's page is
  // embedded in a modal inside Brevo (`iframe_href`). Same validator: both fields
  // carry the same https contract, judged again server-side at upload.
  const isIframe = extensionType === EXTENSION_TYPE_IFRAME;
  const { url } = await inquirer.prompt([
    {
      type: 'input',
      name: 'url',
      message: isIframe
        ? messages.APP_CREATE_UI_IFRAME_HREF_PROMPT
        : messages.APP_CREATE_UI_REDIRECT_LINK_PROMPT,
      validate: validateUiAppUrl,
    },
  ]);

  // Inline vs modal — asked only for an Iframe on a WIDGET slot: an action slot's menu
  // entry must open something, so it is a modal by definition and the question would have
  // one honest answer. Both answers are written to the entry, the default included: an
  // authored `layout: "modal"` says in the file what an absent key only implies.
  const layout = await promptIframeLayout(isIframe, selectedRows);

  // How big that modal is — asked whenever one actually opens, which is a DIFFERENT set of
  // entries from the layout question above. Layout is widget-only; a modal opens on an
  // action slot (always) and on a widget slot unless the answer above was `inline`, which
  // embeds the page in the card and opens nothing. Written for every answer, `large`
  // included, same contract as the layout above.
  const modalSize = await promptModalSize(isIframe, layout);

  // How tall the card is — asked for the one presentation where the card IS the embedded
  // page. An `inline` answer above means the iframe renders in the card body, so its
  // height is the partner's decision and the slot's default is only a starting point;
  // everything else keeps the silent seed (a modal sizes itself from `modal_size`, an
  // action slot renders no card, a Link's card shows a CTA rather than a page).
  const cardHeight = await promptInlineCardHeight(isIframe, layout, selectedRows);

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
      // The slot's default card size (BEX-461) seeds the entry's `size` the same way the
      // row's `default_context_field` seeds `context`: written explicitly into the file,
      // where the partner can see and edit it. The registry is the only source of that
      // seed — the CLI keeps no card-size constant to fall back to, for the same reason
      // it keeps no copy of the slot names.
      //
      // An answered inline card height overrides the seed's height ONLY: a `width` the
      // slot declared is the column geometry the partner was never asked about, so it
      // survives the override untouched.
      sizeFor: (row) => withCardHeight(row.default_size ?? undefined, cardHeight),
      label: String(label ?? '').trim(),
      more_info: String(more_info ?? '').trim(),
      urlField: isIframe ? 'iframe_href' : 'redirect_link',
      url: String(url ?? '').trim(),
      layout,
      modal_size: modalSize,
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

/** Already-merged input for non-interactive UI app creation — see `create.ts` for how
 * `--ui-config` and the `--ui-app` flag set both resolve to this same shape before
 * this function ever runs. */
export interface UiAppNonInteractiveInput {
  extensionType: string;
  recordPage: string;
  placement: string;
  label: string;
  moreInfo: string;
  url: string;
}

/**
 * Non-interactive counterpart to `resolveUiApp()` — same registry reads, same entry
 * builder, same `validateUiApp()` call, but driven by already-collected input instead
 * of prompts. Reachable from `--ui-config`/`--ui-app` regardless of TTY/`--json`/piped
 * stdin (see `create.ts`'s interception point ahead of `resolveAppType`).
 *
 * Scoped to `actionLink` only — checked first, before any network call, so an
 * iframe/legacy request fails immediately rather than after two registry round trips.
 * NOT the same as the interactive flow any more: that one does offer `iframeExtension`
 * (on a private app). This route stays `actionLink`-only deliberately — a scriptable
 * iframe surface would invite pipelines to pin to a shape that can still change, the
 * same reasoning that keeps `--type` off `app create` altogether.
 */
export async function resolveUiAppNonInteractive(input: UiAppNonInteractiveInput): Promise<UiApp> {
  if (input.extensionType !== EXTENSION_TYPE_ACTION_LINK) {
    throw new CliError(messages.APP_CREATE_UI_NONINTERACTIVE_EXTENSION_TYPE(input.extensionType));
  }

  const locations = await fetchRecordPageLocations(input.extensionType);
  if (!locations.includes(input.recordPage)) {
    throw new CliError(
      messages.APP_CREATE_UI_NONINTERACTIVE_UNKNOWN_RECORD_PAGE(input.recordPage, locations),
    );
  }

  const rows = await fetchSurfacePointsForPages([input.recordPage], input.extensionType);
  const forPage = rows.filter((row) => row.location_name === input.recordPage);
  const matched = forPage.filter((row) => row.surface_point_name === input.placement);
  if (matched.length === 0) {
    throw new CliError(
      messages.APP_CREATE_UI_NONINTERACTIVE_UNKNOWN_PLACEMENT(
        input.placement,
        input.recordPage,
        forPage.map((row) => row.surface_point_name),
      ),
    );
  }

  const uiApp: UiApp = {
    extension_type: input.extensionType as UiApp['extension_type'],
    surface_point_list: buildSurfacePointList(matched, {
      contextFor: (row) => row.default_context_field ?? [],
      sizeFor: (row) => row.default_size ?? undefined,
      label: input.label.trim(),
      more_info: input.moreInfo.trim(),
      // The non-interactive routes are actionLink-only by design, so the destination is
      // always redirect_link here — the iframe branch exists on the interactive flow only.
      urlField: 'redirect_link',
      url: input.url.trim(),
    }),
  };

  validateUiApp(uiApp);
  return uiApp;
}

/**
 * Ask how an Iframe presents on a widget slot: the card CTA opening a modal (default), or the
 * page embedded directly in the card body. BOTH answers reach the file — the entry says in
 * writing how it presents, rather than leaving a reader of `app-config.json` to know that an
 * absent `layout` means modal.
 *
 * `undefined` therefore means one thing only: the field does not APPLY to this entry — a Link,
 * or an action slot, whose menu entry is a modal by definition and which the platform refuses
 * a `layout` on outright. It no longer doubles as "answered modal"; `promptModalSize` below
 * depends on that, and so does `buildSurfacePointList`'s widget-only refusal.
 */
async function promptIframeLayout(
  isIframe: boolean,
  rows: UsableSurfacePoint[],
): Promise<'inline' | 'modal' | undefined> {
  const onWidget = rows.some((row) => row.component_type === 'widget');
  if (!isIframe || !onWidget) return undefined;
  const { layout } = await inquirer.prompt([
    {
      type: 'list',
      name: 'layout',
      message: messages.APP_CREATE_UI_LAYOUT_PROMPT,
      choices: indentChoices([
        { name: messages.APP_CREATE_UI_LAYOUT_MODAL, value: 'modal' },
        { name: messages.APP_CREATE_UI_LAYOUT_INLINE, value: 'inline' },
      ]),
    },
  ]);
  return layout === 'inline' ? 'inline' : 'modal';
}

/**
 * Ask how big the modal an Iframe opens should be. Every answer reaches the file, the default
 * included, for the same reason `layout` writes its default: the size a modal opens at is
 * visible in the config rather than implied by an absent key.
 *
 * `undefined` means the field does not APPLY: a Link, or an entry whose layout answer was
 * `inline` — it embeds the page in the card body and opens no modal at all, so a size here
 * would size nothing.
 *
 * The gating is deliberately NOT `promptIframeLayout`'s. That question is widget-only,
 * because an action slot's menu entry has exactly one presentation; this one applies to
 * every iframe entry that opens a modal, which includes that menu entry. `layout` is
 * `undefined` on an action slot and `'modal'` on a widget slot that answered so — both of
 * those DO open a modal — so `layout === 'inline'` is the whole exclusion.
 */
async function promptModalSize(
  isIframe: boolean,
  layout: 'inline' | 'modal' | undefined,
): Promise<'small' | 'medium' | 'large' | undefined> {
  if (!isIframe || layout === 'inline') return undefined;
  const { modalSize } = await inquirer.prompt([
    {
      type: 'list',
      name: 'modalSize',
      message: messages.APP_CREATE_UI_MODAL_SIZE_PROMPT,
      // The default is pre-selected rather than listed first, so the choices stay in size
      // order and a bare Enter still lands on the platform's own default.
      default: DEFAULT_MODAL_SIZE,
      choices: indentChoices([
        { name: messages.APP_CREATE_UI_MODAL_SIZE_SMALL, value: 'small' },
        { name: messages.APP_CREATE_UI_MODAL_SIZE_MEDIUM, value: 'medium' },
        { name: messages.APP_CREATE_UI_MODAL_SIZE_LARGE, value: DEFAULT_MODAL_SIZE },
      ]),
    },
  ]);
  return modalSize === 'small' || modalSize === 'medium' ? modalSize : DEFAULT_MODAL_SIZE;
}

/**
 * Ask how tall an inline iframe card should be, pre-filled with the slot's own default.
 *
 * Asked for `layout === 'inline'` and nothing else, which is the narrowest gate of the
 * three presentation questions and deliberately so: an inline card IS the embedded page,
 * so its height is the one piece of card geometry the slot cannot decide on the partner's
 * behalf. A modal is sized by `modal_size`, an action slot renders no card at all, and a
 * Link's card shows a CTA rather than a page — in every one of those the registry's
 * `default_size` is the whole answer, and asking would be a question with no better one.
 *
 * `undefined` means "no answer to apply", from a skipped question or a blank one, and the
 * entry then carries the registry seed exactly as it did before this question existed.
 * That is why blank is valid rather than re-prompted: the seed is a real answer — the
 * platform's — so an Enter through this question is not an omission.
 */
async function promptInlineCardHeight(
  isIframe: boolean,
  layout: 'inline' | 'modal' | undefined,
  rows: UsableSurfacePoint[],
): Promise<string | undefined> {
  if (!isIframe || layout !== 'inline') return undefined;
  const { cardHeight } = await inquirer.prompt([
    {
      type: 'input',
      name: 'cardHeight',
      message: messages.APP_CREATE_UI_CARD_HEIGHT_PROMPT,
      // Pre-filled from the registry rather than from a constant here: the slot owns its
      // default, and a local one could only lag it. A row that declares none shows no
      // pre-fill — the prompt's own example carries the grammar in that case.
      default: seededCardHeight(rows),
      validate: validateUiAppCardHeight,
    },
  ]);
  return String(cardHeight ?? '').trim() || undefined;
}

/**
 * The card height to pre-fill: the first selected row's registry default, when it is one
 * this flow's own validator accepts.
 *
 * Checked rather than trusted, for the reason `sanitizeSeededSize` exists further down —
 * a server predating the field, or echoing an unexpected shape, must degrade to "no
 * pre-fill" rather than seat a value in the answer box that the prompt then refuses to
 * accept, which is a dead end a partner can only escape by retyping the field.
 *
 * Reads the rows as a list although the flow selects exactly one placement: the prompt is
 * asked once for the whole answer, so a future multi-placement flow would want the first
 * usable default rather than an arbitrary row's.
 */
function seededCardHeight(rows: UsableSurfacePoint[]): string | undefined {
  for (const row of rows) {
    const height =
      typeof row.default_size?.height === 'string' ? row.default_size.height.trim() : '';
    if (height && validateUiAppCardHeight(height) === true) return height;
  }
  return undefined;
}

/**
 * Apply an answered inline card height to a row's seeded size.
 *
 * Height only, and by merge rather than replacement: the question asked about one axis, so
 * a `width` the registry declared for the slot is not the partner's to have silently
 * dropped by answering a different question. No answer leaves the seed exactly as served.
 */
function withCardHeight(
  seeded: { width?: string; height?: string } | undefined,
  cardHeight: string | undefined,
): { width?: string; height?: string } | undefined {
  if (!cardHeight) return seeded;
  return { ...seeded, height: cardHeight };
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
 *
 * `sizeFor` seeds each entry's `size` from ITS row (the registry default, BEX-461), the
 * same per-row contract as `contextFor`; a row with no default writes no `size` key, so
 * the host's own fallback keeps applying, exactly as before the seed existed.
 *
 * `urlField` names which destination the answered URL is: `redirect_link` for a Link,
 * `iframe_href` for an Iframe. One field, never both — the platform refuses the
 * other type's URL on an entry, so writing both would author a block upload 400s on.
 *
 * `layout` and `modal_size` are written whenever they APPLY to the entry, default answers
 * included — an authored `layout: "modal"` / `modal_size: "large"` states the presentation
 * in the file instead of leaving a reader to know what an absent key means. `undefined` is
 * reserved for "does not apply": no `layout` on a row that renders no card, no `modal_size`
 * on an entry that opens no modal. A `layout` handed in for a row that renders no card is
 * REFUSED here rather than stamped: see the check in the loop.
 */
interface SurfacePointEntryFields {
  contextFor: (row: UsableSurfacePoint) => string[];
  sizeFor: (row: UsableSurfacePoint) => { width?: string; height?: string } | undefined;
  label: string;
  more_info: string;
  urlField: 'redirect_link' | 'iframe_href';
  url: string;
  /** Written as answered. Absent only when the field does not apply: a Link, or a row that
   * renders no card and therefore takes no layout at all. */
  layout?: 'inline' | 'modal';
  /** Written as answered, `'large'` included. Absent only when the field does not apply: a
   * Link, or an entry whose `layout` is `'inline'` and so opens no modal to size. */
  modal_size?: 'small' | 'medium' | 'large';
}

export function buildSurfacePointList(
  rows: UsableSurfacePoint[],
  fields: SurfacePointEntryFields,
): SurfacePointEntry[] {
  const entries: SurfacePointEntry[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.surface_point_name)) continue;
    seen.add(row.surface_point_name);
    // A layout only means something on a slot that renders a card. The prompt above never
    // asks for one on any other slot, so this cannot fire from the interactive flow — but
    // the builder is what actually stamps the field, and it stamps whatever row it is
    // handed. Left unchecked, a caller that resolved its rows differently (the
    // non-interactive routes, a future flow) would author a block the upload endpoint
    // rejects, and the partner would meet the rule one round trip later, phrased by the
    // server. Named per entry, in the same shape `validateUiApp` uses.
    if (fields.layout && row.component_type !== 'widget') {
      throw new CliError(messages.APP_CREATE_UI_LAYOUT_NOT_WIDGET(row.surface_point_name));
    }
    entries.push(toSurfacePointEntry(row, fields));
  }
  return entries;
}

/**
 * One row's entry. Split out of the loop above so the loop reads as what it decides —
 * which rows get an entry at all — while the omit-when-blank rules that decide the
 * entry's SHAPE sit together in one place.
 */
function toSurfacePointEntry(
  row: UsableSurfacePoint,
  fields: SurfacePointEntryFields,
): SurfacePointEntry {
  const context = fields
    .contextFor(row)
    .map((field) => String(field).trim())
    .filter(Boolean);
  const size = sanitizeSeededSize(fields.sizeFor(row));
  return {
    surface_point_name: row.surface_point_name,
    ...(context.length ? { context } : {}),
    ...(size ? { size } : {}),
    label: fields.label,
    ...(fields.more_info ? { more_info: fields.more_info } : {}),
    ...(fields.layout ? { layout: fields.layout } : {}),
    ...(fields.modal_size ? { modal_size: fields.modal_size } : {}),
    [fields.urlField]: fields.url,
  };
}

/**
 * Reduce a registry-served default size to the axes worth writing: the ones that are
 * actually authorable, and no `size` key at all when nothing survives. Belt and braces —
 * the registry's own CHECK pins the grammar at seed time — but a server predating the
 * field, or one echoing an unexpected shape, must degrade to "no seed" rather than write a
 * key `validateUiApp` then refuses in the very flow that authored it.
 *
 * Judged by the authored-size grammar itself (`validateUiAppSizeAxis`), not by
 * non-blankness: a `"100"` with no unit is exactly the kind of near-miss a stale seed
 * produces, and dropping only blanks let it through to the validator two lines later. An
 * answered card height never reaches here needing this — the prompt refuses a bad one at
 * the terminal — so this is the seed path's own guard.
 */
function sanitizeSeededSize(
  raw: { width?: string; height?: string } | undefined,
): { width?: string; height?: string } | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const axis = (name: 'width' | 'height'): string => {
    const value = typeof raw[name] === 'string' ? raw[name].trim() : '';
    return value && validateUiAppSizeAxis(name, value) === true ? value : '';
  };
  const width = axis('width');
  const height = axis('height');
  if (!width && !height) return undefined;
  return { ...(width ? { width } : {}), ...(height ? { height } : {}) };
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
 * Built from the FIRST placement that declares both a context and its own destination —
 * `redirect_link` or `iframe_href`, whichever the entry's type carries (the two live
 * on the same entry since BEX-426): entries can differ, but one example makes the point
 * without turning the box into a list. Nothing is printed when no placement declares a
 * context — the entry's plain destination line above already says everything there is to
 * say in that case. Context reaches an iframe's URL the same way it reaches a redirect:
 * as query parameters, appended by the kit's one URL builder.
 */
function renderExampleContextUrlLines(uiApp: UiApp): string[] {
  const withContext = uiApp.surface_point_list.find(
    (entry) => entry.context?.length && (entry.redirect_link || entry.iframe_href),
  );
  if (!withContext) return [];
  const example = buildExampleContextUrl(
    (withContext.redirect_link ?? withContext.iframe_href)!,
    withContext.context ?? [],
  );
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
