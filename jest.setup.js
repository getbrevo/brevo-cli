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
