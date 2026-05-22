---
'@getbrevo/cli': patch
---

Remove the dormant `minCliVersion` mechanism:

- `brevo app scaffold` no longer writes `minCliVersion` into `app-config.json` (the constant has been `0.0.0` since introduction, so the runtime check never fired).
- Drop the on-startup project-floor warning. The npm-registry update-notifier already covers the "you should upgrade" nudge.
- Existing `app-config.json` files keep their `minCliVersion` field harmlessly — it is now ignored.
- `cliVersion` (informational provenance) is unchanged.
