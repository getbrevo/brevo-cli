import * as fs from 'node:fs';
import * as path from 'node:path';
import inquirer from 'inquirer';
import {
  CLI,
  DEFAULT_PORT,
  DEFAULT_REDIRECT_URI,
  DEFAULT_SCOPES,
  DEFAULT_UI_APP_SURFACE,
  EXTENSION_KIND_ACTION,
  EXTENSION_KIND_WIDGET,
  EXTENSION_PLACE_LABELS,
  EXTENSION_TYPE_ACTION_LINK,
  EXTENSION_TYPE_IFRAME,
  UI_APP_SURFACE_TO_LOCATION,
} from '../../lib/constants';
import { findAvailablePort } from '../../lib/port';
import { logInfo, logError, logWarn } from '../../lib/logger';
import { messages } from '../../lang/en';
import { ApiError, CliError, ErrorCode } from '../../lib/errors';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import {
  validateEnum,
  validateAppName,
  validateUiApp,
  validateUiAppLabel,
  validateUiAppMoreInfo,
  validateUiAppUrl,
} from '../../lib/validators';
import { printBox, createSpinner } from '../../lib/ui';
import { saveAppCredentials, saveAppName, hasLocalApp, readProjectConfig } from '../../lib/config';
import {
  computeSlug,
  fetchAppContext,
  runBaseScaffold,
  runFeatureScaffold,
  resolveProjectDirectory,
  promptFeatureType,
  reportBaseScaffoldSuccess,
  reportScaffoldSuccess,
  computeCdHint,
} from './scaffold';
import { appService } from '../../container';
import { FeatureType } from '../../templates';
import { CreateAppResponse, SurfacePointEntry, SurfacePointRow, UiApp } from '../../types';

function validateHttpUrl(trimmed: string, invalidMessage: string): true | string {
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return invalidMessage;
    }
    return true;
  } catch {
    return invalidMessage;
  }
}

const validateRedirectUrl = (input: string): true | string => {
  const trimmed = input.trim();
  if (!trimmed) return messages.APP_CREATE_REDIRECT_EMPTY;
  return validateHttpUrl(trimmed, messages.APP_CREATE_REDIRECT_INVALID);
};

const validateLogoUrl = (input: string): true | string => {
  const trimmed = input.trim();
  if (!trimmed) return true;
  return validateHttpUrl(trimmed, messages.APP_CREATE_LOGO_INVALID);
};

// 0. Refuse outright if an app is already linked in this directory — no
//    confirm, no override. The user must leave the directory or run
//    `brevo app scaffold` here instead (which knows how to refresh a linked
//    project against the server).
function guardAgainstLinkedApp(): void {
  if (!hasLocalApp()) return;
  const projectConfig = readProjectConfig();
  const linkedName = projectConfig?.appName || String(projectConfig?.appId ?? '');
  throw new CliError(messages.APP_CREATE_ALREADY_LINKED(linkedName));
}

// 1. App name
async function resolveAppName(nameFlag: string | undefined): Promise<string> {
  if (nameFlag) {
    const nameCheck = validateAppName(nameFlag);
    if (nameCheck !== true) throw new CliError(nameCheck);
    return nameFlag;
  }
  const answer = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: messages.APP_CREATE_NAME_PROMPT,
      validate: validateAppName,
    },
  ]);
  return answer.name;
}

// 3. App type — OAuth integration vs UI app (BEX-290).
//    Asked after distribution: name and distribution describe the app record
//    itself, so they come first; the type then decides which of the two
//    remaining prompt paths runs (OAuth callback URLs vs UI-app placement).
//
//    Prompt-only, deliberately: there is no `--type` flag, so a UI app can only
//    be authored from an interactive terminal. UI apps aren't live on the
//    platform yet, and a scriptable create surface would invite pipelines to pin
//    to a shape that can still change. Any non-interactive run — piped stdin or
//    `--json` — creates an OAuth app, exactly as it did before BEX-290, so
//    existing scripted `app create` calls are unaffected.
export type AppType = 'oauth' | 'ui';

async function resolveAppType(interactive: boolean): Promise<AppType> {
  if (!interactive) {
    return 'oauth';
  }
  const answer = await inquirer.prompt([
    {
      type: 'list',
      name: 'appType',
      message: messages.APP_CREATE_APP_TYPE_PROMPT,
      choices: [
        { name: messages.APP_CREATE_APP_TYPE_OAUTH, value: 'oauth' },
        { name: messages.APP_CREATE_APP_TYPE_UI, value: 'ui' },
      ],
    },
  ]);
  return answer.appType as AppType;
}

