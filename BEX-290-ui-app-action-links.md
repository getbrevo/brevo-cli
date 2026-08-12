# BEX-290 — UI app support: action links

Design and review notes for the UI-app authoring surface. **Status: implemented** on this
branch; this file records the shape of the change and the decisions behind it.

> **Superseded in part by BEX-355.** This file is a point-in-time record. Four of its
> statements no longer hold:
>
> - **"An action link may only target `<location>.headerMenu.action` … a `.widget` slot
>   would register it somewhere it never appears"** — false. The UI kit renders both
>   extension types on both kinds: a widget slot gets a card
>   (`buildExtensionCardConfig.ts`), an action slot a menu entry
>   (`getExtensionActions.ts`). All twelve registered slots are now authorable.
> - **`modal_iframe_url` "not authorable"** — now authorable, via `iframeExtension`. The
>   modal surface this cited as missing ships in the kit on both delivery paths. An
>   `iframeExtension` may not carry `redirect_link` (the two paths disagree about which URL
>   wins) or `link_target` (inert for a modal).
> - **`link_target` is no longer prompted.** Uploads are pinned to `_blank`; `_self` is
>   refused server-side for now, so there is no choice to offer.
> - **"`contextProperties` … not declared by the partner"** — true when written. The
>   platform since added `context`: the partner may now *narrow* the slot's context
>   allow-list, though never widen it.

> **Superseded again — second BEX-290 round.** Five more statements below no longer hold:
>
> - **`heading` / `subheading` are now `label` / `more_info`.** Not just a rename: `label`
>   labels the header-menu entry, which previously showed the *app name*, and doubles as
>   the CTA button on a widget card. `more_info` is the menu entry's second line and the
>   card's description. The only rendered text with no field is a card's *title*, which is
>   the app name.
> - **"There is no per-action label"** — false, see above. What remains fieldless is the
>   card title.
> - **`surface_point_list` is a list of objects**, `{ surface_point, context? }`, and the
>   top-level `context` is gone. The allow-list belongs to the registry row rather than to
>   the app, so a flat list could not express different context per page.
> - **`link_target` is not written into `app-config.json` at all.** `brevo app upload`
>   injects `_blank`. (The line above about it no longer being prompted still stands; this
>   goes further.)
> - **The create prompts are reordered**, and three are gone. Order is now: link-or-iframe
>   → record pages → one grouped placement prompt → `label` → `more_info` → redirect link.
>   The kind prompt, the separate place prompt, and the record-context prompt were all
>   removed; each entry's `context` is seeded from that registry row's own default.
>
> Anything below describing the old prompt order, the old field names, or a flat
> `surface_point_list` is history. The current shape is in `src/types.ts`, and the
> reasoning is in the changeset.

**Branch base:** cut from `features_set_public_cli`, not `main`. The change extends
`applyConditionals` in `src/templates/index.ts`, which the PKCE work introduced on that
branch and which does not exist in `main` yet.

## Context

Before this change the CLI could only author OAuth integrations. A **UI app** is a second
app type: it shares the app record, credentials, and version lifecycle with an OAuth app,
and adds a `ui_app` block to `app-config.json` describing where and how it renders inside
Brevo.

The first shippable variant is the **action link** — an entry in a CRM record's header
"More" (•••) menu that opens the partner's URL, with record context appended.

The CLI is the partner's authoring surface for it: produce the `ui_app` block, push it to
the platform (which owns validation), and manage per-account availability with `deploy` /
`remove`. Until an in-product enable/disable surface ships, those two commands *are* the
install mechanism.

## Contract

The `ui_app` block is the app snapshot the platform stores, **field for field** — the same
names it stores, serves and renders. There is no mapping layer, so nothing can drift.

```json
{
  "ui_app": {
    "extension_type": "actionLink",
    "surface_point_list": ["contactDetails.headerMenu.action"],
    "heading": "Invoice Manager",
    "subheading": "Review invoice history for this contact",
    "redirect_link": "https://example.com/brevo",
    "link_target": "_blank"
  }
}
```

Verified against both consumers of that snapshot — the manifest read path and the
extensibility UI kit (BEX-308 / BEX-350).

### Fields that deliberately don't exist

Two fields an earlier draft of this work included have no counterpart on the platform, so
the CLI does not author them. Worth knowing, because both are things a partner (or a future
contributor) will look for:

- **A per-action label.** The menu entry is labelled with the **app name**. To change the
  label, rename the app.
- **`contextProperties`.** The record context an action receives is an allow-list on the
  platform's extension-point registry entry — a property of the *slot*, chosen by the
  platform, not declared by the partner.

`modal_iframe_url` also exists on the wire but only applies to the `iframeExtension` type;
the UI kit discards it for anything else, so the CLI rejects it on an action link rather
than let a partner ship a URL that never opens.

