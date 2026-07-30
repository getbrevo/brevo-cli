/*
 * Public-app review lifecycle: create -> upload -> status -> submit -> submit
 * again -> status -> withdraw -> status -> delete, plus the unknown-app probes.
 */

import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  FailureExpectation,
  SmokeApp,
  State,
  Suite,
  assertMappedFailure,
  brevoCmd,
  createSmokeApp,
  deleteSmokeApp,
  ensureWorkRoot,
  exec,
  execOrThrow,
  firstLine,
  must,
  optStr,
  parseJson,
  requireApp,
  requireCommand,
  skip,
  uploadApp,
} from './core';

// Every state src/lang/en.ts (APP_STATUS_MESSAGE) has canned copy for, plus the
// 'unknown' sentinel status.ts normalises an empty state to. An unrecognised
// value means the server grew a state the CLI doesn't describe yet.
const KNOWN_REVIEW_STATES = [
  'unknown',
  'configured',
  'submitted',
  'in_review',
  'approved',
  'rejected',
  'changes_requested',
];

const SUBMITTED_STATES = new Set(['submitted', 'in_review']);

const SMOKE_LOGO_URI = 'https://example.com/logo.png';

async function stepPublicAppCreate(state: State): Promise<string> {
  // --distribution public is accepted since BEX-327; the old negative step that
  // asserted the CLI rejected it has been removed. --logo-uri exercises the
  // optional create field from BEX-255 in the same call.
  const app = await createSmokeApp(state, {
    label: 'public',
    distribution: 'public',
    logoUri: SMOKE_LOGO_URI,
  });
  return `public app ${app.appId} created in ${app.projectDir}, listed`;
}

function stepPublicAppUpload(state: State): string {
  requireCommand(state, 'upload');
  const app = requireApp(state.publicApp, 'public');
  const res = uploadApp(state, app);
  const next = (res.next ?? {}) as Record<string, unknown>;
  must(
    next.distribution_type === 'public',
    `upload next.distribution_type ${JSON.stringify(next.distribution_type)} != public`,
  );
  return `public app uploaded, version ${optStr(res.version)}`;
}

// Read the review state through `brevo app status --json`. The state itself is
// the backend's to decide, so it's recorded, not dictated — what's asserted is
// that the CLI returns a state it has copy for, with a message.
function readReviewState(state: State, app: SmokeApp): string {
  const r = execOrThrow(brevoCmd(state), ['app', 'status', '--app-id', app.appId, '--json'], state);
  const parsed = parseJson<Record<string, unknown>>(r.stdout);
  const reviewState = parsed.state;
  must(
    typeof reviewState === 'string' && reviewState.length > 0,
    `status --json has no state: ${JSON.stringify(parsed)}`,
  );
  must(
    typeof parsed.message === 'string' && parsed.message.length > 0,
    `status --json has no message: ${JSON.stringify(parsed)}`,
  );
  must(
    KNOWN_REVIEW_STATES.includes(reviewState as string),
    `status returned state "${String(reviewState)}", which the CLI has no copy for (known: ${KNOWN_REVIEW_STATES.join(', ')})`,
  );
  return reviewState as string;
}

function stepPublicAppStatus(state: State): string {
  requireCommand(state, 'status');
  const app = requireApp(state.publicApp, 'public');
  const reviewState = readReviewState(state, app);
  state.publicObs.stateBeforeSubmit = reviewState;
  return `pre-submit state: ${reviewState}`;
}

