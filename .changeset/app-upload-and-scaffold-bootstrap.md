---
'@getbrevo/cli': minor
---

`brevo app update` is replaced by `brevo app upload`, `brevo app scaffold` can set up a
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
With one, it adds a feature to the linked app. Without one it *bootstraps* — sets the
directory up for an app that already exists — the successor to `brevo app update --app-id`.

- `--app-id <id>` fetches the app, writes `app-config.json` plus the base files, then
  continues into the feature flow.
- Interactively with no config and no flag, it asks *"Set up a project for an app you already
  have?"* (default yes) and shows an app picker, so recovery no longer needs the app's ID.
  Declining exits `0`. Under `--json` or off a TTY the usual no-config error is raised, so
  scripts are unaffected.
- A bootstrap also asks for an output directory (defaulting to the app name as a slug),
  creates it, and reports `cd <dir>` as the first next step; answer `.` to stay put. The
  project is written and shown *before* the feature question, so declining still leaves a
  usable project.

Bootstrapping refuses three cases before any network call, each of which previously produced
a silently wrong project: a directory **inside** an existing app project (which used to nest
a second config, after which `upload` pushed the wrong app); `--app-id` naming a **different**
app than the directory is linked to; and an output directory that is **already another app's
project** (where answering *Merge* left that app's config in place while writing this app's
credentials beside it).

`scaffold` also asks before reusing existing feature files — **Overwrite / Merge / Cancel**
(default Merge) — and a new `--overwrite` flag forces a full overwrite without prompting.

**Fixed:** bootstrapping into a directory that already holds a project for the *same* app
wrote nothing and reported success. It is now treated as the refresh it is: drift is listed,
you confirm, the file is rewritten.

**Fixed:** `brevo app scaffold --json` could block on a prompt and hang CI. It now never
prompts — each case reports `{ "cancelled": true, "reason": "...", "diffs": [...] }`.

## `brevo app create`

Creation is split from feature scaffolding. `create` writes only the base project
(`app-config.json`, `.gitignore`, `AGENTS.md`, `CLAUDE.md`, `README.md`); the OAuth
test-server code is now a feature, scaffolded when *"Scaffold the Test OAuth App?"*
(default yes) is accepted. Non-interactive runs stay base-only — add the code later with
`brevo app scaffold`.

`create` now hard-errors if `app-config.json` already exists, resolves its target directory
before creating the app, says where files are landing, and adds a `cd <dir>` step to
*Next steps* when they land elsewhere. The logo URL is asked right after the app name;
`--logo-uri` and non-interactive runs are unchanged. Neither command asks *"What feature do
you want to scaffold?"* any more — the CLI ships one feature; the picker returns
automatically if a second is added.

Fixed in `create`:

- `Client ID: undefined` — the create response nests OAuth fields under `auth`, which
  dropped `Redirect URL n:` lines and omitted `clientId` / `redirectUri` from `--json`. The
  response is now flattened in one place, tolerating both shapes.
- A failed read-back no longer destroys a successful create. A `404` on that one read now
  falls back to the create response and completes with a warning instead of exiting non-zero
  while the app sits on the server.
- No stray directory is left behind when create fails — the directory *decision* still comes
  first, but nothing is written until there is provably an app to write it for.
- The file count no longer reads `(0 files)` above a file tree; it reports `created (5 files)`,
  `already in place (5 files, nothing rewritten)`, or `created (2 of 5 files written)`.
- Choosing Overwrite/Merge on *"Directory already exists"* now says `Moving into <dir>...`
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
Run `brevo login` ``, discarding all of it: a refresh token the login service *refuses* was
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
