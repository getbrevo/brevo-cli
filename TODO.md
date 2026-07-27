# TODO — features_set_public_cli

Per-branch work tracker. Delete before merging to `main`.

## Open

- **[BEX-345] BLOCKING dependency — OAuth service must enforce PKCE for public
  clients.** The scaffolded public-app flow ships nothing usable until the Brevo
  OAuth service accepts `code_challenge` / `code_challenge_method=S256` on
  `/realms/{realm}/oauth/authorize`, requires `code_verifier` on
  `/realms/{realm}/oauth/token` when a challenge was sent (S256-only), and
  accepts a **secret-less** token exchange for public clients. Needs a companion
  ticket on the OAuth service; this CLI change must be sequenced behind it. Do
  not advertise the public-app PKCE flow to external developers until this lands.
- **[BEX-345] Internal-only pre-release for end-to-end validation.** Before the
  PKCE public-app flow reaches the public `@getbrevo/cli` release, publish a
  privately-scoped internal build so it can be validated end-to-end internally.
  This is net-new release infra — the repo publishes only to the public npm
  registry today (+ `release-*` alpha prereleases). Scope the private
  registry/scope + auth as its own sub-task if non-trivial; do **not** gate the
  public release on it until internal validation passes.
- **[BEX-345] Decision to record on the ticket:** public = public OAuth client
  (PKCE, no `client_secret`); private unchanged; PKCE **required** for public.
  Post the decision-record comment once agreed.
