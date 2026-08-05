import * as fs from 'node:fs';
import * as path from 'node:path';
import inquirer from 'inquirer';
import {
  CLI,
  DEFAULT_PORT,
  DEFAULT_REDIRECT_URI,
  DEFAULT_SCOPES,
  DEFAULT_LINK_TARGET,
  DEFAULT_UI_APP_SURFACE,
  EXTENSION_KIND_ACTION,
  EXTENSION_KIND_WIDGET,
  EXTENSION_PLACE_LABELS,
  EXTENSION_TYPE_ACTION_LINK,
  EXTENSION_TYPE_IFRAME,
  UI_APP_SURFACE_TO_LOCATION,
} from '../../lib/constants';
import { findAvailablePort } from '../../lib/port';
import { logInfo, logError } from '../../lib/logger';
import { messages } from '../../lang/en';
import { ApiError, CliError, ErrorCode } from '../../lib/errors';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import {
  validateEnum,
  validateAppName,
  validateUiApp,
  validateUiAppContext,
  validateUiAppHeading,
  validateUiAppUrl,
  parseUiAppContext,
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
import { CreateAppResponse, SurfacePointRow, UiApp } from '../../types';

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
//     apps. Placement choices are read from the platform's extension-point
//     registry at prompt time (BEX-361) — fetch-only, with NO local-mirror
//     fallback, so a partner can never author a slot the platform doesn't
//     have. Only `actionLink` is selectable at the integration-type prompt:
//     the 2026-08-03 decision keeps `iframeExtension` un-authorable until the
//     iframe-embed RFC lands, but it now shows as a disabled "coming soon"
//     choice rather than being hidden (the platform's upload endpoint still
//     accepts a hand-edited block — see validateUiApp).
//
//     The collected block is the app snapshot the platform stores, verbatim, so
//     there is no vocabulary translation between what a partner authors and what
//     the platform renders.

/** Reverse of UI_APP_SURFACE_TO_LOCATION, for labelling fetched locations. */
const LOCATION_TO_UI_APP_SURFACE: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(UI_APP_SURFACE_TO_LOCATION).map(([surface, location]) => [location, surface]),
);

/**
 * Friendly prompt value for a fetched location token: the known `contact` /
 * `company` / `deal` names where the mapping exists, otherwise derived by
 * stripping a trailing `Details` (`orderDetails` → `order`), raw token as the
 * last resort. Values only need to be stable within one prompt run — the wire
 * identity is always the row's `extension_point`.
 */
function surfaceValueForLocation(location: string): string {
  const known = LOCATION_TO_UI_APP_SURFACE[location];
  if (known) return known;
  const stripped = location.endsWith('Details') ? location.slice(0, -'Details'.length) : location;
  return stripped || location;
}

/**
 * A registry row whose location/place/kind are guaranteed present — either
 * parsed server-side (the BEX-361 contract) or backfilled from the slot name.
 */
interface UsableSurfacePoint extends SurfacePointRow {
  location: string;
  place: string;
  kind: string;
}

/**
 * Fetch the extension-point registry rows an actionLink can mount on.
 *
 * Fetch-only by decision: a failure aborts UI-app creation with an actionable
 * message rather than falling back to the local mirror — offering a slot the
 * platform doesn't actually have would reproduce exactly the silent-drop
 * failure this flow exists to prevent. Rows the server didn't parse are
 * backfilled from the `<location>.<place>.<kind>` name; rows that still lack a
 * segment are dropped (not offerable).
 */
async function fetchSurfacePointRegistry(): Promise<UsableSurfacePoint[]> {
  const spinner = createSpinner(messages.APP_CREATE_UI_POINTS_SPINNER);
  let rows: SurfacePointRow[];
  try {
    rows = await appService.fetchSurfacePoints(EXTENSION_TYPE_ACTION_LINK);
  } catch {
    throw new CliError(messages.APP_CREATE_UI_POINTS_FETCH_FAILED);
  } finally {
    spinner.stop();
  }

  const usable: UsableSurfacePoint[] = [];
  for (const row of rows) {
    const segments = row.extension_point.split('.');
    const [locationToken, placeToken, kindToken] = segments.length === 3 ? segments : ['', '', ''];
    const location = (row.location ?? '').trim() || locationToken;
    const place = (row.place ?? '').trim() || placeToken;
    const kind = (row.kind ?? '').trim() || kindToken;
    if (!location || !place || !kind) continue;
    usable.push({ ...row, location, place, kind });
  }
  if (usable.length === 0) {
    throw new CliError(messages.APP_CREATE_UI_POINTS_EMPTY);
  }
  return usable;
}

