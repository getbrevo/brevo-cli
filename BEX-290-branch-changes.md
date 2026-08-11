# BEX-290 — user-facing changes on this branch

Everything this branch (`BEX-290_ui-components`) adds **relative to `features_set_public_cli`**, i.e.
the UI-app work only. 32 commits, ~8.7k insertions across 47 files.

Scope note: the public-app work is *not* listed here. `brevo app upload` replacing `brevo app update`,
`brevo app submit` / `app status` / `app withdraw`, the `brevo app scaffold` rework, the
`auth.redirectUrls` → `auth.redirectUris` rename and the `cli_version` removal all landed on
`features_set_public_cli` and are inherited, not introduced.

Per-branch working doc — delete before merging into `main`, along with `TODO.md` and the
`## Per-branch verification` section of `RELEASE-CHECKLIST.md`.

---

## 1. New: UI apps as an app type

`brevo app create` gains a leading **"What type of app are you building?"** prompt — an OAuth
integration (the default path) or a UI app. A UI app is a new *type* of app rather than a separate
entity: it shares the app record, credentials and version lifecycle with OAuth apps, and adds a
`ui_app` block to `app-config.json` describing where and how it renders inside Brevo.

The first shippable variant is the **action link** — a partner-authored entry point that appears in
a CRM record's action menu and opens an external URL in a new tab with record context.

### Prompt-only, deliberately

There is no `--type` flag and no flag for any UI-app field. Every non-interactive run — `--json` or
piped stdin — creates an OAuth app exactly as before, so existing scripted invocations are
unaffected and nothing new becomes scriptable while the feature is still in development.

### The create flow — five questions, one optional

1. **"Do you want to add a link or an iframe?"** — sets `extension_type`. **Link** is selectable;
   **Iframe** is listed but disabled ("coming soon"). Asked first because it is the decision a
   partner arrives with, and because it decides which single URL question is asked at the end.
2. **Which record pages should it appear on?** — multi-select of contact / company / deal, read from
   `GET /v3/app-store/surface-points/locations`.
