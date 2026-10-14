---
'@getbrevo/cli': minor
---

New `brevo skill` command group installs Brevo agent skills from the brevo-skills catalog: `brevo skill install [names...]` (every skill when none is named; skills marked `default` always included), `brevo skill update [names...]`, `brevo skill uninstall [names...]`, `brevo skill list` and `brevo skill check` (exit code 1 when a skill is outdated or modified on disk). `install` and `update` take `--agent claude,codex,gemini|all`, `--pin <release>`, `--mcp` (registers the Brevo MCP server with each agent CLI on the PATH, or prints the command), `--force`, `--dry-run` and `--json`.

Every skill's files are fetched from the release tag and hashed before they are written; a mismatch skips that skill and the command exits 1. A skill whose `min_cli_version` is newer than the running CLI, or whose platforms do not include the agent's, is skipped with a message. Each installed directory carries a `.brevo-skill.json` marker and `~/.brevo/skills.lock.json` records versions, releases and pins. The catalog is cached at `~/.brevo/skills-catalog.json`; after any `brevo` command, when the cache is older than 12 hours, outdated unpinned skills are reinstalled (same skip rules as before, silent on network failure). Offline, `brevo skill install brevo-cli` installs the copy bundled with the CLI. `BREVO_SKILLS_CATALOG_URL` and `BREVO_SKILLS_FILES_URL` override the catalog and file URLs.

`brevo skill:cli install` and `brevo skill:cli uninstall` keep working as hidden aliases of `brevo skill install brevo-cli` and `brevo skill uninstall brevo-cli`. Under `--json`, install results now carry `status` values `installed`, `updated`, `already-installed` or `skipped` (with a `reason`), and uninstall results a `status` of `removed` or `not-installed`.
