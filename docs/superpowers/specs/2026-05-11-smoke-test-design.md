# Smoke Test Script — Design

**Status:** Draft, awaiting review
**Date:** 2026-05-11

## Purpose

A single command (`yarn smoke`) that exercises the full surface of the locally built `@getbrevo/cli` against a real Brevo account, creating a throwaway OAuth app, running every CLI command against it, and deleting the app plus any side effects on exit. Used to catch regressions before publishing.

This spec covers **Phase 1 (smoke test for local build)** only. Phase 2 (verify the published npm version) will reuse the same script with a different install step and is scoped to a follow-up.

## Non-goals

- Not a Jest unit test, not part of `yarn test`. It performs real network and filesystem side effects.
- Not headless. It triggers an interactive `brevo login` browser flow by default. A `--skip-auth` flag is provided for future non-interactive runs but its CI wiring is out of scope here.
- Not a replacement for unit/integration tests.

## File layout

```
scripts/
  smoke-test.ts        new — main entry, all logic inline
docs/superpowers/specs/
  2026-05-11-smoke-test-design.md   this file
package.json            +1 script ("smoke"), +1 devDependency ("tsx")
```

No new directories under `src/` — this is an operational script, not part of the published package.

## Invocation

```bash
yarn smoke                     # full lifecycle, deletes app and unlinks on exit
yarn smoke --skip-auth         # assume `brevo whoami` already works; skip login
yarn smoke --verbose           # stream subprocess output instead of just logging to file
yarn smoke --port=4009         # override the OAuth server port (default 3009)
yarn smoke --report=path.json  # write a machine-readable run summary to the given path
```

Flags are parsed manually from `process.argv` (no `commander` dep — the script must not import from `src/`).

## Step sequence

| # | Step | Commands | Verification |
|---|------|----------|--------------|
| 1 | Pre-flight | `node -v`, `yarn -v`, parse flags | Node >= 20.15, yarn >= 1.19 |
| 2 | Reinstall local | `yarn unlink` (ignore err) → `npm uninstall -g @getbrevo/cli` (ignore err) → `yarn build` → `yarn link` | `which brevo` resolves, `brevo --version` matches `package.json` |
| 3 | Auth lifecycle | `brevo logout --force` → `brevo login` (interactive, waits for user) → `brevo whoami --json` | Parsed JSON contains a non-empty user identity |
| 4 | App lifecycle | `brevo app list --json` (snapshot) → `brevo app create --name "smoke-test-<ts>" --distribution private --redirect-uri http://localhost:3009/auth/callback --json` → `brevo app list --json` (verify count + presence) → `brevo app credentials --app-id $ID --json` → `brevo app update --app-id $ID --name "smoke-test-<ts>-renamed" --redirect-uri https://example.com/cb --json` | App id captured; new app present in list; credentials returns non-empty `clientId`/`clientSecret`; update reflects new name |
| 5 | Scaffold | `mkdtemp /tmp/brevo-smoke-XXXX` → `cd tmp && brevo app scaffold` (using the captured app id) | Expected scaffold files exist on disk (package.json, .env or .env.example, README, etc. — exact list derived from `src/templates/index.ts` manifest) |
| 6 | Start (briefly) | `yarn install` in scaffold dir → `brevo app start oauth` spawned in background → poll `http://localhost:<port>/` for up to 10s → `SIGTERM` the child | Server responded at least once before SIGTERM; process exited cleanly |
| 7 | Delete main test app | `brevo app delete --app-id $ID --force --json` | App no longer present in `brevo app list --json` |
| 8 | `brevo app init` wizard | `mkdtemp /tmp/brevo-smoke-init-XXXX` → `cd` into it → run `brevo app init` interactively (creates a second app + scaffolds in this dir) → read the resulting `app-config.json` to capture the new app id | `app-config.json` exists in the temp dir with a non-empty `appId`; the new app id appears in `brevo app list --json` |
| 9 | Delete init-created app | `brevo app delete --app-id $INIT_ID --force --json` | App no longer present in list |
| 10 | Logout | `brevo logout --force --json` | `brevo whoami --json` reports unauthenticated |
| 11 | Cleanup (always) | `rm -rf` both temp dirs → `yarn unlink` → kill any stragglers | Temp dirs gone; `which brevo` no longer resolves; no orphan `brevo app start` processes |

Each step is a function returning `{ ok: boolean; durationMs: number; error?: Error }`. The runner records results and continues into cleanup even after a step fails.

## Cleanup guarantees

