---
'@getbrevo/cli': patch
---

fix(app submit): skip the redundant app fetch when the app isn't submittable, and show missing required-field names exactly as returned by the API (BEX-454)
