# TESTING — feat/app-submit-command

Per-branch verification checklist. Delete before merging to `main`.

## `brevo app submit` status preflight

**Change:** `brevo app submit` now runs a status preflight — it reads the app's
review state (the same `appService.fetchAppState` path as `brevo app status`)
before any submit work. Only a failed fetch blocks; the state value is not a gate.

**Must hold true:**

- [x] On a successful status read, submit proceeds exactly as before (public
      check → drift check → confirm → open form). Covered by all existing
      `submit.test.ts` cases + `runs the status check before opening the
      submission form`.
- [x] When the status read throws (network/auth/not-found), submit aborts
      before calling `fetchApp` or opening the browser. Covered by `aborts
      before submitting when the status check fails`.
- [x] Preflight runs in both interactive and `--json` mode (spinner silenced
      in `--json`), and a thrown error is formatted by `withCommandHandler`.
- [ ] Manual: point the CLI at an unreachable API and confirm `brevo app
      submit` exits non-zero with the status-fetch error, not a submit error.

## PKCE for public-app scaffolds (BEX-345)

**Change:** the scaffolded OAuth flow branches on `distribution_type` via a new
`applyConditionals()` step in the template loader (`{{#if public}}` /
`{{#if private}}` whole-line markers). Public apps emit an Authorization Code +
PKCE (RFC 7636) flow with no client secret; private apps are unchanged.

**Must hold true:**

- [x] `applyConditionals` keeps the matching branch, strips the other + markers,
      handles nesting, throws on unbalanced markers, and is an identity transform
      for marker-free templates. Covered by `conditionals.test.ts`.
- [x] Private renders of `token-store.js` and `.env.local` are byte-for-byte
      identical to the pre-change templates (verified by diff against `HEAD`);
      private `handler.js`/`server.js` change only via the shared
      `buildAuthorizeUrl` extraction, covered by `handler.test.ts`.
- [x] Public `handler.js`: generates `code_verifier` with
      `crypto.randomBytes(32).toString('base64url')`, derives the challenge with
      `sha256`→`base64url`, sends `code_challenge_method=S256` (never `plain`),
      sends `code_verifier` on the token exchange, and contains **no**
      `client_secret` / `CLIENT_SECRET` and no `Math.random`. Covered by
      `handler.test.ts`.
- [x] The S256 derivation matches the RFC 7636 Appendix B known-answer vector.
- [x] Both branches of `handler.js`, `server.js`, `token-store.js` are
      syntactically valid JS (`node --check` on rendered output).
- [x] `server.js` displays the authorize URL via the shared `buildAuthorizeUrl`
      (no duplicated concatenation); public shows the `code_challenge` param.
- [ ] Manual (blocked on OAuth-service PKCE support): `brevo app create
      --distribution public` + `brevo app scaffold`, then `brevo app start oauth`
      completes end-to-end against the OAuth service using PKCE, and no
      `code_verifier` is logged or rendered to the browser.
