/**
 * Define the build-time globals that esbuild substitutes in a real build (BEX-405).
 *
 * `__BREVO_PREVIEW__` does not exist under jest — nothing is bundled, so nothing is
 * substituted — and every module that reads it would throw `ReferenceError` on import.
 * Defining it here gives the suite a single, explicit build state to run against.
 *
 * **It is `true`, i.e. the preview build.** The ~80 tests covering `app deploy`,
 * `app rollback`, `app submit`, `app status`, `app withdraw`, UI-app creation and
 * `--distribution public` are tests of those features, not of the gate; running them
 * against a public build would mean asserting that five commands don't exist. The gate
 * itself is covered separately in `src/__tests__/lib/preview.test.ts` and
 * `preview-gate.test.ts`, which flip this global and re-import through
 * `jest.isolateModules` so both build states are exercised in one run — that is the
 * whole reason the flag is read through a global rather than baked by the bundler
 * alone.
 */
globalThis.__BREVO_PREVIEW__ = true;

/**
 * Scrub every ambient `BREVO_*` variable out of the environment.
 *
 * The CLI reads its own configuration from `process.env` — `BREVO_API_KEY` (which
 * `getApiKey()`/`getAuthCred()` return *before* ever touching the credentials file),
 * `BREVO_API_URL`, `BREVO_CONFIG_HOME`, `BREVO_DEBUG`, `BREVO_OAUTH_PROXY_URL`,
 * `BREVO_CLAUDE_HOME`, `BREVO_NO_SKILL_AUTOREFRESH`. A developer working on this CLI
 * very plausibly has some of those exported in their shell, and jest inherits the
 * environment wholesale — so the suite would pass in CI and fail on their machine.
 * That is exactly what happened: an exported `BREVO_API_KEY` made 17 `config` tests
 * read the real key instead of the temp-dir fixture, because pointing
 * `BREVO_CONFIG_HOME` at a temp dir cannot redirect a lookup that never reads a file.
 *
 * `setupFiles` runs before each test file's module body, so a test that wants one of
 * these set still gets it — every such test assigns the value itself (and the ones
 * that snapshot-and-restore now correctly snapshot "absent"). Nothing in the suite is
 * meant to inherit a value from the developer's shell.
 *
 * Deliberately a prefix sweep rather than a fixed list: a var added to the CLI later
 * is covered without anyone remembering to update this file.
 */
for (const key of Object.keys(process.env)) {
  if (key.startsWith('BREVO_')) delete process.env[key];
}