// 2. Distribution type
async function resolveDistribution(distributionFlag: string | undefined): Promise<string> {
  const VALID_DISTRIBUTIONS = ['private', 'public'] as const;
  validateEnum(distributionFlag, VALID_DISTRIBUTIONS, '--distribution');
  if (distributionFlag) {
    return distributionFlag;
  }
  const answer = await inquirer.prompt([
    {
      type: 'list',
      name: 'distribution',
      message: messages.APP_CREATE_TYPE_PROMPT,
      choices: [
        {
          name: 'Private  (Used exclusively by your organisation)',
          value: 'private',
        },
        {
          name: 'Public   (Distributed to end users or marketplace listings)',
          value: 'public',
        },
      ],
    },
  ]);
  return answer.distribution;
}

const validateYesNo = (input: string): true | string => {
  const val = String(input).toLowerCase().trim();
  if (val === 'y' || val === 'yes' || val === 'n' || val === 'no' || val === '') {
    return true;
  }
  return 'Please enter y or n';
};

async function promptAddAnotherRedirect(): Promise<boolean> {
  const { anotherRaw } = await inquirer.prompt([
    {
      type: 'input',
      name: 'anotherRaw',
      message: messages.APP_CREATE_REDIRECT_ANOTHER + ' (y/N)',
      default: 'n',
      validate: validateYesNo,
    },
  ]);
  return String(anotherRaw).toLowerCase().trim().startsWith('y');
}

// Whether to scaffold a feature after creating the app. Defaults to yes —
// pressing Enter opts in.
async function promptScaffoldFeature(): Promise<boolean> {
  const { scaffoldRaw } = await inquirer.prompt([
    {
      type: 'input',
      name: 'scaffoldRaw',
      message: messages.APP_CREATE_SCAFFOLD_FEATURE_PROMPT + ' (Y/n)',
      default: 'y',
      validate: validateYesNo,
    },
  ]);
  const val = String(scaffoldRaw).toLowerCase().trim();
  return val === '' || val.startsWith('y');
}

async function promptRedirectUrls(quiet: boolean): Promise<string[]> {
  // Find an available port for the default redirect URL
  const availablePort = await findAvailablePort(DEFAULT_PORT);
  const defaultRedirect =
    availablePort == null || availablePort === DEFAULT_PORT
      ? DEFAULT_REDIRECT_URI
      : `http://localhost:${availablePort}/auth/callback`;
  if (!quiet) {
    if (availablePort == null) {
      logInfo(messages.APP_CREATE_PORT_SCAN_FAILED(DEFAULT_PORT));
    } else if (availablePort !== DEFAULT_PORT) {
      logInfo(messages.APP_CREATE_PORT_IN_USE(DEFAULT_PORT, availablePort));
    }
    logInfo(messages.APP_CREATE_REDIRECT_HINT(CLI.APP_START('oauth')));
  }

  const redirectUris: string[] = [];
  const { redirectUrl: firstUrl } = await inquirer.prompt([
    {
      type: 'input',
      name: 'redirectUrl',
      message: messages.APP_CREATE_REDIRECT_PROMPT,
      default: defaultRedirect,
      validate: validateRedirectUrl,
    },
  ]);
  redirectUris.push((firstUrl as string).trim());

  while (await promptAddAnotherRedirect()) {
    const { nextUrl } = await inquirer.prompt([
      {
        type: 'input',
        name: 'nextUrl',
        message: messages.APP_CREATE_REDIRECT_PROMPT,
        validate: validateRedirectUrl,
      },
    ]);
    redirectUris.push((nextUrl as string).trim());
  }
  return redirectUris;
}

// 3. Redirect URI(s) — already validated by collectUrls parser when passed via flag
async function resolveRedirectUrls(
  redirectUriFlag: string[] | undefined,
  quiet: boolean,
): Promise<string[]> {
  const flagUrls = redirectUriFlag ?? [];
  if (flagUrls.length > 0) {
    return flagUrls;
  }
  if (process.stdin.isTTY) {
    return promptRedirectUrls(quiet);
  }
  return [DEFAULT_REDIRECT_URI];
}

