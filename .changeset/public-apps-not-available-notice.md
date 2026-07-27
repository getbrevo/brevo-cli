---
"@getbrevo/cli": patch
---

Document that public app distribution is not available yet. The bundled agent docs
(`agent-context/SKILL.md`, `agent-context/AGENTS.md`) and the README now carry a notice
telling AI agents to always create apps with `--distribution private` and not to drive
the review lifecycle (`app submit` / `app status` / `app withdraw`), which applies to
public apps only. The notice carves out an exception for internal Brevo accounts —
agents check `brevo whoami --json` and skip the restriction when the account email ends
in `@brevo.com` or `@sendinblue.com` — so it doesn't obstruct development or QA.
Documentation only — no command, flag, or exit-code behaviour changed.
