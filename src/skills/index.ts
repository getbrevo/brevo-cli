import * as path from 'node:path';

/**
 * Catalog of Brevo-authored agent skills installable via `brevo skill install`.
 *
 * v1 ships a small inline catalog bundled with the CLI; each entry maps to a
 * directory under `src/skills/files/` whose contents are copied into the
 * target agent's skills directory (e.g. `~/.claude/skills/<name>/`).
 *
 * To add a new skill:
 *   1. Drop the SKILL.md (+ any supporting files) under `src/skills/files/<name>/`.
 *   2. Add an entry below. The build script copies the whole `files/` tree to dist/.
 *   3. Bump `version` when content materially changes so `brevo skill update`
 *      can detect refresh-worthy changes.
 */

export interface SkillEntry {
  /** Stable, kebab-case identifier used in `brevo skill install <name>`. */
  name: string;
  /** Short one-line summary surfaced by `brevo skill list`. */
  description: string;
  /** Semantic version of the skill content. Bump when SKILL.md changes. */
  version: string;
  /** Files to copy, relative to `src/skills/files/<name>/`. */
  files: string[];
}

export const SKILL_CATALOG: readonly SkillEntry[] = [
  {
    name: 'brevo-cli',
    description:
      'Agent primer for the Brevo Developer CLI — decision tree, hard rules, and command map for the `brevo` binary.',
    version: '1.0.0',
    files: ['SKILL.md'],
  },
] as const;

/**
 * Absolute path to the bundled skill source directory. Resolved relative to
 * this file so the same code works in `src/` (ts-jest) and `dist/`.
 */
export const SKILLS_BUNDLE_DIR = path.resolve(__dirname, 'files');

export function getSkill(name: string): SkillEntry | undefined {
  return SKILL_CATALOG.find((s) => s.name === name);
}