// 4. Logo URL (optional) — prompt interactively when no --logo-uri flag.
//    Skipped under --json since the field is optional and --json implies scripting.
async function resolveLogoUri(
  logoUriFlag: string | undefined,
  jsonMode: boolean,
): Promise<string | undefined> {
  if (logoUriFlag || !process.stdin.isTTY || jsonMode) {
    return logoUriFlag;
  }
  const { logoUrl } = await inquirer.prompt([
    {
      type: 'input',
      name: 'logoUrl',
      message: messages.APP_CREATE_LOGO_PROMPT,
      validate: validateLogoUrl,
    },
  ]);
  const trimmed = String(logoUrl ?? '').trim();
  return trimmed || undefined;
}

// 4b. UI-app configuration (BEX-290) — replaces the redirect-URL step for UI
//     apps. Prompt order, and why:
//
//       1. link or iframe   → sets `extension_type`. Asked FIRST because it is the
//                             decision a partner arrives with, and because it decides
//                             which single URL question is asked at the end. It does NOT
//                             filter the placement list.
//       2. record pages     → multi-select of the registry's distinct locations.
//       3. placements       → ONE prompt of real registry rows, grouped by page.
//       4. label            → menu entry text / card CTA.
//       5. more_info        → optional supporting line.
//       6. redirect link    → the destination.
//
//     Five questions, one optional, two registry loads. The old kind-then-place pair is
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

/** Reverse of UI_APP_SURFACE_TO_LOCATION, for labelling fetched locations. */
const LOCATION_TO_UI_APP_SURFACE: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(UI_APP_SURFACE_TO_LOCATION).map(([surface, location]) => [location, surface]),
);

/**
 * Friendly prompt value for a fetched location token: the known `contact` /
 * `company` / `deal` names where the mapping exists, otherwise derived by
 * stripping a trailing `Details` (`orderDetails` → `order`), raw token as the
 * last resort. Values only need to be stable within one prompt run — the wire
 * identity is always the row's `surface_point`.
 */
function surfaceValueForLocation(location: string): string {
  const known = LOCATION_TO_UI_APP_SURFACE[location];
  if (known) return known;
  const stripped = location.endsWith('Details') ? location.slice(0, -'Details'.length) : location;
  return stripped || location;
}

/**
 * A registry row whose three slot segments are guaranteed present — either served
 * decomposed (the BEX-361 contract) or backfilled from the slot name.
 */
interface UsableSurfacePoint extends SurfacePointRow {
  location_name: string;
  section_name: string;
  component_type: string;
}

