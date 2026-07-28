# TODO

Running work tracker. Per `CLAUDE.md`, delete this file before merging the branch
into `main` — anything that must outlive the branch belongs in
`RELEASE-CHECKLIST.md` → *Before UI-apps GA* instead.

## Open

### BEX-290 follow-ups

- [ ] **Blocking before this reaches users:** confirm the `ui_app` field names and the
      deploy/remove endpoint contract with the app-store backend team. Both are
      implemented against stated assumptions and marked in code comments — see
      `RELEASE-CHECKLIST.md` → *Before UI-apps GA* → related follow-ups for the full
      list.
- [ ] Modal cards (`ui_app.type: "card"`, `trigger.type: "modal"`). The types
      round-trip today but `validateUiApp` rejects them on upload. Needs: the `modal`
      width/height block in the config, `permittedUrls.iframe` handling (the
      postMessage origin allowlist is what makes the modal secure), and the
      corresponding create prompts. The spec's *Modal card* flow also collects a
      distinct CTA text, which the action-link flow derives from the title.
- [ ] Widgets and cloud functions — spec'd as "not yet supported" upstream too. The
      trigger prompt already shows them as disabled choices.
- [ ] `placement` (`sidebar` / `center`) is typed on `UiAppProperties` but never
      written: it applies to cards and widgets, not action links. Wire it up with the
      card work.
- [ ] No local dev story for a UI app. `brevo app start` has no UI-app equivalent, so
      a partner can't preview an action link without deploying to a real account.
      Worth considering a local harness that renders the action menu and forwards
      context params to the external URL.
- [ ] `permittedUrls` is scaffolded empty and never validated or populated from
      `ui_app.properties.trigger.externalUrl`. Harmless for action links (they open a
      new tab), but it becomes load-bearing for modal cards.
- [ ] Consider whether `brevo app list` should show the app type. Right now an OAuth
      app and a UI app are indistinguishable in the list output.
- [ ] `contextProperties` is validated only as a non-empty string array. If the
      platform ends up with a fixed allowlist (rather than account-defined contact
      attributes), tighten the validator against it.

### Pre-existing, unrelated

- [ ] `dist/` in this working copy is owned by `root` (dated 27 Jul), so `yarn build`
      fails with `EACCES`. `tsc --noEmit`, `yarn test`, and `yarn lint` are unaffected.
      Fix locally with `sudo rm -rf dist` — not a repo issue, and deliberately left
      alone here rather than running `sudo` unprompted.
- [ ] `README.md`'s command table still omits `brevo app status` / `submit` /
      `withdraw` / `available-scopes` (the stale `app update` row was fixed in this
      branch).
