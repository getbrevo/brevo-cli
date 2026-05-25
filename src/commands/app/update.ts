import * as fs from 'node:fs';
import * as path from 'node:path';
import { logSuccess, logInfo } from '../../lib/logger';
import { messages } from '../../lang/en';
import { withCommandHandler } from '../../lib/command-handler';
import { jsonOutput } from '../../lib/json-output';
import { CliError } from '../../lib/errors';
import { appService } from '../../container';
import { createSpinner } from '../../lib/ui';
import { readProjectConfig, saveAppName, writeProjectConfig } from '../../lib/config';
import { OAuthApp } from '../../types';
import { validateAppName, validateScopes } from '../../lib/validators';
import inquirer from 'inquirer';

interface UpdateOptions {
  appId?: string;
  name?: string;
  redirectUri?: string[];
  logoUri?: string;
  scope?: string[];
  yes?: boolean;
  json?: boolean;
}

export const updateCommand = withCommandHandler(async (options: UpdateOptions): Promise<void> => {
  const config = readProjectConfig();
  const hasFlags = !!(
    options.name !== undefined ||
    (options.redirectUri && options.redirectUri.length > 0) ||
    options.logoUri !== undefined ||
    (options.scope && options.scope.length > 0)
  );

  // Validate --name if provided (even empty strings)
  if (options.name !== undefined) {
    const nameCheck = validateAppName(options.name);
    if (nameCheck !== true) throw new CliError(nameCheck);
  }

  // readProjectConfig normalizes appId (trim + coerce finite numbers, reject
  // empty) so `config.appId` is a guaranteed non-empty string whenever `config`
  // is non-null.
  const configAppId = config?.appId;
  const configAppIdValid = !!configAppId;

  // app-config.json is only usable when it describes the app being updated.
  // When --app-id differs from config.appId, the local file belongs to a
  // different app and must not be used as the update payload or merge base.
  const configMatches = configAppIdValid && (!options.appId || options.appId === configAppId);

  // No flags and no usable config: emit a specific error.
  if (!hasFlags && !configMatches) {
    // File exists but appId is empty/invalid — surface that over a
    // mismatch error, which would otherwise quote a garbage configAppId.
    if (config != null && !configAppIdValid) {
      throw new CliError(messages.APP_UPDATE_INVALID_APP_ID);
    }
    if (config != null && options.appId && options.appId !== configAppId) {
      throw new CliError(messages.APP_UPDATE_APP_ID_MISMATCH(options.appId, configAppId!));
    }
    const configExists = fs.existsSync(path.resolve(process.cwd(), 'app-config.json'));
    if (configExists) {
      // File exists but readProjectConfig returned null — invalid JSON or missing appId
      let raw: unknown;
      try {
        raw = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'app-config.json'), 'utf-8'));
      } catch {
        throw new CliError(messages.APP_UPDATE_INVALID_JSON);
      }
      if (
        !raw ||
        typeof raw !== 'object' ||
        !('appId' in raw) ||
        !(raw as Record<string, unknown>).appId
      ) {
        throw new CliError(messages.APP_UPDATE_MISSING_APP_ID);
      }
    }
    throw new CliError(messages.APP_UPDATE_NOTHING_TO_UPDATE);
  }

  // Resolve appId: flag > config
  let appId: string | undefined;
  if (options.appId) {
    appId = options.appId;
  } else if (configAppIdValid) {
    appId = configAppId;
  } else if (config) {
    throw new CliError(messages.APP_UPDATE_INVALID_APP_ID);
  }

  if (!appId) {
    throw new CliError(messages.APP_UPDATE_NO_APP_RESOLVED);
  }

  // Write back only when config describes the app being updated.
  const shouldWriteBack = configMatches;

  // No flags provided: push full config from app-config.json.
  // (config is guaranteed non-null here — the !hasFlags && !config case is handled above)
  if (!hasFlags) {
    const redirectUrls = config!.auth?.redirectUrls;
    if (!redirectUrls || redirectUrls.length === 0) {
      throw new CliError(messages.APP_UPDATE_NO_REDIRECT_URLS);
    }

    validateRedirectUrls(redirectUrls);

    const nextScopes = config!.auth?.scopes ?? [];
    validateScopes(nextScopes);

    if (!options.json) {
      // Fail fast before the network fetch when we'd have nowhere to show the diff.
      if (!options.yes && !process.stdin.isTTY) {
        throw new CliError(
          'Cannot prompt for confirmation in non-interactive mode. Use --yes or --json to skip.',
        );
      }
      // Fetch current remote state so the summary can show deltas vs. what the
      // push will apply. Hard-fail on fetch error — the user asked for a diff.
      const remote = await fetchExistingApp(appId, options.json);
      renderUpdateSummary({
        appId,
        currentName: remote.name,
        nextName: config!.appName,
        currentUrls: remote.redirect_uris ?? [],
        nextUrls: redirectUrls,
        currentLogoUri: remote.logo_uri,
        nextLogoUri: config!.logoUri,
        currentScopes: remote.scopes ?? [],
        nextScopes,
      });
    }

    if (!options.json && !options.yes) {
      const { confirmed } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmed',
          message: messages.APP_UPDATE_CONFIRM,
          default: true,
        },
      ]);
      if (!confirmed) {
        logInfo(`\n  ${messages.APP_UPDATE_CANCELLED}\n`);
        return;
      }
    }

    const spinner = createSpinner('Updating app...', { silent: options.json });
    await appService.updateApp(appId, {
      name: config!.appName,
      redirect_uris: redirectUrls,
      scopes: nextScopes,
      ...(config!.logoUri ? { logo_uri: config!.logoUri } : {}),
    });
    spinner.stop();

    if (config!.appName) saveAppName(appId, config!.appName);

    if (options.json) {
      jsonOutput({
        app_id: appId,
        name: config!.appName,
        redirect_uris: redirectUrls,
        scopes: nextScopes,
        ...(config!.logoUri ? { logo_uri: config!.logoUri } : {}),
      });
      return;
    }

    logSuccess(messages.APP_UPDATE_SUCCESS);
    if (config!.appName) {
      logInfo(`  Name:          ${config!.appName}`);
    }
    logInfo(`  Redirect URLs: ${redirectUrls.join(', ')}`);
    logInfo(`  Scopes:        ${nextScopes.length > 0 ? nextScopes.join(', ') : '(none)'}`);
    if (config!.logoUri) {
      logInfo(`  Logo URL:      ${config!.logoUri}`);
    }
    process.stdout.write('\n');
    return;
  }

  // Flags provided: merge with existing values
  let existingName: string | undefined;
  let existingRedirectUrls: string[] = [];
  let existingLogoUri: string | undefined;
  let existingScopes: string[] = [];

  const configRedirectUrls = config?.auth?.redirectUrls;
  const hasUsableConfigRedirectUrls =
    Array.isArray(configRedirectUrls) && configRedirectUrls.length > 0;

  if (config && shouldWriteBack && hasUsableConfigRedirectUrls) {
    // Use config as baseline only when it can safely preserve redirect URLs
    existingName = config.appName;
    existingRedirectUrls = configRedirectUrls;
    existingLogoUri = config.logoUri;
    existingScopes = config.auth?.scopes ?? [];
  } else if (config && shouldWriteBack) {
    // Config matches the app, but missing/empty redirect URLs would otherwise clear
    // remote redirect URIs on a name-only update. Fall back to the API for preservation.
    const app = await fetchExistingApp(appId, options.json);
    existingName = config.appName ?? app.name;
    existingRedirectUrls = app.redirect_uris ?? [];
    existingLogoUri = config.logoUri ?? app.logo_uri;
    existingScopes = config.auth?.scopes ?? app.scopes ?? [];
  } else {
    const app = await fetchExistingApp(appId, options.json);
    existingName = app.name;
    existingRedirectUrls = app.redirect_uris ?? [];
    existingLogoUri = app.logo_uri;
    existingScopes = app.scopes ?? [];
  }

  // Merge: --name wins, --redirect-uri appends (deduplicated), --logo-uri wins
  const finalName = options.name ?? existingName;
  const appendedUrls = options.redirectUri ?? [];
  const mergedUrls = [...existingRedirectUrls];
  for (const url of appendedUrls) {
    if (!mergedUrls.includes(url)) {
      mergedUrls.push(url);
    }
  }
  const finalLogoUri = options.logoUri ?? existingLogoUri;

  const appendedScopes = options.scope ?? [];
  const mergedScopes = [...existingScopes];
  for (const s of appendedScopes) {
    if (!mergedScopes.includes(s)) {
      mergedScopes.push(s);
    }
  }

  const hasRedirectUriFlag = options.redirectUri !== undefined;

  if (hasRedirectUriFlag && mergedUrls.length === 0) {
    throw new CliError(messages.APP_UPDATE_NO_REDIRECT_URLS);
  }

  if (mergedUrls.length > 0) {
    validateRedirectUrls(mergedUrls);
  }

  validateScopes(mergedScopes);

  if (!options.json) {
    renderUpdateSummary({
      appId,
      currentName: existingName,
      nextName: finalName,
      currentUrls: existingRedirectUrls,
      nextUrls: mergedUrls,
      currentLogoUri: existingLogoUri,
      nextLogoUri: finalLogoUri,
      currentScopes: existingScopes,
      nextScopes: mergedScopes,
    });
  }

  if (!options.json && !options.yes) {
    if (!process.stdin.isTTY) {
      throw new CliError(
        'Cannot prompt for confirmation in non-interactive mode. Use --yes or --json to skip.',
      );
    }
    const { confirmed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmed',
        message: messages.APP_UPDATE_CONFIRM,
        default: true,
      },
    ]);
    if (!confirmed) {
      logInfo(`\n  ${messages.APP_UPDATE_CANCELLED}\n`);
      return;
    }
  }

  const spinner = createSpinner('Updating app...', { silent: options.json });
  await appService.updateApp(appId, {
    name: finalName,
    redirect_uris: mergedUrls,
    scopes: mergedScopes,
    ...(finalLogoUri ? { logo_uri: finalLogoUri } : {}),
  });
  spinner.stop();

  if (finalName) saveAppName(appId, finalName);

  // Write back to app-config.json if appropriate
  if (shouldWriteBack && config) {
    const updatedConfig = { ...config };
    if (options.name) {
      updatedConfig.appName = options.name;
    }
    if (options.logoUri) {
      updatedConfig.logoUri = options.logoUri;
    }
    updatedConfig.auth = {
      ...updatedConfig.auth,
      redirectUrls: mergedUrls,
      scopes: mergedScopes,
    };
    writeProjectConfig(updatedConfig);
  }

  if (options.json) {
    jsonOutput({
      app_id: appId,
      name: finalName,
      redirect_uris: mergedUrls,
      scopes: mergedScopes,
      ...(finalLogoUri ? { logo_uri: finalLogoUri } : {}),
    });
    return;
  }

  logSuccess(messages.APP_UPDATE_SUCCESS);
  if (finalName) {
    logInfo(`  Name:          ${finalName}`);
  }
  logInfo(`  Redirect URLs: ${mergedUrls.length > 0 ? mergedUrls.join(', ') : '(none)'}`);
  logInfo(`  Scopes:        ${mergedScopes.length > 0 ? mergedScopes.join(', ') : '(none)'}`);
  if (finalLogoUri) {
    logInfo(`  Logo URL:      ${finalLogoUri}`);
  }
  if (shouldWriteBack && config) {
    logInfo('  app-config.json updated.');
  }
  process.stdout.write('\n');
});

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

