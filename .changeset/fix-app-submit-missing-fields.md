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

Note that Brevo currently refuses public app creation from the CLI at the platform level: `brevo app create --distribution public` sends the request and the API answers `400`, which the CLI reports as _"Public apps can't be created from the CLI yet"_ with the server's own message quoted. The CLI-side commands are all in place and will work as soon as the platform allows it.

`distribution_type` remains immutable after `brevo app create` — pick `private` for apps used exclusively by your own organisation and `public` for apps distributed to end users or marketplace listings. Only a public app can be submitted for review.

fix(app submit): refuse an app that was never uploaded before reading its review state, naming the real cause. A never-uploaded app has no version for a review state to hang off, and the server's message for that failure listed `name`, `logo_uri`, `scopes` and `redirect_uris` as the fields to fix — all of which could already be correct.

fix(app submit): skip the redundant app fetch when the app isn't submittable, and show missing required-field names exactly as returned by the API (BEX-454)

fix(app status): show the status message returned by the API, falling back to the built-in per-state copy when absent (BEX-454)

feat(public apps): creating a public app now requires agreeing to the Brevo Developer Terms (https://developers.brevo.com/docs/apps-developer-terms). Interactively, `brevo app create` shows the terms notice, opens the terms in the browser automatically (the URL is printed too, with a quiet fallback when no browser can open), and asks _"Do you confirm that you have read and agree to the Brevo Developer Terms?"_ (y/N, default No) as soon as `public` is chosen — declining cancels the create with exit `0` and nothing is sent. Non-interactive runs (`--json` or piped) pass the new `--accept-developer-terms` flag as explicit consent; without it a `--distribution public` create is refused before any prompt or network call. The flag also skips the question in interactive runs. Private, M2M, UI and Function apps are unaffected.

docs: `agent-context/SKILL.md` and `agent-context/AGENTS.md` document the publication and review flow — the route from a public create to an approved app, the refusals `submit` applies in order, the review states, and the fact that a successful `submit` has not yet submitted anything.

feat(app submit): submitting an app for review now requires confirming the Submission Process statement (you have read and agree to the Brevo Developer Terms, the submission is accurate and complete, the app complies with the terms and applicable laws, and activation is not a review, certification, or endorsement). Interactively, `brevo app submit` prints the statement after the app summary and asks _"Do you confirm the above statement?"_ (y/N, default No) — one answer serving as both the legal affirmation and the submit confirmation; declining cancels with exit `0`. Non-interactive runs (`--json` or piped) pass the new `--accept-submission-terms` flag as explicit consent; without it the run is refused before the form URL is printed or opened. The flag also skips the question in interactive runs. The gate fires only once the form URL is known to exist, so an ineligible app still gets its specific refusal first.

fix(app submit): the public-only check now fires first, before the never-uploaded guard and the review-state read. A private app is told it cannot be submitted — previously it was told to run `brevo app upload` or fix "missing fields", remedies that can never make a private app submittable.

fix(app submit): `submittable: false` with no `missing_fields` from the state API now gets generic not-ready copy instead of a malformed message that named nothing to fix.

fix: a failed browser open is now actually reported. Opening a browser can only fail asynchronously (a missing `xdg-open` on a headless box never throws), so the fallback lines in `app create`'s Developer-Terms consent, `app submit`'s form open and `app available-scopes --web` were unreachable; they now print via the spawn's error event. The URL is always printed regardless, as before.
