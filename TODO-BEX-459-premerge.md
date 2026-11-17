# PR #121 (BEX-459 / BEX-498) — to do before merge

> Working doc. NOT to be committed or merged — delete it before the PR lands (see CLAUDE.md,
> "Branch-local working docs"). Items still open after the review of head 458ca24.

## 1. Skills file (agent-context + scaffold templates)
- [x] Iframe/sandbox reference text deleted from `agent-context/SKILL.md`, `agent-context/AGENTS.md`
      and the three `src/templates/files/*.tmpl` (published builds cannot reach it).
- [ ] When the iframe type is un-gated (`FEATURE_STAGE['ui-iframe-type']` -> `'ga'`), restore it in
      the same PR: `iframe_href` rows, the `sandbox` bullet, the framing/CSP checklist,
      `iframeExtension` in the `extension_type` lists. Source: commit `458ca24`
      (`git show 458ca24:agent-context/SKILL.md`). Use `iframe_href`, never `modal_iframe_url`.
- [x] `app credentials` wording in both agent docs no longer mentions iframe.

## 2. Sandbox behaviour (decided; implemented locally, not yet pushed)
- [x] `app create`: every box unticked writes `sandbox: ""`; selection == platform default writes no key.
- [x] Write-back (`app upload`) and pull (`app scaffold`): `actionLink` never gets `sandbox`; an
      `iframeExtension` entry gets local value, else server value, else `""` (`resolveWrittenSandbox`).
- [x] Scaffold-pull test for that rule added (commit pending push).
- [x] Checked in the platform code (app-store-bo-be / app-store-backend, code search): an authored `""` is
      accepted on an iframe entry, stored as `""` (never replaced by the slot default) and echoed back;
      app-store-backend serves a stored `""` verbatim. **Not verifiable from code: whether those changes are
      deployed to the target environment** — confirm before un-gating (backend first, then bo-be).
- [x] Checked: the platform stamps a default `sandbox` on iframe entries ONLY (`stampUIAppSandbox` skips
      every other type; "actionLink is not stamped" is a test). bo-be refuses an authored `sandbox` on an
      action-link entry with a 400, `""` included. So the action-link strip in `resolveWrittenSandbox` is
      defensive: it only matters for legacy rows that store a `sandbox` on an action link.
- [x] (done, commit pending push) Fix comments/docs that say the platform stamps `sandbox` "on every entry" — it is iframe entries only:
      `src/app-types/wire.ts`, `src/app-types/ui/compare.ts`, `src/app-types/ui/index.ts`,
      `src/commands/app/upload.ts` (comment above the diff helpers), and CLAUDE.md.
- [x] DECIDED (owner): keep the `""` fallback in `resolveWrittenSandbox` as implemented, i.e. when neither the
      file nor the server echo has a sandbox for an iframe entry, write `sandbox: ""`. Accepted trade-off:
      against an older bo-be that predates per-entry `sandbox`, the echo carries none, so the file gets
      `sandbox: ""` and the next upload sends a key that bo-be rejects as unknown. (The alternative was to
      apply the fallback only when the echo shows the platform supports it.)
- [x] `allow-same-origin` stays pre-ticked on purpose (owner decision) — keep it called out in the PR description.

## 3. Review findings still open
- [x] (done, commit pending push) `src/lang/en.ts`: iframe strings (`APP_CREATE_UI_LAYOUT_*`, `MODAL_SIZE_*`, `CARD_HEIGHT_PROMPT`,
      `IFRAME_HREF_PROMPT`, `APP_CREATE_UI_IFRAME_DISABLED`, `APP_UPLOAD_UI_LAYOUT_REJECTED`) -> move to
      `src/lang/preview-messages.ts` and widen `LEAK_STRINGS` in `scripts/build.mjs`.
