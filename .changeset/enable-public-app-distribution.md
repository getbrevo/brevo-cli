---
"@getbrevo/cli": minor
---

Enable public app distribution in `brevo app create`.

`brevo app create --distribution public` now creates a public app instead of erroring — the "coming soon" rejection is removed and Public is a selectable option in the interactive distribution prompt. Scaffolded `app-config.json` records the app's distribution type under a top-level `distribution_type` field (via a new `{{DISTRIBUTION}}` template variable), matching the real `brevo app upload` payload shape; `auth` no longer carries distribution info.

The OAuth callback URL hint in `brevo app create` now explicitly labels the localhost default as a local test-server callback and reminds you to add a production callback URL before going live.

Existing projects are migrated automatically regardless of which prior shape their local `app-config.json` has (a legacy top-level `distribution` key from any published version): the next time any command writes the file back (e.g. `brevo app update`), the old key is dropped and `distribution_type` is written in its place.

The scaffolded OAuth flow now branches on the app's `distribution_type`. **Public** apps get an Authorization Code + PKCE (RFC 7636) flow: `/auth/login` generates a `code_verifier`, sends `code_challenge` + `code_challenge_method=S256`, and the token exchange (and refresh) send the `code_verifier` with **no `client_secret`** — the generated `.env.local`/`.env.example` carry no `CLIENT_SECRET`. **Private** apps keep the confidential-client flow (token exchange authenticated with `client_secret`) unchanged. The displayed authorization URL on the local test server's landing page is now built by the same helper `/auth/login` uses, so the two can no longer drift.
