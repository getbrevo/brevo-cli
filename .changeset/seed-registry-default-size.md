---
'@getbrevo/cli': patch
---

`brevo app create` seeds each authored placement's `size` from the slot's registry default (`default_size` on `GET /v3/app-store/surface-points`, BEX-461), the same way `context` is seeded from `default_context_field`: written explicitly into `app-config.json`, where it can be edited or removed — the entry's own value is what uploads. A slot with no declared default writes no `size` key, and a blank or malformed served default degrades to "no seed" rather than authoring a value the CLI's own validation would refuse. There is still no size prompt.
