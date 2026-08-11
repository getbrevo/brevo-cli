import * as fs from 'node:fs';
import * as path from 'node:path';
import inquirer from 'inquirer';
import { logSuccess, logInfo } from '../../lib/logger';
import { messages } from '../../lang/en';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { CliError } from '../../lib/errors';
import { appService } from '../../container';
import { createSpinner } from '../../lib/ui';
import {
  readProjectConfig,
  writeProjectConfig,
  saveAppName,
  isUiAppConfig,
  ProjectConfig,
} from '../../lib/config';
import { validateScopes, containsLegacyAllScope } from '../../lib/validators';
import { DEFAULT_LINK_TARGET, EXTENSION_TYPE_ACTION_LINK } from '../../lib/constants';
import { OAuthApp, UiApp, UploadAppResponse } from '../../types';
import { appTypeById, resolveFromConfig } from '../../app-types';
import { formatPlacementLines } from '../../app-types/ui/fields';

interface UploadOptions {
  yes?: boolean;
  json?: boolean;
}

const NON_INTERACTIVE_CONFIRM_ERROR =
  'Cannot prompt for confirmation in non-interactive mode. Use --yes or --json to skip.';

// Reads + validates app-config.json from cwd. Always hard-errors on any
// problem — upload has no --app-id flag to fall back to, so an unusable
// config is fatal, not a "skip this part" condition like in the old update.ts.
function loadUsableConfig(): NonNullable<ReturnType<typeof readProjectConfig>> {
  const configPath = path.resolve(process.cwd(), 'app-config.json');
  if (!fs.existsSync(configPath)) {
    throw new CliError(messages.APP_UPLOAD_NO_CONFIG);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    throw new CliError(messages.APP_UPLOAD_INVALID_JSON);
  }
  if (
    !raw ||
    typeof raw !== 'object' ||
    !('appId' in raw) ||
    !(raw as Record<string, unknown>).appId
  ) {
    throw new CliError(messages.APP_UPLOAD_MISSING_APP_ID);
  }
  const config = readProjectConfig();
  if (!config) {
    throw new CliError(messages.APP_UPLOAD_MISSING_APP_ID);
  }
  return config;
}

function validateRedirectUrls(urls: string[]): void {
  for (const url of urls) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new CliError(messages.APP_UPLOAD_INVALID_REDIRECT_PROTOCOL(url));
      }
    } catch (err) {
      if (err instanceof CliError) throw err;
      throw new CliError(messages.APP_UPLOAD_INVALID_REDIRECT_URL(url));
    }
  }
}

async function fetchExistingApp(appId: string, silent: boolean | undefined): Promise<OAuthApp> {
  const spinner = createSpinner('Fetching app...', { silent });
  let app: OAuthApp | null;
  try {
    app = await appService.fetchApp(appId);
  } finally {
    spinner.stop();
  }
  if (!app) {
    throw new CliError(`App ${appId} not found.`);
  }
  return app;
}

// Diff `current` vs `next`: next values keep their order (tagged `(new)` when
// absent from current), values dropped from current trail with `(removed)`.
function diffLines(current: string[], next: string[]): string[] {
  const currentSet = new Set(current);
  const nextSet = new Set(next);
  return [
    ...next.map((v) => (currentSet.has(v) ? v : `${v} (new)`)),
    ...current.filter((v) => !nextSet.has(v)).map((v) => `${v} (removed)`),
  ];
}

function logAligned(label: string, lines: string[]): void {
  lines.forEach((line, i) => {
    logInfo(`${i === 0 ? label : '                 '}${line}`);
  });
}

