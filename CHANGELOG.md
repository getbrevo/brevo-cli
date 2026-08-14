# @getbrevo/cli

## 2.1.0

### Minor Changes

- e6d72f5: `brevo app update` is replaced by `brevo app upload`, `brevo app scaffold` can set up a
  directory for an app you already have, `app-config.json` moves to a new shape,
  `brevo <command> --help` prints that command's own usage, and `--json` now produces output
  on failure paths.

  ## `brevo app update` → `brevo app upload` (BEX-250)

  `upload` takes only `--yes` and `--json`. The edit flags (`--app-id`, `--name`,
  `--redirect-uri`, `--scope`, `--logo-uri`) are gone — edit `app-config.json`, then upload.

  It always fetches the app's remote state and shows a local-vs-server diff before pushing,
  including under `--yes` (skips the prompt only) and `--json`. No differences means exit `0`,
  "already up to date", and no network push. Otherwise the whole local file is pushed and the
  server-confirmed state written back. `distribution_type` is immutable after `app create`; a
  changed value is refused locally.

  `app update` stays registered but hidden, and answers with a message naming its replacement
  (reachable with any removed flag, stray args, `--help`, or `brevo app help update`, and with
  no login). Nothing is forwarded or uploaded; it exits `1`.

  **Migrating:** `brevo app scaffold --app-id <id>`, edit `app-config.json`, `brevo app upload`.

  ## `brevo app scaffold` gains a bootstrap mode

  `scaffold` now picks its mode from whether the current directory holds an `app-config.json`.
  With one, it adds a feature to the linked app. Without one it _bootstraps_ — sets the
  directory up for an app that already exists — the successor to `brevo app update --app-id`.
  - `--app-id <id>` fetches the app, writes `app-config.json` plus the base files, then
    continues into the feature flow.
  - Interactively with no config and no flag, it asks _"Set up a project for an app you already
    have?"_ (default yes) and shows an app picker, so recovery no longer needs the app's ID.
    Declining exits `0`. Under `--json` or off a TTY the usual no-config error is raised, so
    scripts are unaffected.
  - A bootstrap also asks for an output directory (defaulting to the app name as a slug),
    creates it, and reports `cd <dir>` as the first next step; answer `.` to stay put. The
    project is written and shown _before_ the feature question, so declining still leaves a
    usable project.

  Bootstrapping refuses three cases before any network call, each of which previously produced
  a silently wrong project: a directory **inside** an existing app project (which used to nest
  a second config, after which `upload` pushed the wrong app); `--app-id` naming a **different**
  app than the directory is linked to; and an output directory that is **already another app's
  project** (where answering _Merge_ left that app's config in place while writing this app's
  credentials beside it).

  `scaffold` also asks before reusing existing feature files — **Overwrite / Merge / Cancel**
  (default Merge) — and a new `--overwrite` flag forces a full overwrite without prompting.

  **Fixed:** bootstrapping into a directory that already holds a project for the _same_ app
  wrote nothing and reported success. It is now treated as the refresh it is: drift is listed,
  you confirm, the file is rewritten.

  **Fixed:** `brevo app scaffold --json` could block on a prompt and hang CI. It now never
  prompts — each case reports `{ "cancelled": true, "reason": "...", "diffs": [...] }`.

  ## `brevo app create`

  Creation is split from feature scaffolding. `create` writes only the base project
  (`app-config.json`, `.gitignore`, `AGENTS.md`, `CLAUDE.md`, `README.md`); the OAuth
  test-server code is now a feature, scaffolded when _"Scaffold the Test OAuth App?"_
  (default yes) is accepted. Non-interactive runs stay base-only — add the code later with
  `brevo app scaffold`.

  `create` now hard-errors if `app-config.json` already exists, resolves its target directory
  before creating the app, says where files are landing, and adds a `cd <dir>` step to
  _Next steps_ when they land elsewhere. The logo URL is asked right after the app name;
  `--logo-uri` and non-interactive runs are unchanged. Neither command asks _"What feature do
  you want to scaffold?"_ any more — the CLI ships one feature; the picker returns
  automatically if a second is added.

  Fixed in `create`:
  - `Client ID: undefined` — the create response nests OAuth fields under `auth`, which
    dropped `Redirect URL n:` lines and omitted `clientId` / `redirectUri` from `--json`. The
    response is now flattened in one place, tolerating both shapes.
  - A failed read-back no longer destroys a successful create. A `404` on that one read now
    falls back to the create response and completes with a warning instead of exiting non-zero
    while the app sits on the server.
  - No stray directory is left behind when create fails — the directory _decision_ still comes
    first, but nothing is written until there is provably an app to write it for.
  - The file count no longer reads `(0 files)` above a file tree; it reports `created (5 files)`,
    `already in place (5 files, nothing rewritten)`, or `created (2 of 5 files written)`.
  - Choosing Overwrite/Merge on _"Directory already exists"_ now says `Moving into <dir>...`
    rather than contradicting the answer with `Creating <dir> and moving into it...`.

  ## `app-config.json` shape

  Backward compatible on read, migrated on the next write-back (`upload`, `app start`'s URL
  registration, `credentials`, or `scaffold`):
  - `auth.redirectUrls` → **`auth.redirectUris`**, matching the wire key `redirect_uris`. The
    old key is still read; the new one wins if both are present.
  - A legacy top-level `distribution`, and the interim `auth.type`, become **`distribution_type`**.
  - New read-only top-level **`version`**, tracking the app-store API's version field.
  - `cliVersion`, `permittedUrls`, `support` and `auth.type` are dropped — nothing read them.

  **Downgrade caveat:** older releases read only `redirectUrls`, so a migrated file reads to
  them as having no redirect URLs. That is loud and harmless in `app update`, but **`app start`
  costs you something**: seeing an empty list it offers to register
  `http://localhost:<port>/auth/callback` and, on yes, pushes that single URL as the app's whole
  `redirect_uris` — dropping every real one, silently. Upgrade the lagging CLI, or keep both
  keys as a stopgap; if it already happened, restore the list and `brevo app upload`.

  `brevo app credentials` backfills a legacy config toward the current shape when its `appId`
  matches the app being inspected, filling a missing `version` / `distribution_type` from the
  server without overwriting existing values — so projects that are never uploaded converge too.

  ## Help, `--json`, and debugging
  - **`brevo <command> --help` prints that command's own usage, arguments, flags and examples.**
    Subcommands previously rendered the root help screen, which never named the flags being
    looked for. The root screen is unchanged.
  - **`--json` now applies on failure.** Commands other than `whoami` and `logout` exited
    non-zero with nothing on stdout. Failures now write one `{"error": {...}}` document carrying
    `name`, `message`, `exitCode`, plus `statusCode` and (when classified) `code`. The
    human-readable message still goes to stderr, so stdout stays exactly one parseable document.
  - **`brevo app list` shows a `Version:` line** and includes `version` in `--json`. It is also
    hardened against `redirect_uris: null` / `scopes: null` from the list endpoint, which used to
    end the listing part-way with `Cannot read properties of null (reading 'length')`; the same
    dereference is fixed in `app credentials`.
  - **`--debug` logs the request body** before the request goes out, alongside the response —
    same `<METHOD> <path>`, same redaction. Nothing changes without `--debug`.

  ## Output
  - **Boxed output wraps instead of shredding itself.** `printBox` sized itself to its longest
    line and let the terminal wrap the overflow without the frame. Lines are now wrapped before
    the frame is drawn — on a word where possible, mid-string where not — with continuation rows
    indented under their label and colour carried across. Piped output falls back to 80 columns.
  - **Selection prompts are indented into the CLI's output gutter**; `list` and `checkbox`
    options used to render two columns left of every other line. Numbered app pickers are
    unchanged.
  - **Fixed:** the first row of a printed file tree was indented two columns deeper than the rest.
  - **The logo-URL prompt fits 80 columns** — `App logo URL (optional — leave blank to skip):`,
    with the example URL moved to the validation error.

  ## Request payloads

  `POST /v3/app-store/apps` now carries OAuth fields in the same `auth: { scopes, redirect_uris }`
  block the upload endpoint takes, and upload's version field is renamed `app_version` →
  `version`. `cli_version` and `source: 'cli'` are no longer sent in either body — both were
  outside the declared contract, upload rejects unknown keys with a `400`, and the caller is
  identified by a structured `User-Agent` (`brevo-cli/<version> (<os>; auth=<method>)`).

  ## An expired session is reported before the prompts (BEX-341 follow-up)

  `brevo app create` could ask every question and only then report ``Your session has expired.
