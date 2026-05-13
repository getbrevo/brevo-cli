---
'@getbrevo/cli': minor
---

Add `brevo skill` command group for installing Brevo-authored agent skills into Claude Code (`~/.claude/skills/`). The first shipping skill is `brevo-cli`, which gives Claude context on how to drive the CLI.

**Commands**

- `brevo skill install [--json]` — installs every catalog skill, idempotently. If a skill is already at the bundled version it reports "already up to date".
- `brevo skill uninstall [--json]` — removes every Brevo-installed skill. Marker-gated, so it never touches a directory the CLI didn't create. Reports a friendly no-op when nothing is installed.

**Auto-refresh**

Once a skill is installed, every subsequent `brevo` invocation silently overwrites the installed copy if the bundled CLI ships a newer version, printing a single line on stderr: `↻ refreshed brevo-cli skill (v1.0.0 → v1.3.0)`. Auto-refresh is skipped under `CI=true`, `--json`, any `brevo skill *` invocation, and when `BREVO_NO_SKILL_AUTOREFRESH=1` is set.

**First-run onboarding**

`brevo login` and `brevo app init` offer to install the `brevo-cli` skill on first run. Skippable via `BREVO_NO_SKILL_PROMPT=1`; auto-skipped under `--json` / non-TTY / CI.

**Implementation notes**

- The skill catalog is bundled inline so installs work fully offline.
- `agent-context/SKILL.md` is the single source of truth — the CLI reads it directly via `SKILLS_BUNDLE_DIR`; manual-copy users and `brevo skill install` users see the same file.
- Installs are tracked with a `.brevo-skill.json` marker so auto-refresh and uninstall stay safe.
- Skill test fixtures route through a repo-local `src/__tests__/**/__sandbox__/` directory (gitignored) instead of `os.tmpdir()` — addresses SonarCloud `S5443`.