interface UploadDiff {
  appId: string;
  currentName?: string;
  nextName: string;
  currentUrls: string[];
  nextUrls: string[];
  currentLogoUri?: string;
  nextLogoUri: string;
  currentScopes: string[];
  nextScopes: string[];
  currentDistribution?: 'public' | 'private';
  nextDistribution: 'public' | 'private';
  currentVersion?: string;
  nextVersion: string;
  migratingLegacyScopes: boolean;
  // UI apps only (BEX-290). `currentUiApp` stays undefined on server builds that
  // accept the ui_app block on write but don't echo it back on reads — in that case
  // the block always reads as new, which is safe: re-sending an identical block is
  // idempotent, whereas skipping it could strand a local edit.
  currentUiApp?: UiApp;
  nextUiApp?: UiApp;
}

function buildDiff(config: NonNullable<ProjectConfig>, remote: OAuthApp): UploadDiff {
  const nextScopes = config.auth?.scopes ?? [];
  return {
    appId: config.appId,
    currentName: remote.name,
    nextName: config.appName,
    currentUrls: remote.redirect_uris ?? [],
    nextUrls: config.auth?.redirectUris ?? [],
    currentLogoUri: remote.logo_uri,
    nextLogoUri: config.logoUri ?? '',
    currentScopes: remote.scopes ?? [],
    nextScopes,
    currentDistribution: remote.distribution_type,
    nextDistribution: config.distribution_type,
    currentVersion: remote.version,
    nextVersion: config.version || remote.version || '',
    migratingLegacyScopes: containsLegacyAllScope(remote.scopes ?? []),
    currentUiApp: remote.ui_app,
    nextUiApp: config.ui_app,
  };
}

// Keys that exist on one side of the comparison only, and so can never signal a real
// local edit (BEX-290):
//
//   - `link_target` — injected into the payload by this command and defaulted by the
//     server, but deliberately absent from app-config.json. Comparing it would make the
//     block read as changed on every single upload, and "Already up to date" would never
//     print for a UI app again.
//   - `version`     — the server-managed snapshot version. Same asymmetry.
//   - `extension_point_name` — the dotted slot name the platform resolves from each entry's
//     `surface_point_name` and stamps onto its own stored copy. Nothing here authors it and
//     the server does not echo it, so it should never arrive — it is listed anyway because
//     the cost of being wrong is asymmetric: if it ever did arrive, comparing it would
//     report drift on a field the partner cannot edit, and writing it back would put a
//     value into app-config.json that the very next upload rejects as an unknown key.
//
// Unlike the two above, this one lives INSIDE each `surface_point_list` entry rather than at
// the top of the block, which is why the strip below recurses to every level.
//
// The list itself now belongs to the app type (`src/app-types/ui/index.ts` →
// `wireOnlyKeys`), so a type that gains a server-stamped field declares it beside itself
// instead of in this command. Read here through the registry rather than imported from the ui
// module directly, so this command stays type-agnostic.
const UPLOAD_INJECTED_UI_APP_KEYS: readonly string[] = appTypeById('ui').wireOnlyKeys;

/**
 * Strip the wire-only keys above from a value at every depth.
 *
 * This is the ONLY place that reads `UPLOAD_INJECTED_UI_APP_KEYS`. Both consumers — the
 * write-back (`withoutInjectedKeys`) and the diff's equality check
 * (`canonicalizeUiApp`) — go through it, so a key added to the list above cannot be
 * honoured by one and forgotten by the other. That split is not hypothetical: the diff and
 * the write-back each had their own traversal, and each had to be fixed separately when
 * `link_target` started arriving on the server's echo and again when
 * `extension_point_name` turned up one level down inside an entry.
 */
function stripInjectedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripInjectedKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !UPLOAD_INJECTED_UI_APP_KEYS.includes(key))
        .map(([k, v]) => [k, stripInjectedKeys(v)]),
    );
  }
  return value;
}

/** Recursively sort object keys, so a serialized comparison is key-order-independent. */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortKeysDeep(v)]),
    );
  }
  return value;
}

/**
 * Drop the wire-only keys above from a block, before it is written back to
 * app-config.json. They are stripped for the same reason and by the same list the diff
 * normalizes with: none is authored, they come back on (or are added around) the server's
 * echo, and writing one into the file would put a key the partner cannot usefully edit into
 * the file this command just decided to keep it out of.
 */
