# BEX-290 — `app deploy` / `app remove` target-account resolution

Design notes for letting the CLI resolve the deployment target account itself instead of
requiring the partner to know and type a numeric account ID.

**Status: design only — nothing implemented.** One design decision is unresolved (the
non-corporate identifier) and the whole feature is blocked on a backend endpoint that does
not exist yet. Both are recorded below rather than guessed at.

## Context

`brevo app deploy <account-id>` and `brevo app remove <account-id>` take the target account
as a required positional. That assumes the partner knows the numeric ID of the account they
are deploying into, which is not something the CLI ever shows them — `whoami` prints an
organization ID and a user ID, neither of which is it.

The proposal: make the positional optional and resolve it from the authenticated identity.
A standalone account has exactly one answer. A master (corporate) account has many, so the
CLI lists its sub-accounts and asks.

Both commands already share one resolution function — `resolveDeploymentTarget()` in
`src/commands/app/account-deployment.ts` — so this lands in one place and `remove` inherits
it for free.

## Resolution order

The account branch mirrors the app branch that already exists in the same function
(`--app-id` → linked `app-config.json` → picker):

1. **Explicit `[account-id]` positional** — used as-is, no API call, no prompt. Keeps CI
   working unchanged and stays the escape hatch for an account the listing won't show
   (notably a deactivated sub-account).
2. **Otherwise, branch on the authenticated account's `type`:**
   - **not `corporate`** — use the account's own identifier. No prompt.
   - **`corporate`** — page the sub-account list and show a picker.

**Non-obvious, and the main reason to prefer this order:** on a standalone account
`brevo app deploy` with no arguments resolves deterministically, so it stays usable
non-interactively — piped stdin, `--json`, CI. Only *corporate without a positional* needs a
TTY, and that case reuses the existing `APP_DEPLOY_NON_INTERACTIVE` error rather than adding
a new failure mode.

`<account-id>` becoming `[account-id]` is user-visible: it needs `agent-context/SKILL.md`,
`agent-context/AGENTS.md`, and a changeset in the same PR.

## Corporate branch — settled

