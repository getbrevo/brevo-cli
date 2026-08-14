---
'@getbrevo/cli': minor
---

`ui_app.surface_point_list` entries accept an optional `size` at the same level as `context` — the card-size override for the widget card that placement renders (BEX-416). Each axis is a CSS length string: `"<positive integer>px"` (absolute) or `"<1-100>%"` (relative to the host slot's box), e.g. `{ "width": "280px" }` or `{ "height": "50%" }`. Author either axis or both — an omitted axis stays on the host record page's per-slot default. Validated shape-only in `validateUiApp`; the platform remains the authority on anything registry-dependent. Partner-authored, so it round-trips through the upload diff and write-back like `label`.