function withoutInjectedKeys(uiApp: UiApp): UiApp {
  return stripInjectedKeys(uiApp) as UiApp;
}

// Stable serialization for equality checks. Three things vary without the block having
// changed, and all three are normalized away here:
//
//   1. Key order in app-config.json depends on how the file was edited.
//   2. `surface_point_list` ORDER is not meaningful — the server returns registry order,
//      which need not match the order the partner picked their pages in. Without sorting,
//      an authored [deal, contact] against an echoed [contact, deal] is phantom drift.
//   3. The injected/server-managed keys above exist on one side only — stripped by
//      `stripInjectedKeys`, the single owner of that list, rather than by a filter
//      duplicated here.
function canonicalizeUiApp(uiApp: UiApp | undefined): string {
  if (!uiApp) return '';
  const normalized = sortKeysDeep(stripInjectedKeys(uiApp)) as Record<string, unknown>;
  const entries = normalized.surface_point_list;
  if (Array.isArray(entries)) {
    normalized.surface_point_list = [...entries].sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b)),
    );
  }
  return JSON.stringify(normalized);
}

function renderUploadDiff(diff: UploadDiff): void {
  logInfo('');
  logInfo(`  ${messages.APP_UPLOAD_SUMMARY}`);
  logInfo(`  App ID:        ${diff.appId}`);
  const renamePrefix =
    diff.currentName && diff.currentName !== diff.nextName ? `${diff.currentName} → ` : '';
  logInfo(`  Name:          ${renamePrefix}${diff.nextName}`);
  if (diff.currentDistribution && diff.currentDistribution !== diff.nextDistribution) {
    logInfo(`  Distribution:  ${diff.currentDistribution} → ${diff.nextDistribution}`);
  } else {
    logInfo(`  Distribution:  ${diff.nextDistribution}`);
  }
  // Only OAuth apps have callbacks — printing an empty "Redirect URLs:" row for a
  // UI app would imply something is missing.
  if (!diff.nextUiApp) {
    logAligned('  Redirect URLs: ', diffLines(diff.currentUrls, diff.nextUrls));
  }
  if (diff.migratingLegacyScopes) {
    logInfo(`  ${messages.LEGACY_ALL_SCOPE_UPDATE_MIGRATING}`);
  }
  // Scopes are OAuth-only as well — a UI app's auth is empty (`{}`),
  // so a scopes row would only ever render as noise.
  if (!diff.nextUiApp) {
    logAligned('  Scopes:        ', diffLines(diff.currentScopes, diff.nextScopes));
  }
  if (diff.currentLogoUri && diff.currentLogoUri !== diff.nextLogoUri) {
    logInfo(`  Logo URL:      ${diff.currentLogoUri} → ${diff.nextLogoUri || '(none)'}`);
  } else if (diff.nextLogoUri) {
    logInfo(`  Logo URL:      ${diff.nextLogoUri}`);
  }
  if (diff.currentVersion && diff.currentVersion !== diff.nextVersion) {
    logInfo(`  Version:       ${diff.currentVersion} → ${diff.nextVersion || '(unknown)'}`);
  } else if (diff.nextVersion) {
    logInfo(`  Version:       ${diff.nextVersion}`);
  }
  if (diff.nextUiApp) {
    renderUiAppDiff(diff.nextUiApp, diff.currentUiApp);
  }
  logInfo('');
}

