#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Command } from 'commander';
import { installAuthGuard } from '../lib/auth-guard';
import { installProactiveOauthRefresh, ensureFreshOauthToken } from '../lib/oauth-freshness';
import { logError, logInfo, logWarn, logSuccess, logDebug } from '../lib/logger';
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
import {
  formatBlockedBanner,
  startUpdateCheck,
  notifyUpdate,
  enforceMinVersion,
  shouldShowBannerBefore,
} from '../lib/update-notifier';
import { skillService } from '../services/skill';
import { fetchCliInfo } from '../services/cli-info';
import { emitJsonError } from '../lib/json-output';
import { createHelpFormatter } from '../lib/help';

const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8'));
const version: string = pkg.version;

// Version update check — async, non-blocking. Cached at ~/.brevo/update-check.json (24h TTL).
// Skipped in CI, non-TTY, or when --no-update-notifier / BREVO_NO_UPDATE_NOTIFIER=1 is set.
// This covers npm detection only. The banner's notice line, and whether the
// version is blocked outright, come from GET /cli/info — see applyCliInfo below.
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
  .configureHelp({ formatHelp: createHelpFormatter(program) })
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

// Proactive OAuth refresh — replaces a near-expiry access token, so a short
// access-token TTL stays invisible and the session lives as long as the refresh
// token does.
//
// A failure that says nothing about the session (network blip, 5xx, unwritable
// file) is logged at debug level and never blocks the command. A *refused
// refresh token* is different in kind: nothing later in the run can recover it,
// so it clears credentials and stops the command — see `isTerminal` below.
const oauthFreshnessDeps = {
  getAuthCred,
  refresh: (refreshToken: string) => refreshAccessToken(refreshToken, OAUTH_PROXY_URL),
  persist: updateOauthTokens,
  // `unauthorized` is set only by a 401 from the proxy's `/refresh`, i.e. the
  // refresh token itself was rejected. Anything else — including a timeout
  // against that same endpoint — stays best-effort.
  isTerminal: (err: unknown) => err instanceof RefreshError && err.unauthorized,
  onTerminal: clearCredentials,
  onError: (err: unknown) =>
    logDebug('proactive oauth refresh skipped', {
      reason: err instanceof Error ? err.message : String(err),
    }),
};

// Once before the command body — the check that has to beat the first prompt.
installProactiveOauthRefresh(program, oauthFreshnessDeps);
// And again before each authenticated request, for a token that expires during
// a long interactive flow. Same deps object: one policy, two trigger points.
client.setEnsureFresh(async () => {
  await ensureFreshOauthToken(oauthFreshnessDeps);
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

// Force-update gate — if the installed CLI is a full major version behind the
// latest npm release, block the command (non-zero exit) so the user upgrades.
// Skipped for --help/--version (so help stays reachable) and whenever the
// update check itself is skipped (CI / non-TTY / opt-out). Fails open.
const args = new Set(process.argv.slice(2));
const isHelpOrVersion =
  args.has('--help') || args.has('-h') || args.has('--version') || args.has('-V');

// ──────────────── API version gate (BEX-370) ────────────────
//
// GET /cli/info on the app-store service, called directly — no gateway, no
// credentials — on every run and never cached, so a reworded message or a new
// block takes effect immediately rather than after a TTL.
//
// It runs *before* the command because a block has to prevent the command, not
// report on it afterwards. `--help` / `--version` stay exempt so a blocked CLI
// can still identify itself.
//
// Fails open in every direction: a timeout, a non-2xx, an unparseable body or
// any other error leaves `info` undefined and the command proceeds. Only an
// explicit `is_blocked: true` stops anything.
//
// A block is not a notice, so it deliberately ignores the notice opt-outs
// (BREVO_NO_UPDATE_NOTIFIER, --no-update-notifier, CI, non-TTY): a suppressed
// banner should never mean a suppressed block.
async function applyCliInfo(): Promise<void> {
  if (isHelpOrVersion) return;

  const info = await fetchCliInfo({ cliVersion: version, reason: 'startup' });
  if (!info) return;

  // Carried in memory only, for whichever banner ends up rendering.
  updateCheck.notice = info.upgradeMessage;
  if (!info.isBlocked) return;

  process.stderr.write(
    formatBlockedBanner(version, updateCheck.cachedLatest, pkg.name, info.upgradeMessage) + '\n',
  );
  process.exit(EXIT_CODES.ERROR);
}

// Kept lazy rather than started at module load: it now runs behind applyCliInfo,
// and an eagerly-created promise would sit with no rejection handler attached
// until that resolved. Costs nothing to defer — the npm request it awaits was
// already kicked off by startUpdateCheck above.
async function forceGate(): Promise<void> {
  if (isHelpOrVersion) return;
  const mustUpdate = await enforceMinVersion(updateCheck, { name: pkg.name, version });
  if (mustUpdate) process.exit(EXIT_CODES.ERROR);
}

applyCliInfo()
  .then(forceGate)
  .then(() =>
    showBannerEarly ? notifyUpdate(updateCheck, { name: pkg.name, version }) : undefined,
  )
  .then(() => program.parseAsync(process.argv))
  .then(async () => {
    // notifyUpdate is idempotent, so the early-banner path above suppresses this
    // one on its own — no need to branch on showBannerEarly.
    await notifyUpdate(updateCheck, { name: pkg.name, version });
    // Local skill catalog check — sync, no network. Silently refreshes any
    // installed skill that's behind the bundled catalog so the AI tool always
    // sees the latest primer. Opt out with BREVO_NO_SKILL_AUTOREFRESH=1.
    skillService.autoRefreshOutdated();
    // Force exit — Node's native fetch keeps TCP connections alive which can
    // prevent the process from exiting when running against local servers.
    process.exit(0);
  })
  .catch(async (err) => {
    emitJsonError(err);
    // A deliberate Ctrl-C is not a failure — exit immediately rather than making
    // the user wait on the update check for a banner they didn't ask for.
    if (err instanceof AbortError) {
      logInfo(`\n  ${messages.ABORTED}`);
      process.exit(EXIT_CODES.ABORTED);
    }

    const exitCode = err instanceof CliError ? err.exitCode : EXIT_CODES.ERROR;
    if (err instanceof CliError) {
      logError(err.message);
    } else {
      logError(err.message, err);
    }

    // A failed command is exactly when knowing about a newer CLI matters most —
    // the upgrade may be the fix. The banner goes after the error so the error
    // stays the first thing the user reads, and the exit code is unchanged.
    await notifyUpdate(updateCheck, { name: pkg.name, version });
    process.exit(exitCode);
  });
