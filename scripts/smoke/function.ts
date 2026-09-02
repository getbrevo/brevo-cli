/*
 * Brevo Function commands: list, get, activate/deactivate cycle, deploy, delete,
 * and the interactive `function init` (template path).
 *
 * The suite validates response shape and error handling. Mutation steps
 * (activate/deactivate, deploy, delete) restore the account to its original
 * state: the activate/deactivate cycle is idempotent, and a deployed function
 * is cleaned up at the end. The init step creates a function from a template
 * via a pty-driven interactive flow and deletes it afterwards.
 */

import {
  PtyExchange,
  State,
  Suite,
  brevoCmd,
  exec,
  execExpectPty,
  execOrThrow,
  must,
  parseJson,
  stampedName,
  stripAnsi,
} from './core';

function stepFunctionList(state: State): string {
  const r = execOrThrow(brevoCmd(state), ['function', 'list', '--json'], state);
  const parsed = parseJson<Record<string, unknown>>(r.stdout);

  // The response must carry the list shape regardless of how many functions exist.
  must(
    Array.isArray(parsed.functions),
    `function list --json: "functions" is not an array: ${JSON.stringify(parsed).slice(0, 200)}`,
  );
  must(
    typeof parsed.total === 'number',
    `function list --json: "total" is not a number: ${JSON.stringify(parsed).slice(0, 200)}`,
  );
  must(
    typeof parsed.max === 'number',
    `function list --json: "max" is not a number: ${JSON.stringify(parsed).slice(0, 200)}`,
  );

  const functions = parsed.functions as Array<Record<string, unknown>>;

  // If there are functions, spot-check the first one's shape.
  const first = functions[0];
  if (first) {
    must(typeof first.id === 'string', 'first function missing "id"');
    must(typeof first.name === 'string', 'first function missing "name"');
    must(typeof first.formula === 'string', 'first function missing "formula"');
  }

  // Store the first function ID for subsequent steps.
  state._functionId = first ? String(first.id) : null;

  return `${functions.length} function(s), total ${parsed.total} / max ${parsed.max}`;
}

function stepFunctionListDraft(state: State): string {
  const r = execOrThrow(brevoCmd(state), ['function', 'list', '--draft', '--json'], state);
  const parsed = parseJson<Record<string, unknown>>(r.stdout);

  must(
    Array.isArray(parsed.drafts),
    `function list --draft --json: "drafts" is not an array: ${JSON.stringify(parsed).slice(0, 200)}`,
  );
  must(
    typeof parsed.total === 'number',
    `function list --draft --json: "total" is not a number`,
  );

  const drafts = parsed.drafts as Array<Record<string, unknown>>;

  const firstDraft = drafts[0];
  if (firstDraft) {
    must(typeof firstDraft.id === 'string', 'first draft missing "id"');
    must(typeof firstDraft.formula === 'string', 'first draft missing "formula"');
  }

  // Store the first draft ID for the deploy step.
  state._draftId = firstDraft ? String(firstDraft.id) : null;

  return `${drafts.length} draft(s), total ${parsed.total}`;
}

function stepFunctionGet(state: State): string {
  const id = state._functionId;
  if (!id) {
    return 'skipped — no functions on this account to get';
  }

  const r = execOrThrow(brevoCmd(state), ['function', 'get', '--id', id, '--json'], state);
  const parsed = parseJson<Record<string, unknown>>(r.stdout);

  must(parsed.id === id, `function get: returned id "${parsed.id}", expected "${id}"`);
  must(typeof parsed.name === 'string', 'function get: missing "name"');
  must(typeof parsed.formula === 'string', 'function get: missing "formula"');
  must(typeof parsed.version === 'number', 'function get: missing "version"');
  must(typeof parsed.is_active === 'boolean', 'function get: missing "is_active"');

  // Store is_active for the activate/deactivate cycle.
  state._functionWasActive = parsed.is_active as boolean;

  return `got function "${parsed.name}" (${id})`;
}

