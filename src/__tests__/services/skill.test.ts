import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  skillService,
  getAgentsSkillsRoot,
  getClaudeSkillsRoot,
  getSkillLockPath,
  parseSkillAgents,
  readSkillLock,
  resolveSkillFileDestination,
  shouldSkipAutoRefresh,
  wantsAutoReinstall,
  UnsafeSkillPathError,
} from '../../services/skill';
import {
  getCatalogCachePath,
  readCatalogCache,
  validateCatalog,
  writeCatalogCache,
} from '../../services/skill-catalog';
import { CLI_VERSION } from '../../skills';
import { CliError } from '../../lib/errors';
import {
  LATEST_CATALOG_URL,
  STUB_CATALOG_URL,
  STUB_FILES_URL,
  STUB_SKILLS,
  StubSkill,
  makeCatalog,
  makeFetch,
  pinnedCatalogUrl,
  releaseRoutes,
} from './skill-fixtures';

// We exercise the real filesystem against a temp directory rather than mocking
// `fs` — copy/rmSync interactions are subtle and a real run gives stronger
// confidence that installs land where Claude Code expects. We deliberately
// avoid os.tmpdir() to keep tests off any shared, world-writable directory
// (SonarSource S5443); the repo-local `__sandbox__/` dir is gitignored.
const SANDBOX_ROOT = path.join(__dirname, '__sandbox__');

const NOT_SKILL_ARGV = ['node', 'brevo', 'app', 'list'];

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