**Endpoint:** `GET /v3/corporate/subAccount?offset=&limit=` →
`{ count, subAccounts: [{ id, active, companyName, createdAt, groups[] }] }`
([public reference](https://developers.brevo.com/reference/get-the-list-of-all-the-sub-accounts-of-the-master-account)).
`id` is the numeric sub-account ID, so a selection needs no follow-up lookup. `createdAt`
and `groups` are ignored.

**Pagination.** `offset` and `limit` are both required — there is no "return everything"
call. `count` is the paging terminator: fetch until `count` items have been retrieved, then
filter. No documented `limit` cap on the reference page, so page in conservative fixed
chunks rather than guessing a maximum.

**`active` filter.** Only `active === true` sub-accounts are offered. Deploying into a
deactivated account is almost certainly a mistake, and the explicit positional remains
available for the rare case where it isn't. `count` therefore is *not* the number of
choices shown — a master account can page through `count` entries and end up with an empty
picker, which gets the `promptAppSelection` treatment: a `CliError` telling the user to pass
the account explicitly, never an empty prompt.

**Picker copy.** `Company1  (Account ID: 4043629)`, matching the existing
`promptAppSelection` label style. **Non-obvious:** the label deliberately says *Account ID*,
not *User ID* — `/v3/account/info` already returns a `user_id` that `whoami` prints as
`User ID:`, and reusing that wording for a sub-account `id` would put two unrelated numbers
under one name.

**Auth.** The endpoint accepts both an `api-key` header and an OAuth bearer token, like the
rest of the v3 surface. This matters because `buildAuthHeader()` in `src/container.ts` sends
whichever the user logged in with, and browser login is the default path — an api-key-only
endpoint would have failed for most users while working in CI. No extra branch needed.

## Caching the account `type`

**Decision: cache it in `~/.brevo/credentials.json`** alongside the existing
`accountEmail` / `organizationId` / `userId` triple.

The argument that settled it: `organization_id` is *already* cached, so if that turns out to
be the non-corporate identifier, caching `type` too makes that entire branch resolve with
**zero network calls**. Fetching `type` fresh on every deploy would reintroduce a request the
common path doesn't otherwise need.

**This is contingent on the open decision below.** If the identifier turns out to be a
numeric account ID that isn't in the credentials file today, it has to be cached alongside
`type` — same four sites — or the branch loses the offline property that justified caching in
the first place.

The cost is that four sites in `src/lib/config.ts` must treat the new field exactly like the
existing triple:

- `saveCredentials()` and `saveOauthCredentials()` — write it, so re-login overwrites a
  previous account's value
- `saveOauthCredentials()`'s account-less `else` branch — delete it, the path that
  deliberately drops stale account info before validation
- `clearCredentials()` — delete it

`logout` needs nothing: it calls `deleteCredentialsFile()`, which unlinks the whole file.

**Residual risk:** an account that converts to corporate mid-session leaves a stale cached
`type`. Refreshing the value on every `whoami` shrinks the window cheaply. It stays *out* of
`whoami`'s credential-mismatch check — that check exists to catch identity drift, and a
`type` change is legitimate, not a mismatch.

## Open decision — the non-corporate identifier

The two branches currently produce different kinds of identifier for the same body field:

| Branch | Source | Shape |
| --- | --- | --- |
| corporate | `subAccounts[].id` | integer, int64 — `4043629` |
| non-corporate | `organization_id` | UUID string |

Two problems. `parseAccountId()` enforces `^\d+$` (`src/lib/validators.ts`) and rejects the
UUID outright, so the non-corporate branch cannot construct its own target today. And more
fundamentally these look like different namespaces: an organization is the container, a
sub-account is a tenant inside one. If sub-accounts share their master's `organization_id`,
the UUID cannot distinguish one sub-account from another and is not a viable target
identifier at all.

Since the deploy endpoint is still unspecified, this is a choice rather than a constraint:

- **A — key on a numeric account ID everywhere.** *Recommended.* One namespace, matches the
  `account_id` field name the CLI already assumes, and the corporate branch is already
  correct. Requires a numeric account ID to exist for a standalone account.
- **B — key on an organization UUID everywhere.** Requires each sub-account's organization
  UUID, which the sub-account listing does not return — an extra lookup per sub-account, or
  a different listing endpoint. Dead on arrival if sub-accounts share their master's UUID.
- **C — accept both, as two distinct body keys** (`account_id` *or* `organization_id`, never
  one overloaded field). Most flexible, most backend work; the reasonable fallback if
  standalone accounts genuinely have no numeric ID.

**What resolves it:** whether `/v3/account/info` returns a numeric account ID distinct from
both `organization_id` and `user_id`. If yes → A, and this section closes. If no → the
choice is B or C, and it depends on whether sub-accounts share their master's
`organization_id`.

Whichever wins, `parseAccountId` needs revisiting: either it keeps its numeric contract (A)
or it has to accept both shapes, at which point its error message and its name are both
wrong.

## Blocked on: the deploy endpoint does not exist

`appService.deployApp()` / `removeApp()` describe endpoints that have not been built. The
`⚠️ ASSUMED CONTRACT` comments in `src/services/app.ts` stay exactly where they are, and the
`422` → "not uploaded" mapping in `deploy.ts` is a guess at a status code nobody has
committed to.

The upside is that the contract is ours to define. What it needs to pin down:

- path and method, for `deploy` and its `remove` mirror
- the body field name and type — string or integer, and which identifier (see above)
- who owns the "must be uploaded first" rule, and its status code. The CLI currently
  enforces it locally on a missing `version` *and* mirrors an assumed server `422` to the
  same message; if the server owns it, the local pre-flight is an optimisation, not the rule.
- idempotency: deploying twice — `200` or `409`
- authorization: whether a master account's credential may deploy into its own sub-account,
  or that is a `403`
- whether the response carries anything worth persisting or printing (an installation or
  integration ID)

Until that lands, none of this ships regardless of the CLI side.

## What this does not change

The upload gate (`assertUploadedBeforeDeploy`) and the confirmation prompt are untouched —
resolution happens before both. The confirmation copy improves for free: a picker-resolved
account has a `companyName` to show instead of a bare ID.

## Follow-ups

In `TODO.md` under *BEX-290 follow-ups*. The load-bearing ones are the non-corporate
identifier and the backend contract; everything else here is settled.