// `brevo app submit` does not itself transition the app — it validates the app
// (public, in sync with app-config.json) and hands back the review form URL;
// the state only moves once the form is submitted. So this asserts everything
// the CLI owns and records the URL.
function stepPublicAppSubmit(state: State): string {
  requireCommand(state, 'submit');
  const app = requireApp(state.publicApp, 'public');
  // Run from the project dir so the local-vs-server drift check is exercised;
  // straight after an upload it must come back clean. Without a project dir
  // (older build) submit still works from --app-id alone, minus the drift check.
  const r = exec(brevoCmd(state), ['app', 'submit', '--app-id', app.appId, '--json'], state, {
    cwd: app.projectDir || ensureWorkRoot(state),
  });

  if (r.exitCode !== 0) {
    const text = `${r.stderr}\n${r.stdout}`;
    // No review form link on the app means the backend isn't serving one for
    // this account yet (pre-GA) — there's nothing for the CLI to do, so skip
    // loudly instead of reporting a CLI failure. Anything else, including a
    // config mismatch right after a clean upload, is a real failure.
    if (/Review submission is currently unavailable/.test(text)) {
      skip(`backend returned no review form link for app ${app.appId} (${firstLine(text)})`);
    }
    throw new Error(`submit failed with exit ${r.exitCode}: ${firstLine(text)}`);
  }

  const parsed = parseJson<Record<string, unknown>>(r.stdout);
  must(
    String(parsed.app_id) === app.appId,
    `submit returned app_id ${JSON.stringify(parsed.app_id)} != ${app.appId}`,
  );
  const formUrl = parsed.form_url;
  must(
    typeof formUrl === 'string' && /^https?:\/\//.test(formUrl),
    `submit returned no usable form_url: ${JSON.stringify(formUrl)}`,
  );
  state.publicObs.formUrl = formUrl as string;
  return `submit returned a review form URL for app ${app.appId}`;
}

// Submitting the same app twice. The CLI's submit is a form hand-off rather
// than a state transition, so a server-side "already submitted" rejection can't
// be produced from the CLI alone — what's asserted is that the second call is
// either idempotent (same form URL) or refused with the mapped
// already-under-review message, never an unmapped error.
function stepPublicAppSubmitAgain(state: State): string {
  requireCommand(state, 'submit');
  const app = requireApp(state.publicApp, 'public');
  if (!state.publicObs.formUrl) skip('first submit did not run, nothing to repeat');

  const r = exec(brevoCmd(state), ['app', 'submit', '--app-id', app.appId, '--json'], state, {
    cwd: app.projectDir || ensureWorkRoot(state),
  });
  if (r.exitCode === 0) {
    const parsed = parseJson<Record<string, unknown>>(r.stdout);
    must(
      parsed.form_url === state.publicObs.formUrl,
      `repeat submit returned a different form_url than the first call`,
    );
    return 'repeat submit is idempotent (same form URL, exit 0)';
  }
  return assertMappedFailure(r, {
    what: 'repeat submit',
    patterns: [/Review submission is currently unavailable/],
    exitCodes: [1],
  });
}

function stepPublicAppStatusAfterSubmit(state: State): string {
  requireCommand(state, 'status');
  const app = requireApp(state.publicApp, 'public');
  const reviewState = readReviewState(state, app);
  state.publicObs.stateAfterSubmit = reviewState;
  const before = state.publicObs.stateBeforeSubmit;
  // A transition only happens if the backend moves the app when the review form
  // link is issued — it usually waits for the form itself, so report either way.
  const moved = before && before !== reviewState ? ` (was ${before})` : ' (unchanged)';
  return `post-submit state: ${reviewState}${moved}`;
}

// `brevo app withdraw` has two documented success shapes (src/commands/app/withdraw.ts):
// an actual withdrawal, or the mapped HTTP 422 "not submitted yet" report which
// is informational and deliberately exits 0. Assert whichever applies, then
// re-read the state.
function stepPublicAppWithdraw(state: State): string {
  requireCommand(state, 'withdraw');
  const app = requireApp(state.publicApp, 'public');
  const r = exec(
    brevoCmd(state),
    ['app', 'withdraw', '--app-id', app.appId, '--force', '--json'],
    state,
  );
  const combinedOutput = `${r.stderr}\n${r.stdout}`;
  must(
    r.exitCode === 0,
    `withdraw exited ${r.exitCode} (both documented outcomes exit 0): ${firstLine(combinedOutput)}`,
  );
  const parsed = parseJson<Record<string, unknown>>(r.stdout);
  must(
    String(parsed.appId) === app.appId,
    `withdraw returned appId ${JSON.stringify(parsed.appId)} != ${app.appId}`,
  );

  if (parsed.withdrawn === true) {
    state.publicObs.withdrawn = true;
    return `app ${app.appId} withdrawn`;
  }

  must(
    parsed.withdrawn === false,
    `withdraw --json has no boolean "withdrawn": ${JSON.stringify(parsed)}`,
  );
  must(
    parsed.reason === 'NOT_SUBMITTED',
    `withdraw reported withdrawn:false with reason ${JSON.stringify(parsed.reason)}, expected NOT_SUBMITTED`,
  );
  must(
    typeof parsed.message === 'string' && /has not been submitted yet/.test(parsed.message),
    `withdraw NOT_SUBMITTED message is not the mapped one: ${JSON.stringify(parsed.message)}`,
  );
  must(
    typeof parsed.submitCommand === 'string' && parsed.submitCommand.includes('brevo app submit'),
    `withdraw NOT_SUBMITTED did not include the submit hint: ${JSON.stringify(parsed.submitCommand)}`,
  );
  state.publicObs.withdrawn = false;
  state.publicObs.withdrawReason = 'NOT_SUBMITTED';
  return `not-submitted app mapped to NOT_SUBMITTED (exit 0, by design)`;
}

