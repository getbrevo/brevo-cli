# TODO

Running work tracker for this branch. Delete before merging into `main`
(see `CLAUDE.md` → *Working docs*).

## Open

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
