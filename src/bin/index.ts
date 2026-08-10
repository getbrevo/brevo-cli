#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Command } from 'commander';
import { installAuthGuard } from '../lib/auth-guard';
import { installProactiveOauthRefresh } from '../lib/oauth-freshness';
import { logError, logInfo, logWarn, logSuccess, logDebug } from '../lib/logger';
import { EXIT_CODES } from '../lib/exit-codes';
import { CliError, AbortError, AuthExpiredError, CliVersionUnsupportedError } from '../lib/errors';
import { messages } from '../lang/en';
import { readHiddenInput } from '../lib/hidden-input';
import { saveCredentials, clearCredentials, getAuthCred, updateOauthTokens } from '../lib/config';
import {
  ENDPOINTS,
  OAUTH_PROXY_URL,
  warnIfPathStripped,
  BREVO_CLI_REFERENCE_URL,
} from '../lib/constants';
import { refreshAccessToken, RefreshError } from '../services/oauth-refresh';
import { stopActiveSpinner } from '../lib/ui';
import { AccountResponse } from '../types';
import { client, versionGate } from '../container';
import { jsonOutput } from '../lib/json-output';
import { registerAll } from '../lib/command-registry';
import { topLevelCommands, appCommandGroup, skillCommandGroup } from '../commands/definitions';
import { skillService } from '../services/skill';

const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8'));
const version: string = pkg.version;

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
        `  brevo app create      [--name] [--distribution private|public] [--redirect-uri <url>...] [--logo-uri <url>] [--json]`,
        `  brevo app list        [--json]`,
        `  brevo app credentials [--app-id <id>] [--reveal-secret] [--json]`,
        `  brevo app update      [--app-id <id>] [--name] [--redirect-uri <url>...] [--logo-uri <url>] [--json]`,
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
        `Docs: ${BREVO_CLI_REFERENCE_URL}`,
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

// Proactive OAuth refresh — replaces a near-expiry access token before the
// command runs, so a short access-token TTL stays invisible and the session
// lives as long as the refresh token does. Best-effort: failures are logged at
// debug level and never block the command. The reactive handler below stays the
// safety net and the only place credentials get cleared.
installProactiveOauthRefresh(program, {
  getAuthCred,
  refresh: (refreshToken) => refreshAccessToken(refreshToken, OAUTH_PROXY_URL),
  persist: updateOauthTokens,
  onError: (err) =>
    logDebug('proactive oauth refresh skipped', {
      reason: err instanceof Error ? err.message : String(err),
    }),
});

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

// ──────────────── CLI version gate (BEX-370) ────────────────
//
// The backend decides whether this CLI version is still supported: it knows the
// caller's version from the User-Agent on every request and returns a verdict in
// the response headers. The CLI compares nothing and never contacts npm.
//
// `--help` / `--version` stay exempt so a blocked CLI can still identify itself.
const args = process.argv.slice(2);
const isHelpOrVersion =
  args.includes('--help') ||
  args.includes('-h') ||
  args.includes('--version') ||
  args.includes('-V');
const wantsJson = args.includes('--json');

// A box is useless to a script, so a blocked --json run emits the documented
// error envelope instead. Either way the exit code is 1.
async function writeVersionNotice(): Promise<void> {
  if (wantsJson) {
    jsonOutput(versionGate.jsonEnvelope());
    return;
  }
  const box = await versionGate.render();
  if (box) process.stderr.write(box + '\n');
}

// Decided from the cached verdict alone: no network, so an already-known
// unsupported CLI stops offline and instantly.
async function runStartupVersionGate(): Promise<void> {
  if (isHelpOrVersion) return;
  if (!versionGate.shouldBlock()) return;
  await writeVersionNotice();
  process.exit(EXIT_CODES.ERROR);
}

// After the command has run. The verdict is already known from the headers; the
// fetch here only enriches the wording, and only when the cached copy is stale.
async function renderVersionNotice(): Promise<void> {
  if (isHelpOrVersion) return;
  if (!versionGate.shouldNotify()) return;
  const box = await versionGate.render();
  if (box) process.stderr.write(box + '\n');
}

runStartupVersionGate()
  .then(() => program.parseAsync(process.argv))
  .then(async () => {
    await renderVersionNotice();
    // Local skill catalog check — sync, no network. Silently refreshes any
    // installed skill that's behind the bundled catalog so the AI tool always
    // sees the latest primer. Opt out with BREVO_NO_SKILL_AUTOREFRESH=1.
    skillService.autoRefreshOutdated();
    // Force exit — Node's native fetch keeps TCP connections alive which can
    // prevent the process from exiting when running against local servers.
    process.exit(0);
  })
  .catch(async (err) => {
    // A block discovered mid-run, thrown from inside ApiClient.request before
    // the command wrote anything. Checked ahead of CliError because it is one,
    // and needs the notice/envelope rather than a bare error line.
    if (err instanceof CliVersionUnsupportedError) {
      await writeVersionNotice();
      process.exit(err.exitCode);
    }
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