// Field-by-field so the partner can see exactly what the platform will store —
// this block drives what renders inside Brevo, so a bare "changed" would be
// useless. Values that differ from the server are tagged.
function renderUiAppDiff(next: UiApp, current: UiApp | undefined): void {
  const changed = canonicalizeUiApp(next) !== canonicalizeUiApp(current);
  logInfo(`  ${messages.APP_UPLOAD_UI_APP_SUMMARY}${changed ? ' (changed)' : ''}`);
  logInfo(`    Extension type: ${next.extension_type}`);
  // Each placement prints its own context, because the two are per-entry now: a
  // partner targeting a contact page and a deal page can be forwarded different
  // fields on each, and one shared row would hide that.
  formatPlacementLines(next).forEach((line, i) => {
    logInfo(`    ${i === 0 ? 'Placement:      ' : '                '}${line}`);
  });
  logInfo(`    Label:          ${next.label ?? ''}`);
  if (next.more_info) logInfo(`    More info:      ${next.more_info}`);
  logInfo(`    Redirect link:  ${next.redirect_link ?? ''}`);
  // No link_target row: app-config.json does not carry the field, so printing a value
  // for it only sends a partner looking for one to edit. `_blank` is still injected
  // into an actionLink's payload — see the payload build.
}

function diffToJson(diff: UploadDiff) {
  return {
    current: {
      name: diff.currentName,
      redirect_uris: diff.currentUrls,
      scopes: diff.currentScopes,
      logo_uri: diff.currentLogoUri,
      distribution_type: diff.currentDistribution,
      version: diff.currentVersion,
      ...(diff.currentUiApp ? { ui_app: diff.currentUiApp } : {}),
    },
    next: {
      name: diff.nextName,
      // OAuth-only keys are omitted for UI apps — their desired state has no
      // OAuth block (auth is `{}`), and emitting empty arrays
      // would misread as "clearing the values".
      ...(diff.nextUiApp ? {} : { redirect_uris: diff.nextUrls, scopes: diff.nextScopes }),
      logo_uri: diff.nextLogoUri,
      distribution_type: diff.nextDistribution,
      version: diff.nextVersion,
      ...(diff.nextUiApp ? { ui_app: diff.nextUiApp } : {}),
    },
  };
}

function hasNoChanges(diff: UploadDiff): boolean {
  // Scopes and redirect URLs are OAuth-only: a UI app's config carries neither
  // (auth is `{}`), so comparing them against whatever the
  // server still reports would flag a phantom change on every upload.
  const isUiApp = !!diff.nextUiApp;
  const oauthUnchanged =
    isUiApp ||
    (JSON.stringify([...diff.currentUrls].sort()) === JSON.stringify([...diff.nextUrls].sort()) &&
      JSON.stringify([...diff.currentScopes].sort()) ===
        JSON.stringify([...diff.nextScopes].sort()));
  return (
    diff.currentName === diff.nextName &&
    diff.currentDistribution === diff.nextDistribution &&
    oauthUnchanged &&
    (diff.currentLogoUri || '') === (diff.nextLogoUri || '') &&
    (diff.currentVersion || '') === (diff.nextVersion || '') &&
    // Without this, editing only the `ui_app` block reports "Already up to date"
    // and the change is never pushed.
    canonicalizeUiApp(diff.currentUiApp) === canonicalizeUiApp(diff.nextUiApp)
  );
}

export interface ConfigUploadOutcome {
  confirmedVersion: string;
  finalName: string;
}

/**
 * Push the config's full desired state to the server — the single write path
 * for app state (BEX-366) — and persist the server's echo back into
 * app-config.json so the local copy always tracks the confirmed version.
 *
 * The upload contract needs the server's latest version as a staleness token;
 * when none is known (neither passed in nor stored in the config), the remote
 * app is fetched to obtain one.
 */