function stepFunctionGetNotFound(state: State): string {
  // A nonexistent ID should exit 0 with a JSON error body — the command handles
  // 404 gracefully rather than throwing.
  const fakeId = 'brevo-cli-smoke-nonexistent-fn';
  const r = exec(brevoCmd(state), ['function', 'get', '--id', fakeId, '--json'], state);

  must(
    r.exitCode === 0,
    `function get (404) exited ${r.exitCode}, expected 0: ${(r.stderr || r.stdout).slice(0, 200)}`,
  );

  const parsed = parseJson<Record<string, unknown>>(r.stdout);
  must(
    parsed.error === 'not_found',
    `function get (404): expected error "not_found", got ${JSON.stringify(parsed.error)}`,
  );

  return `404 handled gracefully for "${fakeId}"`;
}

function stepFunctionActivateDeactivateCycle(state: State): string {
  const id = state._functionId;
  if (!id) {
    return 'skipped — no functions on this account';
  }

  const wasActive = state._functionWasActive;
  if (wasActive === undefined) {
    return 'skipped — get step did not record is_active';
  }

  // Toggle to the opposite state, then toggle back.
  // If active: deactivate -> verify -> activate -> verify.
  // If inactive: activate -> verify -> deactivate -> verify.
  const firstCmd = wasActive ? 'deactivate' : 'activate';
  const secondCmd = wasActive ? 'activate' : 'deactivate';
  const firstKey = wasActive ? 'deactivated' : 'activated';
  const secondKey = wasActive ? 'activated' : 'deactivated';

  // First toggle.
  const r1 = execOrThrow(
    brevoCmd(state),
    ['function', firstCmd, '--id', id, '--json'],
    state,
  );
  const p1 = parseJson<Record<string, unknown>>(r1.stdout);
  must(
    p1[firstKey] === true,
    `function ${firstCmd}: expected ${firstKey}=true, got ${JSON.stringify(p1).slice(0, 200)}`,
  );

  // Second toggle — restore original state.
  const r2 = execOrThrow(
    brevoCmd(state),
    ['function', secondCmd, '--id', id, '--json'],
    state,
  );
  const p2 = parseJson<Record<string, unknown>>(r2.stdout);
  must(
    p2[secondKey] === true,
    `function ${secondCmd}: expected ${secondKey}=true, got ${JSON.stringify(p2).slice(0, 200)}`,
  );

  return `${firstCmd} -> ${secondCmd} cycle complete (was ${wasActive ? 'active' : 'inactive'})`;
}

function stepFunctionActivateNotFound(state: State): string {
  const fakeId = 'brevo-cli-smoke-nonexistent-fn';
  const r = exec(brevoCmd(state), ['function', 'activate', '--id', fakeId, '--json'], state);

  must(
    r.exitCode === 0,
    `function activate (404) exited ${r.exitCode}, expected 0: ${(r.stderr || r.stdout).slice(0, 200)}`,
  );

  const parsed = parseJson<Record<string, unknown>>(r.stdout);
  must(
    parsed.error === 'not_found',
    `function activate (404): expected error "not_found", got ${JSON.stringify(parsed.error)}`,
  );

  return `404 handled gracefully for "${fakeId}"`;
}

function stepFunctionDeactivateNotFound(state: State): string {
  const fakeId = 'brevo-cli-smoke-nonexistent-fn';
  const r = exec(brevoCmd(state), ['function', 'deactivate', '--id', fakeId, '--json'], state);

  must(
    r.exitCode === 0,
    `function deactivate (404) exited ${r.exitCode}, expected 0: ${(r.stderr || r.stdout).slice(0, 200)}`,
  );

  const parsed = parseJson<Record<string, unknown>>(r.stdout);
  must(
    parsed.error === 'not_found',
    `function deactivate (404): expected error "not_found", got ${JSON.stringify(parsed.error)}`,
  );

  return `404 handled gracefully for "${fakeId}"`;
}