3. **Where should it appear on those pages?** — **one single-select prompt per page** ("Where should
   it appear on the contact page?"), listing that page's placements, each reading as a page region
   plus the shape it renders as (*Header "More" (•••) menu — menu entry*, *Sidebar — card*). An app
   therefore takes exactly one spot per page, and can still mix shapes across pages. A picked page
   the registry offers no spot on is reported as a warning and simply not asked about.
4. **Label** (≤ 48 chars), 5. **More info** (≤ 255 chars, optional), 6. **Redirect link**.

Length ceilings are checked at the prompt and again at upload, so an over-long value fails with a
precise local message instead of an opaque 400.

### The registry is the only authority on slot names

Placements are read **live from the platform registry, fetch-only, with no offline fallback** — if
the first fetch fails, UI-app creation aborts with an actionable error (OAuth creation is
unaffected). The record pages come from the `locations` endpoint; the rows come from one narrowed
read, `GET /v3/app-store/surface-points?location=<csv>`. A narrowed read that fails or that covers
fewer pages than were asked for is retried unfiltered and narrowed locally; only a failure of both
aborts.

The CLI carries **no list of valid slot names**. It used to mirror the platform's twelve
`extension_points` rows so `app upload` could pre-flight offline, but a copy can only lag the
registry and it failed in both directions — rejecting a slot the platform had added (including one
the CLI had just authored itself) and accepting one the platform had removed, which is exactly the
silent empty slot the check existed to prevent. `app upload` now sends the block and the endpoint
answers `400` naming every offender. `validateSurfacePoint` is deliberately shape-only, and a test
asserts an unregistered name passes it, so an allow-list cannot creep back in.

For anyone hand-editing `app-config.json`: a mistyped slot name is no longer caught locally.

### The created-app box prints an example URL

The redirect link with the seeded context fields as query parameters and placeholder values — query
parameters are the only way context reaches a partner's endpoint. There is no path templating, so
seeing the exact shape before building the endpoint beats discovering it from a request log.

---

## 2. New commands

| Command | Notes |
|---|---|
| `brevo app deploy [account-id]` | Make an app available in a Brevo account. `--app-id`, `--force`, `--json`. Refuses until the configuration has been validated by an upload, pointing at `brevo app upload` — detected locally from a missing `version` and mapped from the server's own rejection |
| `brevo app rollback [account-id]` | Roll back an app from a Brevo account. Same flags. No upload gate; treats HTTP 404 as "not deployed to this account" and exits `0` (`{"rolledBack": false, "reason": "NOT_DEPLOYED"}` under `--json`) so teardown scripts stay idempotent |

Both resolve the target app from `--app-id`, the linked `app-config.json`, or an interactive picker.

### `[account-id]` is optional on both

Omitted, the target resolves from the authenticated account. A plain account has exactly one
possible answer — itself — so it resolves with no prompt and no extra request, and keeps working
under `--json` and in CI. A corporate account lists its active sub-accounts and asks which one;
deactivated sub-accounts aren't offered, and if none are, the command says so rather than showing an
empty prompt. Passing the ID explicitly skips resolution entirely and remains the only way to target
an account the listing won't show.

### One resource, not two routes

`POST /v3/app-store/apps/{id}/installs` to install, `DELETE` on the same path to remove. The
`deploy` / `rollback` commands are named for the partner-facing verb; the resource is an install.

Both carry `client_id` (the *caller* — the account that owns the app, which the server resolves the
app against) and `deploy_client_id` (the *target* the install lands in). They are not
interchangeable and differ whenever a corporate account deploys into a sub-account. Both are
optional on the wire and a **non-numeric identifier is omitted rather than sent** — the platform
types both as 64-bit ints and parses the body before it reads the authenticated caller, so a UUID
would reject a request that otherwise works. Omission loses nothing: the server resolves the caller
from the credential and defaults the target to it.

Trade-off worth knowing: because the uninstall endpoint identifies the install from the body rather
than an installation ID (a developer never has one), it answers 404 both for an unknown app and for
an install that isn't there — so a mistyped `--app-id` on `rollback` reports "not deployed" rather
than "app not found".

---

## 3. `app-config.json` changes

A UI app's config carries a `ui_app` block instead of an OAuth one:

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

The block **is** the app snapshot the platform stores, field for field — field names are confirmed
against both of its consumers (the manifest read path and the extensibility UI kit, BEX-308 /
BEX-350).

- **`auth` is now empty (`{}`)** for a UI app — no `scopes`, no `redirectUris`. On the wire the two
  blocks are mutually exclusive on both create and upload: a UI app sends `ui_app` and no `auth`, an
  OAuth app sends `auth` and no `ui_app`. **The presence of `ui_app` is the app-type
  discriminator** — there is no `appType` key, and every branch that needs to tell the types apart
  goes through `isUiAppConfig()`.
- **`surface_point_name` takes the registry's kebab-case slug** (`contact-details-header-menu`), not
  the dotted `contactDetails.headerMenu.action` name that every spec quotes and that renders in the
  UI. Authoring the dotted name 400s with `ui_app.surface_point_list contains unregistered extension
  point(s)`, naming slots that plainly exist — that bug shipped on this branch and was fixed twice:
  once for the value, once so the *key* names the registry column it is matched against. A row the
  registry gives no slug for is dropped from the prompt, since the platform's lookup skips a NULL.
- **`link_target`, the block's `version`, and `extension_point_name` are not fields in the file.**
  `app upload` injects `_blank` (for an `actionLink` only); the write-back strips all three and the
  upload diff normalizes them away on both sides, at every depth — otherwise the first successful
  upload writes fields into `app-config.json` that it isn't supposed to carry, and a UI app reads as
  changed on every upload so "Already up to date" never prints again. The diff also sorts
  `surface_point_list` before comparing, since the server returns registry order.
- **`permittedUrls` and `support` are gone** from scaffolded configs for *both* app types — nothing
  ever read them. Existing files keep working; the CLI ignores them and drops them on the next
  write-back.
- **`extension_type` values are camelCase** (BEX-350): `actionLink`, `iframeExtension`,
  `legacyComponent`. The pre-BEX-350 snake_case spellings are deliberately **not** accepted — no
  alias map, no normalize-on-read — because the CLI is a producer and there is no config in the wild
  to migrate.
- **`modal_iframe_url` is rejected on an `actionLink`**, since the UI kit keeps it only for an
  `iframeExtension` and would otherwise discard it silently.
- **A config written by an earlier build of this branch is rejected**, with a migration hint naming
  the fix (`heading` → `label`, `subheading` → `more_info`, top-level `context` → move into each
  entry, bare strings in `surface_point_list` → wrap as objects). Purely a local diagnostic; there
  is no read-path alias, since these files only exist on developer machines.

### Two fields the CLI deliberately does not author

A **card's title** (it is the app name, and is the only rendered text a partner changes by renaming
the app) and **partner-declared context properties** (record context is an allow-list on the
registry row; an entry's `context` can only narrow it).

---

## 4. Changes to existing commands

### `brevo app list`

- **No longer crashes on a UI app.** The list endpoint returns `redirect_uris: null` — not `[]`, not
  absent — for any app with no OAuth block, which is every UI app. The command dereferenced that
  list, so a single UI app in the account ended the whole listing part-way through the output with
  `Cannot read properties of null (reading 'length')`. Both nullable wire fields (`redirect_uris`
  and `scopes`) are now typed as nullable so the compiler covers the remaining read paths — which
  surfaced the same unguarded dereference in **`brevo app credentials`**, fixed here too.
- **Renders a UI app as a UI app.** Each row now leads with its type (`OAuth app` / `UI app`), a UI
  app's OAuth-only rows are omitted rather than printed empty (an empty Client ID and three
  `(none)` rows read as a broken OAuth app), and the `ui_app` block is rendered field for field.
  Header is `Your apps:` rather than `Your OAuth apps:`. The list endpoint does not echo `ui_app`
  today, so a UI app's row currently stops at the type; type detection falls back to the absence of
  every piece of OAuth material.

### `brevo app create`

- **Prompt order** is now name → distribution → app type → type-specific prompts → logo.
  Flag-driven and non-interactive runs are unaffected.
