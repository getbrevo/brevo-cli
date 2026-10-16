---
'@getbrevo/cli': minor
---

`brevo skill:cli install` can now install the brevo-cli agent skill for Codex and Gemini CLI, not only Claude Code. Pass `--agent codex`, `--agent gemini`, a comma-separated list, or `--agent all`. Claude Code keeps reading `~/.claude/skills/brevo-cli/`; Codex and Gemini CLI both read `~/.agents/skills/brevo-cli/`, so one copy there serves the two. Without `--agent` the command installs for Claude Code exactly as before.

`brevo skill:cli uninstall` now removes every copy the CLI installed, for any agent, or only the agents given with `--agent`. Auto-refresh keeps every installed copy current. `BREVO_AGENTS_HOME` overrides the `~/.agents/` home, the same way `BREVO_CLAUDE_HOME` does for Claude Code. Under `--json`, each install and uninstall result gains an `agents` field naming the agents that read its `path`.

The skill text and `AGENTS.md` no longer tell other agents not to install the skill: it follows the open Agent Skills format, which these agents load.
