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
  ProjectConfig,
} from '../../lib/config';
import { validateScopes, containsLegacyAllScope } from '../../lib/validators';
import { OAuthApp, UploadAppResponse } from '../../types';

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
  };
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
  logAligned('  Redirect URLs: ', diffLines(diff.currentUrls, diff.nextUrls));
  if (diff.migratingLegacyScopes) {
    logInfo(`  ${messages.LEGACY_ALL_SCOPE_UPDATE_MIGRATING}`);
  }
  logAligned('  Scopes:        ', diffLines(diff.currentScopes, diff.nextScopes));
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
  logInfo('');
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
    },
    next: {
      name: diff.nextName,
      redirect_uris: diff.nextUrls,
      scopes: diff.nextScopes,
      logo_uri: diff.nextLogoUri,
      distribution_type: diff.nextDistribution,
      version: diff.nextVersion,
    },
  };
}

function hasNoChanges(diff: UploadDiff): boolean {
  return (
    diff.currentName === diff.nextName &&
    diff.currentDistribution === diff.nextDistribution &&
    JSON.stringify([...diff.currentUrls].sort()) === JSON.stringify([...diff.nextUrls].sort()) &&
    JSON.stringify([...diff.currentScopes].sort()) ===
      JSON.stringify([...diff.nextScopes].sort()) &&
    (diff.currentLogoUri || '') === (diff.nextLogoUri || '') &&
    (diff.currentVersion || '') === (diff.nextVersion || '')
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
      app_version: appVersion,
      distribution_type: config.distribution_type,
      auth: {
        scopes,
        redirect_uris: redirectUris,
      },
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
    auth: {
      scopes: response.auth.scopes ?? scopes,
      redirectUris: response.auth.redirect_uris ?? redirectUris,
    },
  });

  return { confirmedVersion, finalName };
}

export const uploadCommand = withCommandHandler(async (options: UploadOptions): Promise<void> => {
  const config = loadUsableConfig();

  const redirectUris = config.auth?.redirectUris ?? [];
  if (redirectUris.length === 0) {
    throw new CliError(messages.APP_UPLOAD_NO_REDIRECT_URLS);
  }
  validateRedirectUrls(redirectUris);

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