function renderUpdateSummary(params: {
  appId: string;
  currentName: string | undefined;
  nextName: string | undefined;
  currentUrls: string[];
  nextUrls: string[];
  currentLogoUri?: string;
  nextLogoUri?: string;
  currentScopes?: string[];
  nextScopes?: string[];
}): void {
  const {
    appId,
    currentName,
    nextName,
    currentUrls,
    nextUrls,
    currentLogoUri,
    nextLogoUri,
    currentScopes,
    nextScopes,
  } = params;
  const currentSet = new Set(currentUrls);
  const nextSet = new Set(nextUrls);
  const addedSet = new Set(nextUrls.filter((u) => !currentSet.has(u)));
  const removed = currentUrls.filter((u) => !nextSet.has(u));

  logInfo('');
  logInfo(`  ${messages.APP_UPDATE_SUMMARY}`);
  logInfo(`  App ID:        ${appId}`);
  if (nextName) {
    if (currentName && currentName !== nextName) {
      logInfo(`  Name:          ${currentName} → ${nextName}`);
    } else {
      logInfo(`  Name:          ${nextName}`);
    }
  }
  const lines = [
    ...nextUrls.map((u) => (addedSet.has(u) ? `${u} (new)` : u)),
    ...removed.map((u) => `${u} (removed)`),
  ];
  lines.forEach((line, i) => {
    const prefix = i === 0 ? '  Redirect URLs: ' : '                 ';
    logInfo(`${prefix}${line}`);
  });
  if (nextScopes !== undefined) {
    const currentScopesSet = new Set(currentScopes ?? []);
    const nextScopesSet = new Set(nextScopes);
    const addedScopes = new Set(nextScopes.filter((s) => !currentScopesSet.has(s)));
    const removedScopes = (currentScopes ?? []).filter((s) => !nextScopesSet.has(s));
    const scopeLines =
      nextScopes.length === 0 && removedScopes.length === 0
        ? ['(none)']
        : [
            ...nextScopes.map((s) => (addedScopes.has(s) ? `${s} (new)` : s)),
            ...removedScopes.map((s) => `${s} (removed)`),
          ];
    scopeLines.forEach((line, i) => {
      const prefix = i === 0 ? '  Scopes:        ' : '                 ';
      logInfo(`${prefix}${line}`);
    });
  }

  if (currentLogoUri || nextLogoUri) {
    const label = '  Logo URL:      ';
    if (currentLogoUri && nextLogoUri && currentLogoUri !== nextLogoUri) {
      logInfo(`${label}${currentLogoUri} → ${nextLogoUri}`);
    } else if (nextLogoUri) {
      logInfo(`${label}${nextLogoUri}`);
    } else if (currentLogoUri) {
      logInfo(`${label}${currentLogoUri} (unchanged)`);
    }
  }

  logInfo('');
}

function validateRedirectUrls(urls: string[]): void {
  for (const url of urls) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new CliError(messages.APP_UPDATE_INVALID_REDIRECT_PROTOCOL(url));
      }
    } catch (err) {
      if (err instanceof CliError) throw err;
      throw new CliError(messages.APP_UPDATE_INVALID_REDIRECT_URL(url));
    }
  }
}