Run `brevo login` ``, discarding all of it: a refresh token the login service _refuses_ was
  treated like a transient network failure and swallowed.

  A refused token is now terminal — stored credentials are cleared and the expiry is reported
  from the pre-command hook, before the first prompt. Failures that say nothing about the
  session (timeout, `5xx`, unwritable credentials file) are still swallowed and never block a
  command. The token is also re-checked before each authenticated request rather than once at
  startup, and if a session dies mid-flow `app create` offers to log you back in and re-sends
  the answers you already gave (interactive terminals only). Exit codes and error text are
  unchanged.

  ## The legacy `all` OAuth scope is refused on upload (BEX-214)

  `brevo app upload` now stops when `auth.scopes` still contains the deprecated catch-all `all`
  and explains the migration: replace it with the specific scopes your integration uses, list
  them with `brevo app available-scopes`, then upload. `brevo app start oauth` refuses the same
  config with the same guidance, `brevo app list` tags an affected app, and `brevo app scaffold`
  writes granular scopes.

  The refusal is local — no round trip, nothing pushed. An app already holding `all` on Brevo is
  untouched until you upload a replacement list; the upload diff then labels it as a migration.

  ## Other fixes
  - **`auth.scopes` written as a single string is read correctly.** A hand-edited
    `"scopes": "contacts:read, contacts:write"` was documented as normalized on read and was
    not — the splitter was only reached for arrays, so the upload validator iterated the string
    one character at a time and rejected the run with `Invalid scope: ":"`. Strings are now split
    on commas and whitespace, exactly as over-long array entries always were.
  - **`app credentials` / `app delete` no longer open an app picker they cannot draw.** Their
    `--app-id` fallback was not gated on the run being interactive, so under `--json` or off a
    TTY it printed its choice list to **stdout** and then aborted with
    `ERR_USE_AFTER_CLOSE: readline was closed`. Both now refuse up front, before any network
    call, naming the exact command to run and exiting `1`; `--json` gets the usual error
    envelope. Interactive runs are unchanged. `app delete` is the consequential one — a scripted
    delete that appeared to rely on the picker was never selecting anything.

