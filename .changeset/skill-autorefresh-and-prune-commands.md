---
'@getbrevo/cli': minor
---

Skill installs now auto-refresh on every `brevo` run, and the manual `brevo skill list` / `brevo skill update` commands are removed.

**What changed**

- Auto-refresh: when an installed skill (e.g. `brevo-cli` in `~/.claude/skills/brevo-cli/`) is behind the bundled catalog, the next `brevo` invocation silently overwrites the installed copy and prints one line: `↻ refreshed brevo-cli skill (v0.0.1 → v1.1.0)` on stderr. Opt out with `BREVO_NO_SKILL_AUTOREFRESH=1`. Auto-refresh is also skipped under `CI=true`, `--json`, and any `brevo skill *` invocation (so explicit skill commands stay in charge).
- `brevo skill list` removed — discovery now happens via the README and the `brevo skill install` first-run prompt.
- `brevo skill update` removed — auto-refresh replaces it. To force a re-install of an installed skill, use `brevo skill install <name> --force`.
- The legacy "skill update available" banner is gone; auto-refresh handles it.

**Repo dedup**

`agent-context/SKILL.md` is now the single source of truth — the CLI reads it directly via `SKILLS_BUNDLE_DIR` instead of maintaining a duplicate under `src/skills/files/`. Manual-copy users and `brevo skill install` users see the same file.

**Migration**

- Replace `brevo skill update` in scripts with `brevo skill install <name> --force` (or just remove it — auto-refresh covers normal usage).
- If you scripted around `brevo skill list --json`, fetch the catalog from `node_modules/@getbrevo/cli/agent-context/` directly or rely on `brevo skill install --all`.
