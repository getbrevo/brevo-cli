---
'@getbrevo/cli': minor
---

`brevo app update` is removed and replaced by `brevo app upload`. Also in this release:
`brevo app scaffold` can set up a directory for an app you already have, `app-config.json`
migrates to a new shape, `brevo <command> --help` prints that command's own usage, and
`--json` now produces output on failure paths.

## `brevo app update` is removed — use `brevo app upload` (BEX-250)

`brevo app upload` takes only `--yes` and `--json`. The edit flags — `--app-id`, `--name`,
`--redirect-uri`, `--scope`, `--logo-uri` — are gone: change an app's name, redirect URLs,
scopes or logo by editing `app-config.json`, then run `brevo app upload`.

`upload` always fetches the app's current remote state and renders a local-vs-server diff
before pushing — even under `--yes` (skips the prompt, still shows the diff) and `--json`
(structured data). If nothing differs it exits `0` with "already up to date" and makes no
network push. Otherwise it POSTs the whole local file and writes the server-confirmed
state back. `distribution_type` is immutable after `app create`; a changed value is
refused locally, before anything is pushed.

`brevo app update` stays registered, hidden, and answers with a message naming
`brevo app upload` — instead of Commander's `unknown command 'update'`, whose
string-distance guess was `create`. It is not a shim: nothing is forwarded, nothing is
uploaded, and it exits `1`. The message is reachable however the old invocation was typed
(any removed flag, stray arguments, `--help`, `brevo app help update`) and needs no login.

**Migrating:** `brevo app scaffold --app-id <id>` to obtain the config, edit
`app-config.json`, then `brevo app upload`.

## `brevo app scaffold` gains a bootstrap mode

`scaffold` now has two modes, selected by whether the current directory holds an
`app-config.json`. With one, it adds a feature to the linked app. Without one, it
*bootstraps* — sets the directory up for an app that already exists — which is the
successor to `brevo app update --app-id`.

`--app-id <id>` names the app: it fetches the app, writes `app-config.json` plus the base
files, then continues into the feature flow. Interactively, with no config and no flag,
the command asks *"Set up a project for an app you already have?"* (default yes) and shows
an app picker, so recovering a project no longer requires knowing the app's ID. Declining
exits `0`. The offer is interactive-only — under `--json` or off a TTY the usual no-config
error is raised, so scripts and CI are unaffected.

A bootstrap also asks where to put the project (`Output directory:`, defaulted to the app
name as a slug), creates it, and reports `cd <dir>` as the first next step; answer `.` to
stay put. Without this, running `scaffold` from the folder where you keep your app folders
wrote eleven files straight into it. This question is interactive-only too. The project is
written and shown *before* the feature question, so declining leaves a usable project.

Bootstrapping refuses three cases before any network call, each of which previously
produced a silently wrong project:

- **A directory inside an existing app project.** `app-config.json` is read from the
  current directory only, so scaffolding one level down used to create a nested second
  config — after which `brevo app upload` from there pushed the wrong app with no warning.
- **`--app-id` naming a different app than the directory is linked to.**
- **An output directory that is already another app's project** — the check above compares
  against the current directory, so it cannot catch a target somewhere else. Answering
  **Merge** there used to leave that app's `app-config.json` in place while writing *this*
  app's credentials into `src/oauth/.env.local` beside it.

Fixed: bootstrapping into a directory that **already holds a project for the same app**
wrote nothing and reported success anyway — the directory prompt's **Merge** answer was
being applied to `app-config.json` itself, which always exists in that case. It is now
treated as the refresh it is: drift is listed, you confirm, the file is rewritten. A
target with files but no `app-config.json` still honours the merge answer.

`scaffold` also asks before reusing existing feature files: **Overwrite / Merge / Cancel**
(default **Merge**). A new `--overwrite` flag forces a full overwrite and skips the prompt.

Fixed: `brevo app scaffold --json` could block on an interactive prompt and hang CI. It now
never prompts — each case is reported as `{ "cancelled": true, "reason": "...", "diffs": [...] }`.

## `brevo app create`

Creation is split from feature scaffolding. `create` writes only the basic project
structure — `app-config.json` plus `.gitignore`, `AGENTS.md`, `CLAUDE.md`, `README.md` —
and the OAuth test-server code is now a *feature*, scaffolded when *"Scaffold the Test
OAuth App?"* (default yes) is answered yes. Non-interactive runs (`--json` or piped stdin)
stay base-only; add the code with a follow-up `brevo app scaffold`.