/** Turn raw registry rows into offerable ones, dropping any that can't be placed. */
function toUsableRows(rows: SurfacePointRow[]): UsableSurfacePoint[] {
  const usable: UsableSurfacePoint[] = [];
  for (const row of rows) {
    const segments = row.surface_point.split('.');
    const [locationToken, placeToken, kindToken] = segments.length === 3 ? segments : ['', '', ''];
    const location = (row.location_name ?? '').trim() || locationToken;
    const section = (row.section_name ?? '').trim() || placeToken;
    const component = (row.component_type ?? '').trim() || kindToken;
    if (!location || !section || !component) continue;
    usable.push({
      ...row,
      location_name: location,
      section_name: section,
      component_type: component,
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
 * Load the whole registry, for the record-page prompt.
 *
 * Fetch-only by decision: a failure aborts UI-app creation with an actionable message
 * rather than falling back to the local mirror — offering a slot the platform doesn't
 * actually have would reproduce exactly the silent-drop failure this flow exists to
 * prevent. Unfiltered, per the BEX-361 endpoint design; the type check above is what
 * keeps un-hostable rows out of the prompts.
 */
async function fetchAllSurfacePoints(extensionType: string): Promise<UsableSurfacePoint[]> {
  const spinner = createSpinner(messages.APP_CREATE_UI_PAGES_SPINNER);
  let rows: SurfacePointRow[];
  try {
    rows = await appService.fetchSurfacePoints();
  } catch {
    throw new CliError(messages.APP_CREATE_UI_POINTS_FETCH_FAILED);
  } finally {
    spinner.stop();
  }

  const usable = toUsableRows(rows);
  if (usable.length === 0) {
    throw new CliError(messages.APP_CREATE_UI_POINTS_EMPTY);
  }
  const hostable = usable.filter((row) => rowSupportsExtensionType(row, extensionType));
  if (hostable.length === 0) {
    throw new CliError(messages.APP_CREATE_UI_POINTS_NONE_FOR_TYPE(extensionType));
  }
  return hostable;
}

/**
 * Load the placements for the pages the partner picked.
 *
 * A second, narrowed round trip — the endpoint takes `?location=<comma-separated>` — so
 * that the placement prompt reflects the registry at the moment it is shown rather than
 * whatever the first call happened to return.
 *
 * It falls back to the rows already held instead of aborting. The narrowed response is a
 * strict SUBSET of the first call's, so nothing is lost by reusing it, and dying here
 * would throw away the answer the partner just gave to a prompt they cannot be re-asked.
 * That matters more than usual while the endpoint is unbuilt: an early build may well not
 * implement the `location` filter, and a 400 on it should not be fatal.
 */
async function fetchSurfacePointsForPages(
  allRows: UsableSurfacePoint[],
  locations: readonly string[],
  extensionType: string,
): Promise<UsableSurfacePoint[]> {
  const onPickedPages = allRows.filter((row) => locations.includes(row.location_name));
  const spinner = createSpinner(messages.APP_CREATE_UI_POINTS_SPINNER);
  let rows: SurfacePointRow[];
  try {
    rows = await appService.fetchSurfacePoints(locations);
  } catch {
    return onPickedPages;
  } finally {
    spinner.stop();
  }

  const hostable = toUsableRows(rows)
    .filter((row) => locations.includes(row.location_name))
    .filter((row) => rowSupportsExtensionType(row, extensionType));
  // An empty narrowed response is also treated as "the filter didn't work" rather than
  // "these pages have no placements" — the first call already proved they do.
  return hostable.length > 0 ? hostable : onPickedPages;
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
 * Ask which record pages the app appears on, then — in ONE prompt — which placements on
 * those pages, grouped under a separator per page.
 *
 * Every choice is a real registry row and the answer maps straight back to it, so the
 * authored `surface_point` values are never string-composed client-side.
 */
async function promptSurfacePointList(
  allRows: UsableSurfacePoint[],
  extensionType: string,
): Promise<UsableSurfacePoint[]> {
  // Pages — unique locations in registry order, shown under their friendly names.
  const surfaceChoices: Array<{ name: string; value: string; location: string }> = [];
  for (const row of allRows) {
    if (!surfaceChoices.some((choice) => choice.location === row.location_name)) {
      const value = surfaceValueForLocation(row.location_name);
      surfaceChoices.push({ name: value, value, location: row.location_name });
    }
  }
  const { surfaces } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'surfaces',
      message: messages.APP_CREATE_UI_SURFACE_PROMPT,
      choices: surfaceChoices.map(({ name, value }) => ({ name, value })),
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

  const rows = await fetchSurfacePointsForPages(allRows, pickedLocations, extensionType);
  const byName = new Map(rows.map((row) => [row.surface_point, row]));

  // Placements — one flat checkbox, grouped by page with a separator heading each group.
  // Values are slot names, which are globally unique, so grouping is presentation only.
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

  const choices: unknown[] = [];
  const preselected: string[] = [];
  for (const group of grouped) {
    choices.push(new inquirer.Separator(`  ${surfaceValueForLocation(group.location)}`));
    for (const row of group.rows) {
      choices.push({ name: placementLabel(row), value: row.surface_point });
    }
    // A page offering exactly one placement gets pre-ticked rather than making the
    // partner confirm a lone box they had no alternative to.
    if (group.rows.length === 1) preselected.push(group.rows[0]!.surface_point);
  }

  const { placements } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'placements',
      message: messages.APP_CREATE_UI_PLACEMENT_PROMPT,
      choices,
      default: preselected,
      // Two rules, because one grouped prompt can fail in two ways: nothing ticked at
      // all, or — the quiet one — pages chosen whose groups were then left empty, which
      // would silently author fewer placements than the partner asked for.
      //
      // The second rule is measured against the pages that actually produced a GROUP, not
      // the pages that were picked: a rule the offered choices cannot satisfy would lock
      // the prompt. Pages with no group were warned about above.
      validate: (picked: unknown[]) => {
        const names = (picked as string[]) ?? [];
        if (names.length === 0) return messages.APP_CREATE_UI_PLACEMENT_REQUIRED;
        const covered = new Set(names.map((name) => byName.get(name)?.location_name));
        const missing = grouped
          .map((group) => group.location)
          .filter((location) => !covered.has(location));
        if (missing.length > 0) {
          return messages.APP_CREATE_UI_PLACEMENT_PAGE_MISSING(
            missing.map(surfaceValueForLocation),
          );
        }
        return true;
      },
    },
  ]);

  // Registry order, not tick order, so the authored list is deterministic and the upload
  // diff doesn't churn on a re-run that picked the same slots in a different sequence.
  const picked = new Set((placements as string[]) ?? []);
  return rows.filter((row) => picked.has(row.surface_point));
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
      choices: [
        {
          name: messages.APP_CREATE_UI_INTEGRATION_EXTERNAL_LINK,
          value: EXTENSION_TYPE_ACTION_LINK,
        },
        {
          name: messages.APP_CREATE_UI_INTEGRATION_MODAL_IFRAME,
          value: EXTENSION_TYPE_IFRAME,
          disabled: messages.APP_CREATE_UI_INTEGRATION_COMING_SOON,
        },
      ],
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
async function resolveUiApp(): Promise<UiApp> {
  // Integration type first: it is the decision a partner arrives with, and it decides
  // which registry rows can host the app at all.
  const extensionType = await promptIntegrationType();
  const registry = await fetchAllSurfacePoints(extensionType);
  const selectedRows = await promptSurfacePointList(registry, extensionType);

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
 * name and keeping registry order (which is deterministic server-side, so the upload
 * diff doesn't churn).
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
    if (seen.has(row.surface_point)) continue;
    seen.add(row.surface_point);
    const context = contextFor(row)
      .map((field) => String(field).trim())
      .filter(Boolean);
    entries.push({
      surface_point: row.surface_point,
      ...(context.length ? { context } : {}),
    });
  }
  return entries;
}

type CreateDirectoryResult =
  | { targetDir: string; mergeOnly: boolean; skipped: false }
  | { targetDir: string; skipped: true };

async function resolveCreateDirectory(
  appName: string,
  interactive: boolean,
): Promise<CreateDirectoryResult> {
  const slug = computeSlug(appName);

  if (!interactive) {
    const targetDir = path.resolve(`./${slug}`);
    if (fs.existsSync(targetDir)) {
      return { targetDir, skipped: true };
    }
    fs.mkdirSync(targetDir, { recursive: true });
    process.chdir(targetDir);
    return { targetDir, mergeOnly: false, skipped: false };
  }

  let dir = await resolveProjectDirectory(`./${slug}`);
  while (!dir.unresolved && dir.chooseAgain) {
    dir = await resolveProjectDirectory(`./${slug}`);
  }
  if (dir.unresolved) {
    // Unreachable in practice: `interactive` is only true when we're not in
    // --json/non-TTY mode, and resolveProjectDirectory only reports
    // `unresolved` when called with jsonMode=true (never the case here).
    // Fail loudly instead of silently guessing a directory if this ever
    // changes.
    throw new CliError(messages.APP_CREATE_DIR_UNRESOLVED);
  }
  return { targetDir: dir.targetDir, mergeOnly: dir.mergeOnly, skipped: false };
}

interface CreateAppInputs {
  appName: string;
  distribution: string;
  redirectUris: string[];
  logoUri?: string;
  /** Present for UI apps only; drives scope defaults and omits redirect URIs. */
  uiApp?: UiApp;
}

interface CreatedApp {
  result: CreateAppResponse;
  appName: string;
}

function buildCreatePayload(inputs: CreateAppInputs) {
  // The `ui_app` block is deliberately NOT sent here. `POST /apps` registers the
  // app record and issues credentials; the extension configuration is validated
  // and stored by `app upload`, which is the platform's single validation
  // authority for it. Create only writes it to app-config.json.
  const isUiApp = !!inputs.uiApp;
  return {
    name: inputs.appName,
    distribution_type: inputs.distribution as 'public' | 'private',
    // OAuth fields travel inside the `auth` block, same as the upload payload
    // (unified structure). A UI app has no OAuth block at all (`auth: {}` in
    // its config) — the key is omitted entirely, not sent empty. Sending empty
    // arrays (or worse, the default localhost URI) would register OAuth state
    // the app type never uses.
    ...(isUiApp
      ? {}
      : { auth: { scopes: [...DEFAULT_SCOPES], redirect_uris: inputs.redirectUris } }),
    ...(inputs.logoUri ? { logo_uri: inputs.logoUri } : {}),
  };
}

async function retryCreateWithNewName(inputs: CreateAppInputs): Promise<CreatedApp> {
  logError(messages.APP_CREATE_NAME_TAKEN);
  const retry = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: messages.APP_CREATE_NAME_PROMPT,
      validate: validateAppName,
    },
  ]);
  const retrySpinner = createSpinner('Creating app...');
  try {
    const result = await appService.createApp(
      buildCreatePayload({ ...inputs, appName: retry.name }),
    );
    retrySpinner.stop();
    // Use the retried name for cache, JSON output, display, and scaffold prompt
    return { result, appName: retry.name };
  } catch (retryErr) {
    retrySpinner.stop();
    throw retryErr;
  }
}

