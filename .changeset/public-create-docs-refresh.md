---
'@getbrevo/cli': patch
---

Docs: public app creation (`brevo app create --distribution public`) is now documented as working. The agent skill (`SKILL.md`), `AGENTS.md` and the README previously stated that the Brevo API rejects public creates from the CLI with a `400` and told agents to fall back to a private app. That server-side restriction has been lifted, so those statements are removed.

If the platform refuses a public create in the future, the CLI still reports the server's message under `Brevo said:`. No CLI behaviour changes.