- 67390da: Take the update banner's message from the Brevo app-store service, and let it block a CLI version that can no longer be supported.

  Whether an update banner appears is unchanged: the CLI still checks the npm registry, compares against its own version, and applies the same soft-notice and force-update rules. What changed is the first line of that banner, which now comes from `GET /cli/info` and is rendered in red above the box. The box's own contents are untouched.

  That endpoint is called on the app-store service **directly**, not through the v3 API gateway, and needs no API key — so the notice still renders while logged out, mid-`login`, or with expired credentials, which is exactly when a stale CLI is most likely to be the real problem. `BREVO_APP_STORE_URL` overrides the base URL for non-production testing.

  The response may also carry `"is_blocked": true`. When it does, every command except `--help` / `--version` prints the banner to stderr and exits `1` without running, letting a broken CLI version be stopped without shipping a new release. This is deliberately **not** silenced by `BREVO_NO_UPDATE_NOTIFIER=1`, `--no-update-notifier`, CI, or a non-TTY — those suppress a _notice_, and a suppressed banner must never mean a suppressed block.

  Because a block has to prevent a command rather than report on it afterwards, the call now runs once before the command instead of after it. The result is cached at `~/.brevo/cli-info-cache.json` for **15 minutes**, keyed to the running CLI version, so a healthy fleet of invocations doesn't call the app-store service on every single command — revised wording and a new block reach users within minutes rather than after the old 12h npm-style TTL, and an upgrade always gets a live check regardless of the cache's age. A failed call never overwrites a good cache entry.

  It fails open throughout. A timeout, a non-2xx, HTML from a gateway, or an unparseable body all leave the CLI behaving exactly as before — the banner falls back to local wording and nothing is blocked. Only a literal `true` blocks, so an outage can never lock anyone out. The endpoint is fetched outside the authenticated API client, so a 401 from it cannot reach the re-auth handler or clear stored credentials, and the returned text is control-character stripped, flattened to one line, and clamped before display.

  Also show the update notice when a command fails. Previously the banner only printed on the success path, so anyone whose command errored — including the auth errors most likely to be fixed by upgrading — never saw that a newer CLI existed. The banner now prints after the error message on stderr, keeping the command's own exit code, and `notifyUpdate` is idempotent so runs that already showed it up front (`--help`, `app init`, `app create`) don't print it twice. A Ctrl-C abort still exits immediately without waiting on the check.

  The npm registry check backing the soft-notice/force-update gate (`~/.brevo/update-check.json`) moves from a 24h TTL to **12h**, so a newly-published version reaches users about twice as fast.

