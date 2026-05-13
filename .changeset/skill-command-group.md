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

Discovery is doc-driven rather than interrupting interactive runs: `agent-context/AGENTS.md` opens with an "AI agents — install the skill first" section telling any agent helping with the CLI to run `brevo skill:cli install` before doing other work. Humans run `brevo skill:cli install` once when they want the AI assist; otherwise the CLI never nags. No first-run banner, no `~/.brevo/skill-banner.json` state file.

**Implementation notes**

- The skill catalog is bundled inline so installs work fully offline.
- `agent-context/SKILL.md` is the single source of truth — the CLI reads it directly via `SKILLS_BUNDLE_DIR`; manual-copy users and `brevo skill:cli install` users see the same file.
- Installs are tracked with a `.brevo-skill.json` marker so auto-refresh and uninstall stay safe.
- Skill test fixtures route through a repo-local `src/__tests__/**/__sandbox__/` directory (gitignored) instead of `os.tmpdir()` — addresses SonarCloud `S5443`.

**Docs**

- Fix `AGENTS.md` env-var table: the debug toggle is `BREVO_DEBUG=1`, not `DEBUG=1` (the latter never enabled debug logging — `src/lib/logger.ts` only reads `BREVO_DEBUG`).
- Document previously undocumented env vars in `AGENTS.md`: `BREVO_CLAUDE_HOME` (override Claude Code home used by `skill:cli`) and `BREVO_NO_UPDATE_NOTIFIER` (suppress the npm update-available notice).
- Round out `AGENTS.md` command table: add the missing `brevo logout` row and the `--yes` flag on `app update`; list `--json` consistently across every command that supports it.
- Add the missing `whoami` mapping to the `SKILL.md` decision tree.
