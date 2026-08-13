---
'@getbrevo/cli': minor
---

`brevo app update` is removed and replaced by `brevo app upload`. Also in this release:
`brevo app scaffold` can set up a directory for an app you already have, `app-config.json`
migrates to a new shape, `brevo <command> --help` prints that command's own usage, and
`--json` now produces output on failure paths.

## `brevo app update` is removed — use `brevo app upload` (BEX-250)

`brevo app upload` takes only `--yes` and `--json`. There are no edit flags — `--app-id`,
`--name`, `--redirect-uri`, `--scope`, `--logo-uri` are all gone. Change an app's name,
redirect URLs, scopes or logo by editing `app-config.json`, then run `brevo app upload`.

`upload` always fetches the app's current remote state and renders a local-vs-server diff
before pushing — even under `--yes` (skips the prompt, still shows the diff) and `--json`
(the diff comes back as structured data). If nothing differs it exits `0` with "already up
to date" and makes no network push. Otherwise it POSTs the whole local `app-config.json`
and writes the server-confirmed state back on success, reading the confirmed `version` and
`distribution_type` from the top level of the response.

`distribution_type` is immutable after `app create`. The CLI refuses a changed value
locally, before anything is pushed, and tells you to restore it or create a new app.

`brevo app update` is still registered, hidden, and answers with a message naming
`brevo app upload` and explaining that the edit flags are gone — instead of Commander's
`unknown command 'update'`, whose string-distance guess was `create`. It is not a shim:
nothing is forwarded, nothing is uploaded, and it exits `1` (`--json` gives the usual
`{"error":{…}}` envelope). The message is reachable however the old invocation was typed —
with any removed flag, with stray arguments, and via `brevo app update --help` or
`brevo app help update`, neither of which prints a usage screen or exits `0` any more. It
does not require being logged in, and `update` stays absent from every help screen.

**Migrating:** replace `brevo app update --app-id <id> --name X` (and friends) with a
`brevo app scaffold --app-id <id>` to obtain the config, an edit to `app-config.json`, and
`brevo app upload`.

## `brevo app scaffold` gains a bootstrap mode

`scaffold` now has two modes, selected by whether the current directory holds an
`app-config.json`. With one, it adds a feature to the linked app. Without one, it
*bootstraps* — sets the directory up for an app that already exists — which is the
successor to `brevo app update --app-id`.

`--app-id <id>` names the app; it fetches the app, writes `app-config.json` plus the base
files, then continues into the usual feature flow. Run interactively with no config and no
flag, the command explains there is no app here, asks "Set up a project for an app you
already have?" (default yes) and shows the same app picker `app delete` uses — recovering a
project no longer requires knowing the app's ID, which is the common case after a fresh
clone or a new machine. Declining exits `0`. The offer is interactive-only: under `--json`
or off a TTY the command raises the same no-config error as before, so scripts and CI are
unaffected and `--app-id` remains the non-interactive entry point.

A bootstrap also asks *where* to put the project, the way `brevo app create` does:
`Output directory:` defaulted to `./<the app's name as a slug>`, with the same
overwrite / merge / choose-a-different-path follow-up when that directory already exists.
It creates the directory and reports `cd <dir>` as the first of the next steps. Answer `.`
to keep the current directory. Without this, running `brevo app scaffold` from the folder
where you keep your app folders wrote eleven files straight into it. The question is
interactive-only — under `--json` or off a TTY the project is written to the current
directory exactly as before, so scripted `scaffold --app-id <id>` runs are unchanged.

In that flow the project is written and shown *before* the feature question, so declining
leaves a usable project rather than an empty directory.

Bootstrapping refuses two cases before any network call, each of which previously produced
a silently wrong project:

- **A directory inside an existing app project.** `app-config.json` is read from the current
  directory only and never looked up the tree, so scaffolding one level down used to create
  a second, nested config — after which `brevo app upload` from there pushed the wrong app
  without a warning. It now names the enclosing project and stops.
- **`--app-id` naming a different app than the directory is linked to.**

`scaffold` also asks before reusing existing feature files: interactive runs prompt
**Overwrite / Merge / Cancel** (default **Merge**, which keeps existing files and only adds
missing ones). A new `--overwrite` flag forces a full overwrite and skips the prompt, both
interactively and under `--json`. Non-interactive `--json` runs still default to merging.

Fixed: `brevo app scaffold --json` could block on an interactive prompt (target-directory
conflict, a config diff against the server, or a directory linked to a different app),
hanging CI. `--json` now never prompts — each case is treated as declined and reported via
`{ "cancelled": true, "reason": "...", "diffs": [...] }`.

## Fewer questions with only one answer

`brevo app create` and `brevo app scaffold` no longer ask *"What feature do you want to
scaffold?"* — the CLI ships one feature, so that list had a single entry and could only be
answered one way, and the app type was already chosen. `create`'s confirm names it instead
(*"Scaffold the Test OAuth App?"*, default yes), and `scaffold` goes straight to writing it.
The picker returns by itself if a second feature is ever added: both prompts are derived
from the feature manifest rather than a hard-coded list.

