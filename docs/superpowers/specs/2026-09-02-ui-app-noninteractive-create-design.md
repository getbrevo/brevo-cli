# Non-interactive UI app creation — design

Status: draft, awaiting spec review
Owner: Piyush Sarin
Date: 2026-09-02

## Problem

`brevo app create` for a UI app is currently prompt-only: there is no `--type` flag
and no per-field flags (`src/commands/definitions.ts` L88–91 documents this as
deliberate). `resolveAppType(interactive)` (`src/commands/app/create.ts` L115–121)
hard-returns `'oauth'` whenever the run isn't an interactive TTY (`--json`, piped
stdin, or driven by an agent's non-interactive shell tool). This means any
non-interactive attempt to create a UI app silently creates an OAuth app instead —
no error, just the wrong app type.

This surfaced directly: an AI assistant driving the CLI via a non-interactive Bash
tool correctly detected it couldn't safely drive the wizard and had to hand control
back to a human to run `brevo app create` by hand, following an eight-step manual
prompt script.

The original reasoning for the restriction (`CLAUDE.md`: "a scriptable create
surface would invite pipelines to pin to a shape that can still change") applied
while the `ui_app` config shape was still moving (BEX-426 moved several fields
per-entry). That shape is now considered stable, so the restriction is being
revisited.

## Goal

Let a UI app be created non-interactively — by a script or an agent — through two
input mechanisms, without weakening any of the existing registry-backed validation
that today's interactive wizard performs.

## Non-goals

- Multiple placements in one `create` call. The interactive wizard creates exactly
  one placement per call (CLAUDE.md: "app create authors ONE placement, and that is
  the CLI's rule, not the platform's"); both new non-interactive paths keep that
  same rule. Additional placements continue to go through hand-edited
  `app-config.json` + `brevo app upload`, unchanged.
- A dedicated discovery/listing command for valid `--record-page` /
  `--placement` values. Rejection error messages carry the valid options instead
  (see "Discovery via errors" below) — no new command surface.
- `iframeExtension` (and `legacyComponent`). This iteration only supports
  `extension_type: actionLink` — the modal/iframe surface (`modal_iframe_url`,
  gated per CLAUDE.md on `extension_type`) is out of scope. Both non-interactive
  paths reject a config/input that resolves to anything other than `actionLink`.
- Any change to `app upload`, `app install`, or any other existing command.
- Any change to the interactive wizard's own behavior — it's untouched.

## CLI surface

New options on `app create` (`src/commands/definitions.ts`), in addition to the
existing `--name`, `--distribution`, `--redirect-uri`, `--logo-uri`, `--json`:

- `--ui-config <file>` — path to a JSON file holding one `ui_app`-shaped object:
  `{ extension_type, surface_point_name, label, more_info?, redirect_link }`.
  Same field names and constraints as one entry of `app-config.json`'s
  `surface_point_list`. `extension_type` must be `actionLink` — any other value
  (`iframeExtension`, `legacyComponent`) is rejected with a `CliError` explaining
  that only action links are supported by this path today.
- `--ui-app` — flag selecting UI-app type without a config file, for the per-field
  route. Always builds an `actionLink` entry (there's no `--extension-type` flag —
  action link is the only type this route supports, so it's implicit). Requires
  `--record-page`, `--placement`, `--label`, and `--url` together; `--more-info`
  is optional.
- `--record-page <slug>` — record page (from the registry's page listing).
- `--placement <surface_point_name>` — the slot's dot-notation slug (the same
  identity `app-config.json` authors today — see CLAUDE.md's slot-naming note).
- `--label <text>`, `--more-info <text>`, `--url <destination>`.

`--ui-config` and the `--ui-app`/per-field flags are mutually exclusive
(`CliError` if both are present). `--redirect-uri` and `--logo-uri` are OAuth-only
and are rejected (`CliError`) alongside either UI-app input mode.

The existing comment in `definitions.ts` L88–91 ("no per-field flags — by design")
is removed/rewritten to describe the new surface instead of contradicting it.

## Flow change

In `create.ts`, before `resolveAppType(interactive)` is called: if `--ui-config` or
`--ui-app` is present, the app type is `'ui'` unconditionally — independent of TTY,
`--json`, or piped stdin. This is the single interception point that stops a
UI-app-shaped invocation from ever falling through to the OAuth default.

That branch calls a new **`resolveUiAppNonInteractive(inputs)`** in
`src/app-types/ui/authoring.ts`, sitting next to the existing `resolveUiApp()`
(the interactive entry point). It performs the same steps `resolveUiApp()` does,
minus the prompts:

1. **Registry validation, not skipped.** Calls the same
   `fetchRecordPageLocations()` (authoring.ts L167) and
   `fetchSurfacePointsForPages()` (authoring.ts L212) reads the interactive wizard
   uses, to confirm the given record page and `surface_point_name` are real. This
   is deliberate — CLAUDE.md is explicit that the registry is the *only* authority
   on valid slot names and that a locally cached list must never be reintroduced,
   and that an unregistered name is otherwise dropped silently by the platform (a
   200, an empty slot, no error). Skipping this check for the non-interactive path
   would reintroduce exactly that footgun.
2. **Entry construction.** Builds the `surface_point_list` entry with
   `buildSurfacePointList(rows, fields)` (authoring.ts L469) — today module-private,
   to be **exported** so both the interactive and non-interactive paths build the
   entry identically rather than maintaining two implementations.
3. **Field validation.** Runs the built object through the same `validateUiApp()`
   (`src/lib/validators.ts:350`) the interactive path already calls before create —
   same per-field checks (`validateUiAppLabel`, `validateUiAppMoreInfo`,
   `validateUiAppUrl`, `validateSurfacePoint`, `validateUiAppContext`, the
   camelCase-only `extension_type` check, the root-CTA-field rejection). No new
   validation logic; existing logic is invoked from a second call site. Ahead of
   this shared validation, both non-interactive paths add one extra check of their
   own: `extension_type !== 'actionLink'` → `CliError` (see Non-goals — this
   iteration doesn't support `iframeExtension`/`legacyComponent`).
4. Any failure at either step raises the same `CliError` shape the interactive
   and upload paths already produce.

`buildCreatePayload` (`create.ts` L375–399) is unchanged — it already sends
`ui_app` vs `auth` based on which is present on the resolved input.

## Discovery via errors

Since step 1 above always fetches the live registry rows to check the given
`--record-page`/`--placement` before create is ever called, an invalid value's
`CliError` includes the valid options pulled from that same response:

- Unknown `--record-page` → error lists the record pages `fetchRecordPageLocations()`
  returned.
- Unknown `--placement` for a valid `--record-page` → error lists the
  `surface_point_name` values `fetchSurfacePointsForPages()` returned for that page.

This gives a script or agent a working discovery loop (attempt, read the valid
options back out of the rejection, retry) without adding a dedicated listing
command. No caching of these lists between processes — each invocation reads live.

## Error handling summary

| Condition | Behavior |
|---|---|
| `--ui-config` and `--ui-app` both given | `CliError`, exit 1, before any network call |
| `--ui-app` missing a required companion flag | `CliError` naming the missing flag(s) |
| UI-app input mode combined with `--redirect-uri`/`--logo-uri` | `CliError` |
| `--ui-config` file missing / not valid JSON | `CliError` with the parse error, no stack trace |
| `--ui-config`'s `extension_type` is not `actionLink` | `CliError`, "only action links are supported" |
| Unregistered `--record-page` / `--placement` | `CliError` listing valid options (see above) |
| `validateUiApp` failure (label length, URL scheme, root-level CTA fields, etc.) | Same `CliError` messages the interactive/upload paths already produce |

## Output

Unchanged from today's interactive UI-app create: `renderCreatedUiApp()`
(authoring.ts) renders the same box, including the existing hint that further
placements are hand-authored in `app-config.json` and pushed with
`brevo app upload`. `--json` output carries the same `ui_app` shape as the
interactive create response.

## Docs sync

Per `CLAUDE.md`'s "Keep agent docs in sync with CLI behavior" rule, in the same PR:

- `agent-context/SKILL.md` (currently line 56) and `agent-context/AGENTS.md`
  (currently line 80) both state "a UI app can only be authored from an
  interactive terminal, and every non-interactive run creates an OAuth app." Both
  are rewritten to describe `--ui-config` and the `--ui-app` flag set instead of
  the old restriction.
- Both docs' "OAuth vs UI app discriminator" / non-interactive-behavior
  cross-references are checked for the same stale claim and updated together, per
  CLAUDE.md's instruction to keep the two docs aligned with each other.
- This is new command surface, not a GA-flip of a previously gated feature, so no
  `RELEASE-CHECKLIST.md` section applies. A step exercising `--ui-config`
  end-to-end is added to the UI-app smoke suite (`scripts/smoke/`), since the
  suite already covers UI-app creation for the interactive path.
- A changeset is required (user-visible new flags) — `yarn changeset`.

## Testing

- Extend `src/__tests__/commands/app/create.test.ts`: valid `--ui-config` file,
  valid `--ui-app` flag set, mutual-exclusivity rejection, missing-required-flag
  rejection, OAuth-only-flag-with-UI-app rejection, malformed config file.
- Add `src/__tests__/app-types/ui/authoring.test.ts` — none of `resolveUiApp`,
  `buildSurfacePointList`, or the new `resolveUiAppNonInteractive` currently have
  dedicated unit tests (confirmed absent from `src/__tests__` under that name or
  filter); the new function should not extend that existing gap. Cover: registry
  row → entry mapping, unregistered-slot error message contents (the discovery
  behavior above), and delegation to `validateUiApp`.

## Open questions

None outstanding — the two points raised during review (input mechanism, and
discovery of valid placement values) are both resolved above (both `--ui-config`
and flags; discovery via self-describing rejection errors, no new command).
