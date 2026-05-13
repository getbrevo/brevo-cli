---
'@getbrevo/cli': minor
---

Simplify `brevo skill install` and `brevo skill uninstall` now that the catalog ships a single skill (`brevo-cli`):

- `brevo skill install [--json]` — installs every catalog entry, idempotently. The `[name]`, `--all`, and `--force` flags are gone; if a skill is already at the bundled version it reports "already up to date" instead of an error.
- `brevo skill uninstall [--json]` — removes every Brevo-installed skill (marker-gated, so it never touches a directory the CLI didn't create). The `<name>` positional is gone; running with nothing installed reports a friendly no-op.

Hardened the skill test fixtures by routing the per-test `tmpHome` through a repo-local `src/__tests__/**/__sandbox__/` directory (gitignored) instead of `os.tmpdir()`. Addresses SonarCloud `S5443` on the install/uninstall test files. Test-only — no runtime behavior is affected by this part.
