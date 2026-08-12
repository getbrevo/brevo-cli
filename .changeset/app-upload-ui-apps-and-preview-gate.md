---
'@getbrevo/cli': minor
---

`brevo app update` is removed and replaced by `brevo app upload`. Also in this release:
`brevo <command> --help` prints that command's own usage, and `--json` now produces output
on failure paths.

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
flag, the command explains there is no app here, asks "Set this directory up for an app you
already have?" (default yes) and shows the same app picker `app delete` uses — recovering a
project no longer requires knowing the app's ID, which is the common case after a fresh
clone or a new machine. Declining exits `0`. The offer is interactive-only: under `--json`
or off a TTY the command raises the same no-config error as before, so scripts and CI are
unaffected and `--app-id` remains the non-interactive entry point.

Bootstrapping refuses three cases before any network call, each of which previously produced
a silently wrong project:

- **A directory inside an existing app project.** `app-config.json` is read from the current
  directory only and never looked up the tree, so scaffolding one level down used to create
  a second, nested config — after which `brevo app upload` from there pushed the wrong app
  without a warning. It now names the enclosing project and stops.
- **A UI app that was never uploaded.** The platform sources a UI app's `ui_app` block from
  its latest upload snapshot, so a never-uploaded UI app has no block to return, and a config
  written without one reads as a valid *OAuth* app (the block's presence is the app-type
  discriminator). A half-configured OAuth app — client ID issued, no callbacks yet — is
  unaffected and still bootstraps.
- **`--app-id` naming a different app than the directory is linked to.**

`scaffold` also asks before reusing existing feature files: interactive runs prompt
**Overwrite / Merge / Cancel** (default **Merge**, which keeps existing files and only adds
missing ones). A new `--overwrite` flag forces a full overwrite and skips the prompt, both
interactively and under `--json`. Non-interactive `--json` runs still default to merging.

Fixed: `brevo app scaffold --json` could block on an interactive prompt (target-directory
conflict, a config diff against the server, or a directory linked to a different app),
hanging CI. `--json` now never prompts — each case is treated as declined and reported via
`{ "cancelled": true, "reason": "...", "diffs": [...] }`.

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

Interactive prompt order is now name → distribution → app type → type-specific prompts →
logo. Flag-driven and non-interactive runs are unaffected. The OAuth callback hint labels the
localhost default as a local test-server callback and reminds you to add a production one.

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

## New commands

- **`brevo app status`** — an app's review lifecycle state (`configured`, `submitted`,
  `in_review`, `approved`, `rejected`, `changes_requested`, or `unknown`) with a human
  message. Read-only, `--json` gives `{ state, message }`.
- **`brevo app submit`** — opens the public-app review submission form. Runs a status
  preflight, requires `distribution_type: public`, and verifies the local `app-config.json`
  matches the server (showing a field-by-field diff with `(local only)` / `(server only)`
  tags on drift) before opening the form. `--json` prints `{"app_id","form_url"}`.
- **`brevo app withdraw`** — withdraws an app from submission. Mirrors `app delete`'s UX
  (`--force`, `--json`); an app that was never submitted prints a hint and exits `0`.
- **`brevo app deploy [account-id]`** / **`brevo app rollback [account-id]`** — manage a UI
  app's availability in one Brevo account.

All five resolve the target app from `--app-id`, the linked `app-config.json`, or an
interactive picker.

`deploy` refuses an app that was never uploaded, whichever way it is named — a linked project
is answered from `app-config.json` with no extra request, and `--app-id` / the picker read the
app's server-side version. There is no server-side gate: the install endpoint resolves the app,
checks the plan and installs, so an unuploaded app would otherwise answer `201` and render
nothing.

`rollback` has no such gate and treats HTTP `404` as "not deployed to this account", exiting
`0` (`{"rolledBack": false, "reason": "NOT_DEPLOYED"}` under `--json`), so teardown scripts stay
idempotent — at the cost of a mistyped `--app-id` reading as "not deployed" rather than "app not
found".

`[account-id]` is optional on both. Omitted, the target resolves from the account you are logged
in as: a plain account resolves to itself with no prompt (so `--json` and CI keep working), a
corporate account lists its active sub-accounts and asks. Passing the ID explicitly skips
resolution and remains the only way to target an account the listing won't show.

## UI apps (BEX-290)