- **Sends the `ui_app` block in the create request**, under the same key `app upload` uses. It was
  previously written only to `app-config.json`. A create body carrying neither `auth` nor `ui_app` —
  which is what a UI app produced — has nothing in it saying the missing OAuth block is deliberate,
  and the endpoint rejects it with `redirect_uris is required and must not be empty`. Whether the
  endpoint actually branches on it is not yet confirmed.
- **A failed read-back no longer discards a created app.** After creating, `create` reads the app
  back to build the scaffold. When that answered `404 id not found` — observed on staging for an ID
  the create endpoint had issued a second earlier — the error propagated before any file was
  written: non-zero exit with `App <id> not found.` while the app sat on the server, and re-running
  produced another one. The create response is now passed in as a fallback, and the run completes
  with a warning pointing at `brevo app scaffold`. Scoped to that one read and to 404 only — a 500
  or expired session still surfaces, and a 404 anywhere else still fails.
- **`--redirect-uri` is documented as OAuth-only**; UI apps never ask for or default one.
- No feature is scaffolded for a UI app — there is no local server to run.

### `brevo app upload`

- Sends the block under the `ui_app` wire key and validates it locally first — deliberately stricter
  than the wire, because the platform degrades a bad snapshot silently rather than rejecting it.
- Local validation keeps only the checks that are statements about the *file*: entries must be
  objects, `surface_point_name` non-blank, slots not repeated, `context` names unique and non-blank,
  `redirect_link` https (`http://` accepted for `localhost` / `127.0.0.1`), pre-BEX-290 field names
  rejected with a migration hint.
- The **redirect-URL requirement is OAuth-only**; the diff covers the snapshot ignoring key order,
  so editing only the `ui_app` block is correctly detected as a change.
- Enforces the empty-`auth` shape both ways: a UI-app config still carrying `scopes`/`redirectUris`
  is rejected, and an OAuth-less marker on a config with no `ui_app` block is rejected too.

### `brevo app scaffold`

Inside a UI-app project it refreshes the base config and reports there are no features to scaffold.
It preserves a hand-edited `ui_app` block through a confirmed config refresh — which would otherwise
have overwritten `app-config.json` wholesale from server values that don't include it — and no
longer reports phantom redirect-URL drift for an app type that has none.

### `--debug`

Now logs the **request body** as well as the response, so a payload the platform rejects can be read
next to the rejection. The body is logged *before* the request goes out, so it is still there when
the request never comes back (a timeout, a dropped socket). Both lines carry the same
`<METHOD> <path>` so the two halves pair up in a busy log, and both are redacted by the same rules —
a `client_secret` or access token prints as `[REDACTED]` in either direction. A request with no body
logs no line rather than a bare `undefined`. Nothing changes without `--debug` / `BREVO_DEBUG=1`.

### Request bodies

**`source: 'cli'` is no longer sent** in the `app create` body (BEX-355). It was a top-level key
outside the declared create contract, and the platform now reads it as policy input rather than
telemetry: `POST /v3/app-store/apps` answers `400 invalid_parameter` ("public apps cannot be created
with source \"cli\"") for any create pairing it with `distribution_type: "public"`. The caller
already reaches the backend on every request as a structured `User-Agent`.

---

## 5. Docs

`README.md`, `agent-context/SKILL.md` and `agent-context/AGENTS.md` gain a **"⚠️ UI apps are not
available yet"** notice, reusing the public-app *Exception — internal Brevo accounts* clause (agents
run `brevo whoami --json` and skip the restriction when the email ends in `@brevo.com` or
`@sendinblue.com`, so dogfooding still works).

Documentation-level only — the CLI ships the surface unguarded, by design. A runtime guard is tracked
separately in `RELEASE-CHECKLIST.md`; if one is added it needs the same internal-account escape hatch.

---

## 6. Release gates

Blocking, called out in the changeset:

- The unified create/upload payload **requires the matching server-side change** — do not release
  ahead of it.
- The `source: 'cli'` removal **changes what the platform does with `--distribution public`**, and
  the outcome depends on how the create endpoint treats an absent `source`. Confirm against BEX-355
  before releasing.

Still assumed, marked in code comments and tracked in `RELEASE-CHECKLIST.md` → *Before UI-apps GA*:

- HTTP 422 for `deploy`'s "not uploaded" (the confirmed platform PR is uninstall-only).
- Whether the install `POST` response carries an install ID worth surfacing.
- The `type === 'corporate'` discriminator on `/v3/account/info` that account resolution branches on.
- Whether `POST /v3/app-store/apps` actually branches on the `ui_app` block.
- Whether the platform should resolve a just-created app's ID at all (the create read-back 404).

Confirmed: the `ui_app` upload key, and the deploy transport as one resource
(`POST`/`DELETE /v3/app-store/apps/{id}/installs`, app-store-backend PR #717, BEX-362 / BEX-364).

### Sequencing

Labelling the header-menu entry from `label` is a rendering change on the Brevo side. Until that
ships, a partner can author a `label` the menu does not yet show. The CLI is the producer and is
ready; nothing here is blocked on it.
