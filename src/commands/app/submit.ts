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
import { AppStateResponse, OAuthApp } from '../../types';
import { assertCapability, resolveFromRecord, type Distribution } from '../../app-types';

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
  const localUrls = config.auth?.redirectUris ?? [];
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

// Preflight through the canonical review-state read (`brevo app status`'s path)
// before doing any submit work. A failed fetch — network, auth, or a not-found
// app — propagates to the command handler and aborts the submission. The
// returned state also carries the submittability signal (BEX-383), consumed by
// `assertSubmittable` immediately after this read.
async function preflightAppState(
  appId: string,
  silent: boolean | undefined,
): Promise<AppStateResponse> {
  const spinner = createSpinner(messages.APP_SUBMIT_CHECKING_STATUS, { silent });
  try {
    return await appService.fetchAppState(appId);
  } finally {
    spinner.stop();
  }
}

// Block a submission the backend would reject for incompleteness. The state API
// reports `submittable` plus the specific `missing_fields`; only an explicit
// `false` gates, so an older server that omits the flag still submits (matches the
// optional type in AppStateResponse). Both modes show the field keys exactly as the
// server returns them (e.g. `logoLink`, `oauth.scopes`) — no local relabelling — so
// the developer sees the same name the API uses. --json is a compact inline list;
// humans get the multiline list.
function assertSubmittable(state: AppStateResponse, jsonMode: boolean, appId: string): void {
  if (state.submittable !== false) return;
  const fields = state.missing_fields ?? [];
  if (jsonMode) {
    throw new CliError(messages.APP_SUBMIT_NOT_SUBMITTABLE(fields, appId));
  }
  const diff = fields.map((f) => `  ${f}`).join('\n');
  throw new CliError(messages.APP_SUBMIT_NOT_SUBMITTABLE_DIFF(diff, appId));
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

  // Fetch the app BEFORE the review-state read, so an app that was never uploaded is
  // refused in the CLI's own words (TC-6.3). The order used to be the other way round —
  // state read first, "a failed read aborts before we attempt to submit" — and it still
  // does abort, just one round trip later. What the old order cost was the error message:
  // the state read fails on an app with no `app_versions` row, and the server's copy for
  // that failure names `name`, `logo_uri`, `scopes` and `redirect_uris` as the things to
  // fix. All four can be present. Nothing in `apiCodeMessages` maps the code, so it
  // reached the user verbatim and sent them auditing fields that were already correct.
  //
  // `version` is the certain signal: it is written only by a successful `app upload`, so
  // its absence means the app has never been uploaded and cannot have a review state.
  // Same gate `app install` already applies for the same reason — see
  // `assertInstallable`'s `requireUploaded` in `account-install.ts`, and CLAUDE.md on why
  // a local pre-flight is kept even where the server also checks.
  const app = await fetchExistingApp(appId, options.json);
  if (!app.version?.trim()) {
    throw new CliError(messages.APP_SUBMIT_NOT_UPLOADED(appId));
  }

  // The response carries the submittability signal used just below.
  const state = await preflightAppState(appId, options.json);

  // Block when the app is still missing fields required for review (BEX-383) before
  // doing any submit work.
  assertSubmittable(state, !!options.json, appId);

  // Only public apps can be submitted for review — expressed as a capability so the rule
  // lives in one table (`src/app-types/capabilities.ts`) instead of being restated by each
  // command that needs it.
  //
  // The MESSAGE stays this command's own, deliberately: scripts may match on it and
  // `CLAUDE.md` counts a changed error string or exit code as user-visible, so the matrix
  // single-sources the decision while the wording is unchanged.
  //
  // A missing distribution_type (older server) reads as `private` and so still fails closed,
  // exactly as the direct `!== 'public'` comparison did.
  const distribution: Distribution = app.distribution_type === 'public' ? 'public' : 'private';
  assertCapability(
    resolveFromRecord(app).id,
    distribution,
    'review-lifecycle',
    messages.APP_SUBMIT_NOT_PUBLIC(appId),
  );

  // Tracks whether we actually ran a local-vs-server comparison and it came back
  // clean — only then does the "no mismatch" note make sense to show.
  const configVerified = assertConfigInSync(config, app, appId, !!options.json);

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

  openSubmissionForm(formUrl, appId);
  logInfo(messages.APP_SUBMIT_FORM_GATE);
  logInfo(messages.APP_SUBMIT_NEXT_STEPS);
});

/**
 * Refuse a submission whose local `app-config.json` no longer matches the server, and
 * report whether a comparison actually ran and came back clean.
 *
 * The local config is only a sync source when it describes the app being submitted; a
 * different `--app-id` makes it irrelevant, not an error (submit never writes locally).
 */
function assertConfigInSync(
  config: ProjectConfig | null,
  app: OAuthApp,
  appId: string,
  jsonMode: boolean,
): boolean {
  if (!config?.appId || config.appId !== appId) return false;

  const drift = computeConfigDrift(config, app);
  if (drift.length > 0) {
    // JSON mode keeps the compact field-name message (machine consumers only
    // need the outcome); human mode shows the value-level diff.
    throw new CliError(
      jsonMode
        ? messages.APP_SUBMIT_OUT_OF_SYNC(
            drift.map((d) => d.field),
            appId,
          )
        : messages.APP_SUBMIT_OUT_OF_SYNC_DIFF(renderDriftBlock(drift), appId),
    );
  }
  return true;
}

function openSubmissionForm(formUrl: string, appId: string): void {
  // Both branches include the URL, so headless users always get it.
  try {
    openBrowser(formUrl);
    logSuccess(messages.APP_SUBMIT_BROWSER_OPENED(formUrl, appId));
  } catch (err) {
    logDebug('openBrowser failed', { message: (err as Error).message });
    logInfo(messages.APP_SUBMIT_BROWSER_FAILED(formUrl, appId));
  }
}
