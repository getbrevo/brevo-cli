---
'@getbrevo/cli': minor
---

feat(public apps): public app distribution and the review lifecycle are now GA (BEX-405)

`brevo app create --distribution public` is accepted, `Public` is selectable in the interactive distribution prompt, and `brevo app submit`, `brevo app status` and `brevo app withdraw` ship in the published package. They were built but eliminated from published builds at compile time; that gate is gone and the build now asserts the three commands are present in every artifact.

- **`brevo app status`** — an app's review lifecycle state (`draft`, `submitted`, `in_review`, `approved`, `rejected`, `changes_requested`, or `unknown`) with a human message. Read-only; `--json` gives `{ state, message }`.
- **`brevo app submit`** — opens the public-app review submission form. Requires `distribution_type: public`, an uploaded app, and a local `app-config.json` that matches the server (shown as a field-by-field diff with `(local only)` / `(server only)` tags on drift). `--json` prints `{"app_id","form_url"}` on stdout with the next-steps notes on stderr. The app is submitted only once the form itself is completed — the command changes nothing server-side.
- **`brevo app withdraw`** — withdraws an app from submission (`--force`, `--json`). An app that was never submitted prints a hint and exits `0`.

All three resolve the target app from `--app-id`, the linked `app-config.json`, or an interactive picker.

The scaffolded OAuth flow now branches on distribution: a **public** app gets Authorization Code + PKCE (RFC 7636) — `/auth/login` generates a `code_verifier` and sends `code_challenge` + `code_challenge_method=S256`, and the token exchange and refresh send the verifier with no `client_secret`, so the generated `.env.local` / `.env.example` carry none. **Private** apps keep the confidential-client flow unchanged.

Note that Brevo currently refuses public app creation from the CLI at the platform level: `brevo app create --distribution public` sends the request and the API answers `400`, which the CLI reports as *"Public apps can't be created from the CLI yet"* with the server's own message quoted. The CLI-side commands are all in place and will work as soon as the platform allows it.

`distribution_type` remains immutable after `brevo app create` — pick `private` for apps used exclusively by your own organisation and `public` for apps distributed to end users or marketplace listings. Only a public app can be submitted for review.

fix(app submit): refuse an app that was never uploaded before reading its review state, naming the real cause. A never-uploaded app has no version for a review state to hang off, and the server's message for that failure listed `name`, `logo_uri`, `scopes` and `redirect_uris` as the fields to fix — all of which could already be correct.

fix(app submit): skip the redundant app fetch when the app isn't submittable, and show missing required-field names exactly as returned by the API (BEX-454)

fix(app status): show the status message returned by the API, falling back to the built-in per-state copy when absent (BEX-454)

docs: `agent-context/SKILL.md` and `agent-context/AGENTS.md` document the publication and review flow — the route from a public create to an approved app, the five refusals `submit` applies in order, the review states, and the fact that a successful `submit` has not yet submitted anything.