export async function uploadProjectConfig(
  config: NonNullable<ProjectConfig>,
  opts: { silent?: boolean; appVersion?: string } = {},
): Promise<ConfigUploadOutcome> {
  const isUiApp = isUiAppConfig(config);
  const redirectUris = config.auth?.redirectUris ?? [];
  const scopes = config.auth?.scopes ?? [];

  let appVersion = opts.appVersion ?? config.version ?? '';
  if (!appVersion) {
    appVersion = (await fetchExistingApp(config.appId, opts.silent)).version ?? '';
  }

  const spinner = createSpinner('Uploading app...', { silent: opts.silent });
  let response: UploadAppResponse;
  try {
    response = await appService.uploadApp(config.appId, {
      app_id: config.appId,
      name: config.appName,
      logo_uri: config.logoUri ?? '',
      version: appVersion,
      distribution_type: config.distribution_type,
      // UI apps have no OAuth block — the whole `auth` key is omitted, not sent
      // with empty arrays, mirroring `auth: {}` in the config.
      // ASSUMED wire contract (server side not built yet, see
      // RELEASE-CHECKLIST.md → Before UI-apps GA): the upload endpoint must
      // tolerate an absent auth key for UI apps.
      ...(isUiApp
        ? {}
        : {
            auth: {
              scopes,
              redirect_uris: redirectUris,
            },
          }),
      // Spread rather than a fixed key so OAuth uploads keep their exact
      // historical payload shape — `ui_app` is absent, not `undefined`.
      //
      // `link_target` is injected here rather than authored into app-config.json
      // (BEX-290): there was never a choice to make, since the server refuses
      // `_self`, so a field in the file only invited a partner to edit it into a
      // value that 400s. It is still sent explicitly rather than left to the
      // server's own default, which is gated on the pre-BEX-350 spelling of
      // extension_type and therefore no longer fires for CLI-authored apps.
      //
      // Only for an `actionLink`. An `iframeExtension` embeds its URL in a modal
      // instead of navigating, has no link target to set, and `validateUiApp`
      // refuses the field in the authored file — so injecting it would send the
      // one field the CLI just told the partner not to write.
      ...(isUiApp && config.ui_app
        ? {
            ui_app: {
              ...config.ui_app,
              ...(config.ui_app.extension_type === EXTENSION_TYPE_ACTION_LINK
                ? { link_target: DEFAULT_LINK_TARGET as UiApp['link_target'] }
                : {}),
            },
          }
        : {}),
    });
  } finally {
    spinner.stop();
  }

  const finalName = response.name ?? config.appName;
  if (finalName) saveAppName(config.appId, finalName);

  // Single source of truth for the version we persist AND print, so the two can
  // never diverge. The server returns the bumped value under `version` (see
  // UploadAppResponse); fall back to `app_version` for tolerance, and only then
  // to the version we sent — so a server-confirmed bump always wins.
  const confirmedVersion = response.version ?? response.app_version ?? appVersion;

  writeProjectConfig({
    ...config,
    appName: finalName,
    logoUri: response.logo_uri ?? config.logoUri,
    distribution_type: response.distribution_type ?? config.distribution_type,
    version: confirmedVersion,
    // A UI app's auth block is always written back as the canonical empty
    // `{}` — never reconciled from the server's echo, which reports null
    // scopes/redirect_uris for UI-only apps anyway.
    auth: isUiApp
      ? {}
      : {
          scopes: response.auth.scopes ?? scopes,
          redirectUris: response.auth.redirect_uris ?? redirectUris,
        },
    // Prefer the server's normalized block when it echoes one back, otherwise
    // keep what we just sent — with the wire-only keys stripped either way. The
    // server defaults `link_target` and manages the block's `version`, and
    // echoes both, so passing the echo through verbatim would write back into
    // app-config.json fields the partner never authored — undoing, on the very
    // first successful upload, the decision to keep them out of the file.
    ...(isUiApp && (response.ui_app ?? config.ui_app)
      ? { ui_app: withoutInjectedKeys((response.ui_app ?? config.ui_app)!) }
      : {}),
  });

  return { confirmedVersion, finalName };
}

// The auth block's shape follows the app type, and a mismatch is a hard error
// rather than a silent ignore. This one stays local because it is a statement about
// the local file: `auth` and `ui_app` are how `app-config.json` says which app type
// it describes, and the server never sees the contradiction — a UI app must carry
// exactly `auth: {}` (no scopes, no redirect URIs — nothing OAuth is issued for it).
function validateAuthShape(config: NonNullable<ProjectConfig>): void {
  if (!isUiAppConfig(config)) return;
  if (!config.auth) {
    throw new CliError(messages.APP_UPLOAD_UI_APP_AUTH_EMPTY_REQUIRED);
  }
  if (config.auth.scopes !== undefined || config.auth.redirectUris !== undefined) {
    throw new CliError(messages.APP_UPLOAD_UI_APP_AUTH_HAS_OAUTH_FIELDS);
  }
}