// 5. Create the app
async function createAppWithRetry(inputs: CreateAppInputs, jsonMode: boolean): Promise<CreatedApp> {
  const spinner = createSpinner('Creating app...', { silent: jsonMode });
  try {
    const result = await appService.createApp(buildCreatePayload(inputs));
    spinner.stop();
    return { result, appName: inputs.appName };
  } catch (err) {
    spinner.stop();
    if (err instanceof ApiError && err.errorCode === ErrorCode.APP_LIMIT_REACHED) {
      if (jsonMode) {
        jsonOutput({ error: 'APP_LIMIT_REACHED', message: messages.APP_CREATE_LIMIT_REACHED });
      }
      throw new CliError(messages.APP_CREATE_LIMIT_REACHED);
    }
    if (err instanceof ApiError && err.statusCode === 409) {
      return retryCreateWithNewName(inputs);
    }
    throw err;
  }
}

function renderCreatedApp(result: CreateAppResponse, appName: string, logoUri?: string): void {
  const boxLines = [
    `App name:       ${appName}`,
    `App ID:         ${result.app_id}`,
    `Client ID:      ${result.client_id}`,
    `Client secret:  ${messages.CLIENT_SECRET_HIDDEN_HUMAN}`,
    ...(result.redirect_uris ?? []).map((uri, i) => `Redirect URL ${i + 1}: ${uri}`),
    ...(logoUri ? [`Logo URL:       ${logoUri}`] : []),
    ...(result.version ? [`App version:    ${result.version}`] : []),
    `${messages.APP_CREATE_BOX_SCOPES_LABEL} ${[...DEFAULT_SCOPES].join(', ')}`,
    '',
    messages.APP_CREATE_BOX_SCOPE_HINT,
  ];
  printBox(messages.APP_CREATE_BOX_TITLE, boxLines);
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
function renderCreatedUiApp(
  result: CreateAppResponse,
  appName: string,
  uiApp: UiApp,
  logoUri?: string,
): void {
  const boxLines = [
    `App name:       ${appName}`,
    `App ID:         ${result.app_id}`,
    `Client ID:      ${result.client_id}`,
    `Client secret:  ${messages.CLIENT_SECRET_HIDDEN_HUMAN}`,
    `Extension type: ${uiApp.extension_type}`,
    // Each placement carries its own record context, so they print together — a
    // single shared "Record context" row would hide that they can differ.
    ...uiApp.surface_point_list.map((entry, i) => {
      const context = entry.context?.length ? `  (context: ${entry.context.join(', ')})` : '';
      return `${i === 0 ? 'Placement:      ' : '                '}${entry.surface_point}${context}`;
    }),
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

export const createCommand = withCommandHandler(
  async (options: {
    name?: string;
    distribution?: string;
    redirectUri?: string[];
    logoUri?: string;
    json?: boolean;
  }): Promise<void> => {
    const jsonMode = !!options.json;
    const originalCwd = process.cwd();

    guardAgainstLinkedApp();

    const interactive = !jsonMode && !!process.stdin.isTTY;

    const appName = await resolveAppName(options.name);
    const distribution = await resolveDistribution(options.distribution);
    const appType = await resolveAppType(interactive);

    // The two app types diverge here: OAuth apps collect callback URLs, UI apps
    // collect placement + destination. Neither path runs the other's prompts.
    let redirectUris: string[] = [];
    let uiApp: UiApp | undefined;
    if (appType === 'ui') {
      uiApp = await resolveUiApp();
    } else {
      redirectUris = await resolveRedirectUrls(options.redirectUri, jsonMode);
    }

    const logoUri = await resolveLogoUri(options.logoUri, jsonMode);

    const dir = await resolveCreateDirectory(appName, interactive);

    const inputs: CreateAppInputs = { appName, distribution, redirectUris, logoUri, uiApp };
    const { result, appName: finalAppName } = await createAppWithRetry(inputs, jsonMode);

    // Store app credentials locally — client_secret may not be retrievable again
    saveAppCredentials(result.app_id, {
      clientId: result.client_id,
      clientSecret: result.client_secret,
    });
    if (finalAppName) saveAppName(result.app_id, finalAppName);

    // Shared JSON shape for both exits below. `redirectUri` is omitted for UI
    // apps rather than emitted as an empty array, so a consumer can distinguish
    // "no callbacks by design" from "callbacks not returned".
    //
    // `--json` implies non-interactive, which implies OAuth, so `appType` is
    // always `oauth` here today and the `uiApp` branch is unreachable. Both are
    // kept so the field stays meaningful to a consumer, and so this shape doesn't
    // have to be rediscovered if UI apps ever gain a non-interactive path.
    const jsonBase = {
      appId: result.app_id,
      appName: finalAppName,
      clientId: result.client_id,
      clientSecret: messages.CLIENT_SECRET_HIDDEN_JSON,
      appType,
      ...(uiApp ? { uiApp } : { redirectUri: result.redirect_uris }),
      ...(logoUri ? { logoUri } : {}),
      ...(result.version ? { version: result.version } : {}),
    };

    const renderBox = (): void =>
      uiApp
        ? renderCreatedUiApp(result, finalAppName, uiApp, logoUri)
        : renderCreatedApp(result, finalAppName, logoUri);

    if (dir.skipped) {
      if (jsonMode) {
        jsonOutput({
          ...jsonBase,
          directory: dir.targetDir,
          scaffoldSkipped: messages.APP_CREATE_JSON_SCAFFOLD_DIR_EXISTS(dir.targetDir),
        });
        return;
      }
      renderBox();
      logInfo(messages.APP_CREATE_DIR_EXISTS_SKIPPED(dir.targetDir));
      return;
    }

    // Pass the freshly collected `ui_app` block explicitly: the server doesn't
    // have it yet (it only learns about it on `app upload`), so the scaffold
    // can't read it back from `fetchAppContext`'s server response.
    const ctx = await fetchAppContext(result.app_id, jsonMode, uiApp);

    // Always write the basic project structure (app-config.json + meta files).
    const base = runBaseScaffold(result.app_id, ctx, dir.targetDir, dir.mergeOnly);

    // --json never scaffolds a feature — emit the base result as a single blob.
    if (jsonMode) {
      jsonOutput({
        ...jsonBase,
        directory: dir.targetDir,
        scaffolded: base.written,
      });
      return;
    }

    // Show the created-app box and the base files that were just written,
    // before asking about features.
    renderBox();
    reportBaseScaffoldSuccess(base);

    const cdDir = computeCdHint(originalCwd, dir.targetDir);

    // UI apps have no scaffoldable feature — an action link runs on the partner's
    // own infrastructure, so there is no local server to generate. Point at the
    // upload → deploy path instead of offering the OAuth test server.
    if (uiApp) {
      printBox(messages.APP_SCAFFOLD_NEXT_STEPS_TITLE, messages.APP_CREATE_UI_NEXT(cdDir));
      return;
    }

    // Then offer to scaffold a feature (default yes → pick a type). Only the
    // interactive prompt triggers it; a piped (non-TTY) run stays base-only.
    let feature: FeatureType | null = null;
    if (interactive && (await promptScaffoldFeature())) {
      feature = await promptFeatureType(true);
    }

    if (feature) {
      const feat = runFeatureScaffold(feature, result.app_id, ctx, dir.targetDir, dir.mergeOnly);
      reportScaffoldSuccess({
        written: feat.written,
        // The legacy 'all' substitution (if any) was already surfaced by
        // reportBaseScaffoldSuccess above — don't repeat it here.
        legacyAllSubstituted: false,
        scopes: base.scopes,
        files: feat.files,
        targetDir: dir.targetDir,
        cdDir,
      });
    } else {
      // Base project only — point the user at `brevo app scaffold` to add a feature.
      logInfo(messages.APP_SCAFFOLD_SCOPES_TIP);
      printBox(messages.APP_SCAFFOLD_NEXT_STEPS_TITLE, messages.APP_CREATE_BASE_ONLY_NEXT(cdDir));
    }
  },
);
