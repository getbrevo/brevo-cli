# TODO — running work tracker

A running list of work to do. Append new items at the bottom of "Open"; move finished
items to "Done" with the date.

**Status key:** `[ ]` open · `[~]` in progress · `[x]` done · `[!]` blocked

---

## Open

- [ ] **Migrate old users' config distribution type on `brevo app update`.**
  Existing users have `app-config.json` files carrying the distribution type in the
  legacy top-level `distribution` key (or none at all). `readProjectConfig()` already
  backfills `auth.type` at read time, but the on-disk file is never rewritten. On
  `brevo app update`, migrate the config: write the distribution type into `auth.type`
  and drop the legacy top-level `distribution` key so old projects converge to the new
  format. — (relates to `enable-public-app`; see `TESTING.md`)

---

## Done

_(nothing yet)_
