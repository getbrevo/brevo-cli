import * as fs from 'node:fs';
import * as path from 'node:path';
import inquirer from 'inquirer';
import { CLI, DEFAULT_PORT, DEFAULT_REDIRECT_URI, DEFAULT_SCOPES } from '../../lib/constants';
import { findAvailablePort } from '../../lib/port';
import { logInfo, logError, logWarn } from '../../lib/logger';
import { messages } from '../../lang/en';
import { ApiError, AuthExpiredError, CliError, ErrorCode } from '../../lib/errors';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { validateEnum, validateAppName, validateYesNo } from '../../lib/validators';
import { assertFeatureAvailable, isFeatureAvailable } from '../../lib/preview';
import { printBox, createSpinner, indentChoices } from '../../lib/ui';
import {
  saveAppCredentials,
  saveAppName,
  hasLocalApp,
  isAuthenticated,
  readProjectConfig,
} from '../../lib/config';
// Cyclic on paper — `login.ts` imports `createCommand` to offer an app after a
// successful login. Safe in practice and by construction: neither import is
// touched at module-init time, only from inside an async handler, so the
// binding is always resolved by the time it is read.
import { loginCommand } from '../login';
// The project writer, not the `scaffold` COMMAND. `create` has never depended on that
// command — only on the file-writing half it used to be bundled with, which is now its
// own module. `scaffold.ts` imports the same functions; the two commands don't meet.
import {
  computeSlug,
  fetchAppContext,
  runBaseScaffold,
  resolveProjectDirectory,
  applyProjectDirectory,
  reportBaseScaffoldSuccess,
  computeCdHint,
} from './project-writer';
import { finishProject } from './finish-project';
import { appService } from '../../container';

import { CreateAppResponse, OAuthApp, UiApp } from '../../types';
// The UI-app half of this flow (registry reads, placement prompts, the summary box) lives
// beside its app type — see `src/app-types/contract.ts` for why authoring hangs off the
// module folder rather than off the type descriptor. Only these two entry points are public.
import { resolveUiApp, renderCreatedUiApp } from '../../app-types/ui/authoring';

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

// 4. App type — OAuth integration vs UI app (BEX-290).
//    Asked last of the four opening questions: name, logo and distribution all
//    describe the app record itself and are asked of every app, so they come first.
//    The type is the branch point — it decides which of the two remaining prompt
//    paths runs (OAuth callback URLs vs UI-app placement) — so it is the last thing
//    asked before the flow splits.
//
//    Prompt-only, deliberately: there is no `--type` flag, so a UI app can only
//    be authored from an interactive terminal. UI apps aren't live on the
//    platform yet, and a scriptable create surface would invite pipelines to pin
//    to a shape that can still change. Any non-interactive run — piped stdin or
//    `--json` — creates an OAuth app, exactly as it did before BEX-290, so
//    existing scripted `app create` calls are unaffected.
export type AppType = 'oauth' | 'ui';

async function resolveAppType(interactive: boolean): Promise<AppType> {
  // A UI app is only reachable through this prompt (there is no `--type` flag), so a
  // non-interactive run has nothing to resolve and creates an OAuth app, exactly as it
  // did before BEX-290.
  if (!interactive) {
    return 'oauth';
  }
  // The question is always asked; only the *choices* are gated. A build that offers one
  // app type still names it, so the flow reads the same everywhere and the user is told
  // what they are getting rather than having it applied silently.
  //
  // ELIMINATION SITE — the raw global, not `isFeatureAvailable('ui-app-type')` alone.
  // esbuild cannot fold a function call, so the helper by itself would leave this branch
  // live and keep `messages.APP_CREATE_APP_TYPE_UI` reachable. `isFeatureAvailable` is
  // still consulted, so flipping `FEATURE_STAGE` to `'ga'` releases the choice without
  // touching this line. The elimination that actually matters — the whole UI-authoring
  // layer (registry reads, placement prompts, the summary box) — hangs off the
  // `resolveUiApp` call site, which is guarded by the same global.
  const choices: Array<{ name: string; value: AppType }> = [
    { name: messages.APP_CREATE_APP_TYPE_OAUTH, value: 'oauth' },
  ];
  if (__BREVO_PREVIEW__ && isFeatureAvailable('ui-app-type')) {
    choices.push({ name: messages.APP_CREATE_APP_TYPE_UI, value: 'ui' });
  }
  const answer = await inquirer.prompt([
    {
      type: 'list',
      name: 'appType',
      message: messages.APP_CREATE_APP_TYPE_PROMPT,
      choices: indentChoices(choices),
    },
  ]);
  return answer.appType as AppType;
}

