import * as fs from 'node:fs';
import * as path from 'node:path';

import { maybeShowSkillBanner, shouldSkipBanner } from '../../lib/skill-banner';
import { skillService } from '../../services/skill';

// Avoid os.tmpdir() to keep tests off any shared, world-writable directory
// (SonarSource S5443); the repo-local `__sandbox__/` dir is gitignored.
const SANDBOX_ROOT = path.join(__dirname, '__sandbox__');

describe('skill-banner', () => {
  let tmpHome: string;
  let cachePath: string;
  let output: { write: jest.Mock };

  beforeEach(() => {
    fs.mkdirSync(SANDBOX_ROOT, { recursive: true });
    tmpHome = fs.mkdtempSync(path.join(SANDBOX_ROOT, 'brevo-skill-banner-'));
    process.env.BREVO_CLAUDE_HOME = tmpHome;
    cachePath = path.join(tmpHome, 'skill-banner.json');
    output = { write: jest.fn() };
  });

  afterEach(() => {
    delete process.env.BREVO_CLAUDE_HOME;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  function showOpts(overrides: Partial<Parameters<typeof maybeShowSkillBanner>[0]> = {}): {
    argv: readonly string[];
    env: NodeJS.ProcessEnv;
    isTTY: boolean;
    output: NodeJS.WriteStream;
    cachePath: string;
    now: () => string;
  } {
    return {
      argv: ['node', 'brevo', 'app', 'list'],
      env: {},
      isTTY: true,
      output: output as unknown as NodeJS.WriteStream,
      cachePath,
      now: () => '2026-05-13T12:00:00.000Z',
      ...overrides,
    };
  }

  describe('shouldSkipBanner', () => {
    it('skips in CI', () => {
      expect(shouldSkipBanner({ env: { CI: 'true' }, isTTY: true, cachePath })).toBe(true);
    });

    it('skips when not a TTY', () => {
      expect(shouldSkipBanner({ env: {}, isTTY: false, cachePath })).toBe(true);
    });

    it('skips under --json', () => {
      expect(
        shouldSkipBanner({
          argv: ['node', 'brevo', 'app', 'list', '--json'],
          env: {},
          isTTY: true,
          cachePath,
        }),
      ).toBe(true);
    });

    it('skips while running `brevo skill:cli <anything>`', () => {
      expect(
        shouldSkipBanner({
          argv: ['node', 'brevo', 'skill:cli', 'install'],
          env: {},
          isTTY: true,
          cachePath,
        }),
      ).toBe(true);
    });

    it('skips when banner has already been shown', () => {
      fs.writeFileSync(
        cachePath,
        JSON.stringify({ shown: true, shownAt: '2026-05-13T12:00:00.000Z' }),
      );
      expect(
        shouldSkipBanner({
          argv: ['node', 'brevo', 'app', 'list'],
          env: {},
          isTTY: true,
          cachePath,
        }),
      ).toBe(true);
    });

    it('skips when the skill is already installed', () => {
      skillService.install('brevo-cli');
      expect(
        shouldSkipBanner({
          argv: ['node', 'brevo', 'app', 'list'],
          env: {},
          isTTY: true,
          cachePath,
        }),
      ).toBe(true);
    });

    it('runs in an interactive shell when nothing else applies', () => {
      expect(
        shouldSkipBanner({
          argv: ['node', 'brevo', 'app', 'list'],
          env: {},
          isTTY: true,
          cachePath,
        }),
      ).toBe(false);
    });
  });

  describe('maybeShowSkillBanner', () => {
    it('prints the banner and writes the cache marker on first call', () => {
      maybeShowSkillBanner(showOpts());

      const writes = output.write.mock.calls.map((c) => c[0]).join('');
      expect(writes).toContain('Brevo ships a Claude Code skill');
      expect(writes).toContain('brevo skill:cli install');
      expect(writes).toContain("(You'll only see this notice once.)");

      expect(fs.existsSync(cachePath)).toBe(true);
      const state = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      expect(state).toEqual({ shown: true, shownAt: '2026-05-13T12:00:00.000Z' });
    });

    it('does NOT print on the second call (cache file makes it skip)', () => {
      maybeShowSkillBanner(showOpts());
      output.write.mockClear();

      maybeShowSkillBanner(showOpts());
      expect(output.write).not.toHaveBeenCalled();
    });

    it('does not throw when the cache file cannot be written', () => {
      // Point the cache at a path that cannot be created: the cache file's
      // parent dir already exists as a regular file, so mkdir/write both fail.
      const blockedParent = path.join(tmpHome, 'blocked');
      fs.writeFileSync(blockedParent, 'i am a file, not a directory');
      const broken = path.join(blockedParent, 'skill-banner.json');

      expect(() => maybeShowSkillBanner(showOpts({ cachePath: broken }))).not.toThrow();

      // Banner still printed even though the marker write failed.
      const writes = output.write.mock.calls.map((c) => c[0]).join('');
      expect(writes).toContain('Brevo ships a Claude Code skill');
    });

    it('skips when the skill is already installed', () => {
      skillService.install('brevo-cli');
      maybeShowSkillBanner(showOpts());
      expect(output.write).not.toHaveBeenCalled();
      expect(fs.existsSync(cachePath)).toBe(false);
    });
  });
});