`create` hard-errors when `app-config.json` already exists in the working directory,
resolves its target directory before creating the app, and says where files are landing
before writing them. The *Next steps* box shows a `cd <dir>` step when files landed
somewhere other than where the command was run.

The app logo URL is now asked immediately after the app name rather than last, since it
describes the app record rather than any one prompt path. It stays optional, and
`--logo-uri` / non-interactive runs are unchanged.

Neither `create` nor `scaffold` asks *"What feature do you want to scaffold?"* any more —
the CLI ships one feature, so that list had a single entry. Both prompts derive from the
feature manifest, so a picker returns by itself if a second feature is added.

**Fixed: `create` no longer prints `Client ID: undefined`.** Moving the create request's
OAuth fields inside an `auth` block made the platform echo that nesting back while every
read site still expected them at the top level — so human output dropped its
`Redirect URL n:` lines and `--json` silently omitted `clientId` and `redirectUri`. The
response is now flattened in one place, tolerating both shapes.

**Fixed: a failed read-back no longer destroys a successful create.** When the read-back
answered `404` for an ID the create endpoint had issued a second earlier, the command
exited non-zero while the app sat on the server, and re-running produced another one. The
create response is now used as a fallback and the run completes with a warning. Scoped to
that one read and to `404` only.

**Fixed: `create` no longer leaves a stray directory behind when the create fails.** The
target directory was created and `chdir`'d into one line *before* the app was registered,
so any hard failure left an empty directory on disk. The directory *decision* still
happens first — that is what stops an abandoned prompt from orphaning an app — but nothing
is written until there is provably an app to write it for.

**Fixed: the scaffold file count no longer reads `(0 files)` above a file tree.** It now
reports the pair: `created (5 files)`, `already in place (5 files, nothing rewritten)`, or
`created (2 of 5 files written)`.

**Fixed: choosing Overwrite or Merge on *"Directory already exists"*** was followed by
`Creating <dir> and moving into it...`, contradicting the answer just given. It now says
`Moving into <dir>...`.

## Output

**Boxed output wraps instead of shredding itself.** `printBox` sized itself to its longest
line and left the terminal to wrap anything wider — and a terminal wraps text without the
frame, so one 147-column line in a 127-column window destroyed the whole box. Lines are
now wrapped before the frame is drawn, breaking on a word where possible and mid-string
where not (a URL), with continuation rows indented under their label and colour carried
across the break. Piped output falls back to 80 columns.

**Selection prompts are indented into the CLI's output gutter** — `list` and `checkbox`
options used to render two columns left of every other line the CLI prints. Numbered app
pickers are unchanged.

**Fixed: the first row of a printed file tree was indented two columns deeper than the
rest** — the tree was handed to the logger as one multi-line string, so the output gutter
landed on the string rather than each line.

**The logo-URL prompt fits an 80-column terminal.** It now reads `App logo URL (optional —
leave blank to skip):`; the example URL moved to the validation error.

## `app-config.json` shape

