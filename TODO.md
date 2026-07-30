# TODO

Running work tracker for this branch. Delete before merging into `main`
(see `CLAUDE.md` → *Working docs*).

## Open

- **Smoke: assert the binary under test is the build we installed.** `stepReinstall`
  resolves `brevo` off PATH and trusts it. Twice now a *different* package won that
  lookup — a global `@dtsl/brevo-cli`, then a stray undeclared copy under this repo's
  `node_modules/.bin` (which `yarn smoke` puts ahead of any exported PATH). Both
  carried the commands under test, so a full run passed 26/26 against the wrong CLI
  and nothing looked wrong. Pinning the resolved path doesn't help — it pins the
  wrong binary faithfully. The fix is a version comparison in `stepReinstall`: when
  `--against=local`, fail hard unless `brevo --version` equals `package.json`'s
  version. Until it lands, `yarn smoke` is unsafe (both smoke workflows use exactly
  that invocation) and the suite must be run via
  `./node_modules/.bin/tsx scripts/smoke-test.ts`. Also worth asking why
  `@dtsl/brevo-cli` is in `node_modules` at all — it is in neither `package.json`
  nor `yarn.lock`.
- **CI does not run on PRs into `features_set_public_cli`.** `.github/workflows/push.yaml`
  is scoped to `branches: [main]`, so a PR targeting the integration branch gets
  SonarCloud and nothing else — no lint, no tests, no build. The BEX-221 children
  (#33–#40) all merged under this gap. One-line fix (add the branch to both triggers),
  but it belongs in its own PR.
- **`brevo app submit`'s "private app" message is unreachable.** `APP_SUBMIT_NOT_PUBLIC`
  ("App X is private. Private apps cannot be submitted for review. Only public apps
  are eligible…") never fires: `checkAppStatus` runs the review-state preflight
  *before* the `distribution_type !== 'public'` check, and the API refuses that read
  for a private app, so the user sees the server's terser `This activity is not
  supported for private apps.` instead. Verified against the live API on 2026-07-29
  (`brevo app submit --app-id <private> --json` → exit 1 with the server string).
  Fix is probably to move the public check ahead of the preflight — nothing is
  gained by reading review state for an app that can't be submitted. Worth checking
  whether `submit.test.ts`'s coverage of that message is therefore testing a path
  users can't hit. The smoke accepts both strings for now.
- **Smoke: assert a real `submitted` → `withdrawn` transition.** `brevo app submit`
  only hands back the review form URL — the app moves to `submitted` when the
  *form* is submitted, not when the command runs. So the smoke can never drive the
  app into a withdrawable state on its own, and the withdraw step always lands on
  the `NOT_SUBMITTED` branch. To cover the real path we need either a test-only way
  to put an app in `submitted` (an API/staging hook), or an accepted manual QA step.
  The script already handles the `withdrawn: true` branch when it happens.
- **Smoke: `--against=published` runs a superset of what published supports.**
  Command presence is feature-detected from `brevo --help`, and create's
  project-directory behaviour is detected from its `--json` output, but the create
  *response* assertions (`appName`, `redirectUri`, `logoUri`) assume the current
  shape. If a published version ever predates those fields, add detection there too.
- **`brevo app submit` cannot be asserted end to end pre-GA.** When the backend
  returns no `google_form_link` the smoke skips that step loudly. Once public apps
  are GA on the test account, tighten it to a hard failure so a missing form link
  reds the run.
- **`brevo --help` advertises a flag that no longer exists.** The hand-written help
  table in `src/bin/index.ts` lists `brevo app scaffold [--app-id <id>] [--json]`
  and the Examples block shows `brevo app scaffold --app-id APPID`, but `--app-id`
  was removed when create and scaffold were split — following the CLI's own help
  gives `error: unknown option '--app-id'`. `README.md` repeats it twice (the
  quick-start snippet and the command table). The agent docs are already correct.
  Found while fixing the smoke test's scaffold step; deliberately left out of
  BEX-339 to keep that change test-only. Fix needs a changeset (user-visible help
  text) — append to `.changeset/add-app-version-config.md`, the changeset that
  removed the flag. Fold this into the README command-table pass already tracked
  in `RELEASE-CHECKLIST.md` → *Before public-apps GA*, which covers the same
  drift in the README table.
