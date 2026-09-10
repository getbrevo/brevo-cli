/*
 * M2M (machine-to-machine) OAuth apps — the INTERACTIVE half: the OAuth-flow
 * prompt and the live scope-catalog picker, driven through a pty, then delete.
 *
 * The non-interactive half is in the `private` suite (`--m2m --scopes …`, the
 * credentials read, and every flag refusal `assertM2mFlags` owns) — it needs no
 * terminal, so it stays in the DEFAULT set where it runs on every smoke. This
 * suite is the part that cannot: `app create` only asks *which OAuth flow* on a
 * real terminal (`process.stdin.isTTY`), exactly like the UI-app type prompt, so
 * it is opt-in for the same reason `ui` and `init` are (`--suite=private,m2m`).
 *
 * What it covers that the flag path structurally cannot:
 *   - the flow prompt exists, and answering it with *Machine to Machine*
 *     produces an M2M app;
 *   - the scope picker renders the IdP's catalog, and what it grants is real
 *     catalog scopes — cross-checked against `app available-scopes --json`,
 *     which reads the same catalog;
 *   - create-only holds on the prompt path too: no project directory is written.
 *
 * The catalog read can fail, in which case the CLI falls back to the typed
 * comma-separated prompt. The scope exchange answers whichever prompt appears,
 * so an IdP hiccup costs the cross-check (reported in the step detail) rather
 * than the run.
 *
 * The app is tracked on `state.m2mApp`, the same slot the `private` suite uses.
 * Safe because each suite deletes its own app in its last step, and it means
 * every cleanup path — the leftover-app step and the signal traps — already
 * covers this suite with no new wiring.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  PtyExchange,
  State,
  Suite,
  brevoCmd,
  computeSlug,
  deleteSmokeApp,
  exec,
  execExpectPty,
  execOrThrow,
  findAppByName,
  firstLine,
  must,
  parseJson,
  printOrphanWarning,
  requireApp,
  requireFeature,
  sameSet,
  skip,
  sleep,
  stampedName,
  stripAnsi,
  trackTmpDir,
} from './core';

/**
 * The prompt patterns, exported so `en.test.ts` can pin them against `messages`
 * — same contract, and the same reason, as `UI_CREATE_EXPECT` in ./ui-app: the
 * smoke drives the REAL binary (whose strings may legitimately lag this repo
 * under `--against=published`), so a reword can only be caught by a test that
 * sees both sides. Keep every pattern SHORT and free of typographic punctuation:
 * the copy uses curly apostrophes and em dashes, and a pty transcript wraps at a
 * fixed width, so a long phrase can break mid-match.
 *
 * `scopes` matches EITHER scope prompt on purpose — the picker when the catalog
 * read succeeded, the typed fallback when it didn't. Which one rendered is
 * decided by the sender, not by waiting for one and timing out on the other.
 */
