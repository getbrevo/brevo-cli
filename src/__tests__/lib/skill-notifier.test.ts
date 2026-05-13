import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  autoRefreshOutdatedSkills,
  offerSkillInstall,
  shouldSkipSkillAutoRefresh,
  shouldSkipInstallPrompt,
} from '../../lib/skill-notifier';
import { skillService } from '../../services/skill';
import { SKILL_CATALOG } from '../../skills';

describe('skill-notifier', () => {
  let tmpHome: string;
  let stderrWrites: string[];
  let stdoutWrites: string[];
  let stderrSpy: jest.SpyInstance;
  let stdoutSpy: jest.SpyInstance;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'brevo-skill-notifier-'));
    process.env.BREVO_CLAUDE_HOME = tmpHome;
    stderrWrites = [];
    stdoutWrites = [];
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      stderrWrites.push(String(chunk));
      return true;
    });
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      stdoutWrites.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    delete process.env.BREVO_CLAUDE_HOME;
    delete process.env.BREVO_NO_SKILL_PROMPT;
    delete process.env.BREVO_NO_SKILL_AUTOREFRESH;
    fs.rmSync(tmpHome, { recursive: true, force: true });
    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  /** Install brevo-cli, then forge an older version in its marker so auto-refresh sees it as stale. */
  function installStaleBrevoCli(forgedVersion = '0.0.1'): string {
    skillService.install('brevo-cli');
    const markerPath = path.join(tmpHome, 'skills', 'brevo-cli', '.brevo-skill.json');
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf-8'));
    marker.version = forgedVersion;
    fs.writeFileSync(markerPath, JSON.stringify(marker));
    return markerPath;
  }

  describe('shouldSkipSkillAutoRefresh', () => {
    it('skips in CI', () => {
      expect(shouldSkipSkillAutoRefresh({ env: { CI: 'true' } })).toBe(true);
    });

    it('skips when --json is in argv', () => {
      expect(
        shouldSkipSkillAutoRefresh({
          argv: ['node', 'brevo', 'app', 'list', '--json'],
          env: {},
        }),
      ).toBe(true);
    });

    it('skips while running `brevo skill <anything>`', () => {
      expect(
        shouldSkipSkillAutoRefresh({
          argv: ['node', 'brevo', 'skill', 'install', 'brevo-cli'],
          env: {},
        }),
      ).toBe(true);
    });

    it('skips when BREVO_NO_SKILL_AUTOREFRESH=1', () => {
      expect(shouldSkipSkillAutoRefresh({ env: { BREVO_NO_SKILL_AUTOREFRESH: '1' } })).toBe(true);
    });

    it('runs in a non-CI, non-skill, non-json invocation', () => {
      expect(
        shouldSkipSkillAutoRefresh({
          argv: ['node', 'brevo', 'app', 'list'],
          env: {},
        }),
      ).toBe(false);
    });

    // Unlike the old notifier, auto-refresh is NOT gated on TTY — scripts also
    // benefit from a fresh skill on every run.
    it('does not require a TTY', () => {
      expect(
        shouldSkipSkillAutoRefresh({
          argv: ['node', 'brevo', 'app', 'list'],
          env: {},
        }),
      ).toBe(false);
    });
  });

  describe('autoRefreshOutdatedSkills', () => {
    it('does nothing when no skills are installed', () => {
      autoRefreshOutdatedSkills({ env: {}, argv: ['node', 'brevo', 'app', 'list'] });
      expect(stderrWrites.join('')).toBe('');
    });

    it('does nothing when installed skills are current', () => {
      skillService.install('brevo-cli');
      autoRefreshOutdatedSkills({ env: {}, argv: ['node', 'brevo', 'app', 'list'] });
      expect(stderrWrites.join('')).toBe('');
    });

    it('rewrites the installed marker and prints a notice when stale', () => {
      const markerPath = installStaleBrevoCli('0.0.1');
      const latest = SKILL_CATALOG.find((s) => s.name === 'brevo-cli')!.version;

      const output = { write: jest.fn() } as unknown as NodeJS.WriteStream;
      autoRefreshOutdatedSkills({
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
      autoRefreshOutdatedSkills({
        env: { BREVO_NO_SKILL_AUTOREFRESH: '1' },
        argv: ['node', 'brevo', 'app', 'list'],
        output,
      });

      // Marker untouched; no output.
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
        autoRefreshOutdatedSkills({
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

  describe('shouldSkipInstallPrompt', () => {
    it('skips under --json', () => {
      expect(shouldSkipInstallPrompt({ json: true, isTTY: true, env: {} })).toBe(true);
    });

    it('skips when not a TTY', () => {
      expect(shouldSkipInstallPrompt({ isTTY: false, env: {} })).toBe(true);
    });

    it('skips when BREVO_NO_SKILL_PROMPT=1', () => {
      expect(shouldSkipInstallPrompt({ isTTY: true, env: { BREVO_NO_SKILL_PROMPT: '1' } })).toBe(
        true,
      );
    });

    it('runs in an interactive shell otherwise', () => {
      expect(shouldSkipInstallPrompt({ isTTY: true, env: {} })).toBe(false);
    });
  });

  describe('offerSkillInstall', () => {
    it('installs the brevo-cli skill when the user accepts', async () => {
      const prompt = jest.fn().mockResolvedValue({ install: true });

      await offerSkillInstall({ isTTY: true, env: {}, prompt });

      expect(prompt).toHaveBeenCalled();
      expect(skillService.isInstalled('brevo-cli')).toBe(true);
    });

    it('does not install when the user declines', async () => {
      const prompt = jest.fn().mockResolvedValue({ install: false });

      await offerSkillInstall({ isTTY: true, env: {}, prompt });

      expect(skillService.isInstalled('brevo-cli')).toBe(false);
    });

    it('short-circuits when the skill is already installed (no prompt)', async () => {
      skillService.install('brevo-cli');
      const prompt = jest.fn();

      await offerSkillInstall({ isTTY: true, env: {}, prompt });

      expect(prompt).not.toHaveBeenCalled();
    });

    it('does not prompt under --json', async () => {
      const prompt = jest.fn();
      await offerSkillInstall({ json: true, isTTY: true, env: {}, prompt });
      expect(prompt).not.toHaveBeenCalled();
    });

    it('does not prompt in non-TTY environments', async () => {
      const prompt = jest.fn();
      await offerSkillInstall({ isTTY: false, env: {}, prompt });
      expect(prompt).not.toHaveBeenCalled();
    });

    it('respects BREVO_NO_SKILL_PROMPT=1', async () => {
      const prompt = jest.fn();
      await offerSkillInstall({ isTTY: true, env: { BREVO_NO_SKILL_PROMPT: '1' }, prompt });
      expect(prompt).not.toHaveBeenCalled();
    });
  });
});