Both temp dirs, both test apps (main + init-created), the active session, and the global `yarn link` MUST be cleaned up on exit, including on SIGINT/SIGTERM and on unhandled exceptions. Implementation:

- A `cleanup()` function is idempotent and safe to call multiple times. It tracks which artifacts exist (`mainAppId`, `initAppId`, `mainTmpDir`, `initTmpDir`, `linked`) and only acts on those still present.
- Registered on `process.on('exit')`, `process.on('SIGINT')`, `process.on('SIGTERM')`, and `process.on('uncaughtException')`.
- Steps 7, 9, 10, 11 are the canonical happy-path teardown and each shrink the cleanup surface so the trap handler has less to do.
- Both app ids are written to the log so manual recovery is possible if a delete API call itself fails.
- If the script aborts between steps 4 and 8, the trap handler will still attempt `brevo app delete` for whichever app ids it has captured. If the script aborts before login (step 3) there is nothing remote to clean up.

## Output format

```
▶ Step 1: Pre-flight
  ✓ node v20.18.1, yarn 1.22.22 — ok (12ms)

▶ Step 2: Reinstall local
  ✓ built and linked — ok (18.4s)

▶ Step 3: Auth lifecycle
  ⏳ Waiting for browser login...
  ✓ logged in as <redacted from log> — ok (24.1s)

...

──────────────────────────────────────
Summary: 12/12 steps passed
Log:     /tmp/brevo-smoke-1715472831234.log
```

On failure, the failing step shows `✗` with the error message, and the script exits with code `1` after running cleanup.

Subprocess stdout/stderr go to the log file. With `--verbose`, they are also tee'd to the terminal.

## Errors and edge cases