### Patch Changes

- bcfc3c1: Fix two ways the update banner could show local wording when the app-store service had wording of its own.

  **`--help` and `--version` never asked.** They are exempt from the `is_blocked` gate so a blocked CLI can still say what version it is — but that was implemented by skipping the whole `/cli/info` call, which discarded the message along with the verdict. Both still render an update banner, so the two commands people most often run to check their version were the only ones that could never explain why the version mattered. The exemption now covers the block alone: they fetch the wording, show it, and still exit `0` no matter what `is_blocked` says.

  **The 15-minute cache ignored which service the answer came from.** The entry was keyed on `cliVersion` and `lastChecked` only, but the base URL is overridable per-invocation via `BREVO_APP_STORE_URL`, so two runs against different environments shared one entry — whichever was hit first answered for both until the TTL expired. The symptom was badly misleading: pointing at staging rendered the message production had returned moments earlier and vice versa, so the CLI and a direct `curl` disagreed, and which environment looked broken depended only on the order the two were run in. `baseUrl` is now part of the key. An entry written before the field existed fails the shape check and is treated as a miss, so an upgrade re-fetches once rather than serving a stale answer.

  Neither changes what blocks, what fails open, or any exit code.

## 2.0.2

### Patch Changes

- fb22583: Keep browser (OAuth) logins alive for as long as the refresh token is valid.

  The CLI stored an access-token expiry on login but never read it, so refresh was purely reactive — it only fired after the API returned `401`, which made a short access-token TTL feel like the session itself expiring and cost every post-expiry request an extra round-trip. Commands that need credentials now check the stored expiry first and refresh the access token before it lapses (60s skew buffer), so the request goes out with a valid token.

  The refresh is best-effort: if the login service is unreachable the command runs anyway with the existing token, and the reactive `401` path stays in place as the safety net and remains the only thing that clears dead credentials. Local-only commands (`login`, `logout`, `skill:cli …`, `app available-scopes`) never trigger it, so they keep working offline. No new command, flag, or environment variable.

  `brevo app init` no longer announces an expired session when its credential check simply fails to verify. A network blip, a server error, or an auth gateway sitting in front of the API now leaves the stored session in place and lets setup continue, instead of warning that the session expired and opening a browser login that would fail for the same reason. Only Brevo actually refusing the credentials (`401`/`403`) sends you to log in.

## 2.0.1

### Patch Changes

- 9df6fcd: Update account endpoint from `/v3/account` to `/v3/account/info`.

## 2.0.0

### Major Changes

- 26ac404: Migrate app management onto the public App Store APIs (BEX-249).

  **Breaking changes**
  - App create/list/get/update/delete now target `/v3/app-store/apps` instead of the legacy `/v3/oauth/apps` endpoints.
  - App update uses `PATCH` instead of `PUT`.
  - The distribution field is sent and read as `distribution_type: "public" | "private"` instead of the boolean `public`. `--distribution public` is still rejected ("coming soon").

  **New features**
  - Add a blocking force-update banner: when the installed CLI is a full major version behind the latest npm release, commands (except `--help`/`--version`) print an update banner and exit non-zero until the user upgrades. Honors the existing update-notifier opt-outs (`BREVO_NO_UPDATE_NOTIFIER`, `--no-update-notifier`, CI, non-TTY).

## 1.1.1

### Patch Changes