interface SurfacePointSelection {
  surfacePointList: string[];
  /** The selected registry rows — carried so the context prompt can offer their allow-lists. */
  selectedRows: UsableSurfacePoint[];
}

/**
 * Ask which record pages the app appears on, then whether it is a menu entry or a card,
 * then which positions — every choice built from the fetched registry rows, and the
 * selection mapping back to the rows themselves so `surfacePointList` is always a set of
 * real `extension_point` names (nothing is string-composed client-side).
 *
 * Kind is asked before place, and asked as a single choice, because it decides which
 * places exist — same UX shape as before BEX-361, only the data source changed.
 */
async function promptSurfacePointList(
  registry: UsableSurfacePoint[],
): Promise<SurfacePointSelection> {
  // Pages — unique locations in registry order, shown under their friendly names.
  const surfaceChoices: Array<{ name: string; value: string; location: string }> = [];
  for (const row of registry) {
    if (!surfaceChoices.some((choice) => choice.location === row.location)) {
      const value = surfaceValueForLocation(row.location);
      surfaceChoices.push({ name: value, value, location: row.location });
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
  const pickedLocations = new Set(
    surfaceChoices
      .filter((choice) => pickedSurfaces.includes(choice.value))
      .map((choice) => choice.location),
  );
  const onPickedPages = registry.filter((row) => pickedLocations.has(row.location));

  // Kind — unique kinds available on the picked pages, `action` first to match
  // the historical ordering. Unknown kinds are offered under their raw token:
  // they exist in the registry, so they are authorable.
  const kinds = [...new Set(onPickedPages.map((row) => row.kind))].sort((a, b) => {
    if (a === EXTENSION_KIND_ACTION) return -1;
    if (b === EXTENSION_KIND_ACTION) return 1;
    return 0;
  });
  const kindLabel = (kind: string): string => {
    if (kind === EXTENSION_KIND_ACTION) return messages.APP_CREATE_UI_KIND_ACTION;
    if (kind === EXTENSION_KIND_WIDGET) return messages.APP_CREATE_UI_KIND_WIDGET;
    return kind;
  };
  const { kind } = await inquirer.prompt([
    {
      type: 'list',
      name: 'kind',
      message: messages.APP_CREATE_UI_KIND_PROMPT,
      choices: kinds.map((value) => ({ name: kindLabel(value), value })),
    },
  ]);

  // Positions — the matching rows' places, labelled by the registry's own
  // surface_point_name when it carries one, falling back to the local label
  // mirror, then the raw token.
  const matchingKind = onPickedPages.filter((row) => row.kind === String(kind));
  const placeChoices: Array<{ name: string; value: string }> = [];
  for (const row of matchingKind) {
    if (!placeChoices.some((choice) => choice.value === row.place)) {
      placeChoices.push({
        name: row.surface_point_name?.trim() || EXTENSION_PLACE_LABELS[row.place] || row.place,
        value: row.place,
      });
    }
  }
  const { places } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'places',
      message: messages.APP_CREATE_UI_PLACE_PROMPT,
      choices: placeChoices,
      // A single available position gets pre-selected rather than making the
      // partner tick a lone box.
      default: placeChoices.length === 1 ? [placeChoices[0]!.value] : [],
      validate: (picked: unknown[]) => picked.length > 0 || messages.APP_CREATE_UI_PLACE_REQUIRED,
    },
  ]);
  const pickedPlaces = new Set((places as string[]) ?? []);

  const selectedRows = matchingKind.filter((row) => pickedPlaces.has(row.place));
  const surfacePointList = [...new Set(selectedRows.map((row) => row.extension_point))];
  return { surfacePointList, selectedRows };
}

/**
 * Ask how the app opens. Only External link (`actionLink`) is selectable —
 * Modal iframe is rendered as a disabled "coming soon" choice so partners see
 * the roadmap without being able to author a block the kit can't serve yet.
 */
async function promptIntegrationType(): Promise<UiApp['extensionType']> {
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
  return integrationType as UiApp['extensionType'];
}

/**
 * Ask for the record-context fields the app wants forwarded to it.
 *
 * Choices are the union of the selected placements' `allowed_context_field`
 * allow-lists (BEX-361) — a checkbox, so a partner can only request fields at
 * least one chosen slot can forward. Selecting nothing means "no narrowing",
 * the behaviour every app had before narrowing existed. Free text remains only
 * for the case where no selected row declares an allow-list (e.g. a registry
 * seeded before BEX-349) — there, the server refuses unknown names at upload,
 * where the 400 enumerates what is allowed.
 */
