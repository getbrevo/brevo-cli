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
