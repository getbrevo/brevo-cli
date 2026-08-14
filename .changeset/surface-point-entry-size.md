---
'@getbrevo/cli': minor
---

`ui_app.surface_point_list` entries accept an optional `size: { width, height }` (px, both axes required, positive integers) at the same level as `context` — the card-size override for the widget card that placement renders (BEX-416). Absent, the host record page's per-slot default size applies. Validated shape-only in `validateUiApp`; the platform remains the authority on anything registry-dependent. Partner-authored, so it round-trips through the upload diff and write-back like `label`.