A UI app is a new *type* of app rather than a separate entity — it shares the app record,
credentials and version lifecycle with OAuth apps, and adds a `ui_app` block to
`app-config.json` describing where and how it renders inside Brevo. The first shippable variant
is the **action link**: an entry in a CRM record's action menu that opens an external URL in a
new tab with record context.

```json
{
  "ui_app": {
    "extension_type": "actionLink",
    "surface_point_list": [
      { "surface_point_name": "contact-details-header-menu", "context": ["recordId"] },
      { "surface_point_name": "deal-details-header-menu", "context": ["recordId", "recordName"] }
    ],
    "label": "View in CRM",
    "more_info": "Open this contact in your connected CRM to see full activity history.",
    "redirect_link": "https://example.com/view"
  }
}
```

`surface_point_name` is the registry's **kebab-case slug**, which is what the platform resolves
an entry by. `label` (max 48 chars) labels the menu entry and doubles as a widget card's CTA
button; `more_info` (max 255) is the menu entry's second line and the card's description. A
card's *title* is the app name and has no field. `link_target` is not authored — `brevo app
upload` injects `_blank` for an `actionLink`. Neither is `extension_point_name`, the dotted
`<location>.<place>.<kind>` name the platform derives from the slug and stamps on its own copy;
it is excluded from every configuration comparison on both sides.

**A UI app is authored entirely through the prompts.** There is no `--type` flag and no flag for
any UI-app field, so every non-interactive run creates an OAuth app exactly as before. The flow
is five questions, one optional: link vs iframe (**Iframe** is listed but disabled, "coming
soon") → which record pages → where on each page (one single-select per page, so an app takes
exactly one spot per page and can still mix a menu entry on contacts with a card on deals) →
label → more info (optional) → redirect link. The created-app box prints an **example URL** —
the redirect link with the seeded context fields as query parameters — because query parameters
are the only way context reaches your endpoint.

Placements are read live from the platform's extension-point registry, fetch-only with no
offline fallback: `GET /v3/app-store/surface-points/locations` for the record pages, then
`GET /v3/app-store/surface-points?location=<csv>` for the placements on the pages that were
picked. A page the registry offers nothing on is warned about and skipped. A row carrying no
slug is never offered, since it could only author a placement its own upload rejects.

**The CLI carries no list of valid slot names.** It used to mirror the platform's twelve
`extension_points` rows so upload could pre-flight offline; that copy could only lag the
registry and was wrong in both directions — it rejected a slot the platform had added
(including one `brevo app create` had just authored from the live registry) and accepted one
the platform had removed. `brevo app upload` now sends the block and the endpoint answers `400`
naming every slot it doesn't recognise. Local validation keeps the checks that are statements
about the *file*: `extension_type` must be `actionLink` (the pre-BEX-350 `action_link` spelling
is rejected), entries must be objects with a non-blank `surface_point_name`, slots must not
repeat, `context` names must be unique and non-blank, `label` must be non-empty and within its
ceiling, `redirect_link` must be https (`http://` only for `localhost`/`127.0.0.1`), and
`modal_iframe_url` is rejected on an `actionLink`. For anyone hand-editing `app-config.json`, a
mistyped slot name is no longer caught locally.

A UI app's `app-config.json` carries exactly `auth: {}` — an empty object, no `scopes`, no
`redirectUris` — and on the wire both create and upload omit the `auth` key entirely. `ui_app`
is what marks the omission deliberate: a create body carrying neither block is read as an OAuth
app missing its callbacks and rejected with `redirect_uris is required and must not be empty`.
`upload` enforces the shape both ways, rejecting a UI-app config with no `auth` at all and one
still carrying `scopes`/`redirectUris`.

**A config written by an earlier build of this branch is rejected with a migration hint** —
`heading` → `label`, `subheading` → `more_info`, a top-level `context` → move it into each
entry, `surface_point` → `surface_point_name`, and bare strings in `surface_point_list` → wrap
each as an object. There is deliberately no read-path alias: the feature is not live, so these
files only exist on developer machines.

`brevo app scaffold` inside a UI-app project refreshes the base config and reports that there
are no features to scaffold, preserving a hand-edited `ui_app` block through a confirmed
refresh and no longer reporting phantom redirect-URL drift for an app type that has none.

## Public app distribution

`brevo app create --distribution public` no longer errors locally, and Public is a selectable
option in the interactive distribution prompt. The scaffolded OAuth flow branches on
`distribution_type`: **public** apps get Authorization Code + PKCE (RFC 7636) — `/auth/login`
generates a `code_verifier` and sends `code_challenge` + `code_challenge_method=S256`, and the
token exchange and refresh send the `code_verifier` with **no `client_secret`**, so the
generated `.env.local`/`.env.example` carry none. **Private** apps keep the confidential-client
flow unchanged.

