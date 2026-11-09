---
'@getbrevo/cli': patch
---

Docs: public app creation from the CLI works. The bundled agent skill (`SKILL.md`), `AGENTS.md` and the README no longer tell agents that Brevo answers `400` to `brevo app create --distribution public` and to fall back to a private app. The server-side restriction has been lifted; the CLI keeps reporting any future server-side refusal under `Brevo said:`. No CLI behaviour changes.
