#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Command } from 'commander';
import { installAuthGuard } from '../lib/auth-guard';
import { logError, logInfo, logWarn, logSuccess } from '../lib/logger';
import { EXIT_CODES } from '../lib/exit-codes';
import { CliError, AbortError, AuthExpiredError } from '../lib/errors';
import { messages } from '../lang/en';
import { readHiddenInput } from '../lib/hidden-input';
import { saveCredentials, clearCredentials, getAuthCred, updateOauthTokens } from '../lib/config';
import { ENDPOINTS, OAUTH_PROXY_URL, warnIfPathStripped } from '../lib/constants';
import { refreshAccessToken, RefreshError } from '../services/oauth-refresh';
import { stopActiveSpinner } from '../lib/ui';
import { AccountResponse } from '../types';
import { client } from '../container';
import { registerAll } from '../lib/command-registry';
import { topLevelCommands, appCommandGroup, skillCommandGroup } from '../commands/definitions';
import { startUpdateCheck, notifyUpdate, shouldShowBannerBefore } from '../lib/update-notifier';
import { skillService } from '../services/skill';

const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8'));
const version: string = pkg.version;

// Version update check — async, non-blocking. Cached at ~/.brevo/update-check.json (24h TTL).
// Skipped in CI, non-TTY, or when --no-update-notifier / BREVO_NO_UPDATE_NOTIFIER=1 is set.
const updateCheck = startUpdateCheck({ pkg, argv: process.argv });
// For long interactive flows (`app init`, `app create`), surface the banner
// before the command runs so the user sees it up front instead of after a
// multi-prompt sequence.
const showBannerEarly = shouldShowBannerBefore(process.argv);

if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
  logWarn(messages.TLS_VERIFICATION_DISABLED);
}

const program = new Command();

program
  .name('brevo')
  .description('Brevo Developer CLI — create, manage, and test OAuth integrations')
  .version(version)
  .option('--debug', 'Enable debug logging')
  .configureHelp({
    formatHelp: (_cmd, helper) => {
      const version = helper.commandDescription(_cmd);
      return [
        `Usage: brevo [options] [command]`,
        ``,
        version,
        ``,
        `Options:`,
        `  -V, --version    output the version number`,
        `  -h, --help       display help for command`,
        ``,
        `Commands:`,
        `  brevo login       [--browser] [--json]         Authenticate with your Brevo account`,
        `  brevo logout      [--json]                     Clear stored credentials`,
        `  brevo whoami      [--json]                     Show current authenticated user`,
        ``,
        `App commands:`,
        `  brevo app init                                 Quick setup — login, create app, and scaffold`,
        `  brevo app create      [--name] [--distribution private|public] [--json]`,
        `  brevo app list        [--json]`,
        `  brevo app credentials [--app-id <id>] [--reveal-secret] [--json]`,
        `  brevo app update      [--json]`,
        `  brevo app delete      [--app-id <id>] [--force] [--json]`,
        `  brevo app scaffold    [--app-id <id>] [--json]`,
        `  brevo app start       [feature] [--port <port>]`,
        ``,
        `Skill commands:`,
        `  brevo skill:cli install   [--json]             Install the brevo-cli Claude Code skill`,
        `  brevo skill:cli uninstall [--json]             Remove the brevo-cli skill`,
        ``,
        `Scope commands:`,
        `  brevo app available-scopes [--web] [--json]    List OAuth scopes supported by the IdP`,
        `                                                 (--web opens the catalog in a local browser page)`,
        ``,
        `Run \`brevo <command> --help\` for details on a specific command.`,
        ``,
        `Examples:`,
        `  $ brevo login                                   # authenticate interactively`,
        `  $ brevo app init                                # guided setup`,
        `  $ brevo app create --name "My App" --json       # create app, JSON output`,
        `  $ brevo app list --json                         # list apps as JSON`,
        `  $ brevo app scaffold --app-id APPID             # generate starter code`,
        `  $ brevo app start oauth --port 3000             # start OAuth test server`,
        `  $ brevo app available-scopes --web              # browse OAuth scope catalog`,
        ``,
      ].join('\n');
    },
  })
  .action((_options, cmd) => {
    const stray = cmd.args;
    if (stray.length === 0) {
      cmd.outputHelp();
      return;
    }
    // Unknown top-level command — Commander dispatches stray args to the
    // root action when no subcommand matches. Surface a clear error so the
    // user knows they typed a command that doesn't exist.
    process.stderr.write(`error: unknown command '${stray[0]}'\n`);
    process.stderr.write(`See \`brevo --help\` for available commands.\n`);
    process.exit(EXIT_CODES.ERROR);
  });

// Auth guard — blocks unauthenticated access (except login, logout, help)
installAuthGuard(program);

// ──────────────── Register all commands ────────────────

registerAll(program, topLevelCommands, [appCommandGroup, skillCommandGroup]);

// ──────────────── Re-auth handler ────────────────

client.setOnAuthFailure(async () => {
  const auth = getAuthCred();

  // OAuth: silently refresh the access token and let the original request retry.
  // If the refresh itself returns 401, the refresh token is dead — clear creds
  // and surface a friendly "please log in again" message instead of falling
  // through to the api-key prompt.
  if (auth?.kind === 'oauth') {
    try {
      const refreshed = await refreshAccessToken(auth.refreshToken, OAUTH_PROXY_URL);
      updateOauthTokens(refreshed);
      return;
    } catch (err) {
      if (err instanceof RefreshError && err.unauthorized) {
        clearCredentials();
        throw new AuthExpiredError();
      }
      throw err;
    }
  }

  // API-key: prompt for a new key and re-validate.
  stopActiveSpinner();
  clearCredentials();
  logWarn(messages.AUTH_EXPIRED);
  logInfo(`  ${messages.AUTH_GET_KEY_URL}\n`);
  const newKey = await readHiddenInput(messages.AUTH_EXPIRED_PROMPT + ' ');
  const account = await client.getWithKey<AccountResponse>(ENDPOINTS.ACCOUNT, newKey);
  saveCredentials(newKey, {
    email: account.email,
    organizationId: account.organization_id,
    userId: account.user_id,
  });
  logSuccess(messages.AUTH_SUCCESS(account.email));
});

// ──────────────── Signal handling ────────────────

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logInfo(`\n  Received ${signal}, shutting down.\n`);
    process.exit(EXIT_CODES.ABORTED);
  });
}

// ──────────────── Error handling ────────────────

// Emit deferred warning if BREVO_API_URL had a path stripped
warnIfPathStripped();

const earlyNotify = showBannerEarly
  ? notifyUpdate(updateCheck, { name: pkg.name, version })
  : Promise.resolve();

earlyNotify
  .then(() => program.parseAsync(process.argv))
  .then(async () => {
    if (!showBannerEarly) {
      await notifyUpdate(updateCheck, { name: pkg.name, version });
    }
    // Local skill catalog check — sync, no network. Silently refreshes any
    // installed skill that's behind the bundled catalog so the AI tool always
    // sees the latest primer. Opt out with BREVO_NO_SKILL_AUTOREFRESH=1.
    skillService.autoRefreshOutdated();
    // Force exit — Node's native fetch keeps TCP connections alive which can
    // prevent the process from exiting when running against local servers.
    process.exit(0);
  })
  .catch((err) => {
    if (err instanceof AbortError) {
      logInfo(`\n  ${messages.ABORTED}`);
      process.exit(EXIT_CODES.ABORTED);
    }
    if (err instanceof CliError) {
      logError(err.message);
      process.exit(err.exitCode);
    }
    logError(err.message, err);
    process.exit(EXIT_CODES.ERROR);
  });