export const uploadCommand = withCommandHandler(async (options: UploadOptions): Promise<void> => {
  const config = loadUsableConfig();
  const isUiApp = isUiAppConfig(config);

  validateAuthShape(config);

  // A UI app has no OAuth callback (enforced above), so the redirect
  // requirement — and validation — is OAuth-only.
  const redirectUris = config.auth?.redirectUris ?? [];
  if (!isUiApp && redirectUris.length === 0) {
    throw new CliError(messages.APP_UPLOAD_NO_REDIRECT_URLS_OAUTH);
  }
  validateRedirectUrls(redirectUris);

  // Local pre-flight on the block's SHAPE only — a missing label, a bare-string
  // placement, a pre-BEX-290 field name — so an obviously malformed file fails with a
  // precise message before a round trip. Anything that needs the extension-point
  // registry to answer (is this slot name registered, is this context field allowed on
  // it) is left to the upload endpoint, which reads the registry and 400s naming the
  // offenders. The CLI holds no copy of that registry to check against.
  //
  // Dispatched through the app type rather than branched on here: `validateConfig` is a no-op
  // for OAuth (whose checks are capability-driven, above) and runs `validateUiApp` for a UI
  // app, so a third type brings its own pre-flight without this command changing.
  resolveFromConfig(config).validateConfig(config);

  const scopes = config.auth?.scopes ?? [];
  validateScopes(scopes);
  if (containsLegacyAllScope(scopes)) {
    throw new CliError(messages.LEGACY_ALL_SCOPE_DEPRECATED_BLOCK);
  }

  // Unconditional: --json and --yes both still fetch + diff, per BEX-250.
  const remote = await fetchExistingApp(config.appId, options.json);
  const diff = buildDiff(config, remote);

  // distribution_type is immutable via upload. The server (BEX-355) rejects
  // drift with a 422, but that would burn the round trip — fast-fail here
  // against the remote state we just fetched, before prompting or pushing.
  // Skipped when the server didn't report a distribution to compare against
  // (the server-side check then remains the only enforcement).
  if (diff.currentDistribution && diff.currentDistribution !== diff.nextDistribution) {
    throw new CliError(
      messages.APP_UPLOAD_DISTRIBUTION_IMMUTABLE(diff.currentDistribution, diff.nextDistribution),
    );
  }

  if (!options.json) {
    renderUploadDiff(diff);
  }

  if (hasNoChanges(diff)) {
    if (options.json) {
      jsonOutput({
        appId: config.appId,
        upToDate: true,
        version: diff.nextVersion,
        ...diffToJson(diff),
      });
      return;
    }
    logInfo(messages.APP_UPLOAD_UP_TO_DATE(diff.nextVersion || 'unknown'));
    return;
  }

  if (!options.json && !options.yes) {
    if (!process.stdin.isTTY) {
      throw new CliError(NON_INTERACTIVE_CONFIRM_ERROR);
    }
    const { confirmed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmed',
        message: messages.APP_UPLOAD_CONFIRM,
        default: true,
      },
    ]);
    if (!confirmed) {
      logInfo(`\n  ${messages.APP_UPLOAD_CANCELLED}\n`);
      return;
    }
  }

  const { confirmedVersion, finalName } = await uploadProjectConfig(config, {
    silent: options.json,
    appVersion: diff.nextVersion,
  });

  if (options.json) {
    jsonOutput({
      appId: config.appId,
      name: finalName,
      version: confirmedVersion,
      ...diffToJson(diff),
    });
    return;
  }

  logSuccess(messages.APP_UPLOAD_SUCCESS);
  logInfo(`  Version: ${confirmedVersion || '(unknown)'}`);
  process.stdout.write('\n');
});
