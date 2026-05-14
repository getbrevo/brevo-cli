import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Catalog of Brevo-authored agent skills installable via `brevo skill:cli install`.
 *
 * Source content lives under `agent-context/` at the repo root — the same
 * directory the README documents for manual install (`cp .../agent-context/
 * SKILL.md ...`). Keeping a single source avoids drift between the
 * programmatic install path and the documented manual path.
 *
 * **Skill version is the CLI version.** Every published CLI release carries
 * its own bundled `agent-context/`, so installed skills auto-refresh after a
 * CLI upgrade even if `SKILL.md` itself didn't change. This eliminates the
 * "forgot to bump skill version when editing SKILL.md" failure mode.
 *
 * To add a new skill:
 *   1. Drop SKILL.md (+ any supporting files) under `agent-context/<subdir>/`,
 *      or directly under `agent-context/` if it shares the brevo-cli layout.
 *   2. Add an entry below with `subdir` pointing at the right directory.
 */

export interface SkillEntry {
  /** Stable, kebab-case identifier for the skill catalog entry. */
  name: string;
  /** Short one-line summary. */
  description: string;
  /** Tracks the CLI version (see `CLI_VERSION` below). */
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

/**
 * CLI version pulled from the bundled `package.json` at module-init.
 *
 * Resolved relative to this file so the same lookup works under ts-jest
 * (`src/skills/` → repo root) and the published tarball
 * (`node_modules/@getbrevo/cli/dist/skills/` → package root). Falls back to
 * `'0.0.0'` if the file is missing or malformed — the auto-refresh pass
 * then never fires, which is the safe default.
 */
function readCliVersion(): string {
  try {
    const pkgPath = path.resolve(__dirname, '..', '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const CLI_VERSION = readCliVersion();

export const SKILL_CATALOG: readonly SkillEntry[] = [
  {
    name: 'brevo-cli',
    description:
      'Agent primer for the Brevo Developer CLI — decision tree, hard rules, and command map for the `brevo` binary.',
    version: CLI_VERSION,
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