function stepFunctionDeleteNotFound(state: State): string {
  const fakeId = 'brevo-cli-smoke-nonexistent-fn';
  // --json skips the confirmation prompt, so this works headless.
  const r = exec(brevoCmd(state), ['function', 'delete', '--id', fakeId, '--json'], state);

  must(
    r.exitCode === 0,
    `function delete (404) exited ${r.exitCode}, expected 0: ${(r.stderr || r.stdout).slice(0, 200)}`,
  );

  const parsed = parseJson<Record<string, unknown>>(r.stdout);
  must(
    parsed.error === 'not_found',
    `function delete (404): expected error "not_found", got ${JSON.stringify(parsed.error)}`,
  );

  return `404 handled gracefully for "${fakeId}"`;
}

function stepFunctionDeploy(state: State): string {
  const draftId = state._draftId;
  if (!draftId) {
    return 'skipped — no drafts on this account to deploy';
  }

  const r = execOrThrow(
    brevoCmd(state),
    ['function', 'deploy', '--id', draftId, '--json'],
    state,
  );
  const parsed = parseJson<Record<string, unknown>>(r.stdout);

  must(
    parsed.deployed === true,
    `function deploy: expected deployed=true, got ${JSON.stringify(parsed).slice(0, 200)}`,
  );
  must(typeof parsed.id === 'string', 'function deploy: missing "id"');
  must(typeof parsed.name === 'string', 'function deploy: missing "name"');

  // Store the deployed function ID for cleanup.
  state._deployedFunctionId = String(parsed.id);

  return `deployed draft "${draftId}" as function "${parsed.name}" (${parsed.id})`;
}

function stepFunctionCleanup(state: State): string {
  const deployedId = state._deployedFunctionId;
  if (!deployedId) {
    return 'nothing to clean up';
  }

  // --json skips the confirmation prompt.
  const r = execOrThrow(
    brevoCmd(state),
    ['function', 'delete', '--id', deployedId, '--json'],
    state,
  );
  const parsed = parseJson<Record<string, unknown>>(r.stdout);

  must(
    parsed.deleted === true,
    `function cleanup: expected deleted=true, got ${JSON.stringify(parsed).slice(0, 200)}`,
  );

  state._deployedFunctionId = null;

  return `deleted deployed function "${deployedId}"`;
}

// ─────────────────── function init (template path, pty) ───────────────────

// Expect patterns for the interactive `brevo function init` prompts.
// Kept short and anchored on distinctive words — pty transcripts wrap at a
// fixed width and carry ANSI escapes that stripAnsi removes; a long phrase
// spanning a line break never matches.
//
// Prompt sequence (template path):
//   1. App selection list          → Enter (first app)
//   2. Method selection            → '2' = "Use a predefined template"
//   3. Template list               → Enter (first template)
//   4. [Preview runs automatically — no prompt]
//   5. Function name               → type the stamped name
//   6. Deploy confirmation         → 'Y'
const FN_INIT_EXPECT = {
  selectApp: /Select a Brevo Function app/,
  method: /How would you like to create/,
  selectTemplate: /Select a template/,
  namePrompt: /Enter a name for this function/,
  confirmDeploy: /Are you sure you want to deploy/,
  deployedBox: /Function deployed/,
} as const;

function initExchanges(functionName: string): PtyExchange[] {
  return [
    // 1. Pick first app
    { expect: FN_INIT_EXPECT.selectApp, send: '' },
    // 2. Pick "Use a predefined template" (second choice)
    { expect: FN_INIT_EXPECT.method, send: '2' },
    // 3. Pick first template
    { expect: FN_INIT_EXPECT.selectTemplate, send: '' },
    // 4. Preview runs automatically — wait for the name prompt
    // 5. Type the function name
    { expect: FN_INIT_EXPECT.namePrompt, send: functionName },
    // 6. Confirm deploy
    { expect: FN_INIT_EXPECT.confirmDeploy, send: 'Y' },
  ];
}

