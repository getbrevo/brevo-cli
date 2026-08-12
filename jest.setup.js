/**
 * Unlock the pre-GA gate for the whole suite (BEX-405).
 *
 * Without this, `isPreviewUnlocked()` reads whatever `~/.brevo/credentials.json`
 * happens to hold on the machine running the tests — so the ~80 tests covering
 * `app deploy`, `app rollback`, `app submit`, `app status`, `app withdraw`, UI-app
 * creation and `--distribution public` would pass on a Brevo developer's laptop and
 * fail in CI, or flip mid-run as another suite repoints `BREVO_CONFIG_HOME`. Test
 * outcomes must not depend on who is logged in.
 *
 * Those tests are about the features, not about the gate. The gate has its own
 * coverage in `src/__tests__/lib/preview.test.ts`, plus the locked-path cases in
 * `command-registry`, `help` and `create` — all of which override this explicitly
 * (`delete process.env.BREVO_ENABLE_PREVIEW`) so they exercise a genuinely locked
 * CLI rather than trusting the default.
 *
 * Set here rather than in each file so that adding a test for a gated command needs
 * no ceremony, and so this comment is the one place explaining why.
 */
process.env.BREVO_ENABLE_PREVIEW = '1';