- e7ffaa6: Deprecate the legacy `'all'` OAuth scope and improve scope tooling:
  - `brevo app update` and `brevo app start oauth` now block when scopes contain `'all'`. Pass `--scope` on `brevo app update` to migrate (drops `'all'`, applies the new granular scopes). `brevo app list` flags legacy apps (text tag + `legacy_all_scope: true` in `--json`); `brevo app scaffold` drops `'all'` when scaffolding from a legacy app, keeping its granular scopes (or the default scopes when `'all'` was the only one).
  - `brevo app available-scopes` no longer requires authentication — it only reads the public IdP scope catalog, so it now works before `brevo login` (previously exited with "Not authenticated").
  - `brevo app available-scopes --web` page improvements: per-category "Copy" CTA, per-scope checkboxes that build a copyable selection list, a `deprecated` badge on the legacy `'all'` scope (excluded from copy/selection), a hero CTA linking the scope catalog docs (https://developers.brevo.com/docs/oauth-scopes#scope-catalog), and a footer link to the CLI reference docs. The terminal output also prints the scope catalog docs URL. Copied scope lists are double-quoted and comma-separated (`"contacts:read","contacts:write"`) — ready to paste into `app-config.json`'s `auth.scopes` array or `brevo app update --scope`.
  - added user-agent for cli-version, os and auth type

- ab05546: Add Homebrew as an install channel: `brew install getbrevo/tap/brevo`. The
  formula in `getbrevo/homebrew-tap` is auto-bumped on every npm release. No CLI
  behavior, command, flag, or env var changed.

- a4533d9: The CLI now identifies itself to the Brevo API on every request via a single `User-Agent` header: `brevo-cli/<version> (<os>)`, extended with `; auth=api_key` or `; auth=oauth` when the request carries credentials. No personal data is sent — only the CLI version, operating system family, and authentication method already in use.

## 1.1.0

### Minor Changes

- 0896225: Granular OAuth scopes (BEX-197) and `logo_uri` support (BEX-194):
  - `brevo app create` now creates apps with `contacts:read`, `contacts:write`, `crm:read`, `crm:write` instead of the legacy `all`. The CLI prints a one-line notice listing the defaults and how to change them.
  - `brevo app update --scope <scope>` (new, repeatable) appends scopes to an app's existing set, de-duped, order-preserving. Writes back to `app-config.json` when applicable. A single flag value may contain multiple comma- or whitespace-separated tokens (`--scope "crm:read, crm:write"` is equivalent to two `--scope` flags); the same normalization heals comma-embedded entries when reading `auth.scopes` from `app-config.json`. Each resulting token is validated locally against `[A-Za-z0-9][A-Za-z0-9:_.-]*` to catch typos before the API call.
  - `brevo app available-scopes [--json] [--web]` (new) prints the IdP's supported-scopes catalog. Text output groups scopes by category (`account`, `data_crm`, `messaging`); `--json` returns a flat array of names. OIDC-reserved scopes and magic wildcards are excluded. Sourced from `/realms/partner/scopes`.
  - Passing `--web` to `brevo app available-scopes` additionally starts a short-lived loopback HTTP server on `127.0.0.1` and opens the user's browser to a self-contained HTML page listing every supported scope grouped by category, with a search filter. Each scope is expandable to reveal its API endpoints (chip list). A "Refresh" button on the page re-fetches scopes from the IdP without restarting the command. The server runs in the foreground until Ctrl+C (SIGINT or SIGTERM closes it cleanly). Without `--web` the command exits after printing the list — TTY detection no longer triggers the browser. `--json` always suppresses the browser.
  - Add `logo_uri` support to `brevo app create` (`--logo-uri`), `brevo app update` (`--logo-uri`), and the `logoUri` top-level field in `app-config.json`. Flagless `brevo app update` pushes `logoUri` from the config file when present. The interactive `brevo app create` flow (also reached via `brevo app init`) now prompts for an optional logo URL; the prompt is skipped under `--json` or when `--logo-uri` is passed. The interactive prompt and its invalid-format hint now advertise the expected `https://` form.

  Other changes:
  - `brevo app create` and `brevo app update` now send the CLI's own version as `cli_version` in the request body, so the backend can track which CLI release performed each write.
  - Removed the dormant `minCliVersion` mechanism. `brevo app scaffold` no longer writes `minCliVersion` into `app-config.json` (the constant had been `0.0.0` since introduction, so the runtime check never fired). The npm-registry update-notifier already covers the "you should upgrade" nudge. Existing `app-config.json` files keep their `minCliVersion` field harmlessly — it is now ignored. `cliVersion` (informational provenance) is unchanged.

## 1.0.1

### Patch Changes

- 6aeb15a: Add `brevo skill:cli` command group for installing the brevo-cli Claude Code skill into `~/.claude/skills/`. The `skill:<name>` shape reserves a namespace for future Brevo-authored skills (each gets its own top-level group rather than positional args).

  **Commands**
  - `brevo skill:cli install [--json]` — installs the brevo-cli skill, idempotently. If the skill is already at the bundled version it reports "already up to date".
  - `brevo skill:cli uninstall [--json]` — removes the brevo-cli skill. Marker-gated, so it never touches a directory the CLI didn't create. Reports a friendly no-op when nothing is installed.

  **Auto-refresh**

  The skill version tracks the CLI version (read from `package.json` at module-init). Every CLI release effectively bumps the bundled skill version too, so installed copies auto-refresh after a CLI upgrade — even when `SKILL.md` itself didn't change. The refresh emits a single stderr line: `↻ refreshed brevo-cli skill (v1.0.0 → v1.0.1)`. Skipped under `CI=true`, `--json`, any `brevo skill:cli *` invocation, and when `BREVO_NO_SKILL_AUTOREFRESH=1` is set.

  **Onboarding**

  Discovery is doc-driven rather than interrupting interactive runs: `agent-context/AGENTS.md` opens with an "AI agents — install the skill first" section telling any agent helping with the CLI to run `brevo skill:cli install` before doing other work. Humans run `brevo skill:cli install` once when they want the AI assist; otherwise the CLI never nags. No first-run banner, no `~/.brevo/skill-banner.json` state file.

  **Implementation notes**
  - The skill catalog is bundled inline so installs work fully offline.
  - `agent-context/SKILL.md` is the single source of truth — the CLI reads it directly via `SKILLS_BUNDLE_DIR`; manual-copy users and `brevo skill:cli install` users see the same file.
  - Installs are tracked with a `.brevo-skill.json` marker so auto-refresh and uninstall stay safe.
  - Skill test fixtures route through a repo-local `src/__tests__/**/__sandbox__/` directory (gitignored) instead of `os.tmpdir()` — addresses SonarCloud `S5443`.

  **Docs**
  - Fix `AGENTS.md` env-var table: the debug toggle is `BREVO_DEBUG=1`, not `DEBUG=1` (the latter never enabled debug logging — `src/lib/logger.ts` only reads `BREVO_DEBUG`).
  - Document previously undocumented env vars in `AGENTS.md`: `BREVO_CLAUDE_HOME` (override Claude Code home used by `skill:cli`) and `BREVO_NO_UPDATE_NOTIFIER` (suppress the npm update-available notice).
  - Round out `AGENTS.md` command table: add the missing `brevo logout` row and the `--yes` flag on `app update`; list `--json` consistently across every command that supports it.
  - Add the missing `whoami` mapping to the `SKILL.md` decision tree.
  - Disambiguate Claude vs non-Claude agents across docs and command surface:
    - `SKILL.md` intro callout splits the "reading this from the repo" guidance — Claude installs the skill, other agents read `AGENTS.md` instead.
    - `brevo skill:cli {install,uninstall} --help` descriptions now flag the commands as Claude-only.
    - `brevo skill:cli install` prints a follow-up hint after a fresh install pointing non-Claude tools at `AGENTS.md`.
  - Add a two-step preflight to both `SKILL.md` and `AGENTS.md`. Before any other work, agents must (1) confirm `brevo --version` returns a string — otherwise stop and ask the user to `npm install -g @getbrevo/cli` — and (2) verify their reference matches the running CLI: Claude compares `~/.claude/skills/brevo-cli/.brevo-skill.json` to `brevo --version`; non-Claude agents read the canonical bundled `AGENTS.md` from `$(npm root -g)/@getbrevo/cli/agent-context/AGENTS.md` (or yarn/local equivalent) so the doc is always in lockstep with the installed CLI.

- d4335f5: Wipe the per-app credential cache on `brevo login` when the new account differs from the previously-stored one. Cached `clientId`/`clientSecret` values belong to the prior account's apps and would mislead the new session. Same-account re-logins keep the cache intact.
- d4335f5: Internal: hardened scaffold test fixtures by routing the mocked `outputDir` strings through a sandbox path under `__dirname` instead of `os.tmpdir()` / hardcoded `/tmp/...`. Addresses SonarCloud `S5443` (publicly-writable directories) at all 9 callsites. Test-only change — no runtime behavior is affected.

## 1.0.0

### Major Changes

- 93dad27: Initial release of `@getbrevo/cli` — the Brevo Developer CLI for creating, managing, and testing OAuth integrations from the terminal. Published to the public npm registry (`registry.npmjs.org`) under `@getbrevo/cli`.

  **Authentication & setup**
  - `brevo login` / `brevo logout` / `brevo whoami` — authenticate with a Brevo API key, stored at `~/.brevo/credentials.json`. Invalid keys surface a single, consistent `Invalid API key. Please check and try again.` message on first attempt and on retry.
  - `brevo init` — link a local project to a Brevo app via `app-config.json`.

  **App management**
  - `brevo app create` — interactive and flag-driven app creation. Probes both `0.0.0.0` and `127.0.0.1` to detect wildcard listeners before suggesting a default redirect port. Prints a one-line tip pointing at `brevo app start oauth` for local testing (suppressed under `--json` and skipped when `--redirect-uri` is passed). `--help` examples use `http://localhost:3009/auth/callback` to match the scaffolded handler.
  - `brevo app list` — lists apps; locally caches names updated via `brevo app update` so renames reflect immediately despite server-side eventual consistency. Cache refreshes on `app credentials` and clears on `app delete`.
  - `brevo app update` — supports `--name`, `--redirect-uri` (repeatable, appends), and `--app-id` flags. Without flags, pushes the full `app-config.json`. With flags, merges values over `app-config.json` or the API. Writes back to `app-config.json` after a successful update when the app ID matches.
  - `brevo app credentials` — reveals client credentials. `--json` includes `redirectUris`. Consistent placeholders: human output uses `[hidden — run \`brevo app credentials --reveal-secret\`]`, `--json`uses`[hidden]`, missing values use `[not available]`.
  - `brevo app delete` — deletes an app; reports `App <id> not found.` instead of generic `Request failed with status 404`.

  **Scaffolding & local OAuth testing**
  - `brevo app scaffold` — generates a working OAuth project with templates referencing both `npm` and `yarn`. Stamps `cliVersion` and `minCliVersion` into `app-config.json` so projects can warn at startup when run with an older CLI (suppressed under `--json` and for unpublished local builds). `brevo app update` does not touch these fields.
  - `brevo app start oauth` — runs the scaffolded local OAuth server. Self-registers the local redirect URL when the resolved port has no matching `http://localhost:<port>/...` (or `127.0.0.1`) entry on the app: interactively prompts (default Yes) to add `http://localhost:<port>/auth/callback`, pushes to the remote app, and writes back to `app-config.json`. Decline continues with a warning. In non-TTY mode, hard-fails with a structured error suggesting `brevo app update --redirect-uri` rather than silently mutating the remote app.
  - `--port <port>` propagation — `REDIRECT_URI` is forwarded to the child process whenever a registered localhost redirect URL exists on the resolved port (preserving `localhost` vs `127.0.0.1` for Brevo's exact-string match), so the authorization URL and the listener agree on the port. Declined registrations leave `.env.local` untouched.
  - After a successful flow, both the CLI and the scaffolded handler print a next-steps hint (`/auth/refresh` URL, pointers to call the Brevo API or open `src/oauth/handler.js`). The Authorization URL preview renders `state=[random]` instead of `<random>` so the browser doesn't strip it as an unknown HTML tag.

  **General CLI behaviour**
  - Unknown top-level commands report `error: unknown command '<x>'` and exit 1 instead of being intercepted by the auth guard.
  - Validation errors (`--distribution invalid`, malformed URLs, etc.) print once. The top-level error handler renders messages; `validateEnum` / `validateUrl` no longer log before throwing.
  - Every command supports `--json` via `jsonOutput()`. Diagnostic log lines (`APP_CREATE_PORT_IN_USE`, `APP_CREATE_PORT_SCAN_FAILED`, etc.) are gated under `!--json` to keep machine output clean.
  - All user-facing strings live in `src/lang/en.ts`; CLI command references live in `src/lib/constants.ts` as `CLI.*`.

  **Update notifier**
  - After every command, the CLI checks the npm registry for a newer release and shows a non-intrusive banner if one is available. The check runs asynchronously, caches at `~/.brevo/update-check.json` with a 24h TTL, and is skipped in CI, non-TTY sessions, when `--no-update-notifier` is passed, or when `BREVO_NO_UPDATE_NOTIFIER=1` / `NO_UPDATE_NOTIFIER=1` is set. Implemented in-tree (no `simple-update-notifier` dependency).
