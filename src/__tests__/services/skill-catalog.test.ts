import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  CatalogFetchError,
  CatalogInvalidError,
  catalogUrl,
  fetchCatalog,
  fetchSkillFiles,
  getCatalogCachePath,
  hashFiles,
  isCatalogCacheStale,
  noteCatalogAttempt,
  readCatalogCache,
  skillFileUrl,
  validateCatalog,
  writeCatalogCache,
} from '../../services/skill-catalog';
import {
  LATEST_CATALOG_URL,
  RAW_FILES_URL,
  STUB_CATALOG_URL,
  STUB_FILES_URL,
  STUB_SKILLS,
  makeCatalog,
  makeFetch,
  pinnedCatalogUrl,
  releaseRoutes,
  skillEntry,
} from './skill-fixtures';

const SANDBOX_ROOT = path.join(__dirname, '__sandbox__');

describe('services/skill-catalog', () => {
  let configHome: string;

  beforeEach(() => {
    fs.mkdirSync(SANDBOX_ROOT, { recursive: true });
    configHome = fs.mkdtempSync(path.join(SANDBOX_ROOT, 'brevo-config-'));
    process.env.BREVO_CONFIG_HOME = configHome;
  });

  afterEach(() => {
    delete process.env.BREVO_CONFIG_HOME;
    delete process.env.BREVO_SKILLS_CATALOG_URL;
    delete process.env.BREVO_SKILLS_FILES_URL;
    fs.rmSync(configHome, { recursive: true, force: true });
  });

  describe('URLs', () => {
    it('addresses the latest release asset and a pinned one', () => {
      expect(catalogUrl()).toBe(LATEST_CATALOG_URL);
      expect(catalogUrl('0.2.0')).toBe(pinnedCatalogUrl('0.2.0'));
      expect(skillFileUrl('0.2.0', 'skills/brevo', 'SKILL.md')).toBe(
        `${RAW_FILES_URL}/v0.2.0/skills/brevo/SKILL.md`,
      );
    });

    it('honours BREVO_SKILLS_CATALOG_URL and BREVO_SKILLS_FILES_URL', () => {
      process.env.BREVO_SKILLS_CATALOG_URL = STUB_CATALOG_URL;
      process.env.BREVO_SKILLS_FILES_URL = `${STUB_FILES_URL}/`;
      expect(catalogUrl()).toBe(STUB_CATALOG_URL);
      expect(catalogUrl('0.1.0')).toBe(STUB_CATALOG_URL);
      expect(skillFileUrl('0.1.0', 'skills/brevo', 'SKILL.md')).toBe(
        `${STUB_FILES_URL}/v0.1.0/skills/brevo/SKILL.md`,
      );
    });

    it('caches under BREVO_CONFIG_HOME', () => {
      expect(getCatalogCachePath()).toBe(path.join(configHome, 'skills-catalog.json'));
    });
  });

  describe('hashFiles', () => {
    it('matches the brevo-skills contract: path\\0bytes\\0 in sorted path order', () => {
      // Computed by hand with the contract for these exact inputs.
      const files = [
        { path: 'b.md', bytes: Buffer.from('two') },
        { path: 'a.md', bytes: Buffer.from('one') },
      ];
      const expected = require('node:crypto')
        .createHash('sha256')
        .update('a.md\0one\0b.md\0two\0')
        .digest('hex');
      expect(hashFiles(files)).toBe(expected);
      expect(hashFiles([...files].reverse())).toBe(expected);
    });

    it('changes when a byte or a path changes', () => {
      const base = hashFiles([{ path: 'SKILL.md', bytes: Buffer.from('x') }]);
      expect(hashFiles([{ path: 'SKILL.md', bytes: Buffer.from('y') }])).not.toBe(base);
      expect(hashFiles([{ path: 'OTHER.md', bytes: Buffer.from('x') }])).not.toBe(base);
    });
  });

  describe('validateCatalog', () => {
    it('parses a valid catalog and normalises optional fields', () => {
      const catalog = validateCatalog(makeCatalog());
      expect(catalog.version).toBe('0.1.0');
      expect(catalog.mcp).toEqual({
        serverName: 'brevo',
        endpoints: {
          claude: 'https://mcp.brevo.example/claude',
          openai: 'https://mcp.brevo.example/openai',
          gemini: 'https://mcp.brevo.example/gemini',
        },
      });
      expect(catalog.skills.map((s) => s.name)).toEqual(['brevo', 'brevo-cli', 'email-test-send']);
      expect(catalog.skills[0]!.default).toBe(true);
      expect(catalog.skills[1]!.min_cli_version).toBe('0.1.0');
      expect(catalog.skills[1]!.files).toEqual(['SKILL.md', 'references/commands.md']);
    });

    it('tolerates a catalog without the mcp block', () => {
      const catalog = validateCatalog(makeCatalog(STUB_SKILLS, { mcp: undefined }));
      expect(catalog.mcp).toBeUndefined();
    });

    it('drops platforms this CLI does not know and non-https endpoints', () => {
      const raw = makeCatalog([{ ...STUB_SKILLS[0]!, platforms: ['claude', 'cursor'] }], {
        mcp: { serverName: 'brevo', endpoints: { claude: 'http://insecure', gemini: 42 } },
      });
      const catalog = validateCatalog(raw);
      expect(catalog.skills[0]!.platforms).toEqual(['claude']);
      expect(catalog.mcp).toEqual({ serverName: 'brevo', endpoints: {} });
    });

    it.each([
      ['not an object', 'nope', /not a JSON object/],
      ['no skills', { version: '0.1.0' }, /skills is missing/],
      ['bad version', { version: 'x', skills: [] }, /version is missing/],
      ['bad hash', makeCatalog([{ ...STUB_SKILLS[0]!, sha256: 'abc' }]), /sha256/],
      [
        'no files',
        { version: '0.1.0', skills: [{ ...skillEntry(STUB_SKILLS[0]!), files: [] }] },
        /files is missing or empty/,
      ],
      [
        'path escape',
        { version: '0.1.0', skills: [{ ...skillEntry(STUB_SKILLS[0]!), files: ['../x.md'] }] },
        /not a relative path/,
      ],
      [
        'absolute path',
        { version: '0.1.0', skills: [{ ...skillEntry(STUB_SKILLS[0]!), path: '/etc' }] },
        /path is missing or not a relative path/,
      ],
      [
        'bad name',
        { version: '0.1.0', skills: [{ ...skillEntry(STUB_SKILLS[0]!), name: 'Bad Name' }] },
        /name is missing/,
      ],
      [
        'bad skill version',
        { version: '0.1.0', skills: [{ ...skillEntry(STUB_SKILLS[0]!), version: '1' }] },
        /version is missing or not semver/,
      ],
      [
        'no platforms',
        { version: '0.1.0', skills: [{ ...skillEntry(STUB_SKILLS[0]!), platforms: 'claude' }] },
        /platforms is missing/,
      ],
      [
        'bad min_cli_version',
        { version: '0.1.0', skills: [{ ...skillEntry(STUB_SKILLS[0]!), min_cli_version: 'new' }] },
        /min_cli_version is not semver/,
      ],
      ['skill not an object', { version: '0.1.0', skills: [1] }, /skills\[0\] is not an object/],
      [
        'duplicate',
        { version: '0.1.0', skills: [skillEntry(STUB_SKILLS[0]!), skillEntry(STUB_SKILLS[0]!)] },
        /listed twice/,
      ],
    ])('rejects a malformed catalog: %s', (_label, raw, message) => {
      expect(() => validateCatalog(raw)).toThrow(CatalogInvalidError);
      expect(() => validateCatalog(raw)).toThrow(message);
    });
  });

  describe('cache', () => {
    it('round-trips with timestamps and reports staleness', () => {
      const catalog = validateCatalog(makeCatalog());
      writeCatalogCache({ fetchedAt: 1000, attemptedAt: 1000, url: STUB_CATALOG_URL, catalog });
      const cache = readCatalogCache();
      expect(cache?.catalog?.version).toBe('0.1.0');
      expect(cache?.fetchedAt).toBe(1000);
      expect(isCatalogCacheStale(cache, 1000 + 60_000)).toBe(false);
      expect(isCatalogCacheStale(cache, 1000 + 13 * 60 * 60 * 1000)).toBe(true);
      expect(isCatalogCacheStale(undefined)).toBe(true);
    });

    it('returns no cache for a missing or malformed file', () => {
      expect(readCatalogCache()).toBeUndefined();
      fs.writeFileSync(getCatalogCachePath(), '{not json');
      expect(readCatalogCache()).toBeUndefined();
      fs.writeFileSync(getCatalogCachePath(), JSON.stringify({ fetchedAt: 'x', url: 'u' }));
      expect(readCatalogCache()).toBeUndefined();
    });

    it('keeps the timestamps when the cached catalog no longer validates', () => {
      fs.writeFileSync(
        getCatalogCachePath(),
        JSON.stringify({ fetchedAt: 5, url: 'u', catalog: { version: 'bad' } }),
      );
      const cache = readCatalogCache();
      expect(cache).toMatchObject({ fetchedAt: 5, attemptedAt: 5, url: 'u' });
      expect(cache?.catalog).toBeUndefined();
    });

    it('records a failed attempt without losing the cached catalog', () => {
      const catalog = validateCatalog(makeCatalog());
      writeCatalogCache({ fetchedAt: 1000, attemptedAt: 1000, url: STUB_CATALOG_URL, catalog });
      noteCatalogAttempt(STUB_CATALOG_URL, 5000);
      const cache = readCatalogCache();
      expect(cache).toMatchObject({ fetchedAt: 1000, attemptedAt: 5000 });
      expect(cache?.catalog?.version).toBe('0.1.0');
      expect(isCatalogCacheStale(cache, 5000 + 60_000)).toBe(false);
    });

    it('records a first failed attempt with no catalog at all', () => {
      noteCatalogAttempt(STUB_CATALOG_URL, 7000);
      expect(readCatalogCache()).toMatchObject({ fetchedAt: 0, attemptedAt: 7000 });
    });

    it('swallows an unwritable cache directory', () => {
      process.env.BREVO_CONFIG_HOME = path.join(configHome, 'file-not-dir');
      fs.writeFileSync(process.env.BREVO_CONFIG_HOME, 'x');
      expect(() =>
        writeCatalogCache({ fetchedAt: 1, attemptedAt: 1, url: 'u', catalog: undefined }),
      ).not.toThrow();
    });
  });

  describe('fetchCatalog', () => {
    it('fetches, validates and caches the latest catalog with the fetch time', async () => {
      const fetchImpl = makeFetch(releaseRoutes(makeCatalog()));
      const catalog = await fetchCatalog(undefined, { fetchImpl, now: () => 4242 });
      expect(catalog.version).toBe('0.1.0');
      expect(fetchImpl).toHaveBeenCalledWith(LATEST_CATALOG_URL, expect.anything());
      expect(readCatalogCache()).toMatchObject({ fetchedAt: 4242, url: LATEST_CATALOG_URL });
    });

    it('fetches a pinned release without touching the cache', async () => {
      const fetchImpl = makeFetch(releaseRoutes(makeCatalog()));
      const catalog = await fetchCatalog('0.1.0', { fetchImpl });
      expect(catalog.version).toBe('0.1.0');
      expect(fetchImpl).toHaveBeenCalledWith(pinnedCatalogUrl('0.1.0'), expect.anything());
      expect(readCatalogCache()).toBeUndefined();
    });

    it('rejects a pinned release that serves another version', async () => {
      const fetchImpl = makeFetch({ [pinnedCatalogUrl('0.0.9')]: JSON.stringify(makeCatalog()) });
      await expect(fetchCatalog('0.0.9', { fetchImpl })).rejects.toThrow(
        /release 0.0.9 served catalog 0.1.0/,
      );
    });

    it('uses the URL override', async () => {
      process.env.BREVO_SKILLS_CATALOG_URL = STUB_CATALOG_URL;
      const fetchImpl = makeFetch(releaseRoutes(makeCatalog()));
      await fetchCatalog(undefined, { fetchImpl });
      expect(fetchImpl).toHaveBeenCalledWith(STUB_CATALOG_URL, expect.anything());
    });

    it('throws CatalogFetchError on a non-2xx, a network error, and a timeout', async () => {
      await expect(
        fetchCatalog(undefined, {
          fetchImpl: makeFetch({ [LATEST_CATALOG_URL]: { status: 500 } }),
        }),
      ).rejects.toThrow(/HTTP 500/);

      const err = await fetchCatalog(undefined, {
        fetchImpl: makeFetch({ [LATEST_CATALOG_URL]: new Error('ECONNREFUSED') }),
      }).catch((e) => e);
      expect(err).toBeInstanceOf(CatalogFetchError);
      expect(err.url).toBe(LATEST_CATALOG_URL);
      expect(err.reason).toBe('ECONNREFUSED');

      await expect(
        fetchCatalog(undefined, {
          fetchImpl: makeFetch({ [LATEST_CATALOG_URL]: 'hang' }),
          timeoutMs: 10,
        }),
      ).rejects.toThrow(/timed out/);
      expect(readCatalogCache()).toBeUndefined();
    });

    it('throws CatalogInvalidError for a body that is not JSON or not a catalog', async () => {
      await expect(
        fetchCatalog(undefined, { fetchImpl: makeFetch({ [LATEST_CATALOG_URL]: '<html>' }) }),
      ).rejects.toThrow(/not JSON/);
      await expect(
        fetchCatalog(undefined, {
          fetchImpl: makeFetch({ [LATEST_CATALOG_URL]: '{"version":"0.1.0"}' }),
        }),
      ).rejects.toThrow(CatalogInvalidError);
    });
  });

  describe('fetchSkillFiles', () => {
    it('downloads every file of a skill at the release tag', async () => {
      const catalog = validateCatalog(makeCatalog());
      const fetchImpl = makeFetch(releaseRoutes(makeCatalog()));
      const files = await fetchSkillFiles(catalog.skills[1]!, '0.1.0', { fetchImpl });
      expect(files.map((f) => f.path)).toEqual(['SKILL.md', 'references/commands.md']);
      expect(files[0]!.bytes.toString()).toBe('# brevo-cli v1.1.0\n');
      expect(hashFiles(files)).toBe(catalog.skills[1]!.sha256);
    });

    it('fails on the first missing file', async () => {
      const catalog = validateCatalog(makeCatalog());
      const fetchImpl = makeFetch({});
      await expect(fetchSkillFiles(catalog.skills[0]!, '0.1.0', { fetchImpl })).rejects.toThrow(
        /HTTP 404/,
      );
    });
  });
});
