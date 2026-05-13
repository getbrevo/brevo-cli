---
'@getbrevo/cli': minor
---

Add `brevo skill` command group for installing Brevo-authored agent skills into Claude Code (`~/.claude/skills/`). Subcommands: `list`, `install [name] [--all] [--force]`, `update [name]`, `uninstall <name>`. v1 ships the `brevo-cli` skill, which gives Claude context on how to drive the CLI.

The skill catalog is bundled inline so installs work fully offline. Installs are tracked with a `.brevo-skill.json` marker so updates are safe and uninstalls never touch directories the CLI didn't create.

Onboarding hooks: `brevo login` and `brevo app init` offer to install the skill on first run (skippable via `BREVO_NO_SKILL_PROMPT=1`, auto-skipped under `--json` / non-TTY / CI). After every command, an opt-in banner surfaces available skill updates (honoring the same `BREVO_NO_UPDATE_NOTIFIER` opt-out as the CLI version notifier).