// 0b. Validate `--distribution` before anything is asked.
//
//     Hoisted out of `resolveDistribution` because that now runs *after* the logo
//     prompt: a flag the CLI is going to reject must be rejected before the user is
//     made to answer questions, otherwise `--distribution typo` costs a logo prompt
//     first. Pure — no I/O, no prompts — so it is safe this early.
//
//     Public distribution is pre-GA (BEX-405). The flag keeps validating against the
//     full set so `--distribution public` still fails as an *unreleased feature* rather
//     than as an unknown value — the second would be a lie, and would send the user
//     looking for a typo. `validateEnum` runs first so a genuine typo still gets the
//     "invalid value" error it deserves.
function assertDistributionFlag(distributionFlag: string | undefined): void {
  const VALID_DISTRIBUTIONS = ['private', 'public'] as const;
  validateEnum(distributionFlag, VALID_DISTRIBUTIONS, '--distribution');
  if (distributionFlag === 'public') {
    assertFeatureAvailable('public-distribution');
  }
}

// 3. Distribution type — the flag is already validated by `assertDistributionFlag`.
async function resolveDistribution(
  distributionFlag: string | undefined,
  interactive: boolean,
): Promise<string> {
  if (distributionFlag) {
    return distributionFlag;
  }
  // Load-bearing, not a tidy-up: this used to be covered by the feature check below
  // returning early, so removing that check without this one would put a prompt in
  // front of every `--json` / piped run and hang CI on a question it cannot answer.
  if (!interactive) {
    return 'private';
  }
  // Same shape as the app-type prompt: the question is always asked, only the choices
  // are gated. See the ELIMINATION SITE note there for why the raw global appears
  // alongside `isFeatureAvailable`.
  const choices: Array<{ name: string; value: string }> = [
    { name: 'Private  (Used exclusively by your organisation)', value: 'private' },
  ];
  if (__BREVO_PREVIEW__ && isFeatureAvailable('public-distribution')) {
    choices.push({
      name: 'Public   (Distributed to end users or marketplace listings)',
      value: 'public',
    });
  }
  const answer = await inquirer.prompt([
    {
      type: 'list',
      name: 'distribution',
      message: messages.APP_CREATE_TYPE_PROMPT,
      choices: indentChoices(choices),
    },
  ]);
  return answer.distribution;
}

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

// 5. Redirect URI(s) — already validated by collectUrls parser when passed via flag
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

// 2. Logo URL (optional) — prompt interactively when no --logo-uri flag.
//    Skipped under --json since the field is optional and --json implies scripting.
//
//    Asked up front, right after the name, and asked identically for every app
//    type: the logo belongs to the app record rather than to either prompt path,
//    so it must not sit behind the type branch where an OAuth app answers it after
//    its callback URLs and a UI app after its placements.
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

type CreateDirectoryResult =
  | { targetDir: string; mergeOnly: boolean; skipped: false; existed: boolean }
  | { targetDir: string; skipped: true };