- [x] `src/commands/app/credentials.ts`: relaxed gate KEPT for every app type (owner decision, option A); comment now justifies it without the unshipped iframe trust layer.
- [x] `src/commands/app/upload.ts`: `isUiLayoutRefusal` now needs `surface_point_list` + `layout "inline"` (commit pending push).
- [x] `scripts/smoke/ui-app.ts`: fixed from the code, NOT yet run live. (a) the assertion now expects
      `layout: "modal"` / `modal_size: "large"` when present (they are written, defaults included);
      (b) an optional exchange answers the sandbox checkbox with Enter and the entry may then carry a
      `sandbox` that includes `allow-same-origin`. **Still to do: run `yarn smoke --suite=ui` against an
      environment whose registry has an iframe slot** (with and without `metadata.sandbox` on the row) to
      prove both — nothing here has exercised the pty leg.
- [x] `src/lib/validators.ts`: docstring now cites `validateUiAppSizeAxis` (commit pending push).

## 4. Release hygiene
- [x] Commit + push the local changes on `feat/bex-459-iframe-extension-authoring` (pushed, head b1c2fd2).
- [x] `yarn lint`, `yarn test:ci`, `yarn build` green after the above (last run: 2125 tests, green; public and preview builds both pass).
- [ ] **Re-create the changeset before merge** (it was removed from the branch on request; this PR changes
      user-visible behaviour, so CLAUDE.md requires exactly one `.changeset/*.md`, bump `minor`). Write it
      so it describes only what a PUBLISHED build gains (the gated iframe surface stays out of it).
      - Start from the removed file: `git show 458ca24:.changeset/ui-app-authoring-and-install.md`
        (covers: `app install` upload-first offer, `app create --ui-config` refusals, `app upload`
        refusing a hand-added `sandbox`, `app credentials` for UI apps with a client ID, malformed
        registry default card size no longer seeded).
      - Add the changes made after that commit that ARE live in every build:
        * `app upload` / `app scaffold` never write a `sandbox` into an action-link entry of
          `app-config.json` (the platform only stamps iframe entries, so this matters for legacy rows that
          store one on an action link; the next upload would have been refused).
      - Leave out (preview-only, not reachable in a published build): `sandbox: ""` for an empty
        selection in `app create`; the iframe write-back rule (local value, else server value, else `""`);
        the layout / iframe-disabled refusal translations (now behind `__BREVO_PREVIEW__`, and the layout
        one now needs `surface_point_list` + `layout "inline"`); the iframe copy moving to
        `preview-messages.ts`; the agent-doc and template text removal.
      - Keep it a single file; do not add a second one.
- [x] Platform changes DEPLOYED IN PRODUCTION (checked 2026-11-17 via ArgoCD + GitHub; both repos are in the
      DTSL org). Production runs app-store-backend 1.12.0 (rke2-frontend synced at 9e893940, rke2-internal at
      8d4bcfda) and app-store-bo-be 1.29.0 (rke2-frontend 2dbb8325, rke2-internal 40669bfa). Each synced
      revision contains the merge commit of the PR that matters, so it is deployed:
        * app-store-backend #820 (serve an authored-empty iframe sandbox verbatim, BEX-640), merge 02a9b2e4.
        * app-store-bo-be #489 (private iframe apps may author sandbox, BEX-641), merge 2de049fc.
      The required order (backend before bo-be) held: backend deployed 2026-11-12/13, bo-be 2026-11-13.
- [ ] Still NOT checked (cannot be read from deploys): (a) staging, if the smoke/QA run targets staging;
      (b) registry DATA in the target environment — an iframe slot enabled for `iframeExtension`, and
      `metadata.sandbox` on the rows the CLI prompt reads; (c) the per-account Unleash flag
      `app-store-bo-be-iframe-extension` for the account used. These are what the smoke run below proves.
- [ ] Run `yarn smoke --suite=ui` against an environment whose registry has an iframe slot (with and without
      `metadata.sandbox` on the row): the iframe leg was fixed from the code and never run live.
- [ ] Platform registry flip for iframe slots lands before un-gating.
- [ ] Delete this file.
