import inquirer from 'inquirer';
import { appService } from '../../container';
import { messages } from '../../lang/en';
import { openBrowser } from '../../lib/browser';
import { withCommandHandler } from '../../lib/command-handler';
import { ProjectConfig, readProjectConfig } from '../../lib/config';
import { CliError } from '../../lib/errors';
import { EXIT_CODES } from '../../lib/exit-codes';
import { jsonOutput } from '../../lib/json-output';
import { logDebug, logInfo, logSuccess } from '../../lib/logger';
import { createSpinner } from '../../lib/ui';
import { OAuthApp } from '../../types';

interface SubmitOptions {
  appId?: string;
  json?: boolean;
}

// Order-independent equality — redirect URLs and scopes are sets, not
// sequences (the server may reorder them).
function arraysEqualAsSets(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((v) => setB.has(v));
}

interface FieldDrift {
  // Short name for the --json / summary message ("scopes").
  field: string;
  // Padded display label aligned to update.ts's summary columns.
  label: string;
  local: string[];
  remote: string[];
}

// Diff the fields the CLI can push (name, redirect URLs, scopes, logo) between
// the local app-config.json and the remote app. Absent and empty values
// compare as equal so an older config never produces phantom drift.
function computeConfigDrift(config: ProjectConfig, remote: OAuthApp): FieldDrift[] {
  const drift: FieldDrift[] = [];
  const asList = (v: string | undefined) => (v ? [v] : []);

  if (config.appName !== remote.name) {
    drift.push({
      field: 'name',
      label: 'Name:          ',
      local: asList(config.appName),
      remote: asList(remote.name),
    });
  }
  const localUrls = config.auth?.redirectUrls ?? [];
  const remoteUrls = remote.redirect_uris ?? [];
  if (!arraysEqualAsSets(localUrls, remoteUrls)) {
    drift.push({
      field: 'redirect URLs',
      label: 'Redirect URLs: ',
      local: localUrls,
      remote: remoteUrls,
    });
  }
  const localScopes = config.auth?.scopes ?? [];
  const remoteScopes = remote.scopes ?? [];
  if (!arraysEqualAsSets(localScopes, remoteScopes)) {
    drift.push({
      field: 'scopes',
      label: 'Scopes:        ',
      local: localScopes,
      remote: remoteScopes,
    });
  }
  if ((config.logoUri ?? '') !== (remote.logo_uri ?? '')) {
    drift.push({
      field: 'logo URL',
      label: 'Logo URL:      ',
      local: asList(config.logoUri),
      remote: asList(remote.logo_uri),
    });
  }
  if ((config.version ?? '') !== (remote.version ?? '')) {
    drift.push({
      field: 'version',
      label: 'Version:       ',
      local: asList(config.version),
      remote: asList(remote.version),
    });
  }
  return drift;
}

// Values in both sides print plain; one-sided values are tagged. Neutral
// "(local only)" / "(server only)" tags describe state — submit changes
// nothing, so update.ts's action-implying "(new)" / "(removed)" don't fit.
function diffValueLines(local: string[], remote: string[]): string[] {
  const localSet = new Set(local);
  const remoteSet = new Set(remote);
  return [
    ...local.map((v) => (remoteSet.has(v) ? v : `${v} (local only)`)),
    ...remote.filter((v) => !localSet.has(v)).map((v) => `${v} (server only)`),
  ];
}

// Labelled block with continuation lines aligned under the first value,
// matching update.ts's summary layout.
function renderDriftBlock(drift: FieldDrift[]): string {
  const continuation = ' '.repeat(17);
  return drift
    .map((d) =>
      diffValueLines(d.local, d.remote)
        .map((line, i) => (i === 0 ? `  ${d.label}${line}` : `${continuation}${line}`))
        .join('\n'),
    )
    .join('\n');
}

// Full app object as sent for review, labelled like renderDriftBlock's columns.
// Empty/absent fields are dropped rather than shown blank.
function renderAppSummary(app: OAuthApp): string {
  const rows: Array<{ label: string; values: string[] }> = [
    { label: 'App ID:        ', values: [app.app_id] },
    { label: 'Name:          ', values: [app.name] },
    { label: 'Distribution:  ', values: app.distribution_type ? [app.distribution_type] : [] },
    { label: 'Redirect URLs: ', values: app.redirect_uris ?? [] },
    { label: 'Scopes:        ', values: app.scopes ?? [] },
    { label: 'Logo URL:      ', values: app.logo_uri ? [app.logo_uri] : [] },
    { label: 'Version:       ', values: app.version ? [app.version] : [] },
  ];
  const continuation = ' '.repeat(17);
  return rows
    .filter((r) => r.values.length > 0)
    .map((r) =>
      r.values.map((v, i) => (i === 0 ? `  ${r.label}${v}` : `${continuation}${v}`)).join('\n'),
    )
    .join('\n');
}