All changes are backward compatible on read and migrated on the next write-back (by
`upload`, `app start`'s URL registration, `credentials`, or `scaffold`):

- `auth.redirectUrls` → **`auth.redirectUris`**, matching the wire key `redirect_uris`. The
  old key is still read (the new one wins if both are present). **Downgrade caveat:** older
  CLI releases read only `redirectUrls`, so a migrated file reads to them as a config with no
  redirect URLs at all. Where that is loud it is harmless — `app update` stops with
  "app-config.json has no redirect URLs configured". **`app start` is the one that costs you
  something:** seeing an empty list, it offers to register `http://localhost:<port>/auth/callback`
  and, on yes, pushes that single URL as the app's whole `redirect_uris` — so every real
  redirect URI on the app is dropped, and the write-back re-adds the URL under the legacy
  key. Nothing in the run says a URL was removed. Upgrade the lagging CLI, or keep both keys
  as a stopgap; if it already happened, restore the list in `app-config.json` and
  `brevo app upload`.
- A legacy top-level `distribution` key, and the interim `auth.type`, become
  **`distribution_type`**.
- New read-only top-level **`version`**, tracking the app-store API's version field.
- `cliVersion`, `permittedUrls`, `support` and `auth.type` are dropped — nothing read them.

`brevo app credentials` backfills a legacy config toward the current shape when its `appId`
matches the app being inspected: a missing `version` / `distribution_type` is filled in from
the server, never overwriting a value the file already carries. This mirrors the migration
`upload` performs, so projects that are never uploaded still converge.

## Help, `--json`, and debugging

**`brevo <command> --help` now prints that command's own usage line, arguments, flags and
examples.** Every subcommand previously rendered the root help screen — never naming the
flags the user was looking for, despite the root screen telling them to run
`brevo <command> --help` for exactly those details. The root screen is unchanged.

**`--json` now applies when a command fails.** Commands other than `whoami` and `logout`
wrote the error to stderr and exited non-zero without emitting anything on stdout, so a
script parsing `brevo app list --json` got zero bytes and no reason. Failures now write a
single `{"error": {...}}` document to stdout carrying `name`, `message` and `exitCode`,
plus `statusCode` and (when classified) `code`. The human-readable message still goes to
stderr, and `brevo whoami --json` keeps describing its own failure, so stdout stays exactly
one parseable document.

**`brevo app list` shows a `Version:` line per app** and includes `version` in `--json`. It
is also hardened against the list endpoint returning `redirect_uris: null` / `scopes: null`
— not `[]`, not absent — which used to end the listing part-way through with
`Cannot read properties of null (reading 'length')`. The same unguarded dereference in
`brevo app credentials` is fixed too.

**`--debug` logs the request body** as well as the response, before the request goes out —
so a payload the platform rejects can be read next to the rejection, and is still there
when the request never comes back. Both lines carry the same `<METHOD> <path>` and the same
redaction. Nothing changes without `--debug`.

## Request payloads

`POST /v3/app-store/apps` now carries OAuth fields inside the same `auth: { scopes,
redirect_uris }` block the upload endpoint takes, and the upload request's version field is
renamed `app_version` → `version`. The CLI no longer sends `cli_version` or `source: 'cli'`
in either body: both were outside the declared contract, the upload endpoint rejects unknown
keys with a `400`, and the caller is already identified by a structured `User-Agent`
(`brevo-cli/<version> (<os>; auth=<method>)`).

## An expired session is reported before the prompts, not after them (BEX-341 follow-up)

`brevo app create` could ask every question and only then report
``Your session has expired. Run `brevo login` ``, discarding all of it. A refresh token the
login service *refuses* was being treated like a transient network failure — logged at debug
level and swallowed, leaving the run to continue on a session already proven unusable.

A refused refresh token is now terminal: the stored credentials are cleared and the expiry
is reported from the pre-command hook, before the first prompt. Failures that say nothing
about the session — a timeout, a `5xx`, an unwritable credentials file — are still swallowed
and still never block a command. Two smaller changes close the rest of the gap: the token is
re-checked before each authenticated request rather than once at startup, and if the session
does die mid-flow, `brevo app create` offers to log you back in and re-sends the answers you
already gave (interactive terminals only). Exit codes and error text are unchanged.

## The legacy `all` OAuth scope is refused on upload (BEX-214)

The catch-all `all` scope is being deprecated. `brevo app upload` now stops when
`auth.scopes` still contains it and says how to migrate: replace it with the specific scopes
your integration uses, list them with `brevo app available-scopes`, then upload.
`brevo app start oauth` refuses the same config with the same guidance, `brevo app list`
tags an affected app, and `brevo app scaffold` writes granular scopes rather than `all`.

The refusal is local — it costs no round trip and nothing is pushed. An app that already
holds `all` on Brevo is untouched until you upload a replacement scope list; the upload diff
then labels the change as a migration.

## Fixed: `auth.scopes` written as a single string is read correctly

A hand-edited file can carry a bare string — `"scopes": "contacts:read, contacts:write"`.
That shape was documented as normalized on read and was not: the splitter was only reached
when the value was already an array, so the string travelled through untouched and the
upload validator iterated it one character at a time, rejecting the run with
`Invalid scope: ":"`. A string is now split on commas and whitespace exactly as an over-long
array entry always has been.

## Fixed: `app credentials` / `app delete` no longer open an app picker they cannot draw

Both fall back to an interactive app picker when `--app-id` is absent, and that fallback was
not gated on the run being interactive. Under `--json`, or off a TTY, the picker rendered its
choice list — app names, app ids, client ids — onto **stdout**, breaking the
one-parseable-document contract, then aborted with a raw
`ERR_USE_AFTER_CLOSE: readline was closed` stack trace.

Both now refuse up front, before any network call, with a `CliError` naming the exact command
to run (`brevo app credentials --app-id <id>`) and exiting `1`; `--json` gets the usual
`{"error":{…}}` envelope and nothing else. Interactive runs are unchanged. `brevo app delete`
is the consequential one: a scripted delete that appeared to rely on the picker was never
selecting anything, and now says so instead of dying mid-prompt.
