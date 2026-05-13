import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { skillService, getClaudeSkillsRoot, shouldSkipAutoRefresh } from '../../services/skill';
import { SKILL_CATALOG } from '../../skills';
import { CliError } from '../../lib/errors';

// We exercise the real filesystem against a temp directory rather than mocking
// `fs` — copy/rmSync interactions are subtle and a real run gives stronger
// confidence that installs land where Claude Code expects. We deliberately
// avoid os.tmpdir() to keep tests off any shared, world-writable directory
// (SonarSource S5443); the repo-local `__sandbox__/` dir is gitignored.
const SANDBOX_ROOT = path.join(__dirname, '__sandbox__');

describe('services/skill', () => {
  let tmpHome: string;

  beforeEach(() => {
    fs.mkdirSync(SANDBOX_ROOT, { recursive: true });
    tmpHome = fs.mkdtempSync(path.join(SANDBOX_ROOT, 'brevo-skill-test-'));
    process.env.BREVO_CLAUDE_HOME = tmpHome;
  });

  afterEach(() => {
    delete process.env.BREVO_CLAUDE_HOME;
    delete process.env.BREVO_NO_SKILL_AUTOREFRESH;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  function installStaleBrevoCli(forgedVersion = '0.0.1'): string {
    skillService.install('brevo-cli');
    const markerPath = path.join(tmpHome, 'skills', 'brevo-cli', '.brevo-skill.json');
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf-8'));
    marker.version = forgedVersion;
    fs.writeFileSync(markerPath, JSON.stringify(marker));
    return markerPath;
  }

  describe('getClaudeSkillsRoot', () => {
    it('respects BREVO_CLAUDE_HOME override', () => {
      expect(getClaudeSkillsRoot()).toBe(path.join(tmpHome, 'skills'));
    });

    it('falls back to ~/.claude/skills when override is not set', () => {
      delete process.env.BREVO_CLAUDE_HOME;
      expect(getClaudeSkillsRoot()).toBe(path.join(os.homedir(), '.claude', 'skills'));
    });
  });

  describe('getOutdatedSkills', () => {
    it('returns nothing on a fresh machine', () => {
      expect(skillService.getOutdatedSkills()).toEqual([]);
    });

    it('returns nothing when installed skills are current', () => {
      skillService.install('brevo-cli');
      expect(skillService.getOutdatedSkills()).toEqual([]);
    });

    it('flags a skill whose marker version is behind the catalog', () => {
      skillService.install('brevo-cli');
      const markerPath = path.join(tmpHome, 'skills', 'brevo-cli', '.brevo-skill.json');
      const marker = JSON.parse(fs.readFileSync(markerPath, 'utf-8'));
      marker.version = '0.0.1';
      fs.writeFileSync(markerPath, JSON.stringify(marker));

      const outdated = skillService.getOutdatedSkills();
      expect(outdated).toHaveLength(1);
      expect(outdated[0]).toMatchObject({
        name: 'brevo-cli',
        installedVersion: '0.0.1',
      });
      expect(outdated[0]!.latestVersion).toBe(
        SKILL_CATALOG.find((s) => s.name === 'brevo-cli')!.version,
      );
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

  describe('uninstallAll', () => {
    it('returns an empty list when nothing is installed', () => {
      expect(skillService.uninstallAll()).toEqual([]);
    });

    it('removes every installed Brevo skill', () => {
      skillService.install('brevo-cli');
      const results = skillService.uninstallAll();
      expect(results.map((r) => r.name)).toEqual(['brevo-cli']);
      expect(fs.existsSync(path.join(tmpHome, 'skills', 'brevo-cli'))).toBe(false);
    });

    it('skips directories without our marker (safety)', () => {
      // User-authored directory at the install path — no marker. uninstallAll
      // must report nothing uninstalled and leave the directory untouched.
      const target = path.join(tmpHome, 'skills', 'brevo-cli');
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, 'user-file.md'), 'do not delete');

      expect(skillService.uninstallAll()).toEqual([]);
      expect(fs.existsSync(path.join(target, 'user-file.md'))).toBe(true);
    });
  });

  describe('shouldSkipAutoRefresh', () => {
    it('skips in CI', () => {
      expect(shouldSkipAutoRefresh({ env: { CI: 'true' } })).toBe(true);
    });

    it('skips when --json is in argv', () => {
      expect(
        shouldSkipAutoRefresh({
          argv: ['node', 'brevo', 'app', 'list', '--json'],
          env: {},
        }),
      ).toBe(true);
    });

    it('skips while running `brevo skill:cli <anything>`', () => {
      expect(
        shouldSkipAutoRefresh({
          argv: ['node', 'brevo', 'skill:cli', 'install'],
          env: {},
        }),
      ).toBe(true);
    });

    it('skips when BREVO_NO_SKILL_AUTOREFRESH=1', () => {
      expect(shouldSkipAutoRefresh({ env: { BREVO_NO_SKILL_AUTOREFRESH: '1' } })).toBe(true);
    });

    it('runs in a non-CI, non-skill, non-json invocation', () => {
      expect(
        shouldSkipAutoRefresh({
          argv: ['node', 'brevo', 'app', 'list'],
          env: {},
        }),
      ).toBe(false);
    });
  });

  describe('autoRefreshOutdated', () => {
    it('does nothing when no skills are installed', () => {
      const output = { write: jest.fn() } as unknown as NodeJS.WriteStream;
      skillService.autoRefreshOutdated({ env: {}, argv: ['node', 'brevo', 'app', 'list'], output });
      expect(output.write as jest.Mock).not.toHaveBeenCalled();
    });

    it('does nothing when installed skills are current', () => {
      skillService.install('brevo-cli');
      const output = { write: jest.fn() } as unknown as NodeJS.WriteStream;
      skillService.autoRefreshOutdated({ env: {}, argv: ['node', 'brevo', 'app', 'list'], output });
      expect(output.write as jest.Mock).not.toHaveBeenCalled();
    });

    it('rewrites the installed marker and prints a notice when stale', () => {
      const markerPath = installStaleBrevoCli('0.0.1');
      const latest = SKILL_CATALOG.find((s) => s.name === 'brevo-cli')!.version;

      const output = { write: jest.fn() } as unknown as NodeJS.WriteStream;
      skillService.autoRefreshOutdated({
        env: {},
        argv: ['node', 'brevo', 'app', 'list'],
        output,
      });

      const refreshedMarker = JSON.parse(fs.readFileSync(markerPath, 'utf-8'));
      expect(refreshedMarker.version).toBe(latest);

      const writes = (output.write as jest.Mock).mock.calls.map((c) => c[0]).join('');
      expect(writes).toContain('refreshed brevo-cli');
      expect(writes).toContain(`v0.0.1`);
      expect(writes).toContain(`v${latest}`);
    });

    it('respects BREVO_NO_SKILL_AUTOREFRESH=1 even when stale', () => {
      const markerPath = installStaleBrevoCli('0.0.1');

      const output = { write: jest.fn() } as unknown as NodeJS.WriteStream;
      skillService.autoRefreshOutdated({
        env: { BREVO_NO_SKILL_AUTOREFRESH: '1' },
        argv: ['node', 'brevo', 'app', 'list'],
        output,
      });

      const marker = JSON.parse(fs.readFileSync(markerPath, 'utf-8'));
      expect(marker.version).toBe('0.0.1');
      expect(output.write as jest.Mock).not.toHaveBeenCalled();
    });

    it('does not throw if the install fails — falls through to a single error line', () => {
      installStaleBrevoCli('0.0.1');
      const installSpy = jest.spyOn(skillService, 'install').mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });

      const output = { write: jest.fn() } as unknown as NodeJS.WriteStream;
      expect(() =>
        skillService.autoRefreshOutdated({
          env: {},
          argv: ['node', 'brevo', 'app', 'list'],
          output,
        }),
      ).not.toThrow();

      const writes = (output.write as jest.Mock).mock.calls.map((c) => c[0]).join('');
      expect(writes).toContain('failed to refresh brevo-cli');
      expect(writes).toContain('EACCES');

      installSpy.mockRestore();
    });
  });
});
