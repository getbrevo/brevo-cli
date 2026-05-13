import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { skillService, getClaudeSkillsRoot } from '../../services/skill';
import { SKILL_CATALOG } from '../../skills';
import { CliError } from '../../lib/errors';

// We exercise the real filesystem against a temp directory rather than mocking
// `fs` — copy/rmSync interactions are subtle and a real run gives stronger
// confidence that installs land where Claude Code expects.

describe('services/skill', () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'brevo-skill-test-'));
    process.env.BREVO_CLAUDE_HOME = tmpHome;
  });

  afterEach(() => {
    delete process.env.BREVO_CLAUDE_HOME;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  describe('getClaudeSkillsRoot', () => {
    it('respects BREVO_CLAUDE_HOME override', () => {
      expect(getClaudeSkillsRoot()).toBe(path.join(tmpHome, 'skills'));
    });

    it('falls back to ~/.claude/skills when override is not set', () => {
      delete process.env.BREVO_CLAUDE_HOME;
      expect(getClaudeSkillsRoot()).toBe(path.join(os.homedir(), '.claude', 'skills'));
    });
  });

  describe('list', () => {
    it('marks every skill as not installed on a fresh machine', () => {
      const skills = skillService.list();
      expect(skills.length).toBe(SKILL_CATALOG.length);
      for (const s of skills) {
        expect(s.installed).toBe(false);
      }
    });

    it('reports installed skills with their installed version', () => {
      skillService.install('brevo-cli');

      const skills = skillService.list();
      const brevoCli = skills.find((s) => s.name === 'brevo-cli');
      expect(brevoCli?.installed).toBe(true);
      if (brevoCli?.installed) {
        expect(brevoCli.installedVersion).toBe(brevoCli.version);
        expect(brevoCli.upgradable).toBe(false);
      }
    });

    it('flags upgradable when marker version differs from catalog', () => {
      skillService.install('brevo-cli');
      const markerPath = path.join(tmpHome, 'skills', 'brevo-cli', '.brevo-skill.json');
      const marker = JSON.parse(fs.readFileSync(markerPath, 'utf-8'));
      marker.version = '0.0.1';
      fs.writeFileSync(markerPath, JSON.stringify(marker));

      const skills = skillService.list();
      const brevoCli = skills.find((s) => s.name === 'brevo-cli');
      expect(brevoCli?.installed).toBe(true);
      if (brevoCli?.installed) {
        expect(brevoCli.installedVersion).toBe('0.0.1');
        expect(brevoCli.upgradable).toBe(true);
      }
    });
  });

  describe('install', () => {
    it('copies bundled files into ~/.claude/skills/<name>/', () => {
      const result = skillService.install('brevo-cli');
      expect(result.status).toBe('installed');
      const installedFile = path.join(tmpHome, 'skills', 'brevo-cli', 'SKILL.md');
      expect(fs.existsSync(installedFile)).toBe(true);
      expect(fs.readFileSync(installedFile, 'utf-8')).toContain('Brevo CLI');
    });

    it('writes a marker recording version + source', () => {
      skillService.install('brevo-cli');
      const marker = JSON.parse(
        fs.readFileSync(path.join(tmpHome, 'skills', 'brevo-cli', '.brevo-skill.json'), 'utf-8'),
      );
      expect(marker).toMatchObject({ name: 'brevo-cli', source: 'brevo-cli' });
      expect(typeof marker.version).toBe('string');
      expect(typeof marker.installedAt).toBe('string');
    });

    it('is idempotent without --force', () => {
      skillService.install('brevo-cli');
      const result = skillService.install('brevo-cli');
      expect(result.status).toBe('already-installed');
    });

    it('overwrites with --force', () => {
      skillService.install('brevo-cli');
      const result = skillService.install('brevo-cli', { force: true });
      expect(result.status).toBe('overwritten');
    });

    it('throws CliError for an unknown skill', () => {
      expect(() => skillService.install('does-not-exist')).toThrow(CliError);
    });

    it('installAll installs every catalog entry', () => {
      const results = skillService.installAll();
      expect(results.length).toBe(SKILL_CATALOG.length);
      for (const r of results) {
        expect(r.status).toBe('installed');
      }
    });
  });

  describe('update', () => {
    it('refreshes a single installed skill', () => {
      skillService.install('brevo-cli');
      const results = skillService.update('brevo-cli');
      expect(results).toHaveLength(1);
      expect(results[0]!.status).toBe('updated');
    });

    it('throws when asked to update a skill that is not installed', () => {
      expect(() => skillService.update('brevo-cli')).toThrow(CliError);
    });

    it('updates only installed skills when no name is provided', () => {
      // brevo-cli installed; any future catalog entries are not installed and
      // must be silently skipped (not throw) so `brevo skill update` is safe
      // to run on partially-installed setups.
      skillService.install('brevo-cli');
      const results = skillService.update();
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((r) => r.status === 'updated')).toBe(true);
      expect(results.find((r) => r.name === 'brevo-cli')).toBeDefined();
    });

    it('returns an empty array when nothing is installed', () => {
      expect(skillService.update()).toEqual([]);
    });
  });

  describe('uninstall', () => {
    it('removes the installed skill directory', () => {
      skillService.install('brevo-cli');
      const result = skillService.uninstall('brevo-cli');
      expect(result.name).toBe('brevo-cli');
      expect(fs.existsSync(path.join(tmpHome, 'skills', 'brevo-cli'))).toBe(false);
    });

    it('throws when the skill is not installed', () => {
      expect(() => skillService.uninstall('brevo-cli')).toThrow(CliError);
    });

    it('throws CliError for an unknown skill', () => {
      expect(() => skillService.uninstall('does-not-exist')).toThrow(CliError);
    });

    it('refuses to remove a directory without our marker (safety)', () => {
      // Simulate a user-authored directory at the install path — no marker
      // file. The CLI must not blow it away even if the name matches.
      const target = path.join(tmpHome, 'skills', 'brevo-cli');
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, 'user-file.md'), 'do not delete');

      expect(() => skillService.uninstall('brevo-cli')).toThrow(CliError);
      expect(fs.existsSync(path.join(target, 'user-file.md'))).toBe(true);
    });
  });
});