// Show the exact object under review and get an explicit go-ahead before
// opening the form. Returns true when the flow should proceed.
async function confirmSubmission(app: OAuthApp): Promise<boolean> {
  process.stdout.write(`\n  ${messages.APP_SUBMIT_CONFIRM_HEADER}\n${renderAppSummary(app)}\n\n`);
  const { confirmed } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmed',
      message: messages.APP_SUBMIT_CONFIRM_PROMPT,
      default: true,
    },
  ]);
  if (!confirmed) {
    logInfo(`\n  ${messages.APP_SUBMIT_CANCELLED}\n`);
    return false;
  }
  return true;
}

// Resolve appId: flag > config; interactive picker as a last resort. Never
// prompt in --json mode — machine output must stay deterministic.
async function resolveAppId(options: SubmitOptions, config: ProjectConfig | null): Promise<string> {
  if (options.appId) return options.appId;
  if (config?.appId) return config.appId;
  if (!options.json && process.stdin.isTTY) {
    return appService.pickApp(messages.APP_SUBMIT_PICK_APP);
  }
  throw new CliError(messages.APP_SUBMIT_NO_APP_RESOLVED);
}

async function fetchExistingApp(appId: string, silent: boolean | undefined): Promise<OAuthApp> {
  const spinner = createSpinner(messages.APP_SUBMIT_FETCHING, { silent });
  let app: OAuthApp | null;
  try {
    app = await appService.fetchApp(appId);
  } finally {
    spinner.stop();
  }
  if (!app) {
    throw new CliError(messages.APP_SUBMIT_NOT_FOUND(appId), EXIT_CODES.NOT_FOUND);
  }
  return app;
}

export const submitCommand = withCommandHandler(async (options: SubmitOptions): Promise<void> => {
  const config = readProjectConfig();
  const appId = await resolveAppId(options, config);

  const app = await fetchExistingApp(appId, options.json);

  // Only public apps can be submitted for review. A missing distribution_type
  // (older server) fails closed — the remedy is the same either way.
  if (app.distribution_type !== 'public') {
    throw new CliError(messages.APP_SUBMIT_NOT_PUBLIC(appId));
  }

  // The local config is only a sync source when it describes the app being
  // submitted; a different --app-id makes it irrelevant, not an error (submit
  // never writes locally).
  const configMatches = !!config?.appId && config.appId === appId;
  // Tracks whether we actually ran a local-vs-server comparison and it came back
  // clean — only then does the "no mismatch" note make sense to show.
  let configVerified = false;
  if (configMatches) {
    const drift = computeConfigDrift(config!, app);
    if (drift.length > 0) {
      // JSON mode keeps the compact field-name message (machine consumers only
      // need the outcome); human mode shows the value-level diff.
      throw new CliError(
        options.json
          ? messages.APP_SUBMIT_OUT_OF_SYNC(
              drift.map((d) => d.field),
              appId,
            )
          : messages.APP_SUBMIT_OUT_OF_SYNC_DIFF(renderDriftBlock(drift), appId),
      );
    }
    configVerified = true;
  }

  // The submission form link is part of the app payload for public apps —
  // no extra request needed. Absent means the backend isn't ready for this app.
  const formUrl = app.google_form_link;
  if (!formUrl) {
    throw new CliError(messages.APP_SUBMIT_NO_FORM_URL);
  }

  if (options.json) {
    jsonOutput({ app_id: appId, form_url: formUrl });
    // The next-steps notes print in every mode (BEX-251), but on stderr here
    // so stdout stays parseable JSON.
    process.stderr.write(`  ${messages.APP_SUBMIT_FORM_GATE}\n`);
    process.stderr.write(`  ${messages.APP_SUBMIT_NEXT_STEPS}\n`);
    return;
  }

  // Everything is in sync at this point — show the full object being submitted
  // and ask before opening the form. Non-TTY (piped/CI) can't answer a prompt,
  // so it keeps the previous straight-through behavior.
  if (process.stdin.isTTY) {
    if (configVerified) {
      logInfo(messages.APP_SUBMIT_IN_SYNC);
    }
    if (!(await confirmSubmission(app))) {
      return;
    }
  }

  // Both branches include the URL, so headless users always get it.
  try {
    openBrowser(formUrl);
    logSuccess(messages.APP_SUBMIT_BROWSER_OPENED(formUrl, appId));
  } catch (err) {
    logDebug('openBrowser failed', { message: (err as Error).message });
    logInfo(messages.APP_SUBMIT_BROWSER_FAILED(formUrl, appId));
  }
  logInfo(messages.APP_SUBMIT_FORM_GATE);
  logInfo(messages.APP_SUBMIT_NEXT_STEPS);
});
