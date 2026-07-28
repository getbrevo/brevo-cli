import * as fs from 'node:fs';
import * as path from 'node:path';
import inquirer from 'inquirer';
import {
  CLI,
  DEFAULT_PORT,
  DEFAULT_REDIRECT_URI,
  DEFAULT_SCOPES,
  DEFAULT_LINK_TARGET,
  DEFAULT_UI_APP_SCOPES,
  DEFAULT_UI_APP_SURFACE,
  EXTENSION_TYPE_ACTION_LINK,
  EXTENSION_TYPE_IFRAME,
  LINK_TARGETS,
  UI_APP_SURFACE_TO_LOCATION,
  UI_APP_SURFACES,
  actionPointForLocation,
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
  validateUiAppHeading,
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
import { CreateAppResponse, UiApp } from '../../types';

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

// 2. App type — OAuth integration vs UI app (BEX-290).
//    Asked before distribution because it decides which of the two remaining
//    prompt paths runs (OAuth callback URLs vs UI-app placement).
export type AppType = 'oauth' | 'ui';

async function resolveAppType(typeFlag: string | undefined): Promise<AppType> {
  const VALID_APP_TYPES = ['oauth', 'ui'] as const;
  validateEnum(typeFlag, VALID_APP_TYPES, '--type');
  if (typeFlag) {
    return typeFlag as AppType;
  }
  // Non-TTY with no flag keeps the historical behaviour: an OAuth app. UI apps
  // are strictly opt-in so existing scripted `app create` calls are unaffected.
  if (!process.stdin.isTTY) {
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

// 3. Distribution type
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

  const redirectUrls: string[] = [];
  const { redirectUrl: firstUrl } = await inquirer.prompt([
    {
      type: 'input',
      name: 'redirectUrl',
      message: messages.APP_CREATE_REDIRECT_PROMPT,
      default: defaultRedirect,
      validate: validateRedirectUrl,
    },
  ]);
  redirectUrls.push((firstUrl as string).trim());

  while (await promptAddAnotherRedirect()) {
    const { nextUrl } = await inquirer.prompt([
      {
        type: 'input',
        name: 'nextUrl',
        message: messages.APP_CREATE_REDIRECT_PROMPT,
        validate: validateRedirectUrl,
      },
    ]);
    redirectUrls.push((nextUrl as string).trim());
  }
  return redirectUrls;
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
//     apps. Only the action link is buildable today; the other delivery paths
//     appear as disabled choices so the roadmap is visible where the decision is
//     made.
//
//     The collected block is the app-store backend's `app_versions.snapshot`
//     payload verbatim, so there is no vocabulary translation between what a
//     partner authors and what the platform renders.
interface UiAppFlags {
  /** Repeatable friendly record type(s): contact | company | deal. */
  surfaces?: string[];
  heading?: string;
  subheading?: string;
  redirectLink?: string;
  linkTarget?: string;
}

async function promptUiExtensionType(): Promise<void> {
  const { extensionType } = await inquirer.prompt([
    {
      type: 'list',
      name: 'extensionType',
      message: messages.APP_CREATE_UI_TRIGGER_PROMPT,
      choices: [
        { name: messages.APP_CREATE_UI_TRIGGER_LINK, value: EXTENSION_TYPE_ACTION_LINK },
        new inquirer.Separator(),
        {
          name: messages.APP_CREATE_UI_TRIGGER_MODAL,
          value: EXTENSION_TYPE_IFRAME,
          disabled: 'not yet supported',
        },
        {
          name: messages.APP_CREATE_UI_TRIGGER_WIDGET,
          value: 'widget',
          disabled: 'not yet supported',
        },
      ],
    },
  ]);
  // Defensive: inquirer won't return a disabled choice, but a future edit that
  // enables one before the rest of the pipeline supports it should fail loudly
  // rather than push a config the platform silently drops.
  if (extensionType !== EXTENSION_TYPE_ACTION_LINK) {
    throw new CliError(messages.APP_CREATE_UI_TRIGGER_UNSUPPORTED(String(extensionType)));
  }
}

// Map friendly `--surface` values onto action slot names. Unknown values fail
// here rather than being written and then silently dropped by the platform.
function toActionPoints(surfaces: string[]): string[] {
  const points: string[] = [];
  for (const surface of surfaces) {
    const key = String(surface).trim().toLowerCase();
    const location = UI_APP_SURFACE_TO_LOCATION[key];
    if (!location) {
      throw new CliError(
        `Invalid --surface "${surface}". Must be one of: ${UI_APP_SURFACES.join(', ')}.`,
      );
    }
    const point = actionPointForLocation(location);
    if (!points.includes(point)) points.push(point);
  }
  return points;
}

async function resolveUiApp(flags: UiAppFlags, interactive: boolean): Promise<UiApp> {
  // Two flags fully specify an action link; everything else has a default. When
  // both are present we take the flag path even on a TTY, so a scripted run
  // behaves identically whether or not a terminal is attached.
  const fullySpecifiedByFlags = !!(flags.heading && flags.redirectLink);
  const shouldPrompt = interactive && !fullySpecifiedByFlags;
  if (!shouldPrompt && !fullySpecifiedByFlags) {
    throw new CliError(messages.APP_CREATE_UI_NON_INTERACTIVE);
  }

  if (shouldPrompt) {
    await promptUiExtensionType();
  }

  // Ask a single question when prompting is appropriate, otherwise take the
  // default. Keeps the flag path and the prompt path from drifting.
  const ask = async (question: { name: string } & Record<string, unknown>, fallback: string) => {
    if (!shouldPrompt) return fallback;
    const answers = (await inquirer.prompt([question])) as Record<string, unknown>;
    const answer = answers[question.name];
    return answer == null ? fallback : String(answer);
  };

  const surfaces =
    flags.surfaces && flags.surfaces.length > 0
      ? flags.surfaces
      : shouldPrompt
        ? ((
            await inquirer.prompt([
              {
                type: 'checkbox',
                name: 'surfaces',
                message: messages.APP_CREATE_UI_SURFACE_PROMPT,
                choices: [...UI_APP_SURFACES],
                default: [DEFAULT_UI_APP_SURFACE],
                validate: (picked: unknown[]) =>
                  picked.length > 0 || messages.APP_CREATE_UI_SURFACE_REQUIRED,
              },
            ])
          ).surfaces as string[])
        : [DEFAULT_UI_APP_SURFACE];

  const heading =
    flags.heading ??
    (await ask(
      {
        type: 'input',
        name: 'heading',
        message: messages.APP_CREATE_UI_HEADING_PROMPT,
        validate: validateUiAppHeading,
      },
      '',
    ));

  const subheading =
    flags.subheading ??
    (await ask(
      {
        type: 'input',
        name: 'subheading',
        message: messages.APP_CREATE_UI_SUBHEADING_PROMPT,
      },
      '',
    ));

  const redirectLink =
    flags.redirectLink ??
    (await ask(
      {
        type: 'input',
        name: 'redirectLink',
        message: messages.APP_CREATE_UI_REDIRECT_LINK_PROMPT,
        validate: validateUiAppUrl,
      },
      '',
    ));

  const linkTarget =
    flags.linkTarget ??
    (await ask(
      {
        type: 'list',
        name: 'linkTarget',
        message: messages.APP_CREATE_UI_LINK_TARGET_PROMPT,
        choices: [...LINK_TARGETS],
        default: DEFAULT_LINK_TARGET,
      },
      DEFAULT_LINK_TARGET,
    ));

  const uiApp: UiApp = {
    extensionType: EXTENSION_TYPE_ACTION_LINK,
    surfacePointList: toActionPoints(surfaces ?? []),
    heading: String(heading).trim(),
    // Omitted rather than written empty: the kit only renders it when set, and an
    // empty string would show up as a spurious diff on every upload.
    ...(String(subheading).trim() ? { subheading: String(subheading).trim() } : {}),
    redirectLink: String(redirectLink).trim(),
    linkTarget: String(linkTarget).trim() as UiApp['linkTarget'],
  };

  // Re-run the full server-facing validation on the assembled block: the
  // per-prompt validators cover interactive input, but flag-supplied values reach
  // here unchecked.
  validateUiApp(uiApp);
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
  redirectUrls: string[];
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
    // A UI app has no OAuth callback — sending an empty array (or worse, the
    // default localhost URI) would register a redirect URL it never uses.
    ...(isUiApp ? {} : { redirect_uris: inputs.redirectUrls }),
    scopes: isUiApp ? [...DEFAULT_UI_APP_SCOPES] : [...DEFAULT_SCOPES],
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
    ...(logoUri ? [`Logo URL:       ${logoUri}`] : []),
    ...(result.version ? [`App version:    ${result.version}`] : []),
    `${messages.APP_CREATE_BOX_SCOPES_LABEL} ${[...DEFAULT_UI_APP_SCOPES].join(', ')}`,
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
    type?: string;
    distribution?: string;
    redirectUri?: string[];
    logoUri?: string;
    surfaces?: string[];
    heading?: string;
    subheading?: string;
    redirectLink?: string;
    linkTarget?: string;
    json?: boolean;
  }): Promise<void> => {
    const jsonMode = !!options.json;
    const originalCwd = process.cwd();

    guardAgainstLinkedApp();

    const appName = await resolveAppName(options.name);
    const appType = await resolveAppType(options.type);
    const distribution = await resolveDistribution(options.distribution);

    const interactive = !jsonMode && !!process.stdin.isTTY;

    // The two app types diverge here: OAuth apps collect callback URLs, UI apps
    // collect placement + destination. Neither path runs the other's prompts.
    let redirectUrls: string[] = [];
    let uiApp: UiApp | undefined;
    if (appType === 'ui') {
      uiApp = await resolveUiApp(
        {
          surfaces: options.surfaces,
          heading: options.heading,
          subheading: options.subheading,
          redirectLink: options.redirectLink,
          linkTarget: options.linkTarget,
        },
        interactive,
      );
    } else {
      redirectUrls = await resolveRedirectUrls(options.redirectUri, jsonMode);
    }

    const logoUri = await resolveLogoUri(options.logoUri, jsonMode);

    const dir = await resolveCreateDirectory(appName, interactive);

    const inputs: CreateAppInputs = { appName, distribution, redirectUrls, logoUri, uiApp };
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
