# TODO — running work tracker

A running list of work to do. Append new items at the bottom of "Open"; move finished
items to "Done" with the date.

**Status key:** `[ ]` open · `[~]` in progress · `[x]` done · `[!]` blocked

---

## Open

_(nothing open)_

---

## Done

- [x] **Migrate old users' config distribution type on write-back.** (2026-07-23)
  Existing users have `app-config.json` files carrying the distribution type in the
  legacy top-level `distribution` key (or none at all). `readProjectConfig()` already
  backfilled `auth.type` at read time, but the on-disk file was never rewritten. Fixed
  centrally in `readProjectConfig()`: the legacy top-level `distribution` key is no
  longer forwarded into the returned config object, so any caller that writes it back
  (`update.ts`, `start.ts`) now naturally drops it and re-affirms `auth.type` on the
  next write — no per-call-site changes needed. Also narrowed `auth.type` from `string`
  to `'private' | 'public'`. — (relates to `enable-public-app`; see `TESTING.md`)
  **Superseded by the entry below** — `auth.type` itself was relocated the same day.

- [x] **Move `distribution_type` out of `auth` to a top-level field.** (2026-07-23)
  Per the resolved discussion on the [Product solutioning doc](https://app.notion.com/p/374449002dcb80cbb029e0f73a044e52#376449002dcb80ce81b7ddb295ec1614)
  ("distribution_type would be moved out and reflect auth as well"), `ProjectConfig`
  now carries `distribution_type: 'private' | 'public'` as a top-level field (matching
  the real `brevo app upload` payload shape), and `auth` is back to just
  `{ scopes, redirectUrls }`. `readProjectConfig()` backfills `distribution_type` from
  whichever shape is on disk, in order: new top-level `distribution_type` → interim
  `auth.type` (never actually released) → oldest legacy top-level `distribution`
  (every currently-published scaffold) → defaults to `'private'` if none are present.
  All three legacy shapes are dropped on the next write-back. — (relates to
  `BEX-255_change`; see `TESTING.md`)
