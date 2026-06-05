import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import inquirer from 'inquirer';
import { logInfo, logSuccess, logWarn } from '../../lib/logger';
import { CliError } from '../../lib/errors';
import { messages } from '../../lang/en';
import { withCommandHandler } from '../../lib/command-handler';
import { isPortAvailable } from '../../lib/port';
import { DEFAULT_PORT } from '../../lib/constants';
import { readProjectConfig, writeProjectConfig, ProjectConfig } from '../../lib/config';
import { createSpinner } from '../../lib/ui';
import { appService } from '../../container';
import { containsLegacyAllScope } from '../../lib/validators';

/**
 * Feature registry — maps feature names to their entry files.
 * Add new features here as they are added to the scaffold.
 */
const FEATURES: Record<string, { entry: string; description: string }> = {
  oauth: {
    entry: 'src/oauth/server.js',
    description: 'Local OAuth test server',
  },
};

/**
 * Returns the first redirect URL pointing at the local loopback
 * (host = localhost or 127.0.0.1) on the given port, or undefined.
 * Unparseable URLs are skipped.
 */
function findMatchingLocalRedirect(redirectUrls: string[], port: number): string | undefined {
  return redirectUrls.find((url) => {
    try {
      const parsed = new URL(url);
      const hostMatches = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
      return hostMatches && parsed.port === String(port);
    } catch {
      return false;
    }
  });
}

/**
 * If the resolved port has no matching localhost redirect URL on the app,
 * offer to register one. Approval pushes the new URL to the remote app and
 * writes it back into app-config.json so the next run is silent. Decline
 * continues with a warning. Non-TTY hard-fails because there's no way to
 * confirm a remote-mutating operation.
 *
 * Returns the resolved localhost redirect URL (existing or newly registered),
 * or undefined when the user declined registration.
 */
async function ensureRedirectRegistered(
  config: ProjectConfig,
  port: number,
): Promise<string | undefined> {
  const redirectUrls = config.auth?.redirectUrls ?? [];
  const existing = findMatchingLocalRedirect(redirectUrls, port);
  if (existing) return existing;

  const newRedirectUrl = `http://localhost:${port}/auth/callback`;

  if (!process.stdin.isTTY) {
    throw new CliError(messages.APP_START_REDIRECT_NON_INTERACTIVE(port, newRedirectUrl));
  }

  logInfo(`  ${messages.APP_START_REDIRECT_NOT_REGISTERED(port)}`);
  const { shouldRegister } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'shouldRegister',
      message: messages.APP_START_REDIRECT_REGISTER_PROMPT(newRedirectUrl),
      default: true,
    },
  ]);

  if (!shouldRegister) {
    logWarn(messages.APP_START_REDIRECT_DECLINED(newRedirectUrl));
    return undefined;
  }

  const updatedUrls = [...redirectUrls, newRedirectUrl];
  const spinner = createSpinner(messages.APP_START_REDIRECT_REGISTERING);
  try {
    await appService.updateApp(config.appId, { redirect_uris: updatedUrls });
  } finally {
    spinner.stop();
  }

  writeProjectConfig({
    ...config,
    auth: { ...config.auth, redirectUrls: updatedUrls },
  });
  logSuccess(messages.APP_START_REDIRECT_REGISTERED(newRedirectUrl));
  return newRedirectUrl;
}

function resolveFeatureEntry(feature: string | undefined): string {
  if (!feature) {
    const available = Object.entries(FEATURES)
      .map(([name, f]) => `  ${name}  ${f.description}`)
      .join('\n');
    throw new CliError(messages.APP_START_MISSING_FEATURE(available));
  }

  const featureConfig = FEATURES[feature];
  if (!featureConfig) {
    const available = Object.keys(FEATURES).join(', ');
    throw new CliError(messages.APP_START_UNKNOWN_FEATURE(feature, available));
  }

  const entryFile = path.resolve(featureConfig.entry);
  if (!fs.existsSync(entryFile)) {
    throw new CliError(messages.APP_START_FEATURE_NOT_FOUND(featureConfig.entry));
  }

  const featureDir = path.dirname(featureConfig.entry);
  if (!fs.existsSync(path.resolve(featureDir, 'node_modules'))) {
    throw new CliError(messages.APP_START_NO_DEPS(featureDir));
  }
  return entryFile;
}

function resolvePort(config: ProjectConfig | null, optionsPort?: number): number {
  if (optionsPort) return optionsPort;
  const redirectUrl = config?.auth?.redirectUrls?.[0];
  if (!redirectUrl) return DEFAULT_PORT;
  try {
    const parsed = new URL(redirectUrl);
    return parsed.port ? Number(parsed.port) : DEFAULT_PORT;
  } catch {
    return DEFAULT_PORT;
  }
}

function runChildProcess(
  entryFile: string,
  childEnv: NodeJS.ProcessEnv,
  feature: string,
): Promise<void> {
  const child = spawn(process.execPath, [entryFile], {
    stdio: 'inherit',
    env: childEnv,
  });

  const onSignal = (signal: NodeJS.Signals): void => {
    child.kill(signal);
  };
  process.prependListener('SIGINT', onSignal);
  process.prependListener('SIGTERM', onSignal);

  return new Promise((resolve, reject) => {
    child.on('close', (code) => {
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
      if (code && code !== 0) {
        reject(new CliError(messages.APP_START_EXITED(feature, code)));
      } else {
        logInfo(`\n  ${messages.APP_START_STOPPED}\n`);
        resolve();
      }
    });
    child.on('error', (err) => {
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
      reject(new CliError(messages.APP_START_FAILED(feature, err.message)));
    });
  });
}

export const startCommand = withCommandHandler(
  async (options: { feature?: string; port?: number }): Promise<void> => {
    const { feature } = options;
    const entryFile = resolveFeatureEntry(feature);

    const config = readProjectConfig();

    // The child OAuth server builds its authorize URL from auth.scopes —
    // refuse to launch a test flow with the deprecated legacy 'all' scope
    // and point at the --scope migration path instead (BEX-214).
    if (containsLegacyAllScope(config?.auth?.scopes)) {
      throw new CliError(messages.LEGACY_ALL_SCOPE_START_BLOCK);
    }

    const port = resolvePort(config, options.port);

    if (!(await isPortAvailable(port))) {
      throw new CliError(
        options.port
          ? messages.APP_START_CUSTOM_PORT_IN_USE(port)
          : messages.APP_START_PORT_IN_USE(port),
      );
    }

    // If the app is linked locally, make sure the resolved port is one of
    // its registered redirect URLs — otherwise the OAuth callback will be
    // rejected by Brevo at runtime. Skipped when there's no linked app
    // (no appId means we'd have nowhere to push the update).
    const redirectUri = config?.appId ? await ensureRedirectRegistered(config, port) : undefined;

    logInfo(`\n  Starting ${feature}...`);

    const childEnv: NodeJS.ProcessEnv = { ...process.env, PORT: String(port) };
    if (redirectUri) childEnv.REDIRECT_URI = redirectUri;

    await runChildProcess(entryFile, childEnv, feature!);
  },
);
