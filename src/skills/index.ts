import * as path from 'node:path';

/**
 * Catalog of Brevo-authored agent skills installable via `brevo skill:cli install`.
 *
 * Source content lives under `agent-context/` at the repo root — the same
 * directory the README documents for manual install (`cp .../agent-context/
 * SKILL.md ...`). Keeping a single source avoids drift between the
 * programmatic install path and the documented manual path.
 *
 * To add a new skill:
 *   1. Drop SKILL.md (+ any supporting files) under `agent-context/<subdir>/`,
 *      or directly under `agent-context/` if it shares the brevo-cli layout.
 *   2. Add an entry below with `subdir` pointing at the right directory.
 *   3. Bump `version` when content materially changes so the auto-refresh
 *      pass (and the marker comparison) can detect a refresh-worthy diff.
 */

export interface SkillEntry {
  /** Stable, kebab-case identifier for the skill catalog entry. */
  name: string;
  /** Short one-line summary. */
  description: string;
  /** Semantic version of the skill content. Bump when SKILL.md changes. */
  version: string;
  /**
   * Subdirectory under `SKILLS_BUNDLE_DIR` that holds this skill's files.
   * `''` means files live directly in the bundle root (used by brevo-cli,
   * which shares `agent-context/` with the manually-installable copy).
   */
  subdir: string;
  /** Files to copy, relative to `SKILLS_BUNDLE_DIR/<subdir>/`. */
  files: string[];
}

export const SKILL_CATALOG: readonly SkillEntry[] = [
  {
    name: 'brevo-cli',
    description:
      'Agent primer for the Brevo Developer CLI — decision tree, hard rules, and command map for the `brevo` binary.',
    version: '1.4.0',
    subdir: '',
    files: ['SKILL.md'],
  },
] as const;

/**
 * Absolute path to the bundled skill source directory. Resolved relative to
 * this file so the same code works under ts-jest (`src/skills/`), built dev
 * builds (`dist/skills/`), and the published tarball
 * (`node_modules/@getbrevo/cli/dist/skills/`). The `agent-context/` directory
 * is shipped at the package root via `package.json` `files:`.
 */
export const SKILLS_BUNDLE_DIR = path.resolve(__dirname, '..', '..', 'agent-context');

export function getSkill(name: string): SkillEntry | undefined {
  return SKILL_CATALOG.find((s) => s.name === name);
}
