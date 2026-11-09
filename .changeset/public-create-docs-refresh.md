---
'@getbrevo/cli': patch
---

You can now create public apps from the CLI with `brevo app create --distribution public`. The agent skill (`SKILL.md`), `AGENTS.md` and the README used to say Brevo rejects these requests with a `400` and that agents should fall back to a private app. That restriction has been lifted on the Brevo side, so those notes are removed and agents will no longer refuse to create public apps for you.

If Brevo ever refuses a public create again, the CLI still shows the server's message under `Brevo said:`. There are no changes to CLI behaviour.
