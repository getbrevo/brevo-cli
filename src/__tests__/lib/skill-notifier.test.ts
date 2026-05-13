import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  notifyOutdatedSkills,
  offerSkillInstall,
  shouldSkipSkillNotifier,
  shouldSkipInstallPrompt,
} from '../../lib/skill-notifier';
import { skillService } from '../../services/skill';

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
    delete process.env.BREVO_NO_UPDATE_NOTIFIER;
    fs.rmSync(tmpHome, { recursive: true, force: true });
    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  describe('shouldSkipSkillNotifier', () => {
    it('skips in CI', () => {
      expect(shouldSkipSkillNotifier({ env: { CI: 'true' }, isTTY: true })).toBe(true);
    });

    it('skips when not a TTY', () => {
      expect(shouldSkipSkillNotifier({ env: {}, isTTY: false })).toBe(true);
    });

    it('skips when BREVO_NO_UPDATE_NOTIFIER=1', () => {
      expect(shouldSkipSkillNotifier({ env: { BREVO_NO_UPDATE_NOTIFIER: '1' }, isTTY: true })).toBe(
        true,
      );
    });

    it('skips while running `brevo skill <anything>`', () => {
      expect(
        shouldSkipSkillNotifier({
          argv: ['node', 'brevo', 'skill', 'list'],
          env: {},
          isTTY: true,
        }),
      ).toBe(true);
    });

    it('runs in an interactive non-CI shell otherwise', () => {
      expect(
        shouldSkipSkillNotifier({
          argv: ['node', 'brevo', 'app', 'list'],
          env: {},
          isTTY: true,
        }),
      ).toBe(false);
    });
  });

  describe('notifyOutdatedSkills', () => {
    it('does nothing when no skills are installed', () => {
      notifyOutdatedSkills({ env: {}, isTTY: true, argv: ['node', 'brevo', 'app', 'list'] });
      expect(stderrWrites.join('')).toBe('');
    });

    it('does nothing when installed skills are current', () => {
      skillService.install('brevo-cli');
      notifyOutdatedSkills({ env: {}, isTTY: true, argv: ['node', 'brevo', 'app', 'list'] });
      expect(stderrWrites.join('')).toBe('');
    });

    it('prints a banner when an installed skill is behind the catalog', () => {
      skillService.install('brevo-cli');
      // Forge an older version in the marker to simulate a stale install.
      const markerPath = path.join(tmpHome, 'skills', 'brevo-cli', '.brevo-skill.json');
      const marker = JSON.parse(fs.readFileSync(markerPath, 'utf-8'));
      marker.version = '0.0.1';
      fs.writeFileSync(markerPath, JSON.stringify(marker));

      const output = { write: jest.fn() } as unknown as NodeJS.WriteStream;
      notifyOutdatedSkills({
        env: {},
        isTTY: true,
        argv: ['node', 'brevo', 'app', 'list'],
        output,
      });

      const writes = (output.write as jest.Mock).mock.calls.map((c) => c[0]).join('');
      expect(writes).toContain('brevo-cli v0.0.1');
      expect(writes).toContain('brevo skill update brevo-cli');
    });

    it('respects BREVO_NO_UPDATE_NOTIFIER even when outdated', () => {
      skillService.install('brevo-cli');
      const markerPath = path.join(tmpHome, 'skills', 'brevo-cli', '.brevo-skill.json');
      const marker = JSON.parse(fs.readFileSync(markerPath, 'utf-8'));
      marker.version = '0.0.1';
      fs.writeFileSync(markerPath, JSON.stringify(marker));

      const output = { write: jest.fn() } as unknown as NodeJS.WriteStream;
      notifyOutdatedSkills({
        env: { BREVO_NO_UPDATE_NOTIFIER: '1' },
        isTTY: true,
        argv: ['node', 'brevo', 'app', 'list'],
        output,
      });

      expect(output.write as jest.Mock).not.toHaveBeenCalled();
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