Also: choosing **Overwrite** or **Merge** on *"Directory already exists"* used to be
followed by `Creating <dir> and moving into it...`, contradicting the question just
answered. It now says `Moving into <dir>...`.

## `brevo app create`

Creation is split from feature scaffolding. `create` writes only the basic project structure
— `app-config.json` plus `.gitignore`, `AGENTS.md`, `CLAUDE.md`, `README.md` — and the OAuth
test-server code is now a *feature*, scaffolded when the prompt "Do you want to scaffold a
feature?" (default yes) is answered yes. Non-interactive runs (`--json` or piped stdin) stay
base-only and leave the code to a follow-up `brevo app scaffold`. The old "Generate starter
code now?" confirmation is gone.

`create` hard-errors when `app-config.json` already exists in the working directory, resolves
its target directory before creating the app, and says where files are landing before it
writes them. The post-scaffold "Next steps" box shows a `cd <dir>` step when scaffolding
landed somewhere other than where the command was run — the CLI's internal `process.chdir()`
cannot move the shell the command was typed into.

The OAuth callback hint labels the localhost default as a local test-server callback and
reminds you to add a production one.

**Fixed: `create` no longer prints `Client ID: undefined`.** Moving the create request's OAuth
fields inside an `auth` block made the platform echo that nesting back, and every read site
still expected them at the top level — so the human output dropped its `Redirect URL n:` lines
and `--json` silently omitted `clientId` and `redirectUri`, breaking any pipeline reading
either. The response is now flattened in one place, tolerating both shapes.

**Fixed: a failed read-back no longer destroys a successful create.** `create` reads the app
back to build the scaffold; when that read answered `404` for an ID the create endpoint had
issued a second earlier, the command exited non-zero while the app sat on the server, and
re-running produced another one. The create response is now used as a fallback, and the run
completes with a warning pointing at `brevo app scaffold`. Scoped to that one read and to
`404` only — a `500` or an expired session surfaces as before.

**The logo URL is now asked up front, for every app.** `App logo URL` used to be the last
question before the output directory, which put it *after* the app-type branch — so it
arrived once the OAuth callback URLs had been entered. It describes the app record rather
than either prompt path, so it is now asked immediately after the app name, identically
for every app. The interactive flow opens name → logo URL → distribution → app type, and
only then asks whatever the chosen type needs. The logo remains optional (blank skips it),
and `--logo-uri` / `--json` / non-interactive runs are unchanged. Relatedly, an invalid
`--distribution` value is now rejected before any prompt is shown rather than after the
logo question.

**`Distribution type?` and `What type of app are you building?` are now always asked.**
Both used to be skipped in a build where only one answer remained, applying it silently.
They are now asked whenever the run is interactive, listing only the choices that build
supports — so the flow reads the same everywhere and you are told which distribution and
app type you are getting rather than having to know. Non-interactive runs (`--json` or
piped stdin) still ask neither and still default to a private OAuth app.

**Boxed output wraps instead of shredding itself.** `printBox` sized itself to its longest
line, which left the *terminal* to wrap anything wider than the window — and a terminal
wraps the text without the frame, so the tail of an over-long line came out with no
borders and every `│` after it landed mid-row. One long line was enough to destroy the
whole box: a created-app summary carrying an example URL with six query parameters came to
147 columns and shredded itself in a 127-column window. Lines are now wrapped to the
window before the frame is drawn, breaking on a word where one is available and mid-string
where none is (a URL), with continuation rows indented under their label. Colour is
measured out of the width and carried across the break, so a wrapped coloured value can't
leak its colour onto the border. Piped or redirected output has no width to respect and
falls back to 80 columns.

**Fixed: the scaffold file count no longer reads `(0 files)` above a file tree.** It
reported files actually written, so choosing **Merge** on an existing directory — which
keeps what is there and adds only what is missing — announced `Project structure created
(0 files)` directly above a five-file tree. It now reports the pair: `created (5 files)`
when everything was written, `already in place (5 files, nothing rewritten)` when nothing
was, and `created (2 of 5 files written)` in between. Same three forms for the feature
scaffold's own count.

**Fixed: the first row of a printed file tree was indented two columns deeper than the
rest.** The tree was handed to the logger as a single multi-line string, so the CLI's
output gutter landed on the string rather than on each line.

**Fixed: `brevo init` no longer tells a UI app to run the OAuth test server.** Its closing
line named `brevo app start oauth` whatever was just created — a command a UI app has no
way to run (an action link has no OAuth flow and no local server), and one that
contradicted the *Next steps* box printed immediately above it. A UI app now closes by
pointing at those next steps and `brevo --help`; OAuth apps are unchanged.