/**
 * Decide where the project goes — prompts only, no filesystem writes.
 *
 * Deliberately free of side effects so it can run *before* the app is created
 * (abandoning a prompt must not orphan an app on the server) while the directory
 * itself is only touched *after* the create succeeds. `applyCreateDirectory` is the
 * other half; see `applyProjectDirectory` in `./scaffold` for the full reasoning.
 */
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
    return { targetDir, mergeOnly: false, skipped: false, existed: false };
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
  return {
    targetDir: dir.targetDir,
    mergeOnly: dir.mergeOnly,
    skipped: false,
    existed: dir.existed,
  };
}

/** Apply a decision from `resolveCreateDirectory`. Call only after the app exists. */
function applyCreateDirectory(dir: CreateDirectoryResult, jsonMode: boolean): void {
  if (dir.skipped) return;
  applyProjectDirectory(
    {
      targetDir: dir.targetDir,
      mergeOnly: dir.mergeOnly,
      chooseAgain: false,
      existed: dir.existed,
    },
    jsonMode,
  );
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
  const isUiApp = !!inputs.uiApp;
  return {
    name: inputs.appName,
    distribution_type: inputs.distribution as 'public' | 'private',
    // OAuth fields travel inside the `auth` block, same as the upload payload
    // (unified structure). A UI app has no OAuth block at all (`auth: {}` in
    // its config) — the key is omitted entirely, not sent empty. Sending empty
    // arrays (or worse, the default localhost URI) would register OAuth state
    // the app type never uses.
    //
    // `ui_app` is what tells create the omission is deliberate. It is the
    // app-type discriminator on the wire exactly as it is in app-config.json
    // (`isUiAppConfig`), so create can apply the same branch the CLI does:
    // without it the endpoint reads a UI app as an OAuth app missing its
    // callbacks and answers `redirect_uris is required and must not be empty`.
    // `app upload` still sends the block and remains the platform's validation
    // authority for it — this is the same block under the same key, sent early
    // enough that the record is created with the right app type.
    ...(isUiApp
      ? { ui_app: inputs.uiApp }
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

/**
 * Log in again and re-send the create, rather than discarding the answers.
 *
 * A session can die between the first prompt and the POST — `app create` makes
 * no API call at all until every question is answered, so that gap is the whole
 * interactive flow. The pre-flight refresh now catches the case where the
 * session was already dead at the first prompt, and the client re-checks
 * freshness before each request; what is left for this path is a token revoked
 * (or a refresh token expired) *during* the prompts. Rare, but the old
 * behaviour — exit 1, six answers gone — was the worst possible response to it.
 *
 * Interactive callers only. Under `--json` or a pipe there is nobody to
 * complete a browser login, so the error propagates unchanged and scripts see
 * exactly the exit code they saw before.
 */
async function retryCreateAfterLogin(inputs: CreateAppInputs): Promise<CreatedApp> {
  logWarn(messages.APP_CREATE_SESSION_EXPIRED);
  const { relogin } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'relogin',
      message: messages.APP_CREATE_RELOGIN_CONFIRM,
      default: true,
    },
  ]);
  // A decline is the user choosing to stop, so it gets the plain expiry error
  // — same message and exit code as if this prompt had never been offered.
  if (!relogin) throw new AuthExpiredError();

  await loginCommand({ suppressNextSteps: true });
  if (!isAuthenticated()) throw new AuthExpiredError();

  const spinner = createSpinner('Creating app...');
  try {
    const result = await appService.createApp(buildCreatePayload(inputs));
    return { result, appName: inputs.appName };
  } finally {
    spinner.stop();
  }
}