### Extension-point grammar (BEX-350)

Slot names are `<location>.<place>.<kind>`. Twelve are registered: locations
`contactDetails`, `companyDetails`, `dealDetails` × widget places `overviewAttributes`,
`overviewMain`, `overviewSidebar` (kind `widget`), plus `headerMenu` (kind `action`). An
action link may only target `<location>.headerMenu.action` — it renders as a menu entry, so
a `.widget` slot would register it somewhere it never appears.

**This is why local validation matters more than usual here.** The UI kit matches
`extensionPoint` by exact string equality, and the platform drops a name with no registry
entry. Both failures are silent — an empty slot, an HTTP 200, no error, nothing for
monitoring to catch. The CLI validates against a mirrored copy of the registry
(`EXTENSION_POINTS` in `src/lib/constants.ts`) because it is the only layer that will ever
tell a partner. Keep that copy in lockstep with the registry.

### Still assumed: the transport, not the shape

The **write path does not exist on the platform yet** — only the read path that consumes the
snapshot. So while the field names are confirmed, the CLI's choice of where to *put* them is
not: it sends the block under a `snapshot` key on `POST /v3/app-store/apps/{id}/upload`, and
assumes `POST /v3/app-store/apps/{id}/deploy|remove` with `account_id` in the body plus
HTTP 422 for "not uploaded" / "not deployed". All marked in code comments and tracked in
`RELEASE-CHECKLIST.md` → *Before UI-apps GA*.

**BEX-350 also needs a coordinated release** — UI kit, reseeded extension-point registry,
and backend together. A CLI release ahead of the reseed authors slot names that resolve to
nothing, silently.

## What changed, flow by flow

Four changes follow directly from the feature. Five more were forced by the existing code
and are the ones most worth reviewing — they're marked **Non-obvious**.

### 1. Config schema — `src/lib/config.ts`, `src/types.ts`

`ProjectConfig` gains an optional `ui_app` typed as the snapshot shape:

```ts
export type ExtensionType = 'actionLink' | 'iframeExtension' | 'legacyComponent';
export type LinkTarget = '_blank' | '_self';

export interface UiApp {
  extension_type: ExtensionType;
  surface_point_list: string[]; // `<location>.<place>.<kind>`, registry-validated
  heading?: string;
  subheading?: string;
  redirect_link?: string;
  link_target?: LinkTarget;
  modal_iframe_url?: string; // iframeExtension only — not authorable
  version?: string; // server-managed
}
```

`readProjectConfig` already spreads unknown top-level keys through, so `ui_app` survives a
round-trip untouched. Added there: a non-object `ui_app` is dropped so callers can trust the
type, but field-level validation deliberately stays out — an unrelated command that merely
reads the config must not fail on a half-written block. `app upload` is the enforcement
point.

**The presence of `ui_app` is the app-type discriminator** — there is no `appType` key.
Every branch goes through `isUiAppConfig()` so the discriminator can change in one place.

### 2. `app create` / `app init` prompts — `src/commands/app/create.ts`

`init` delegates to `createCommand`, so all prompts live in `create.ts`. A new
`resolveAppType` step runs between name and distribution. It is **prompt-only — there is no
`--type` flag** — so any non-interactive run (piped stdin or `--json`) stays `oauth` and
existing scripted calls are unaffected. UI apps aren't live on the platform, and a
scriptable create surface would invite pipelines to pin to a shape that can still change.

Then the paths diverge:

- **`oauth`** → the existing redirect-URL + logo path, byte-for-byte unchanged.
- **`ui`** → `resolveUiApp()` prompts for one or more record pages, then heading,
  subheading, redirect link and link target. The multi-select maps `contact|company|deal`
  onto `<location>.headerMenu.action`. Defaults: record page `contact`, `link_target`
  `_blank`, scopes `contacts:read`/`contacts:write` (narrower than the OAuth defaults). No
  description length cap — the platform enforces none, and inventing one would reject valid
  configs.
  - **Non-obvious:** `resolveRedirectUrls` falls back to the default localhost callback in
    non-TTY runs. Without an explicit skip, a UI app silently acquires an OAuth callback it
    has no flow for. The UI path never calls it, and `redirect_uris` is omitted from the
    create call entirely.

Only reachable interactively, so each field is asked for unconditionally with no flag or
default fallback path; the prompts' own `validate` callbacks are the input check, and
`validateUiApp` re-checks the assembled block. The created-app box
gets a UI-app variant listing extension type, point(s), heading, subheading, redirect link
and link target — and stating that the menu entry is labelled with the app name.

`ui_app` is **not** sent to `POST /apps`; that call registers the app record and issues
credentials. The block travels on upload.

### 3. Feature scaffolding is not offered — `src/commands/app/scaffold.ts`