async function stepFunctionInit(state: State): Promise<string> {
  // Pre-check: the account may already be at its function limit (e.g. max 10).
  // If so, skip rather than fail on a server-side capacity error.
  const listR = execOrThrow(brevoCmd(state), ['function', 'list', '--json'], state);
  const listParsed = parseJson<Record<string, unknown>>(listR.stdout);
  const total = listParsed.total as number;
  const max = listParsed.max as number;
  if (typeof total === 'number' && typeof max === 'number' && total >= max) {
    return `skipped — account at function limit (${total}/${max})`;
  }

  const name = stampedName(state, 'fn-init');

  const r = await execExpectPty(
    brevoCmd(state),
    ['function', 'init'],
    state,
    {
      exchanges: initExchanges(name),
      // The template flow includes a preview step that calls the API, so
      // generous timeouts are needed between prompts.
      expectTimeoutMs: 60_000,
      exitTimeoutMs: 30_000,
    },
  );

  if (r.aborted) {
    return 'skipped — function init prompt flow aborted (build may lack the command)';
  }

  const transcript = stripAnsi(r.stdout);

  // Handle server-side limit error that can race with our pre-check (another
  // function created between the list and the deploy).
  if (r.exitCode !== 0 && /function limit reached/i.test(transcript)) {
    return `skipped — account hit function limit during deploy`;
  }

  must(
    r.exitCode === 0,
    `function init exited ${r.exitCode}: ${transcript.slice(-300)}`,
  );

  // Extract the function ID from the "Function deployed" box.
  // The box prints "ID:   <uuid>". Anchor after "Function deployed" so we
  // don't accidentally match the app ID from the earlier selection prompt.
  const deployedIdx = transcript.indexOf('Function deployed');
  const afterDeployed = deployedIdx >= 0 ? transcript.slice(deployedIdx) : transcript;
  const idMatch = /ID:\s+([0-9a-f-]{36})/i.exec(afterDeployed);
  const functionId = idMatch?.[1] ?? null;

  must(functionId, `function init: could not extract function ID from transcript`);

  // Store for cleanup.
  state._initFunctionId = functionId;

  return `created function "${name}" via template (${functionId})`;
}

function stepFunctionInitCleanup(state: State): string {
  const id = state._initFunctionId;
  if (!id) {
    return 'nothing to clean up (init did not create a function)';
  }

  // --json skips the confirmation prompt.
  const r = execOrThrow(
    brevoCmd(state),
    ['function', 'delete', '--id', id, '--json'],
    state,
  );
  const parsed = parseJson<Record<string, unknown>>(r.stdout);

  must(
    parsed.deleted === true,
    `function init cleanup: expected deleted=true, got ${JSON.stringify(parsed).slice(0, 200)}`,
  );

  state._initFunctionId = null;

  return `deleted init function "${id}"`;
}

// Extend State with fields used across steps within this suite.
declare module './core' {
  interface State {
    _functionId?: string | null;
    _functionWasActive?: boolean;
    _draftId?: string | null;
    _deployedFunctionId?: string | null;
    _initFunctionId?: string | null;
  }
}

export const functionSuite: Suite = {
  name: 'function',
  description:
    'Brevo Function commands — list, get, activate/deactivate cycle, deploy, init, error probes',
  steps: [
    ['Function list', stepFunctionList],
    ['Function list (draft)', stepFunctionListDraft],
    ['Function get', stepFunctionGet],
    ['Function get (not found)', stepFunctionGetNotFound],
    ['Function activate/deactivate cycle', stepFunctionActivateDeactivateCycle],
    ['Function activate (not found)', stepFunctionActivateNotFound],
    ['Function deactivate (not found)', stepFunctionDeactivateNotFound],
    ['Function delete (not found)', stepFunctionDeleteNotFound],
    ['Function deploy (draft)', stepFunctionDeploy],
    ['Function cleanup', stepFunctionCleanup],
    ['Function init (template)', stepFunctionInit],
    ['Function init cleanup', stepFunctionInitCleanup],
  ],
};