/**
 * Recognise the platform's refusal to create a public app from the CLI (BEX-355):
 * `POST /v3/app-store/apps` answers `400 invalid_parameter` — *public apps cannot
 * be created with source "cli"; use distribution_type "private"* — for any create
 * that pairs a CLI caller with `distribution_type: "public"`. This is the API-side
 * pre-GA guard `CLAUDE.md` says belongs on the server.
 *
 * **No change to the request body can satisfy it, and the mechanism is not the
 * `User-Agent`.** The handler assigns `payload.Source = SourceCLI` before validating
 * — app-store-bo-be `http_cli_create_app.go`, and identically in
 * `http_cli_create_app_public.go` for the nested `auth`/`ui_app` contract the CLI
 * sends — deliberately *overwriting* any client-supplied value so the gate cannot be
 * bypassed by sending some other source. Dropping `source` from the body on BEX-355
 * therefore had no effect on this gate: the server puts it back.
 *
 * Deliberately a translation and not a local guard, for two reasons. First,
 * `CLAUDE.md`'s standing rule that the CLI must not mirror platform policy locally —
 * a copy can only lag. Second, and concretely: **the restriction is per-account, so
 * a local guard would be wrong rather than merely stale.** The server's `allowPublic`
 * comes from the Unleash flag `app-store-bo-be-public-apps` resolved for the calling
 * client (BEX-333) and lifts the rule for the `cli` source only, failing closed on a
 * lookup error. An account with that flag enabled creates public apps from the CLI
 * successfully, and never reaches this path.
 *
 * Narrowed to the rejection that names `distribution_type`, so an unrelated 400 on a
 * public create (a bad `logo_uri`, say) keeps the server's own text rather than being
 * relabelled as the pre-GA restriction. If the server ever rewords the sentence this
 * stops matching and the raw message surfaces again — the previous behaviour, not a
 * new failure mode.
 */
function isPublicDistributionRefusal(err: unknown, distribution: string): err is ApiError {
  return (
    err instanceof ApiError &&
    err.statusCode === 400 &&
    distribution === 'public' &&
    /distribution_type/i.test(err.message)
  );
}