async function promptUiAppContext(selectedRows: UsableSurfacePoint[]): Promise<string[]> {
  const union: string[] = [];
  for (const row of selectedRows) {
    for (const field of row.allowed_context_field ?? []) {
      const trimmed = String(field ?? '').trim();
      if (trimmed && !union.includes(trimmed)) union.push(trimmed);
    }
  }

  if (union.length > 0) {
    const { context } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'context',
        message: messages.APP_CREATE_UI_CONTEXT_CHECKBOX_PROMPT,
        choices: union,
      },
    ]);
    return ((context as string[]) ?? []).map((field) => String(field).trim()).filter(Boolean);
  }

  const { context } = await inquirer.prompt([
    {
      type: 'input',
      name: 'context',
      message: messages.APP_CREATE_UI_CONTEXT_PROMPT,
      validate: (value: string) => validateUiAppContext(parseUiAppContext(value)),
    },
  ]);
  return parseUiAppContext(String(context ?? ''));
}

/**
 * Collect the `ui_app` block interactively. Only reachable when the app-type
 * prompt returned `ui`, which already implies an interactive terminal — so every
 * field is asked for, with no flag or default fallback path. (That also means
 * the fetch spinner never needs a `silent` option: the UI path is unreachable
 * under `--json`.)
 */
async function resolveUiApp(): Promise<UiApp> {
  const registry = await fetchSurfacePointRegistry();
  const { surfacePointList, selectedRows } = await promptSurfacePointList(registry);
  const extensionType = await promptIntegrationType();

  const { heading } = await inquirer.prompt([
    {
      type: 'input',
      name: 'heading',
      message: messages.APP_CREATE_UI_HEADING_PROMPT,
      validate: validateUiAppHeading,
    },
  ]);

  const { subheading } = await inquirer.prompt([
    {
      type: 'input',
      name: 'subheading',
      message: messages.APP_CREATE_UI_SUBHEADING_PROMPT,
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

  const context = await promptUiAppContext(selectedRows);

  const uiApp: UiApp = {
    extensionType,
    surfacePointList,
    heading: String(heading ?? '').trim(),
    // Omitted rather than written empty: the kit only renders it when set, and an
    // empty string would show up as a spurious diff on every upload.
    ...(String(subheading ?? '').trim() ? { subheading: String(subheading).trim() } : {}),
    // linkTarget is written explicitly, and only as _blank: the server refuses
    // _self today, so there is nothing to prompt for.
    redirectLink: String(url ?? '').trim(),
    linkTarget: DEFAULT_LINK_TARGET as UiApp['linkTarget'],
    ...(context.length ? { context } : {}),
  };

  // Belt and braces: the per-prompt validators cover each answer in isolation,
  // but nothing else checks the assembled block. Validated against the FETCHED
  // registry, not the local mirror — the prompts offered fetched points, so a
  // mirror that lags the platform must not fail a selection the platform has.
  validateUiApp(
    uiApp,
    registry.map((row) => row.extension_point),
  );
  return uiApp;
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
    // A UI app has no OAuth block at all (`auth: { "type": "none" }` in its
    // config) — the scopes and redirect_uris keys are omitted entirely, not
    // sent empty. Sending an empty array (or worse, the default localhost URI)
    // would register OAuth state the app type never uses.
    ...(isUiApp ? {} : { redirect_uris: inputs.redirectUris, scopes: [...DEFAULT_SCOPES] }),
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
    `Extension type: ${uiApp.extensionType}`,
    ...uiApp.surfacePointList.map(
      (point, i) => `${i === 0 ? 'Extension point:' : '                '} ${point}`,
    ),
    `Heading:        ${uiApp.heading ?? ''}`,
    ...(uiApp.subheading ? [`Subheading:     ${uiApp.subheading}`] : []),
    `Redirect link:  ${uiApp.redirectLink ?? ''}`,
    `Link target:    ${uiApp.linkTarget ?? DEFAULT_LINK_TARGET}`,
    // Only shown when narrowed. Absent means "whatever each location allows", which is
    // not something to render as a blank field.
    ...(uiApp.context?.length ? [`Record context: ${uiApp.context.join(', ')}`] : []),
    ...(logoUri ? [`Logo URL:       ${logoUri}`] : []),
    ...(result.version ? [`App version:    ${result.version}`] : []),
    '',
    // The menu entry is labelled with the app name, not a per-action label —
    // worth stating, since it's the one place a partner might expect a field.
    messages.APP_CREATE_UI_BOX_LABEL_NOTE(appName),
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