describe('services/skill', () => {
  let tmpHome: string;
  let tmpAgentsHome: string;
  let configHome: string;
  let fetchImpl: ReturnType<typeof makeFetch>;

  const claudeDir = (name: string): string => path.join(tmpHome, 'skills', name);
  const agentsDir = (name: string): string => path.join(tmpAgentsHome, 'skills', name);
  const markerOf = (dir: string): Record<string, unknown> =>
    readJson(path.join(dir, '.brevo-skill.json'));

  beforeEach(() => {
    fs.mkdirSync(SANDBOX_ROOT, { recursive: true });
    tmpHome = fs.mkdtempSync(path.join(SANDBOX_ROOT, 'brevo-skill-test-'));
    tmpAgentsHome = fs.mkdtempSync(path.join(SANDBOX_ROOT, 'brevo-skill-agents-'));
    configHome = fs.mkdtempSync(path.join(SANDBOX_ROOT, 'brevo-skill-config-'));
    process.env.BREVO_CLAUDE_HOME = tmpHome;
    process.env.BREVO_AGENTS_HOME = tmpAgentsHome;
    process.env.BREVO_CONFIG_HOME = configHome;
    process.env.BREVO_SKILLS_CATALOG_URL = STUB_CATALOG_URL;
    process.env.BREVO_SKILLS_FILES_URL = STUB_FILES_URL;
    fetchImpl = makeFetch(releaseRoutes(makeCatalog()));
  });

  afterEach(() => {
    for (const key of [
      'BREVO_CLAUDE_HOME',
      'BREVO_AGENTS_HOME',
      'BREVO_CONFIG_HOME',
      'BREVO_SKILLS_CATALOG_URL',
      'BREVO_SKILLS_FILES_URL',
      'BREVO_NO_SKILL_AUTOREFRESH',
      'BREVO_SKILL_AUTOREFRESH',
    ]) {
      delete process.env[key];
    }
    for (const dir of [tmpHome, tmpAgentsHome, configHome]) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  /** A release where every stub skill is one minor ahead, served at the stub URLs. */
  function newerRelease(): { catalog: Record<string, unknown>; skills: StubSkill[] } {
    const skills = STUB_SKILLS.map((s) => {
      const [major, minor] = s.version.split('.');
      const version = `${major}.${Number(minor) + 1}.0`;
      return { ...s, version, files: { ...s.files, 'SKILL.md': `# ${s.name} v${version}\n` } };
    });
    return { catalog: makeCatalog(skills, { version: '0.2.0' }), skills };
  }

  describe('roots', () => {
    it('respects BREVO_CLAUDE_HOME and BREVO_AGENTS_HOME', () => {
      expect(getClaudeSkillsRoot()).toBe(path.join(tmpHome, 'skills'));
      expect(getAgentsSkillsRoot()).toBe(path.join(tmpAgentsHome, 'skills'));
      expect(getSkillLockPath()).toBe(path.join(configHome, 'skills.lock.json'));
    });

    it('falls back to the home directory when the overrides are not set', () => {
      delete process.env.BREVO_CLAUDE_HOME;
      delete process.env.BREVO_AGENTS_HOME;
      delete process.env.BREVO_CONFIG_HOME;
      expect(getClaudeSkillsRoot()).toBe(path.join(os.homedir(), '.claude', 'skills'));
      expect(getAgentsSkillsRoot()).toBe(path.join(os.homedir(), '.agents', 'skills'));
      expect(getSkillLockPath()).toBe(path.join(os.homedir(), '.brevo', 'skills.lock.json'));
    });
  });

  describe('parseSkillAgents', () => {
    it('defaults to Claude Code when --agent is omitted', () => {
      expect(parseSkillAgents()).toEqual(['claude']);
    });

    it('accepts a comma-separated list in any case and order, and returns it in canonical order', () => {
      expect(parseSkillAgents(' Gemini, claude ')).toEqual(['claude', 'gemini']);
    });

    it('expands all', () => {
      expect(parseSkillAgents('all')).toEqual(['claude', 'codex', 'gemini']);
    });

    it('rejects an unknown or empty agent with the list of valid ones', () => {
      expect(() => parseSkillAgents('cursor')).toThrow(
        /Unknown agent "cursor".*claude, codex, gemini/,
      );
      expect(() => parseSkillAgents(' , ')).toThrow(CliError);
    });
  });

  describe('install', () => {
    it('installs every catalog skill for Claude Code by default, with files, markers and lock', async () => {
      const run = await skillService.install([], { fetchImpl });

      expect(run.source).toBe('network');
      expect(run.release).toBe('0.1.0');
      expect(run.failed).toBe(false);
      expect(run.mcp?.serverName).toBe('brevo');
      expect(run.results.map((r) => [r.name, r.status, r.agents])).toEqual([
        ['brevo', 'installed', ['claude']],
        ['brevo-cli', 'installed', ['claude']],
        ['email-test-send', 'installed', ['claude']],
      ]);

      expect(fs.readFileSync(path.join(claudeDir('brevo-cli'), 'SKILL.md'), 'utf-8')).toBe(
        '# brevo-cli v1.1.0\n',
      );
      expect(fs.existsSync(path.join(claudeDir('brevo-cli'), 'references', 'commands.md'))).toBe(
        true,
      );
      expect(markerOf(claudeDir('brevo-cli'))).toMatchObject({
        name: 'brevo-cli',
        version: '1.1.0',
        release: '0.1.0',
        source: 'brevo-skills',
      });
      expect(typeof markerOf(claudeDir('brevo-cli')).installedAt).toBe('string');
      expect(markerOf(claudeDir('brevo-cli')).sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(fs.existsSync(agentsDir('brevo'))).toBe(false);

      const lock = readSkillLock();
      expect(lock.directories[path.join(tmpHome, 'skills')]).toEqual({
        agents: ['claude'],
        skills: {
          brevo: { version: '1.0.0', release: '0.1.0', source: 'brevo-skills' },
          'brevo-cli': { version: '1.1.0', release: '0.1.0', source: 'brevo-skills' },
          'email-test-send': { version: '1.0.0', release: '0.1.0', source: 'brevo-skills' },
        },
      });
      expect(readCatalogCache()?.catalog?.version).toBe('0.1.0');
    });

    it('always includes the default skill when names are given', async () => {
      const run = await skillService.install(['email-test-send'], { fetchImpl });
      expect(run.results.map((r) => r.name)).toEqual(['brevo', 'email-test-send']);
      expect(fs.existsSync(claudeDir('brevo-cli'))).toBe(false);
    });

    it('rejects an unknown skill name, listing the catalog, before writing anything', async () => {
      await expect(skillService.install(['nope'], { fetchImpl })).rejects.toThrow(
        /Unknown skill "nope"\. Available: brevo, brevo-cli, email-test-send/,
      );
      expect(fs.existsSync(path.join(tmpHome, 'skills'))).toBe(false);
    });

    it('is idempotent without --force and reinstalls with it', async () => {
      await skillService.install(['brevo-cli'], { fetchImpl });
      const again = await skillService.install(['brevo-cli'], { fetchImpl });
      expect(again.results.map((r) => r.status)).toEqual([
        'already-installed',
        'already-installed',
      ]);

      const forced = await skillService.install(['brevo-cli'], { fetchImpl, force: true });
      expect(forced.results.find((r) => r.name === 'brevo-cli')).toMatchObject({
        status: 'updated',
        previousVersion: '1.1.0',
      });
    });

    it('installs once into ~/.agents/skills/ for Codex and Gemini CLI together', async () => {
      const run = await skillService.install(['brevo-cli'], {
        fetchImpl,
        agents: ['codex', 'gemini'],
      });
      expect(run.results.map((r) => [r.name, r.path, r.agents])).toEqual([
        ['brevo', agentsDir('brevo'), ['codex', 'gemini']],
        ['brevo-cli', agentsDir('brevo-cli'), ['codex', 'gemini']],
      ]);
      expect(fs.existsSync(claudeDir('brevo-cli'))).toBe(false);
    });

    it('installs into both directories for all agents, downloading each skill once', async () => {
      const run = await skillService.install(['brevo-cli'], {
        fetchImpl,
        agents: ['claude', 'codex', 'gemini'],
      });
      expect(run.results.map((r) => r.agents)).toEqual([
        ['claude'],
        ['claude'],
        ['codex', 'gemini'],
        ['codex', 'gemini'],
      ]);
      const fileFetches = fetchImpl.mock.calls.filter(([url]) => String(url).includes('/skills/'));
      expect(fileFetches).toHaveLength(3); // brevo: 1 file, brevo-cli: 2 files
    });

    it('skips a skill whose platforms do not include the agent (platform fit)', async () => {
      const run = await skillService.install(['email-test-send'], {
        fetchImpl,
        agents: ['gemini'],
      });
      expect(run.results.find((r) => r.name === 'email-test-send')).toMatchObject({
        status: 'skipped',
        reason: 'platform',
        detail: 'claude, openai',
      });
      expect(fs.existsSync(agentsDir('email-test-send'))).toBe(false);
      expect(run.failed).toBe(false);

      // Codex is on the openai platform, so with Codex among the agents it installs.
      const both = await skillService.install(['email-test-send'], {
        fetchImpl,
        agents: ['codex', 'gemini'],
      });
      expect(both.results.find((r) => r.name === 'email-test-send')?.status).toBe('installed');
    });

    it('skips a skill whose min_cli_version is newer than this CLI, naming the version', async () => {
      const skills = STUB_SKILLS.map((s) =>
        s.name === 'brevo-cli' ? { ...s, min_cli_version: '999.0.0' } : s,
      );
      fetchImpl = makeFetch(releaseRoutes(makeCatalog(skills), skills));
      const run = await skillService.install(['brevo-cli'], { fetchImpl });
      expect(run.results.find((r) => r.name === 'brevo-cli')).toMatchObject({
        status: 'skipped',
        reason: 'min-cli-version',
        detail: '999.0.0',
      });
      expect(fs.existsSync(claudeDir('brevo-cli'))).toBe(false);
      expect(run.failed).toBe(false);
    });

    it('refuses a skill whose files do not match the catalog hash, continues, and marks the run failed', async () => {
      const skills = STUB_SKILLS.map((s) =>
        s.name === 'brevo' ? { ...s, sha256: 'a'.repeat(64) } : s,
      );
      fetchImpl = makeFetch(releaseRoutes(makeCatalog(skills), skills));
      const run = await skillService.install(['brevo-cli'], { fetchImpl });

      expect(run.failed).toBe(true);
      expect(run.results[0]).toMatchObject({
        name: 'brevo',
        status: 'skipped',
        reason: 'hash-mismatch',
      });
      expect(run.results[0]!.detail).toMatch(/expected aaaaaaaaaaaa…/);
      expect(fs.existsSync(claudeDir('brevo'))).toBe(false);
      expect(run.results[1]).toMatchObject({ name: 'brevo-cli', status: 'installed' });
      expect(fs.existsSync(claudeDir('brevo-cli'))).toBe(true);
    });

    it('reports a download failure for that skill only', async () => {
      const routes = releaseRoutes(makeCatalog());
      delete routes[`${STUB_FILES_URL}/v0.1.0/skills/brevo-cli/references/commands.md`];
      fetchImpl = makeFetch(routes);
      const run = await skillService.install(['brevo-cli'], { fetchImpl });
      expect(run.failed).toBe(true);
      expect(run.results.find((r) => r.name === 'brevo-cli')).toMatchObject({
        status: 'skipped',
        reason: 'download-failed',
      });
      expect(run.results.find((r) => r.name === 'brevo')?.status).toBe('installed');
    });

    it('--dry-run lists the pending changes and writes nothing', async () => {
      await skillService.install(['brevo'], { fetchImpl });
      fetchImpl = makeFetch(releaseRoutes(newerRelease().catalog, newerRelease().skills));
      const run = await skillService.install([], {
        fetchImpl,
        dryRun: true,
        agents: ['claude', 'codex'],
      });

      expect(run.dryRun).toBe(true);
      expect(run.results.map((r) => [r.name, r.status, r.previousVersion])).toEqual([
        ['brevo', 'updated', '1.0.0'],
        ['brevo-cli', 'installed', undefined],
        ['email-test-send', 'installed', undefined],
        ['brevo', 'installed', undefined],
        ['brevo-cli', 'installed', undefined],
        ['email-test-send', 'installed', undefined],
      ]);
      expect(markerOf(claudeDir('brevo')).version).toBe('1.0.0');
      expect(fs.existsSync(claudeDir('brevo-cli'))).toBe(false);
      expect(fs.existsSync(agentsDir('brevo'))).toBe(false);
      expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes('/skills/'))).toHaveLength(
        0,
      );
    });

    it('--pin installs from that release and records the pin; --pin latest clears it', async () => {
      delete process.env.BREVO_SKILLS_CATALOG_URL;
      const old = makeCatalog(
        STUB_SKILLS.map((s) => ({ ...s, version: '0.9.0' })),
        { version: '0.0.9' },
      );
      fetchImpl = makeFetch({
        ...releaseRoutes(
          old,
          STUB_SKILLS.map((s) => ({ ...s, version: '0.9.0' })),
        ),
        ...releaseRoutes(makeCatalog()),
      });

      const run = await skillService.install(['brevo-cli'], { fetchImpl, pin: 'v0.0.9' });
      expect(fetchImpl).toHaveBeenCalledWith(pinnedCatalogUrl('0.0.9'), expect.anything());
      expect(run.release).toBe('0.0.9');
      expect(markerOf(claudeDir('brevo-cli'))).toMatchObject({
        version: '0.9.0',
        release: '0.0.9',
      });
      expect(
        readSkillLock().directories[path.join(tmpHome, 'skills')]!.skills['brevo-cli'],
      ).toEqual({
        version: '0.9.0',
        release: '0.0.9',
        pin: '0.0.9',
        source: 'brevo-skills',
      });
      // A pinned fetch never becomes the "latest" cache.
      expect(readCatalogCache()).toBeUndefined();

      const latest = await skillService.install(['brevo-cli'], { fetchImpl, pin: 'latest' });
      expect(latest.release).toBe('0.1.0');
      expect(
        readSkillLock().directories[path.join(tmpHome, 'skills')]!.skills['brevo-cli']!.pin,
      ).toBeUndefined();
    });

    it('falls back to the bundled brevo-cli skill when the catalog is unreachable', async () => {
      fetchImpl = makeFetch({});
      const run = await skillService.install(['brevo-cli'], { fetchImpl });

      expect(run.source).toBe('bundled');
      expect(run.release).toBeUndefined();
      expect(run.warnings[0]).toMatch(
        /brevo-skills repository is not reachable .*; installing the brevo-cli skill bundled/,
      );
      expect(run.results).toHaveLength(1);
      expect(run.results[0]).toMatchObject({
        name: 'brevo-cli',
        version: CLI_VERSION,
        status: 'installed',
      });
      expect(fs.readFileSync(path.join(claudeDir('brevo-cli'), 'SKILL.md'), 'utf-8')).toContain(
        'Brevo CLI',
      );
      expect(markerOf(claudeDir('brevo-cli'))).toMatchObject({
        version: CLI_VERSION,
        source: 'brevo-cli',
      });
      expect(markerOf(claudeDir('brevo-cli')).sha256).toMatch(/^[0-9a-f]{64}$/);

      const again = await skillService.install(['brevo-cli'], { fetchImpl });
      expect(again.results[0]!.status).toBe('already-installed');
    });

    it('fails with the URL and the cached release when another skill is requested offline', async () => {
      await skillService.install(['brevo'], { fetchImpl });
      fetchImpl = makeFetch({});
      const err = await skillService.install(['email-test-send'], { fetchImpl }).catch((e) => e);
      expect(err).toBeInstanceOf(CliError);
      expect(err.message).toContain(STUB_CATALOG_URL);
      expect(err.message).toContain('release 0.1.0');
      expect(err.message).toContain('not reachable');
      expect(err.message).toContain('brevo skill:cli install');

      const all = await skillService.install([], { fetchImpl }).catch((e) => e);
      expect(all).toBeInstanceOf(CliError);
    });

    it('rejects a catalog that fails validation instead of installing from it', async () => {
      fetchImpl = makeFetch({ [STUB_CATALOG_URL]: JSON.stringify({ version: '0.1.0' }) });
      await expect(skillService.install(['brevo-cli'], { fetchImpl })).rejects.toThrow(
        /catalog is not valid: skills is missing/,
      );
      expect(fs.existsSync(claudeDir('brevo-cli'))).toBe(false);
    });

    it('migrates a pre-catalog install (marker source brevo-cli) to the catalog', async () => {
      fs.mkdirSync(claudeDir('brevo-cli'), { recursive: true });
      fs.writeFileSync(path.join(claudeDir('brevo-cli'), 'SKILL.md'), 'old bundled text');
      fs.writeFileSync(path.join(claudeDir('brevo-cli'), 'stale.md'), 'should go');
      fs.writeFileSync(
        path.join(claudeDir('brevo-cli'), '.brevo-skill.json'),
        JSON.stringify({
          name: 'brevo-cli',
          version: '2.3.0',
          installedAt: '',
          source: 'brevo-cli',
        }),
      );
      const run = await skillService.install(['brevo-cli'], { fetchImpl });
      expect(run.results.find((r) => r.name === 'brevo-cli')).toMatchObject({
        status: 'updated',
        previousVersion: '2.3.0',
      });
      expect(fs.existsSync(path.join(claudeDir('brevo-cli'), 'stale.md'))).toBe(false);
      expect(markerOf(claudeDir('brevo-cli'))).toMatchObject({
        version: '1.1.0',
        source: 'brevo-skills',
      });
    });

    it('writes over a user-authored directory without deleting the user files', async () => {
      fs.mkdirSync(claudeDir('brevo'), { recursive: true });
      fs.writeFileSync(path.join(claudeDir('brevo'), 'notes.md'), 'mine');
      await skillService.install(['brevo'], { fetchImpl });
      expect(fs.existsSync(path.join(claudeDir('brevo'), 'notes.md'))).toBe(true);
      expect(fs.existsSync(path.join(claudeDir('brevo'), '.brevo-skill.json'))).toBe(true);
    });

    it('warns rather than fails when the lock file cannot be written', async () => {
      fs.writeFileSync(getSkillLockPath(), '{}');
      fs.chmodSync(getSkillLockPath(), 0o400);
      try {
        const run = await skillService.install(['brevo'], { fetchImpl });
        expect(run.results[0]!.status).toBe('installed');
        expect(run.warnings.some((w) => w.includes('skills.lock.json'))).toBe(true);
      } finally {
        fs.chmodSync(getSkillLockPath(), 0o600);
      }
    });
  });

  describe('resolveSkillFileDestination (write-site guard)', () => {
    it('resolves a plain nested file under the skill directory', () => {
      const dir = claudeDir('brevo-cli');
      expect(resolveSkillFileDestination(dir, 'brevo-cli', 'references/commands.md')).toBe(
        path.resolve(dir, 'references', 'commands.md'),
      );
    });

    it.each([
      ['parent traversal', '../escape.md'],
      ['deep traversal', 'a/../../escape.md'],
      ['backslash traversal', 'a\\..\\..\\escape.md'],
      ['drive letter', 'C:/escape.md'],
      ['dot segment', './SKILL.md'],
      ['empty segment', 'a//SKILL.md'],
      ['marker clobber', '.brevo-skill.json'],
      ['nested marker clobber', 'refs/.brevo-skill.json'],
      ['absolute', '/etc/passwd'],
    ])('refuses %s and names the skill and file', (_label, file) => {
      const dir = claudeDir('brevo-cli');
      let caught: unknown;
      try {
        resolveSkillFileDestination(dir, 'brevo-cli', file);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(UnsafeSkillPathError);
      expect((caught as UnsafeSkillPathError).message).toContain('Refused brevo-cli');
      expect((caught as UnsafeSkillPathError).message).toContain(file);
      expect(fs.existsSync(path.join(tmpHome, 'escape.md'))).toBe(false);
    });

    it('refuses a symlinked subdirectory and a symlinked skill directory', () => {
      const outside = fs.mkdtempSync(path.join(SANDBOX_ROOT, 'brevo-outside-'));
      try {
        const dir = claudeDir('brevo-cli');
        fs.mkdirSync(dir, { recursive: true });
        fs.symlinkSync(outside, path.join(dir, 'references'));
        expect(() =>
          resolveSkillFileDestination(dir, 'brevo-cli', 'references/commands.md'),
        ).toThrow(UnsafeSkillPathError);
        // A regular file at the top level of the same directory is still fine.
        expect(() => resolveSkillFileDestination(dir, 'brevo-cli', 'SKILL.md')).not.toThrow();

        const linkedDir = claudeDir('linked');
        fs.mkdirSync(path.dirname(linkedDir), { recursive: true });
        fs.symlinkSync(outside, linkedDir);
        expect(() => resolveSkillFileDestination(linkedDir, 'linked', 'SKILL.md')).toThrow(
          UnsafeSkillPathError,
        );
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });

    it('install skips a skill whose directory would carry a write outside it, and writes nothing there', async () => {
      const outside = fs.mkdtempSync(path.join(SANDBOX_ROOT, 'brevo-outside-'));
      try {
        // A user-authored brevo-cli directory (no marker) whose `references` is a link elsewhere.
        const dir = claudeDir('brevo-cli');
        fs.mkdirSync(dir, { recursive: true });
        fs.symlinkSync(outside, path.join(dir, 'references'));

        const run = await skillService.install(['brevo-cli'], { fetchImpl });
        expect(run.failed).toBe(true);
        expect(run.results.find((r) => r.name === 'brevo-cli')).toMatchObject({
          status: 'skipped',
          reason: 'unsafe-path',
          detail: 'references/commands.md',
        });
        expect(fs.readdirSync(outside)).toEqual([]);
        expect(fs.existsSync(path.join(dir, 'SKILL.md'))).toBe(false);
        expect(fs.existsSync(path.join(dir, '.brevo-skill.json'))).toBe(false);
        expect(run.results.find((r) => r.name === 'brevo')?.status).toBe('installed');
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });
  });

  describe('update', () => {
    it('reinstalls only skills whose version is behind the catalog', async () => {
      await skillService.install([], { fetchImpl });
      const { catalog, skills } = newerRelease();
      // email-test-send stays at its old version in the new release.
      const partial = skills.map((s) => (s.name === 'email-test-send' ? STUB_SKILLS[2]! : s));
      fetchImpl = makeFetch(releaseRoutes(makeCatalog(partial, { version: '0.2.0' }), partial));

      const run = await skillService.update([], { fetchImpl });
      expect(run.release).toBe('0.2.0');
      expect(run.results.map((r) => [r.name, r.status, r.previousVersion, r.version])).toEqual([
        ['brevo', 'updated', '1.0.0', '1.1.0'],
        ['brevo-cli', 'updated', '1.1.0', '1.2.0'],
        ['email-test-send', 'already-installed', '1.0.0', '1.0.0'],
      ]);
      expect(fs.readFileSync(path.join(claudeDir('brevo'), 'SKILL.md'), 'utf-8')).toBe(
        '# brevo v1.1.0\n',
      );
      expect(markerOf(claudeDir('brevo'))).toMatchObject({ version: '1.1.0', release: '0.2.0' });
      expect(readSkillLock().directories[path.join(tmpHome, 'skills')]!.skills.brevo).toMatchObject(
        {
          version: '1.1.0',
          release: '0.2.0',
        },
      );
      void catalog;
    });

    it('respects a pin until --pin latest clears it, and --pin <release> moves it', async () => {
      delete process.env.BREVO_SKILLS_CATALOG_URL;
      const newer = newerRelease();
      fetchImpl = makeFetch({
        ...releaseRoutes(makeCatalog()),
        ...releaseRoutes(newer.catalog, newer.skills),
      });
      await skillService.install(['brevo'], { fetchImpl, pin: '0.1.0' });

      // Latest is 0.2.0 now, but the pin keeps brevo on 0.1.0.
      fetchImpl = makeFetch({
        ...releaseRoutes(makeCatalog(), STUB_SKILLS),
        ...releaseRoutes(newer.catalog, newer.skills),
        [LATEST_CATALOG_URL]: JSON.stringify(newer.catalog),
      });
      const pinned = await skillService.update([], { fetchImpl });
      expect(pinned.results[0]).toMatchObject({
        name: 'brevo',
        status: 'already-installed',
        release: '0.1.0',
      });
      expect(fetchImpl).toHaveBeenCalledWith(pinnedCatalogUrl('0.1.0'), expect.anything());

      const moved = await skillService.update([], { fetchImpl, pin: '0.2.0' });
      expect(moved.results[0]).toMatchObject({
        name: 'brevo',
        status: 'updated',
        version: '1.1.0',
      });
      expect(readSkillLock().directories[path.join(tmpHome, 'skills')]!.skills.brevo!.pin).toBe(
        '0.2.0',
      );

      const cleared = await skillService.update([], { fetchImpl, pin: 'latest' });
      expect(cleared.results[0]!.status).toBe('already-installed');
      expect(
        readSkillLock().directories[path.join(tmpHome, 'skills')]!.skills.brevo!.pin,
      ).toBeUndefined();
    });

    it('--force reinstalls a current skill; --dry-run writes nothing', async () => {
      await skillService.install(['brevo'], { fetchImpl });
      const before = markerOf(claudeDir('brevo')).installedAt;

      const dry = await skillService.update(['brevo'], { fetchImpl, force: true, dryRun: true });
      expect(dry.results[0]!.status).toBe('updated');
      expect(markerOf(claudeDir('brevo')).installedAt).toBe(before);

      const forced = await skillService.update(['brevo'], { fetchImpl, force: true });
      expect(forced.results[0]!.status).toBe('updated');
    });

    it('reports a named skill that is not installed, and one the catalog dropped', async () => {
      await skillService.install(['brevo'], { fetchImpl });
      const only = [STUB_SKILLS[1]!];
      fetchImpl = makeFetch(releaseRoutes(makeCatalog(only, { version: '0.3.0' }), only));
      const run = await skillService.update(['brevo', 'ghost'], { fetchImpl });
      expect(run.results).toEqual([
        expect.objectContaining({ name: 'brevo', status: 'skipped', reason: 'not-in-catalog' }),
        expect.objectContaining({ name: 'ghost', status: 'skipped', reason: 'not-installed' }),
      ]);
      expect(run.failed).toBe(false);
    });

    it('skips an update that needs a newer CLI', async () => {
      await skillService.install(['brevo'], { fetchImpl });
      const skills = newerRelease().skills.map((s) =>
        s.name === 'brevo' ? { ...s, min_cli_version: '999.0.0' } : s,
      );
      fetchImpl = makeFetch(releaseRoutes(makeCatalog(skills, { version: '0.2.0' }), skills));
      const run = await skillService.update(['brevo'], { fetchImpl });
      expect(run.results[0]).toMatchObject({ status: 'skipped', reason: 'min-cli-version' });
      expect(markerOf(claudeDir('brevo')).version).toBe('1.0.0');
    });

    it('marks the run failed on a hash mismatch and leaves the installed copy', async () => {
      await skillService.install(['brevo'], { fetchImpl });
      const skills = newerRelease().skills.map((s) =>
        s.name === 'brevo' ? { ...s, sha256: 'b'.repeat(64) } : s,
      );
      fetchImpl = makeFetch(releaseRoutes(makeCatalog(skills, { version: '0.2.0' }), skills));
      const run = await skillService.update(['brevo'], { fetchImpl });
      expect(run.failed).toBe(true);
      expect(run.results[0]).toMatchObject({ status: 'skipped', reason: 'hash-mismatch' });
      expect(markerOf(claudeDir('brevo')).version).toBe('1.0.0');
    });

    it('fails with the URL when the catalog is unreachable', async () => {
      await skillService.install(['brevo'], { fetchImpl });
      fetchImpl = makeFetch({});
      await expect(skillService.update([], { fetchImpl })).rejects.toThrow(STUB_CATALOG_URL);
    });

    it('rejects an invalid catalog', async () => {
      await skillService.install(['brevo'], { fetchImpl });
      fetchImpl = makeFetch({ [STUB_CATALOG_URL]: '[]' });
      await expect(skillService.update([], { fetchImpl })).rejects.toThrow(/not valid/);
    });

    it('returns an empty run when nothing is installed', async () => {
      const run = await skillService.update([], { fetchImpl });
      expect(run.results).toEqual([]);
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });

  describe('uninstall', () => {
    it('returns an empty list when nothing is installed', () => {
      expect(skillService.uninstall([])).toEqual([]);
    });

    it('removes every installed skill from every directory by default', async () => {
      await skillService.install(['brevo-cli'], { fetchImpl, agents: ['claude', 'codex'] });
      const results = skillService.uninstall([]);
      expect(results.map((r) => [r.name, r.agents, r.status])).toEqual([
        ['brevo', ['claude'], 'removed'],
        ['brevo-cli', ['claude'], 'removed'],
        ['brevo', ['codex', 'gemini'], 'removed'],
        ['brevo-cli', ['codex', 'gemini'], 'removed'],
      ]);
      expect(fs.existsSync(claudeDir('brevo-cli'))).toBe(false);
      expect(fs.existsSync(agentsDir('brevo-cli'))).toBe(false);
      expect(readSkillLock().directories[path.join(tmpHome, 'skills')]!.skills).toEqual({});
    });

    it("removes only the named skills from the given agents' directory", async () => {
      await skillService.install(['brevo-cli'], { fetchImpl, agents: ['claude', 'codex'] });
      const results = skillService.uninstall(['brevo-cli'], { agents: ['codex'] });
      // The shared directory serves Codex and Gemini; the result names the agents asked for.
      expect(results).toEqual([
        { name: 'brevo-cli', path: agentsDir('brevo-cli'), agents: ['codex'], status: 'removed' },
      ]);
      expect(fs.existsSync(claudeDir('brevo-cli'))).toBe(true);
      expect(fs.existsSync(agentsDir('brevo'))).toBe(true);
    });

    it('leaves a directory without the marker alone and says so', () => {
      const target = claudeDir('brevo-cli');
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, 'user-file.md'), 'do not delete');

      expect(skillService.uninstall([])).toEqual([]);
      expect(skillService.uninstall(['brevo-cli'], { agents: ['claude'] })).toEqual([
        { name: 'brevo-cli', path: target, agents: ['claude'], status: 'not-installed' },
      ]);
      expect(fs.existsSync(path.join(target, 'user-file.md'))).toBe(true);
      // Absent everywhere: still reported, once per directory.
      expect(skillService.uninstall(['ghost']).map((r) => r.status)).toEqual([
        'not-installed',
        'not-installed',
      ]);
    });

    it('also trusts the pre-catalog marker', () => {
      const target = claudeDir('brevo-cli');
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(
        path.join(target, '.brevo-skill.json'),
        JSON.stringify({
          name: 'brevo-cli',
          version: '2.3.0',
          installedAt: '',
          source: 'brevo-cli',
        }),
      );
      expect(skillService.uninstall(['brevo-cli'])[0]!.status).toBe('removed');
      expect(fs.existsSync(target)).toBe(false);
    });
  });

  describe('list', () => {
    it('reports installed skills per directory with pins and the available catalog', async () => {
      await skillService.install(['brevo-cli'], { fetchImpl, agents: ['claude', 'codex'] });
      const { catalog, skills } = newerRelease();
      fetchImpl = makeFetch(releaseRoutes(catalog, skills));

      const result = await skillService.list({ fetchImpl });
      expect(result.catalog).toEqual({ release: '0.2.0', source: 'network' });
      expect(
        result.installed.map((s) => [s.name, s.version, s.agents, s.latestVersion, s.outdated]),
      ).toEqual([
        ['brevo', '1.0.0', ['claude'], '1.1.0', true],
        ['brevo-cli', '1.1.0', ['claude'], '1.2.0', true],
        ['brevo', '1.0.0', ['codex', 'gemini'], '1.1.0', true],
        ['brevo-cli', '1.1.0', ['codex', 'gemini'], '1.2.0', true],
      ]);
      expect(result.available.map((s) => [s.name, s.version, s.default])).toEqual([
        ['brevo', '1.1.0', true],
        ['brevo-cli', '1.2.0', false],
        ['email-test-send', '1.1.0', false],
      ]);
    });

    it('falls back to the cached catalog, then to none, when the fetch fails', async () => {
      await skillService.install(['brevo'], { fetchImpl });
      fetchImpl = makeFetch({});
      const cached = await skillService.list({ fetchImpl });
      expect(cached.catalog).toMatchObject({ release: '0.1.0', source: 'cache' });
      expect(cached.catalog.error).toContain(STUB_CATALOG_URL);
      expect(cached.available).toHaveLength(3);
      expect(cached.installed[0]).toMatchObject({ name: 'brevo', outdated: false });

      fs.rmSync(getCatalogCachePath());
      const none = await skillService.list({ fetchImpl });
      expect(none.catalog.source).toBe('none');
      expect(none.available).toEqual([]);
      expect(none.installed[0]).toMatchObject({
        name: 'brevo',
        latestVersion: undefined,
        outdated: false,
      });
    });

    it('uses the cache when the fetched catalog is invalid', async () => {
      await skillService.install(['brevo'], { fetchImpl });
      fetchImpl = makeFetch({ [STUB_CATALOG_URL]: '{"skills":[]}' });
      const result = await skillService.list({ fetchImpl });
      expect(result.catalog.source).toBe('cache');
      expect(result.catalog.error).toMatch(/not valid/);
    });
  });

  describe('check', () => {
    it('passes for current, unmodified skills', async () => {
      await skillService.install(['brevo-cli'], { fetchImpl });
      const run = await skillService.check({ fetchImpl });
      expect(run.ok).toBe(true);
      expect(run.results.map((r) => [r.name, r.outdated, r.tampered, r.unverified])).toEqual([
        ['brevo', false, false, false],
        ['brevo-cli', false, false, false],
      ]);
    });

    it('detects a modified file, an added file, and an outdated skill', async () => {
      await skillService.install(['brevo-cli'], { fetchImpl });
      fs.appendFileSync(path.join(claudeDir('brevo-cli'), 'SKILL.md'), 'edited\n');
      const { catalog, skills } = newerRelease();
      const partial = skills.map((s) => (s.name === 'brevo-cli' ? STUB_SKILLS[1]! : s));
      fetchImpl = makeFetch(releaseRoutes(makeCatalog(partial, { version: '0.2.0' }), partial));

      const run = await skillService.check({ fetchImpl });
      expect(run.ok).toBe(false);
      expect(run.results.find((r) => r.name === 'brevo')).toMatchObject({
        outdated: true,
        tampered: false,
      });
      expect(run.results.find((r) => r.name === 'brevo-cli')).toMatchObject({
        outdated: false,
        tampered: true,
      });
      void catalog;

      fs.writeFileSync(path.join(claudeDir('brevo'), 'extra.md'), 'x');
      const again = await skillService.check({ fetchImpl });
      expect(again.results.find((r) => r.name === 'brevo')?.tampered).toBe(true);
    });

    it('cannot verify a pre-catalog install, and flags it as outdated', async () => {
      fs.mkdirSync(claudeDir('brevo-cli'), { recursive: true });
      fs.writeFileSync(path.join(claudeDir('brevo-cli'), 'SKILL.md'), 'old');
      fs.writeFileSync(
        path.join(claudeDir('brevo-cli'), '.brevo-skill.json'),
        JSON.stringify({
          name: 'brevo-cli',
          version: '2.3.0',
          installedAt: '',
          source: 'brevo-cli',
        }),
      );
      const run = await skillService.check({ fetchImpl });
      expect(run.results[0]).toMatchObject({ unverified: true, tampered: false, outdated: true });
      expect(run.ok).toBe(false);
    });
  });

  describe('shouldSkipAutoRefresh', () => {
    it('skips in CI', () => {
      expect(shouldSkipAutoRefresh({ env: { CI: 'true' } })).toBe(true);
    });

    it('skips when --json is in argv', () => {
      expect(shouldSkipAutoRefresh({ argv: [...NOT_SKILL_ARGV, '--json'], env: {} })).toBe(true);
    });

    it('skips while running `brevo skill …` and the `skill:cli` alias', () => {
      expect(shouldSkipAutoRefresh({ argv: ['node', 'brevo', 'skill', 'install'], env: {} })).toBe(
        true,
      );
      expect(
        shouldSkipAutoRefresh({ argv: ['node', 'brevo', 'skill:cli', 'install'], env: {} }),
      ).toBe(true);
    });

    it('skips when BREVO_NO_SKILL_AUTOREFRESH=1', () => {
      expect(shouldSkipAutoRefresh({ env: { BREVO_NO_SKILL_AUTOREFRESH: '1' } })).toBe(true);
    });

    it('runs in a non-CI, non-skill, non-json invocation', () => {
      expect(shouldSkipAutoRefresh({ argv: NOT_SKILL_ARGV, env: {} })).toBe(false);
    });
  });

  describe('wantsAutoReinstall', () => {
    it('is off unless BREVO_SKILL_AUTOREFRESH is 1 or true', () => {
      expect(wantsAutoReinstall({})).toBe(false);
      expect(wantsAutoReinstall({ BREVO_SKILL_AUTOREFRESH: '0' })).toBe(false);
      expect(wantsAutoReinstall({ BREVO_SKILL_AUTOREFRESH: '1' })).toBe(true);
      expect(wantsAutoReinstall({ BREVO_SKILL_AUTOREFRESH: 'true' })).toBe(true);
    });
  });

  describe('autoRefreshOutdated', () => {
    const output = (): NodeJS.WriteStream =>
      ({ write: jest.fn() }) as unknown as NodeJS.WriteStream;
    const written = (out: NodeJS.WriteStream): string =>
      (out.write as jest.Mock).mock.calls.map((c) => c[0]).join('');
    // CI runners set CI=true, which makes the refresh skip itself by design; these tests
    // exercise the refresh, so they start from an environment without that gate.
    const env = (): NodeJS.ProcessEnv => {
      const e = { ...process.env };
      delete e.CI;
      delete e.BREVO_NO_SKILL_AUTOREFRESH;
      delete e.BREVO_SKILL_AUTOREFRESH;
      return e;
    };

    it('does nothing, and fetches nothing, when no skill is installed', async () => {
      const out = output();
      await skillService.autoRefreshOutdated({
        env: env(),
        argv: NOT_SKILL_ARGV,
        output: out,
        fetchImpl,
      });
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(out.write).not.toHaveBeenCalled();
    });

    it('does not refetch while the cache is fresh', async () => {
      await skillService.install(['brevo'], { fetchImpl });
      fetchImpl.mockClear();
      const out = output();
      await skillService.autoRefreshOutdated({
        env: env(),
        argv: NOT_SKILL_ARGV,
        output: out,
        fetchImpl,
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('refetches when the cache is older than 12 hours and names outdated, unpinned skills without writing', async () => {
      await skillService.install(['brevo-cli'], { fetchImpl, agents: ['claude', 'codex'] });
      // Pin brevo in the Codex directory only.
      const lock = readSkillLock();
      lock.directories[path.join(tmpAgentsHome, 'skills')]!.skills.brevo!.pin = '0.1.0';
      fs.writeFileSync(getSkillLockPath(), JSON.stringify(lock));

      const { catalog, skills } = newerRelease();
      fetchImpl = makeFetch(releaseRoutes(catalog, skills));
      const out = output();
      const later = Date.now() + 13 * 60 * 60 * 1000;
      await skillService.autoRefreshOutdated({
        env: env(),
        argv: NOT_SKILL_ARGV,
        output: out,
        fetchImpl,
        now: () => later,
      });

      // Only the catalog was fetched: no skill file was downloaded or rewritten.
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(markerOf(claudeDir('brevo'))).toMatchObject({ version: '1.0.0' });
      expect(markerOf(claudeDir('brevo-cli'))).toMatchObject({ version: '1.1.0' });
      expect(markerOf(agentsDir('brevo-cli'))).toMatchObject({ version: '1.1.0' });
      const text = written(out);
      expect(text).toBe(
        '  ↑ Brevo skill update available: brevo (v1.0.0 → v1.1.0), brevo-cli (v1.1.0 → v1.2.0). Run `brevo skill update`.\n',
      );
      expect(readCatalogCache()?.fetchedAt).toBe(later);

      // A fresh cache means no second notice until the next refetch.
      fetchImpl.mockClear();
      await skillService.autoRefreshOutdated({
        env: env(),
        argv: NOT_SKILL_ARGV,
        output: out,
        fetchImpl,
        now: () => later + 1000,
      });
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(written(out)).toBe(text);
    });

    it('says nothing when every installed skill matches the catalog', async () => {
      await skillService.install(['brevo-cli'], { fetchImpl });
      const out = output();
      await skillService.autoRefreshOutdated({
        env: env(),
        argv: NOT_SKILL_ARGV,
        output: out,
        fetchImpl,
        now: () => Date.now() + 13 * 60 * 60 * 1000,
      });
      expect(out.write).not.toHaveBeenCalled();
    });

    it('reinstalls outdated, unpinned skills with BREVO_SKILL_AUTOREFRESH=1', async () => {
      await skillService.install(['brevo-cli'], { fetchImpl, agents: ['claude', 'codex'] });
      // Pin brevo in the Codex directory only.
      const lock = readSkillLock();
      lock.directories[path.join(tmpAgentsHome, 'skills')]!.skills.brevo!.pin = '0.1.0';
      fs.writeFileSync(getSkillLockPath(), JSON.stringify(lock));

      const { catalog, skills } = newerRelease();
      fetchImpl = makeFetch(releaseRoutes(catalog, skills));
      const out = output();
      const later = Date.now() + 13 * 60 * 60 * 1000;
      await skillService.autoRefreshOutdated({
        env: { ...env(), BREVO_SKILL_AUTOREFRESH: '1' },
        argv: NOT_SKILL_ARGV,
        output: out,
        fetchImpl,
        now: () => later,
      });

      expect(markerOf(claudeDir('brevo'))).toMatchObject({ version: '1.1.0', release: '0.2.0' });
      expect(markerOf(claudeDir('brevo-cli'))).toMatchObject({ version: '1.2.0' });
      expect(markerOf(agentsDir('brevo-cli'))).toMatchObject({ version: '1.2.0' });
      expect(markerOf(agentsDir('brevo'))).toMatchObject({ version: '1.0.0' });
      const text = written(out);
      expect(text).toContain('refreshed brevo skill (v1.0.0 → v1.1.0)');
      expect(text).toContain('refreshed brevo-cli skill (v1.1.0 → v1.2.0)');
      expect(text.match(/refreshed/g)).toHaveLength(3);
      expect(readCatalogCache()?.fetchedAt).toBe(later);
      expect(readSkillLock().directories[path.join(tmpHome, 'skills')]!.skills.brevo).toMatchObject(
        {
          version: '1.1.0',
        },
      );
    });

    /** A bundled install from an older CLI, as the pre-catalog installer left it, with no catalog cache. */
    async function staleBundledInstall(): Promise<void> {
      fetchImpl = makeFetch({});
      await skillService.install(['brevo-cli'], { fetchImpl });
      const markerPath = path.join(claudeDir('brevo-cli'), '.brevo-skill.json');
      fs.writeFileSync(
        markerPath,
        JSON.stringify({ ...markerOf(claudeDir('brevo-cli')), version: '0.0.1' }),
      );
      fs.rmSync(getCatalogCachePath(), { force: true });
    }

    it('stays silent on a network failure, records the attempt, and names a stale bundled copy', async () => {
      await staleBundledInstall();

      const out = output();
      const now = Date.now();
      await expect(
        skillService.autoRefreshOutdated({
          env: env(),
          argv: NOT_SKILL_ARGV,
          output: out,
          fetchImpl,
          now: () => now,
        }),
      ).resolves.toBeUndefined();

      expect(written(out)).toBe(
        `  ↑ Brevo skill update available: brevo-cli (v0.0.1 → v${CLI_VERSION}). Run \`brevo skill update\`.\n`,
      );
      expect(markerOf(claudeDir('brevo-cli'))).toMatchObject({
        version: '0.0.1',
        source: 'brevo-cli',
      });
      expect(readCatalogCache()).toMatchObject({ fetchedAt: 0, attemptedAt: now });

      // The failed attempt counts: the next command does not wait on the network again.
      fetchImpl.mockClear();
      await skillService.autoRefreshOutdated({
        env: env(),
        argv: NOT_SKILL_ARGV,
        output: out,
        fetchImpl,
        now: () => now + 1000,
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('refreshes a stale bundled copy offline with BREVO_SKILL_AUTOREFRESH=1', async () => {
      await staleBundledInstall();
      const out = output();
      await skillService.autoRefreshOutdated({
        env: { ...env(), BREVO_SKILL_AUTOREFRESH: '1' },
        argv: NOT_SKILL_ARGV,
        output: out,
        fetchImpl,
        now: () => Date.now(),
      });
      expect(written(out)).toContain(`refreshed brevo-cli skill (v0.0.1 → v${CLI_VERSION})`);
      expect(markerOf(claudeDir('brevo-cli'))).toMatchObject({
        version: CLI_VERSION,
        source: 'brevo-cli',
      });
    });

    it('respects BREVO_NO_SKILL_AUTOREFRESH=1 even when stale', async () => {
      await skillService.install(['brevo'], { fetchImpl });
      fs.rmSync(getCatalogCachePath());
      fetchImpl.mockClear();
      const out = output();
      await skillService.autoRefreshOutdated({
        env: { ...env(), BREVO_NO_SKILL_AUTOREFRESH: '1' },
        argv: NOT_SKILL_ARGV,
        output: out,
        fetchImpl,
      });
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(out.write).not.toHaveBeenCalled();
    });

    it('prints one failure line and continues when a skill cannot be refreshed', async () => {
      await skillService.install(['brevo-cli'], { fetchImpl });
      const { catalog, skills } = newerRelease();
      const broken = skills.map((s) => (s.name === 'brevo' ? { ...s, sha256: 'c'.repeat(64) } : s));
      fetchImpl = makeFetch(releaseRoutes(makeCatalog(broken, { version: '0.2.0' }), broken));
      const out = output();
      await skillService.autoRefreshOutdated({
        env: { ...env(), BREVO_SKILL_AUTOREFRESH: '1' },
        argv: NOT_SKILL_ARGV,
        output: out,
        fetchImpl,
        now: () => Date.now() + 13 * 60 * 60 * 1000,
      });
      const text = written(out);
      expect(text).toContain('failed to refresh brevo skill');
      expect(text).toContain('refreshed brevo-cli skill');
      expect(markerOf(claudeDir('brevo')).version).toBe('1.0.0');
      void catalog;
    });

    it('does not throw if a refresh throws', async () => {
      await skillService.install(['brevo'], { fetchImpl });
      const { catalog, skills } = newerRelease();
      fetchImpl = makeFetch(releaseRoutes(catalog, skills));
      fs.chmodSync(claudeDir('brevo'), 0o500);
      const out = output();
      try {
        await expect(
          skillService.autoRefreshOutdated({
            env: { ...env(), BREVO_SKILL_AUTOREFRESH: '1' },
            argv: NOT_SKILL_ARGV,
            output: out,
            fetchImpl,
            now: () => Date.now() + 13 * 60 * 60 * 1000,
          }),
        ).resolves.toBeUndefined();
      } finally {
        fs.chmodSync(claudeDir('brevo'), 0o700);
      }
      expect(written(out)).toContain('failed to refresh brevo skill');
    });
  });

  describe('readSkillLock', () => {
    it('starts empty and ignores a corrupt or oddly shaped file', () => {
      expect(readSkillLock()).toEqual({ version: 1, directories: {} });
      fs.writeFileSync(getSkillLockPath(), '{bad');
      expect(readSkillLock()).toEqual({ version: 1, directories: {} });
      fs.writeFileSync(
        getSkillLockPath(),
        JSON.stringify({
          directories: {
            '/a': {
              agents: ['claude', 'cursor'],
              skills: { x: { version: '1.0.0', pin: 7 }, y: 3, z: {} },
            },
            '/b': null,
          },
        }),
      );
      expect(readSkillLock()).toEqual({
        version: 1,
        directories: {
          '/a': { agents: ['claude'], skills: { x: { version: '1.0.0', source: 'brevo-skills' } } },
        },
      });
    });
  });

  it('keeps a valid catalog cache readable by the installer', () => {
    writeCatalogCache({
      fetchedAt: 1,
      attemptedAt: 1,
      url: STUB_CATALOG_URL,
      catalog: validateCatalog(makeCatalog()),
    });
    expect(readCatalogCache()?.catalog?.skills).toHaveLength(3);
  });
});