// 5. Create the app
async function createAppWithRetry(
  inputs: CreateAppInputs,
  jsonMode: boolean,
  interactive: boolean,
): Promise<CreatedApp> {
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
    if (isPublicDistributionRefusal(err, inputs.distribution)) {
      throw new CliError(messages.APP_CREATE_PUBLIC_REJECTED(err.message));
    }
    if (err instanceof ApiError && err.statusCode === 409) {
      return retryCreateWithNewName(inputs);
    }
    if (err instanceof AuthExpiredError && interactive) {
      return retryCreateAfterLogin(inputs);
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
    assertDistributionFlag(options.distribution);

    const interactive = !jsonMode && !!process.stdin.isTTY;

    // The app record first — name, logo, distribution — then the app type. All three
    // identify the app and are asked of every app regardless of type; the type is the
    // branch point, and everything below it belongs to one path or the other.
    const appName = await resolveAppName(options.name);
    const logoUri = await resolveLogoUri(options.logoUri, jsonMode);
    const distribution = await resolveDistribution(options.distribution, interactive);
    const appType = await resolveAppType(interactive);

    // The two app types diverge here: OAuth apps collect callback URLs, UI apps
    // collect placement + destination. Neither path runs the other's prompts.
    let redirectUris: string[] = [];
    let uiApp: UiApp | undefined;
    // Same elimination site as `resolveAppType`: this is the only call to
    // `resolveUiApp`, so guarding it on the build global is what lets the bundler drop
    // `app-types/ui/authoring.ts`. In a public build `appType` can never be `'ui'`
    // anyway — the prompt isn't asked — so this changes nothing at runtime.
    if (__BREVO_PREVIEW__ && appType === 'ui') {
      uiApp = await resolveUiApp();
    } else {
      redirectUris = await resolveRedirectUrls(options.redirectUri, jsonMode);
    }

    const dir = await resolveCreateDirectory(appName, interactive);

    const inputs: CreateAppInputs = { appName, distribution, redirectUris, logoUri, uiApp };
    const { result, appName: finalAppName } = await createAppWithRetry(
      inputs,
      jsonMode,
      interactive,
    );

    // The app now provably exists, so it is safe to touch the filesystem. Before
    // this line a failed create left a stray directory and a moved cwd behind.
    applyCreateDirectory(dir, jsonMode);

    // Cache the credentials locally. Not because this is the only copy — `GET
    // /cli/apps/{id}` is a credential-reveal endpoint and hands back `client_secret`
    // too (verified against app-store-bo-be, 2026-08-13) — but so the scaffold and
    // `app start` can read them without a round trip.
    // Guarded because a UI app has no OAuth credentials to cache: writing the pair
    // unconditionally stored `{clientId: undefined, clientSecret: undefined}` under
    // its ID, which is a cache entry that can only mislead a later read.
    if (result.client_id && result.client_secret) {
      saveAppCredentials(result.app_id, {
        clientId: result.client_id,
        clientSecret: result.client_secret,
      });
    }
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

    // `uiApp` is always undefined in a public build, but an unguarded reference to
    // `renderCreatedUiApp` still keeps its module in the bundle — hence the global here
    // as well. Both call sites have to be guarded or neither elimination happens.
    const renderBox = (): void =>
      __BREVO_PREVIEW__ && uiApp
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

    // Pass the freshly collected `ui_app` block explicitly.
    //
    // NOT because the server lacks it — it does have it. This comment used to claim
    // the server "only learns about it on `app upload`", which was true before create
    // accepted the block and is false now: `persistCreateResultTx` writes an
    // `app_versions` row *inside the create transaction* whose snapshot carries the
    // `ui_app`, and `GET /cli/apps/{id}` serves it straight back from that snapshot
    // (`applyLatestVersionFields`). Verified against app-store-bo-be, 2026-08-13.
    //
    // It is passed because a re-read is the wrong source, not an impossible one:
    // `fetchAppContext` deliberately ignores `appDetails.ui_app` so stale or
    // unexpected server data can't reclassify an app the user just told us the type
    // of. The local answer is the authoritative one here; see that parameter's own
    // comment in `./scaffold`.
    //
    // `result` is passed as the fallback so a read-back that 404s can't destroy a
    // successful create: the app is already on the server at this point, and the
    // create response carries every field the scaffold reads off `appDetails`
    // (name, distribution_type, logo_uri, version) plus the credentials. Without
    // it, `GET /v3/app-store/apps/{id}` answering `id not found` for an ID the
    // create just issued aborted the command and left an orphan app behind.
    //
    // Widened to `OAuthApp` explicitly rather than passed raw: the create response
    // declares its OAuth fields optional (a UI app has none), while `OAuthApp` wants
    // `client_id` present and spells "no callbacks" as `null`. The empty string falls
    // through to the scaffold's own placeholder, which is what a UI app should get.
    const fallbackApp: OAuthApp = {
      ...result,
      client_id: result.client_id ?? '',
      redirect_uris: result.redirect_uris ?? null,
    };
    const ctx = await fetchAppContext(result.app_id, jsonMode, uiApp, fallbackApp);

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

    // Everything from here — the UI-app sign-off, the feature offer, the feature
    // write and its report — is the same tail `app scaffold`'s bootstrap runs, and
    // lives with it in `./project-writer`. `create` used to carry its own near-copy.
    //
    // `onConflict: 'merge'` rather than `'ask'`: the directory question was already
    // answered above, for this exact directory, before the app was created. Asking
    // again here would be the same question twice in one run.
    await finishProject({
      appId: result.app_id,
      ctx,
      targetDir: dir.targetDir,
      baseScopes: base.scopes,
      cdDir: computeCdHint(originalCwd, dir.targetDir),
      isUiApp: !!uiApp,
      // A piped run stays base-only, exactly as before: no question is asked and the
      // feature is left to a follow-up `brevo app scaffold`.
      offerFeature: interactive,
      onConflict: dir.mergeOnly ? 'merge' : 'overwrite',
    });
  },
);
