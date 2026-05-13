---
'@getbrevo/cli': minor
---

Add `brevo skill:cli` command group for installing the brevo-cli Claude Code skill into `~/.claude/skills/`. The `skill:<name>` shape reserves a namespace for future Brevo-authored skills (each gets its own top-level group rather than positional args).

**Commands**

- `brevo skill:cli install [--json]` — installs the brevo-cli skill, idempotently. If the skill is already at the bundled version it reports "already up to date".
- `brevo skill:cli uninstall [--json]` — removes the brevo-cli skill. Marker-gated, so it never touches a directory the CLI didn't create. Reports a friendly no-op when nothing is installed.

**Auto-refresh**

The skill version tracks the CLI version (read from `package.json` at module-init). Every CLI release effectively bumps the bundled skill version too, so installed copies auto-refresh after a CLI upgrade — even when `SKILL.md` itself didn't change. The refresh emits a single stderr line: `↻ refreshed brevo-cli skill (v1.0.0 → v1.1.0)`. Skipped under `CI=true`, `--json`, any `brevo skill:cli *` invocation, and when `BREVO_NO_SKILL_AUTOREFRESH=1` is set.

**Onboarding**

A one-shot banner prints on stderr the first time an interactive `brevo` command runs without the skill installed:

```
  ╭──────────────────────────────────────────────────────╮
  │  Brevo ships a Claude Code skill for AI assistants.  │
  │  Run `brevo skill:cli install` to enable it.         │
  │  (You'll only see this notice once.)                 │
  ╰──────────────────────────────────────────────────────╯
```

The CLI records this at `~/.brevo/skill-banner.json` (respects `BREVO_CONFIG_HOME`) and never re-prints — install or not, the user is only nudged once. Skipped under `CI=true`, non-TTY, `--json`, and during any `brevo skill:cli *` invocation. After the banner, install once with `brevo skill:cli install` (or follow the README's manual-copy escape hatch); auto-refresh then keeps the installed copy in sync.

**Implementation notes**

- The skill catalog is bundled inline so installs work fully offline.
- `agent-context/SKILL.md` is the single source of truth — the CLI reads it directly via `SKILLS_BUNDLE_DIR`; manual-copy users and `brevo skill:cli install` users see the same file.
- Installs are tracked with a `.brevo-skill.json` marker so auto-refresh and uninstall stay safe.
- Skill test fixtures route through a repo-local `src/__tests__/**/__sandbox__/` directory (gitignored) instead of `os.tmpdir()` — addresses SonarCloud `S5443`.