export const M2M_CREATE_EXPECT = {
  logo: /App logo URL \(optional/,
  appTypeOAuth: /OAuth app\s+\(Authorize against Brevo/,
  flowConsent: /Consent Based\s+\(A user authorizes/,
  flowM2m: /Machine to Machine\s+\(Your server calls/,
  scopes: /Which scopes does this app need\?|Scopes \(comma-separated\):/,
  scopePicker: /Which scopes does this app need\?/,
} as const;

/** Answer for the typed fallback. Two scopes, so the split path is exercised too. */
const FALLBACK_SCOPES = ['contacts:read', 'crm:read'];

// The interactive sequence, with `--name` and `--distribution` passed as flags:
//
//   1. logo (input, optional) → Enter
//   2. app type (list)        → Enter (OAuth app is the first choice)
//   3. OAuth flow (list)      → '2' = Machine to Machine, or abort → skip. Same
//                               shape as the UI suite's app-type exchange:
//                               matched on the *Consent* line so the choices
//                               have provably rendered before the transcript is
//                               inspected for the M2M one.
//   4. scopes                 → the picker: <space> ticks the highlighted first
//                               row and Enter submits (a `send` string is
//                               written with '\n' appended, so ' ' is exactly
//                               that). The first row is a category heading,
//                               whose shortcut ticks every scope under it — the
//                               cascade is the part with no flag equivalent.
//                               The typed fallback gets scope names instead.
//
// Nothing is asked after the POST: the M2M path prints the created-app box and
// returns — no directory prompt, and no feature offer.
function createExchanges(): PtyExchange[] {
  return [
    { expect: M2M_CREATE_EXPECT.logo, send: '' },
    { expect: M2M_CREATE_EXPECT.appTypeOAuth, send: '' },
    {
      expect: M2M_CREATE_EXPECT.flowConsent,
      send: (transcript) => (M2M_CREATE_EXPECT.flowM2m.test(transcript) ? '2' : null),
    },
    {
      expect: M2M_CREATE_EXPECT.scopes,
      send: (transcript) =>
        M2M_CREATE_EXPECT.scopePicker.test(transcript) ? ' ' : FALLBACK_SCOPES.join(','),
    },
  ];
}

// Secondary appId recovery, same as the UI and init suites: the stamped name
// makes the app identifiable when parsing the transcript fails, which is what
// keeps a created app from leaking on a box-rendering change.
async function findM2mAppByName(state: State, expectedName: string): Promise<string | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = execOrThrow(brevoCmd(state), ['app', 'list', '--json'], state);
    const found = findAppByName(parseJson(r.stdout), expectedName);
    if (found) return found;
    if (attempt < 3) await sleep([500, 1000, 2000][attempt] ?? 2000);
  }
  return null;
}

/**
 * The scopes the created-app box reports.
 *
 * Read off the box rather than from `--json`, because the prompt path has no
 * `--json`: this is the only place the granted list is visible on this route.
 *
 * Box rows are `  │ <content> │` (U+2502, not an ASCII pipe) and `printBox`
 * FOLDS a row past the content budget — a whole-category grant is well past it —
 * so this takes everything between the label and the box's bottom border (the
 * `Scopes:` line is the last body row) and strips the chrome per line, instead of
 * matching a single line and reading a wide grant as a short one.
 */
function scopesFromBox(transcript: string): string[] {
  const region = /Scopes:([\s\S]*?)(?:└|$)/.exec(transcript)?.[1] ?? '';
  return region
    .split(/[,\n]/)
    .map((token) => token.replaceAll('│', ' ').trim())
    .filter((token) => /^[a-z][a-z0-9_.:-]*$/i.test(token));
}

/** The catalog, or null when the IdP could not be read (the fallback's own cause). */
function readCatalog(state: State): string[] | null {
  const r = exec(brevoCmd(state), ['app', 'available-scopes', '--json'], state);
  if (r.exitCode !== 0) return null;
  try {
    const parsed = parseJson<{ scopes?: unknown }>(r.stdout);
    const scopes = Array.isArray(parsed.scopes) ? parsed.scopes : [];
    const names = scopes.filter((s): s is string => typeof s === 'string');
    return names.length > 0 ? names : null;
  } catch {
    return null;
  }
}

async function stepM2mInteractiveCreate(state: State): Promise<string> {
  // The flag and the flow prompt shipped together, so the `--m2m` probe answers
  // for both: on a build without it the prompt never renders and the run would
  // burn a 120s expect timeout instead of skipping.
  requireFeature(state, 'm2m-flag');

  const tmp = trackTmpDir(state, 'brevo-smoke-m2m-');
  const name = stampedName(state, 'm2m-tty');

  const r = await execExpectPty(
    brevoCmd(state),
    ['app', 'create', '--name', name, '--distribution', 'private'],
    state,
    { cwd: tmp, exchanges: createExchanges() },
  );

  // Aborted at the flow prompt: the choices rendered without *Machine to
  // Machine*, so the installed build predates the flow. Nothing was created —
  // create makes no API call until every prompt is answered.
  if (r.aborted) {
    skip(
      `the installed build's OAuth-flow prompt offers no M2M choice (--against=${state.opts.against})`,
    );
  }
  const transcript = stripAnsi(r.stdout);
  if (r.exitCode !== 0) {
    throw new Error(`brevo app create exited ${r.exitCode}: ${firstLine(transcript)}`);
  }

  const uuidPattern = /App ID:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
  let appId = uuidPattern.exec(transcript)?.[1] ?? null;
  if (!appId) appId = await findM2mAppByName(state, name);

  // Same refusal as the UI and init suites: no blind "delete the newest app"
  // guess. An M2M app writes nothing to disk, so the box and the listing are the
  // only two places its id can come from — if both missed, say so loudly and
  // name the app for manual cleanup.
  if (!appId) {
    printOrphanWarning(state, [], name);
    throw new Error(
      `could not identify the created M2M app (expected name "${name}"); refusing to guess. See orphan warning above for manual cleanup.`,
    );
  }

  // Registered before any assertion below can throw, so a failure still cleans
  // up. Both '' fields are the point of an M2M app: no callback, nothing on disk.
  state.m2mApp = { appId, name, distribution: 'private', projectDir: '', redirectUri: '' };

  const picked = scopesFromBox(transcript);
  // The tail, not `firstLine`: the box is the last thing printed, so the first
  // line of a 9-prompt transcript is the logo question and says nothing about
  // what went wrong here.
  must(
    picked.length > 0,
    `interactive m2m create granted no scopes — transcript tail: ${transcript.slice(-300)}`,
  );

  // Create-only, asserted on disk: `app create` would have written `./<slug>`.
  const wouldBeDir = join(tmp, computeSlug(name));
  must(
    !existsSync(wouldBeDir),
    `interactive m2m create wrote a project directory at ${wouldBeDir}`,
  );

  const viaPicker = M2M_CREATE_EXPECT.scopePicker.test(transcript);
  if (!viaPicker) {
    // The typed fallback answered, so the picker never ran and there is no
    // catalog to check against — reported rather than failed: an unreadable IdP
    // is the fallback's whole reason for existing. What CAN be asserted exactly
    // is the round trip, since this branch typed the list itself: two short
    // names cannot fold, so the box must echo both and nothing else.
    must(
      sameSet(picked, FALLBACK_SCOPES),
      `the typed fallback granted ${picked.join(', ')}, expected ${FALLBACK_SCOPES.join(', ')}`,
    );
    return `m2m app ${appId} created via the typed fallback (catalog unreadable), scopes ${picked.join(', ')}, no project directory`;
  }

  const catalog = readCatalog(state);
  if (!catalog) {
    return `m2m app ${appId} created via the picker, scopes ${picked.join(', ')} (catalog unreadable on re-read, not cross-checked)`;
  }
  // `some`, not `every`, on purpose: `takeRow` hard-breaks a row with no space
  // past half the width, so one parsed token can in principle be a fragment of a
  // long scope name — and a fold artefact must not read as a bogus grant. What
  // this has to catch is a grant that is not catalog-derived AT ALL, which is
  // what a broken cascade or a mis-sent keypress would produce.
  const known = picked.filter((scope) => catalog.includes(scope));
  must(
    known.length > 0,
    `none of the granted scopes are in the catalog: granted ${picked.join(', ')}`,
  );
  return `m2m app ${appId} created via the picker, ${known.length}/${picked.length} granted scope(s) matched the catalog, no project directory`;
}

async function stepM2mInteractiveDelete(state: State): Promise<string> {
  requireFeature(state, 'm2m-flag');
  const app = requireApp(state.m2mApp, 'm2m');
  const detail = await deleteSmokeApp(state, app);
  state.m2mApp = null;
  return detail;
}

export const m2mSuite: Suite = {
  name: 'm2m',
  description: 'Interactive M2M create: OAuth-flow prompt + scope-catalog picker (pty)',
  steps: [
    ['M2M create (pty)', stepM2mInteractiveCreate],
    ['Delete interactive M2M app', stepM2mInteractiveDelete],
  ],
};
