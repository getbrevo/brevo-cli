/*
 * Brevo Function commands: list -> list --draft -> get -> get (404).
 *
 * Read-only — no apps are created or deleted. The suite validates response shape
 * and error handling, not data content (the account may have zero functions).
 */

import {
  State,
  Suite,
  brevoCmd,
  exec,
  execOrThrow,
  must,
  parseJson,
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

  // Store the first function ID for the get step.
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

  return `${drafts.length} draft(s), total ${parsed.total}`;
}

function stepFunctionGet(state: State): string {
  const id = state._functionId;
  if (!id) {
    return 'skipped — no functions on this account to get';
  }

  const r = execOrThrow(brevoCmd(state), ['function', 'get', id, '--json'], state);
  const parsed = parseJson<Record<string, unknown>>(r.stdout);

  must(parsed.id === id, `function get: returned id "${parsed.id}", expected "${id}"`);
  must(typeof parsed.name === 'string', 'function get: missing "name"');
  must(typeof parsed.formula === 'string', 'function get: missing "formula"');
  must(typeof parsed.version === 'number', 'function get: missing "version"');
  must(typeof parsed.is_active === 'boolean', 'function get: missing "is_active"');

  return `got function "${parsed.name}" (${id})`;
}

function stepFunctionGetNotFound(state: State): string {
  // A nonexistent ID should exit 0 with a JSON error body — the command handles
  // 404 gracefully rather than throwing.
  const fakeId = 'brevo-cli-smoke-nonexistent-fn';
  const r = exec(brevoCmd(state), ['function', 'get', fakeId, '--json'], state);

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

// Extend State with a temporary field for the function ID found during list.
// This avoids changing the shared State interface — the field is set and read
// only within this suite.
declare module './core' {
  interface State {
    _functionId?: string | null;
  }
}

export const functionSuite: Suite = {
  name: 'function',
  description: 'Brevo Function commands — list, list --draft, get, get (404)',
  steps: [
    ['Function list', stepFunctionList],
    ['Function list (draft)', stepFunctionListDraft],
    ['Function get', stepFunctionGet],
    ['Function get (not found)', stepFunctionGetNotFound],
  ],
};