- **Already linked:** `yarn unlink` errors are ignored in step 2.
- **Login times out:** the script does not impose a timeout on `brevo login`; if the user takes too long, Ctrl+C still triggers cleanup.
- **Port already in use:** step 6 probes the configured port (default `3009`, overridable via `--port`) before spawning. If busy, logs a clear message, marks step 6 failed, continues to cleanup.
- **`brevo app init` writes no app-config.json:** step 8 fails if the file is missing or its `appId` is empty. The trap handler still attempts to delete via `brevo app list` diff (apps present after step 8 that weren't present before) so an init-created app is not orphaned.
- **`brevo app delete` fails during cleanup:** logged, exit code stays non-zero, manual cleanup instructions printed (the app id is in the log).
- **`yarn install` in scaffold dir fails:** step 6 fails fast (no point starting the server); cleanup still runs.

## Phase 2: CI workflows

Two GitHub Actions workflows reuse the same `scripts/smoke-test.ts` with different install strategies. Their names match the release lifecycle moment:

1. **`.github/workflows/smoke-pre-merge.yml`** — runs `yarn smoke --ci --against=local` on every PR to `main` (and on `workflow_dispatch`). This is the gate: with the appropriate branch protection rule, a PR cannot be merged unless smoke passes — which includes the changesets "Version Packages" PR that triggers `npm publish`. Tests the PR branch's local build. Concurrency group keyed on `github.ref` with `cancel-in-progress: true` so superseded commits don't keep running.
2. **`.github/workflows/smoke-post-merge.yml`** — runs on `release: published` (and on `workflow_dispatch` for manual reruns). Waits for npm to serve the newly published version, installs `@getbrevo/cli@latest` globally, runs the smoke test against the published package. Verifies what real users get after a release.

### Script changes required for CI

The same script powers both local and CI runs. Two new flags + one env var:

- `--against=local|published` (default `local`) — selects step 2's install strategy. `local` keeps the existing `yarn build && yarn link` path. `published` swaps it for `npm install -g @getbrevo/cli@latest` and verifies `brevo --version` matches the latest published version on the npm registry.
- `--ci` — turns on CI-friendly behaviour:
  - Step 3 reads `BREVO_API_KEY` from env and invokes `brevo login` (the CLI auto-uses the env var per the existing examples in `definitions.ts`). The interactive browser fallback is disabled; missing key → fail fast with a clear message.
  - `--verbose` is implied so logs surface in the Actions UI.
  - Steps default to shorter timeouts where applicable (e.g. step 6 polls for 5s instead of 10s).
- Step 8 (`brevo app init` wizard) is **always** non-interactive — even in local mode. The script builds the wizard answers in code (app name, distribution default, redirect URL default, no extra redirect, no scaffold) and pipes them over stdin, so the smoke run is hands-off end-to-end. No external fixture file is needed.
- App names are namespaced as `smoke-test-${GITHUB_RUN_ID:-<ts>}-${GITHUB_RUN_ATTEMPT:-1}` when `--ci` is set, so concurrent or retried runs don't collide on the shared test account.

### Auth secret

- GitHub repo secret `BREVO_TEST_API_KEY` — an API key for a dedicated **test/robot Brevo account**, not a real user account. The robot account is the only thing CI ever touches.
- Exposed to the workflow as `BREVO_API_KEY` env. The CLI picks it up automatically; the script asserts it's present when `--ci` is set.

### Concurrency

- Each workflow declares `concurrency: { group: smoke-<workflow>, cancel-in-progress: false }` so back-to-back merges (or release reruns) serialise instead of racing on the shared Brevo account.
- App-name namespacing (above) is the second line of defence in case serialisation is bypassed (e.g. manual `workflow_dispatch` from a different branch).

### Workflow shape (post-merge, abridged)

```yaml
on:
  push:
    branches: [main]
concurrency:
  group: smoke-main
  cancel-in-progress: false
permissions:
  contents: read
jobs:
  smoke:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<sha>  # pin to commit SHA per CLAUDE.md
        with:
          persist-credentials: false
      - uses: actions/setup-node@<sha>
        with:
          node-version: 20
          cache: yarn
      - run: yarn install --frozen-lockfile
      - run: yarn smoke --ci --against=local --report=smoke-report.json
        env:
          BREVO_API_KEY: ${{ secrets.BREVO_TEST_API_KEY }}
      - uses: actions/upload-artifact@<sha>
        if: always()
        with:
          name: smoke-report
          path: |
            smoke-report.json
            /tmp/brevo-smoke-*.log
```

### Workflow shape (post-release, key differences)

- Trigger: `release: { types: [published] }` plus `workflow_dispatch`.
- Extra step before `yarn smoke`: poll `npm view @getbrevo/cli@latest version` until it matches `github.event.release.tag_name` (or up to ~5 min, then fail).
- `yarn smoke --ci --against=published --report=smoke-report.json` — the install step inside the script handles the global `npm install -g`. Local source on the runner is only used to run the script itself, not the CLI under test.

### Risks specifically introduced by CI

- **Fragile stdin-fed `app init`:** any change to the wizard's prompt order or text silently breaks step 8 (it may answer the wrong prompt with the wrong value, or hang). Mitigation: the answer array sits in `scripts/smoke-test.ts` alongside the step, so it surfaces in code review when either side changes; a follow-up should add non-interactive flags to `brevo app init` and migrate the script off stdin.
- **Shared test account contention:** even with concurrency groups, a developer running `yarn smoke` locally against the test-account API key would race CI. Document that the test API key is for CI use only; humans use their own login.
- **npm propagation lag:** the post-release workflow can flake if npm hasn't replicated the new version yet. The poll handles this but caps at ~5 min; longer lag becomes a real failure.

## Revisions after first dry run

The first end-to-end run on 2026-05-11 surfaced six issues that this spec now accounts for:

1. **List-after-create propagation lag.** `src/commands/app/list.ts` calls this out explicitly ("The /v3/oauth/apps list endpoint lags behind /v3/app-store updates"). Steps 4, 7, and 8's list-diff fallback all need a retry-with-backoff helper (4 attempts at 500ms / 1s / 2s / 4s) before declaring the new app absent.
2. **`brevo app scaffold` writes into a subdirectory.** It prompts inquirer for an output dir and defaults to `./<slug-of-app-name>`. Step 5 must read the `directory` field from `app scaffold --json` output rather than scanning cwd, and feed a `\n` over stdin so the inquirer prompt accepts the default in non-TTY contexts. Subdirectory fallback scan is the last resort.
3. **Port 3009 is regularly busy on developer machines.** The CLI's own init wizard already auto-increments ("Port 3009 is in use. Defaulting to port 3010."). When `--port` is not explicitly passed, the script probes upward from `3009` to find a free port and uses it for both step 4's redirect URI and step 6's poll target.
4. **`brevo app init` is interactive AND its output contains the new App ID.** Step 8 captures stdout (instead of using stdio inherit) while still echoing each line to the terminal in real time, then parses `App ID: <uuid>` from the buffered output. This is authoritative and avoids depending on the user choosing to scaffold inside the wizard. The list-diff fallback (with retry) stays in place for safety.
5. **Orphan-app warning.** If step 8 still can't identify the init-created app, the script lists every app present after the wizard that was not in the pre-wizard snapshot, prints those names and ids, and tells the user to delete them manually. Better a noisy warning than a silently leaked app.
6. **Coloured pass/fail summary at the end.** Rendered after all steps complete: a bordered block with green ✓ PASS / red ✗ FAIL per step, durations, total counts, and the log/report paths. Honours `NO_COLOR` and falls back to plain text when stdout is not a TTY (so CI logs stay readable).

## Revisions after second dry run

A second run on 2026-05-11 (with the six fixes above applied) surfaced four more issues — these are now accounted for too:

7. **List response uses `app_id` (snake_case), not `appId`.** `src/types.ts` defines `OAuthApp.app_id`, and `brevo app list --json` returns objects keyed with `app_id`. The create endpoint returns `appId` (camelCase). The `collectAppIds` helper must accept all of `app_id`, `appId`, and plain `id` so create/list comparisons work across both shapes. This was the actual cause of the step 4 failure in run #1 — the retry loop was correct, but it was scanning for a key that never existed in the list payload.
8. **`brevo app start oauth` must run from the scaffold subdirectory.** It reads `app-config.json` from `process.cwd()` and resolves `src/oauth/server.js` relative to it. Step 6 was running from the parent tmp dir, so the child errored on missing config and exited immediately while the poll burned its full timeout against a dead port. The script now tracks the resolved scaffold target as `state.mainScaffoldDir` (populated in step 5) and uses it as cwd for both `yarn install` and the `app start` spawn in step 6.
9. **Detect early child exit during the start-step poll.** Even with the cwd fix, any future "child died fast" mode (port conflict, missing entry file, npm-failure in scaffolded deps) should not waste the full poll budget. Step 6 now exits the poll loop as soon as the child process emits `exit`, and reports the child's exit code plus the last few lines of its output instead of a generic timeout error.
10. **`brevo app init` is now non-interactive in every mode**, not just CI. The script generates the wizard answers in code (`brevo-cli-smoke-init-<stamp>`, accept Private default, accept default callback URL, no extra redirect URL, no scaffold) and pipes them to stdin. This makes local smoke runs hands-off too — the user just runs `yarn smoke` and walks away. The `scripts/fixtures/init-stdin.txt` artefact from the original Phase 2 plan is no longer needed.

## Revisions after third dry run

A third run surfaced four more issues — these are now accounted for too:

11. **Scaffolded OAuth feature has its own `package.json` under `src/oauth/`.** Per `src/templates/index.ts`, the scaffold writes a feature-level `package.json` inside `<scaffold>/src/oauth/`. `brevo app start oauth` explicitly refuses to launch unless `node_modules` exists there ("Dependencies not installed. Run `yarn --cwd src/oauth`…"). Step 6 now runs `yarn install` both at the scaffold root **and** inside `src/oauth/` (when its `package.json` is present) before spawning `app start`.
12. **`spawnSync({ input })` closes stdin on EOF before inquirer reads ahead.** With piped stdin, inquirer reads from the pipe ahead of its own prompts being rendered; if EOF arrives before the first prompt mount, inquirer falls back to defaults and the supplied answers are lost. The first run with non-interactive init proved this empirically — the wizard ignored our `brevo-cli-smoke-init-<stamp>` and created an app named `test` (no longer obvious where that default came from, but the symptom is "answers dropped"). Step 8 now uses a new `execScriptedStdin` helper that drives the child via `spawn` and writes answers one line at a time with a configurable delay (default 400ms) between writes, closing stdin only after the last answer. inquirer reads each line as its corresponding prompt renders.
13. **Readable, traceable app names + name-based recovery.** Apps are now named `brevo-cli-smoke-test-<stamp>` (main lifecycle) and `brevo-cli-smoke-init-<stamp>` (init wizard) so anything that leaks is obvious in the user's app list and the orphan warning. Step 8's identification flow now has an extra path: if parsing `App ID:` from the wizard output fails, it searches the app list for our expected name (with retry for propagation lag) before falling back to list-diff. Name-based recovery is robust to id-extraction bugs and to wizard-output format changes.
14. **Orphan warning had the same snake_case bug as `collectAppIds`.** `printOrphanWarning` was reading `a.id ?? a.appId` and missing `a.app_id` — which is why ids showed as `?` in the third run's warning output. Fixed. The warning also now annotates rows whose name starts with `brevo-cli-smoke` as `← likely smoke leak` so users can tell at a glance which apps to delete.

## Negative test: public OAuth distribution is rejected

The CLI explicitly refuses to create public-distribution apps (`src/commands/app/create.ts:70-72` throws `CliError(APP_CREATE_PUBLIC_UNAVAILABLE)` *before* any API call). A new step in the smoke sequence (`stepPublicAppRejected`, placed between the app-lifecycle and scaffold steps) exercises this guard:

- Runs `brevo app create --name brevo-cli-smoke-public-reject-<ts> --distribution public --json`.
- Asserts non-zero exit AND error text contains `"public"` (the message starts with "Public distribution is not yet available…").
- If the CLI ever returns exit 0 (the guard regressed), the step logs an alarm, attempts to delete the just-created app to avoid leaking a public app onto the account, and fails loudly.

This protects against a future change accidentally removing or weakening the public-distribution guard.

## Workflow layout and gating

The pre/post-merge split mirrors the release lifecycle. The gate is a GitHub status check enforced by branch protection — `release.yaml` is left untouched so the sensitive publish workflow stays minimal.

- **`smoke-pre-merge.yml` (gate)** — runs on `pull_request: [main]`. Becomes a required status check via repo branch-protection settings. Because the changesets "Version Packages" PR is itself a PR to `main`, no broken release branch can be merged → no broken release can publish. Cost: PRs from forks don't receive secrets, so external contributors can't run smoke from their fork (a maintainer must run it locally before merging, or push the contribution into a branch in the upstream repo).
- **`smoke-post-merge.yml` (verification)** — runs on `release: [published]`. Waits for the new version to appear on npm, then tests `@getbrevo/cli@latest` end-to-end. This catches "the published tarball is broken even though smoke passed on main" — npm packaging bugs, missing files in the published `files` list, etc.

The two workflows use different concurrency groups, and the script namespaces app names by `${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}`, so they can run simultaneously without colliding on the shared robot Brevo account. The pre-merge workflow sets `cancel-in-progress: true` so superseded commits on the same PR don't keep running — the script's SIGINT/SIGTERM handlers run `bestEffortCleanup` to delete any apps the killed run created.

## Auth env var

The CLI reads the API key from `BREVO_API_KEY` (see `src/commands/login.ts:57`). When set, `brevo login` uses the key directly and skips the browser OAuth flow; `--browser` overrides. CI plumbing:

- GitHub repo secret name: **`BREVO_TEST_API_KEY`** (named for the test/robot context to discourage accidental reuse for production tasks).
- Exposed to the smoke job as env `BREVO_API_KEY`.
- The script asserts `BREVO_API_KEY` is present whenever `--ci` is passed without `--skip-auth`, and fails fast with a clear message if it's missing.

## Safety invariant: never touch an app the script did not create

The script must only ever delete or modify apps it can prove it created in the current run. After a near-miss in the third run's design (the list-diff fallback could have identified — and later deleted — any app that happened to appear during the run window, including one a human created manually), all "blind diff" recovery paths are removed:

- Step 7 deletes only `state.mainAppId`, which is captured from the `app create --json` response.
- Step 8 sets `state.initAppId` from one of three identifications: (a) `App ID: <uuid>` parsed from captured wizard output, (b) a list-search for the exact unique name `brevo-cli-smoke-init-<stamp>`, or (c) `app-config.json` written by the wizard. If all three fail, the step throws with the orphan warning and **does not assign `initAppId`** — so step 9 and the trap handler have nothing to delete.
- Step 9 deletes only `state.initAppId`.
- Trap cleanup deletes only `state.mainAppId` and `state.initAppId`. Both are nullified after successful deletion so the trap is idempotent.
- The orphan warning is print-only — it never deletes anything.

The cost: if our identification logic genuinely fails (wizard output format change, unique name doesn't reach the API, propagation lag exceeds retries), the smoke run leaves an app behind that the human must delete by hand. The warning prints the suggested `brevo app delete --app-id <id> --force` and tags `brevo-cli-smoke*` apps as likely leaks. **A noisy leak is strictly better than deleting a user's real app.**

## Out of scope (deferred further)

- Non-interactive flags on `brevo app init` (would replace stdin-fed answers).
- Snapshot testing of help text / version strings.
- Coverage reports.
- Slack/webhook notifications on smoke failure.

## Open dependencies

- Adds `tsx` as a `devDependency` (currently no TS script runner present).
- No changes to `src/` for Phase 1; Phase 2 may surface a need for non-interactive `app init` flags but does not require them.
- New repo secret `BREVO_TEST_API_KEY` and the underlying robot Brevo account must be provisioned before the workflows are enabled.