An action link runs on the partner's own infrastructure, so there is no local server to
generate. The feature prompt is skipped for UI apps, and `app scaffold` in a UI-app project
degrades to a base-config refresh with a message explaining why.

### 4. Templates — `src/templates/index.ts`, `app-config.json.tmpl`

`applyConditionals` is generalised from a single distribution value to a flag set
(`public`/`private` plus `oauth`/`ui_app`), so one template can carry both app types.

- **Non-obvious:** it has a documented byte-for-byte invariant — a private scaffold must
  render identically to one written with no markers at all. Preserved, and covered by the
  existing tests.

The `ui_app` block sits before `permittedUrls` in the template rather than last, so both
branches produce valid JSON without a trailing-comma problem. Markers must be whole-line.

### 5. `app scaffold` refresh would have destroyed a hand-edited `ui_app` block

When drift is detected, the command rewrites `app-config.json` **wholesale** from server
values — which don't include the block. The local block is now carried into the template
vars so a confirmed refresh preserves it. `ui_app` is also excluded from the drift diff: the
local copy is the author's source of truth, and diffing it against an absent remote value
would report permanent phantom drift and then overwrite it with nothing.

Redirect-URL drift is skipped for UI apps too, since the server returns none and the context
falls back to a default — otherwise every UI-app scaffold would report a phantom diff.

### 6. `app upload` — `src/commands/app/upload.ts`

- The block is sent under the `snapshot` key; `UploadAppResponse` reads it back so the
  server's normalisation (notably `link_target`) wins on write-back.
- **The redirect-URL requirement is now OAuth-only.** A UI app legitimately has none.
- Local validation runs before the request, deliberately stricter than the wire — the
  platform degrades a bad snapshot silently rather than rejecting it, so this is the only
  enforcement point. Covers extension type, slot names (registered / action-only / no
  duplicates), non-empty heading, https redirect link (loopback exempt), link target, and
  the `modal_iframe_url` rejection.
- **Non-obvious:** `hasNoChanges` compared every field *except* the block, so editing only
  `ui_app` reported "Already up to date" and never pushed. Now included, with a canonical
  key-order-insensitive comparison so a reformatted file isn't reported as drift.
- **Non-obvious:** this inverts a shipped assertion. `upload.test.ts` had
  `it('never sends a ui_app field')` and `QA-TESTCASES.md` TC-5.7 said the same. That
  guarantee now applies to OAuth apps only; both were updated rather than deleted.

### 7. New `app deploy` / `app remove`

Modelled on `withdraw.ts`: positional `<account-id>`, app resolved as `--app-id` → linked
`app-config.json` → picker, `--force`, `--json`. Shared resolution, the upload gate, and
confirmation live in `account-deployment.ts` so the two mirror commands can't drift.

`deploy` refuses until the config has been validated by an upload — a local pre-flight on a
missing `version` (fast, offline) plus the server's own rejection mapped to the same message.
`remove` has no gate (removing is always safe, and an app deployed by an older CLI must stay
removable) and treats "not deployed" as informational, exiting `0` so teardown stays
idempotent.

### 8. The app type is decided locally, never from server data

- **Non-obvious:** `fetchAppContext` originally fell back to the server's `ui_app`. Since
  it's called during `create`, unexpected server data could reclassify an app the user had
  just explicitly created as OAuth. Both callers always know the type locally, so the
  fallback was removed and pinned with a regression test.

### 9. Not-GA notice

UI apps aren't live, so `agent-context/SKILL.md` and `agent-context/AGENTS.md` carry a
**⚠️ UI apps are not available yet** notice mirroring the public-apps one, reusing the same
internal-account exception so dogfooding still works. This is a judgement call — easy to drop
if unwanted.

## Verification

**Unit** — 847 tests across 46 suites. New: `deploy.test.ts`, `remove.test.ts`, plus UI-app
blocks in `create` / `upload` / `scaffold` / `validators` / `conditionals`, with a case per
silent-failure slot-name mode (stale grammar, wrong casing, widget slot, unregistered
location).

**Manual, against a mock API** — UI-app create → config inspection → upload (wire payload
confirmed to carry `snapshot` and no `ui_app`) → deploy → remove; every validation
rejection; the deploy gate; the snapshot-only diff; and an OAuth regression sweep confirming
an unchanged config and payload.

**Still outstanding** — verification against a real test account: whether the platform
accepts the snapshot, and whether the action link renders once the registry is reseeded.
Tracked in `RELEASE-CHECKLIST.md` → *Per-branch verification*.

## Follow-ups

In `TODO.md` (branch-scoped) and `RELEASE-CHECKLIST.md` → *Before UI-apps GA* (durable). The
load-bearing ones: confirm the write-path transport, sequence the BEX-350 coordinated
release, and keep the mirrored registry in lockstep.