The platform still refuses public creates per account. That refusal now reads *"Public apps
can't be created from the CLI yet"*, points at `--distribution private`, notes that
`distribution_type` is fixed at creation, and quotes the server's own response.

## Pre-GA gate (BEX-405)

Public app distribution and UI apps are shipped in this CLI but **not live on the Brevo
platform**. Until now the only thing keeping a user — or their AI agent — out of them was a
notice in the bundled agent docs, which works exactly as far as the agent's cooperation goes.
This is the runtime half.

Gated: `app deploy`, `app rollback`, `app submit`, `app status`, `app withdraw`, the *UI app*
choice in `app create`'s app-type prompt, and `app create --distribution public`.

Two behaviours. **Hidden** — gated commands are dropped from `brevo --help` and
`brevo app --help`, `--distribution` narrows its advertised values to `private`, and the public
example disappears from `app create --help`. **Refused** — invoking one anyway exits `1` with
*"That command is not available yet. It is part of a Brevo feature that has not been released."*

Commands are registered hidden rather than skipped: skipping would drop them from the parser
too, so invoking one would answer `unknown command` — telling the user the CLI has no such
command when in fact it has one that isn't released — and would lose the typed exit code.

**Escape hatch**, the same rule the agent docs already carry: an account whose email ends in
`@brevo.com` / `@sendinblue.com`, or the new **`BREVO_ENABLE_PREVIEW=1`** environment variable
for CI and QA runs against a non-Brevo test account. The email is read from the cached
credential, not a `whoami` round trip, so help renders without a network call and while logged
out — logged out means locked, which is the safe direction.

This is a guardrail, not a security boundary: the check runs client-side and real enforcement
belongs on the API. What it stops is *accidental* use.

## `app-config.json` shape

All changes are backward compatible on read and migrated on the next write-back (by `upload`,
`app start`'s URL registration, `credentials`, or `scaffold`):

- `auth.redirectUrls` → **`auth.redirectUris`**, matching the wire key `redirect_uris`. The old
  key is still read (the new one wins if both are present). **Downgrade caveat:** older CLI
  releases read only `redirectUrls`, so a migrated file makes them fail with "app-config.json
  has no redirect URLs configured." See the note below.
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
stderr, and commands that already describe their own failure — `whoami`'s
`{"authenticated": false, …}`, `rollback`'s `{"rolledBack": false, …}` — keep their shape, so
stdout stays exactly one parseable document.

**`brevo app list` no longer crashes on a UI app.** The list endpoint returns
`redirect_uris: null` — not `[]`, not absent — for any app with no OAuth block, and the command
dereferenced it, so a single UI app in the account ended the whole listing with
`Cannot read properties of null (reading 'length')` part-way through the output. Both nullable
wire fields (`redirect_uris` and `scopes`) are now typed as such, which surfaced the same
unguarded dereference in `brevo app credentials`, fixed here too. Each row now leads with its
type (`OAuth app` / `UI app`), omits a UI app's OAuth-only rows rather than printing them empty,
shows `Version:`, and renders a `ui_app` block field for field. The header is `Your apps:`
rather than `Your OAuth apps:`.

Authoring a `ui_app` block against an account without it enabled previously surfaced the raw
`ui_app is not enabled for this account`. `403` / `ui_app_not_enabled` now reads *"UI apps
aren't enabled for this Brevo account yet"* with the reason and the alternative, mapped by API
code so it covers both `create` and `upload`; `--json` consumers still receive
`code: "ui_app_not_enabled"`.

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

`app deploy` / `app rollback` send `client_id` — the authenticated account's organization ID —
alongside `deploy_client_id`, when each is a number. The two are not interchangeable:
`client_id` is the account that *owns* the app, `deploy_client_id` is the account the install
lands in, and they differ whenever a corporate account deploys into a sub-account. Both are
optional on the wire and a non-numeric identifier is omitted rather than sent, because the
platform types both as 64-bit integers and parses the body before it looks at the authenticated
caller — a UUID in either field would reject a request that otherwise works. Omitting loses
nothing: the platform resolves the caller from the credential and defaults the target to that
same account. If the CLI can't determine your account at all it says so and points at
`brevo login`.
