/**
 * Scrub every ambient `BREVO_*` variable out of the environment.
 *
 * This file's *only* job. It also used to define `__BREVO_PREVIEW__`, the pre-GA gate's
 * build-time global, which is gone with the gate (BEX-405) — the suite now runs against
 * the one artifact that exists. **Do not delete the file with it:** the scrub below is
 * unrelated and load-bearing, and so is its `setupFiles` entry in `jest.config.js`.
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