function stepPublicAppStatusAfterWithdraw(state: State): string {
  requireCommand(state, 'status');
  const app = requireApp(state.publicApp, 'public');
  const reviewState = readReviewState(state, app);
  state.publicObs.stateAfterWithdraw = reviewState;
  // Only a real withdrawal implies a state change; a NOT_SUBMITTED no-op must
  // leave the app exactly where it was.
  if (state.publicObs.withdrawn === true) {
    must(
      !SUBMITTED_STATES.has(reviewState),
      `app is still "${reviewState}" after a successful withdraw`,
    );
  } else if (state.publicObs.stateAfterSubmit) {
    must(
      reviewState === state.publicObs.stateAfterSubmit,
      `no-op withdraw changed the state: ${state.publicObs.stateAfterSubmit} → ${reviewState}`,
    );
  }
  return `post-withdraw state: ${reviewState}`;
}

async function stepDeletePublicApp(state: State): Promise<string> {
  const app = requireApp(state.publicApp, 'public');
  const detail = await deleteSmokeApp(state, app);
  state.publicApp = null;
  return detail;
}

// ──────────────────────────── init wizard ────────────────────────────

// Unknown app IDs must map to the friendly not-found message, not a raw HTTP
// error. Uses a random UUID that cannot exist on the account.
function stepNegativeUnknownApp(state: State): string {
  const fakeId = randomUUID();
  const details: string[] = [];
  const expectation = (what: string): FailureExpectation => ({
    what,
    patterns: [/not found\./i, /don't have access|access denied|not authorized/i],
    // 404 → NOT_FOUND (5). A backend that answers 403 for someone else's app
    // maps to ERROR (1) — see statusToExitCode in src/lib/errors.ts.
    exitCodes: [1, 5],
  });

  if (state.caps?.status !== false) {
    details.push(
      assertMappedFailure(
        exec(brevoCmd(state), ['app', 'status', '--app-id', fakeId, '--json'], state),
        expectation('status on an unknown app'),
      ),
    );
  }
  if (state.caps?.withdraw !== false) {
    details.push(
      assertMappedFailure(
        exec(brevoCmd(state), ['app', 'withdraw', '--app-id', fakeId, '--force', '--json'], state),
        expectation('withdraw on an unknown app'),
      ),
    );
  }
  if (details.length === 0) skip('neither app status nor app withdraw is available in this build');
  return details.join('; ');
}

export const publicAppSuite: Suite = {
  name: 'public',
  description: 'Public-app submission and review lifecycle',
  steps: [
    ['Public app create', stepPublicAppCreate],
    ['Public app upload', stepPublicAppUpload],
    ['Public app status', stepPublicAppStatus],
    ['Public app submit', stepPublicAppSubmit],
    ['Public app submit (repeat)', stepPublicAppSubmitAgain],
    ['Public app status after submit', stepPublicAppStatusAfterSubmit],
    ['Public app withdraw', stepPublicAppWithdraw],
    ['Public app status after withdraw', stepPublicAppStatusAfterWithdraw],
    ['Negative: unknown app id', stepNegativeUnknownApp],
    ['Delete public test app', stepDeletePublicApp],
  ],
};
