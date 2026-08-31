---
'@getbrevo/cli': patch
---

fix(app submit): skip the redundant app fetch when the app isn't submittable, and show missing required-field names exactly as returned by the API (BEX-454)

fix(app status): show the status message returned by the API, falling back to the built-in per-state copy when absent (BEX-454)