**The UI-app record-page prompt shows the registry's own page names.** It used to render
`contactDetails` as `contact` through a CLI-owned map, with a strip-`Details` guess for any
page the map didn't know — so the prompt could disagree with the platform, and every page
the registry gained needed a second name kept in step by hand. The prompt now shows the
`location_name` the API returned, verbatim, and pre-selects nothing (it used to default to
*contact*): the pages are the registry's answer, so the CLI doesn't nominate one. Picking
at least one is still required.

**Selection prompts are indented into the CLI's output gutter.** Every `list` and
`checkbox` prompt — the login method, `init`'s next action, distribution, app type,
scaffold's overwrite/merge conflicts, and the UI-app authoring questions — used to render
its options flush against the terminal's left edge, two columns left of every other line
the CLI prints. The option labels now sit in the same two-space gutter as the rest of the
output, so they read as nested under their question. Numbered `rawlist` prompts (the app
pickers) are unchanged — their ` 1) `, ` 2) ` already provide that structure.

## `app-config.json` shape

All changes are backward compatible on read and migrated on the next write-back (by `upload`,
`app start`'s URL registration, `credentials`, or `scaffold`):

- `auth.redirectUrls` → **`auth.redirectUris`**, matching the wire key `redirect_uris`. The old
  key is still read (the new one wins if both are present). **Downgrade caveat:** older CLI
  releases read only `redirectUrls`, so once a file is migrated they fail with "app-config.json
  has no redirect URLs configured." Upgrade the lagging CLI, or re-add the old key alongside
  the new one as a stopgap — both are read, and the new one wins.
- A legacy top-level `distribution` key, and the interim `auth.type`, become
  **`distribution_type`**.
- New read-only top-level **`version`**, tracking the app-store API's version field.
- `cliVersion`, `permittedUrls`, `support` and `auth.type` are dropped — nothing ever read them.

`brevo app credentials` now backfills a legacy config toward the current shape when its `appId`
matches the app being inspected: a missing `version` and/or `distribution_type` is filled in
from the server. Fill-only-when-missing — a value the file already carries is never overwritten.
It runs in every mode; human output prints a one-line note only when something was written, and
`--json` output is unchanged. This mirrors the migration `upload` already performs, so projects
that are never uploaded still converge.

## Help, `--json`, and output

**`brevo <command> --help` now prints that command's own usage line, arguments, flags and
examples.** Previously every subcommand rendered the root help screen — repeating the full
command list and never naming the flags the user was looking for, despite the root screen
telling them to run `brevo <command> --help` for exactly those details. A single `formatHelp`
override on the root program was being copied down to every subcommand. The root screen is
unchanged.

**`--json` now applies when a command fails.** Commands other than `whoami` and `logout`
previously wrote the error to stderr and exited non-zero without emitting anything on stdout, so
a script parsing `brevo app list --json` got zero bytes and no reason. Failures now write a
single `{"error": {...}}` document to stdout carrying `name`, `message` and `exitCode`, plus
`statusCode` and (when the API classified it) `code`. The human-readable message still goes to
stderr, and `brevo whoami --json` keeps describing its own failure as
`{"authenticated": false, …}`, so stdout stays exactly one parseable document.

**`brevo app list` shows a `Version:` line per app** and includes `version` in `--json` output.
It is also hardened against the list endpoint returning `redirect_uris: null` and
`scopes: null` — not `[]`, not absent — which the command used to dereference, ending the whole
listing part-way through with `Cannot read properties of null (reading 'length')`. Both wire
fields are now typed as nullable, which surfaced the same unguarded dereference in
`brevo app credentials`, fixed here too.

`--debug` (or `BREVO_DEBUG=1`) now logs the request body as well as the response, before the
request goes out — so a payload the platform rejects can be read next to the rejection, and is
still there when the request never comes back. Both lines carry the same `<METHOD> <path>` and
are redacted by the same rules. Nothing changes without `--debug`.

## Request payloads

`POST /v3/app-store/apps` now carries OAuth fields inside the same `auth: { scopes,
redirect_uris }` block the upload endpoint takes, and the upload request's version field is
renamed `app_version` → `version`. The CLI no longer sends `cli_version` or `source: 'cli'` in
either body: both were top-level keys outside the declared contract, the upload endpoint binds
strictly and rejects unknown keys with a `400`, and the caller already reaches the backend on
every request as a structured `User-Agent` (`brevo-cli/<version> (<os>; auth=<method>)`).

`brevo app create` no longer leaves a stray project directory behind when the create fails. The target directory was resolved — created, and `chdir`'d into — one line *before* the app was registered, so any hard failure (a plan quota `403`, a dropped connection, an unmapped `400`) left an empty directory on disk and moved the shell's working directory into it. The directory *decision* still happens before the create, deliberately: it is what stops an abandoned prompt from orphaning an app on the server. Only the filesystem mutation moved to after the create returns, so nothing is written until there is provably an app to write it for. The `409` name clash is unaffected — it retries in place and never reached the failure path.
