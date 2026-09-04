import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Set a temp config dir BEFORE importing config module. mkdtempSync uses
// crypto-quality randomness from libuv (avoids Math.random's Sonar hotspot).
const TEST_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'brevo-test-'));
process.env.BREVO_CONFIG_HOME = TEST_CONFIG_DIR;

import {
  getApiKey,
  getEmail,
  saveCredentials,
  clearCredentials,
  isAuthenticated,
  saveAppCredentials,
  getAppCredentials,
  getCredentialsPath,
  readProjectConfig,
  writeProjectConfig,
  backfillProjectConfigFromServer,
  hasLegacyProjectConfigKeys,
  migrateProjectConfigKeys,
  hasLocalApp,
  findEnclosingProjectDir,
} from '../../lib/config';

function writeRawCredentials(data: object): void {
  fs.mkdirSync(TEST_CONFIG_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(TEST_CONFIG_DIR, 'credentials.json'), JSON.stringify(data, null, 2), {
    mode: 0o600,
  });
}

describe('config', () => {
  beforeEach(() => {
    // Clean up test config dir
    if (fs.existsSync(TEST_CONFIG_DIR)) {
      fs.rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(TEST_CONFIG_DIR)) {
      fs.rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
    }
    delete process.env.BREVO_CONFIG_HOME;
  });

  describe('credentials', () => {
    it('should return undefined for apiKey when no credentials exist', () => {
      expect(getApiKey()).toBeUndefined();
    });

    it('should return undefined for email when no credentials exist', () => {
      expect(getEmail()).toBeUndefined();
    });

    it('should not be authenticated initially', () => {
      expect(isAuthenticated()).toBe(false);
    });

    it('should save and retrieve credentials', () => {
      saveCredentials('xkeysib-test-key', {
        email: 'test@example.com',
        organizationId: 'org-test',
        userId: 100,
      });
      expect(getApiKey()).toBe('xkeysib-test-key');
      expect(getEmail()).toBe('test@example.com');
      expect(isAuthenticated()).toBe(true);
    });

    it('should clear credentials', () => {
      saveCredentials('xkeysib-test-key', {
        email: 'test@example.com',
        organizationId: 'org-test',
        userId: 100,
      });
      expect(isAuthenticated()).toBe(true);

      clearCredentials();
      expect(getApiKey()).toBeUndefined();
      expect(isAuthenticated()).toBe(false);
    });

    it('should set file permissions to 0o600', () => {
      saveCredentials('xkeysib-test-key', {
        email: 'test@example.com',
        organizationId: 'org-test',
        userId: 100,
      });
      const credPath = getCredentialsPath();
      const stats = fs.statSync(credPath);
      // Check owner read/write permissions (0o600)
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o600);
    });

    it('migrates legacy top-level apiKey into auth union on read', () => {
      // Write the legacy shape directly
      fs.mkdirSync(TEST_CONFIG_DIR, { recursive: true, mode: 0o700 });
      fs.writeFileSync(
        path.join(TEST_CONFIG_DIR, 'credentials.json'),
        JSON.stringify({
          apiKey: 'xkeysib-legacy',
          accountEmail: 'legacy@example.com',
          organizationId: 'org-L',
          userId: 7,
          apps: {},
        }),
      );

      // Reading via public API should surface the key and return authenticated
      expect(getApiKey()).toBe('xkeysib-legacy');
      expect(isAuthenticated()).toBe(true);

      // And the file should have been rewritten with the new shape
      const raw = JSON.parse(
        fs.readFileSync(path.join(TEST_CONFIG_DIR, 'credentials.json'), 'utf-8'),
      );
      expect(raw.auth).toEqual({ kind: 'api-key', apiKey: 'xkeysib-legacy' });
      expect(raw.apiKey).toBeUndefined();
    });

    it('saves and reads OAuth credentials', () => {
      const { saveOauthCredentials, getAccessToken } = require('../../lib/config');
      saveOauthCredentials(
        {
          accessToken: 'at-1',
          refreshToken: 'rt-1',
          expiresIn: 3600,
          tokenType: 'Bearer',
          scope: 'all',
        },
        { email: 'oauth@example.com', organizationId: 'org-O', userId: 99 },
      );
      expect(getAccessToken()).toBe('at-1');
      expect(getApiKey()).toBeUndefined();
      expect(getEmail()).toBe('oauth@example.com');
      expect(isAuthenticated()).toBe(true);
    });

    it.each([
      ['empty accessToken', { accessToken: '', refreshToken: 'rt', tokenType: 'Bearer' }],
      ['empty refreshToken', { accessToken: 'at', refreshToken: '', tokenType: 'Bearer' }],
      ['empty tokenType', { accessToken: 'at', refreshToken: 'rt', tokenType: '' }],
      [
        'NaN expiresAt',
        { accessToken: 'at', refreshToken: 'rt', tokenType: 'Bearer', expiresAt: Number.NaN },
      ],
      [
        'Infinity expiresAt',
        { accessToken: 'at', refreshToken: 'rt', tokenType: 'Bearer', expiresAt: Infinity },
      ],
    ])('rejects corrupted OAuth credential: %s', (_label, partial) => {
      fs.mkdirSync(TEST_CONFIG_DIR, { recursive: true, mode: 0o700 });
      fs.writeFileSync(
        path.join(TEST_CONFIG_DIR, 'credentials.json'),
        JSON.stringify({
          auth: { kind: 'oauth', expiresAt: 1, ...(partial as Record<string, unknown>) },
          apps: {},
        }),
      );

      const { getAccessToken, getApiKey } = require('../../lib/config');
      expect(getAccessToken()).toBeUndefined();
      expect(getApiKey()).toBeUndefined();
      expect(isAuthenticated()).toBe(false);
    });

    it('saveOauthCredentials without account clears stale account fields', () => {
      const { saveOauthCredentials, getAccessToken } = require('../../lib/config');
      // First, write tokens AND account info from a previous login
      saveOauthCredentials(
        { accessToken: 'at-old', refreshToken: 'rt-old', expiresIn: 3600, tokenType: 'Bearer' },
        { email: 'old@example.com', organizationId: 'org-old', userId: 1 },
      );
      expect(getEmail()).toBe('old@example.com');

      // Re-save with new tokens but NO account — simulates browser auth before
      // /v3/account validation. Stale email/org/userId must be cleared.
      saveOauthCredentials({
        accessToken: 'at-new',
        refreshToken: 'rt-new',
        expiresIn: 3600,
        tokenType: 'Bearer',
      });
      expect(getAccessToken()).toBe('at-new');
      expect(getEmail()).toBeUndefined();
    });

    it('clearCredentials removes OAuth auth block', () => {
      const { saveOauthCredentials } = require('../../lib/config');
      saveOauthCredentials(
        { accessToken: 'at-1', refreshToken: 'rt-1', expiresIn: 3600, tokenType: 'Bearer' },
        { email: 'oauth@example.com', organizationId: 'org-O', userId: 99 },
      );
      expect(isAuthenticated()).toBe(true);

      clearCredentials();
      expect(isAuthenticated()).toBe(false);
      const { getAccessToken } = require('../../lib/config');
      expect(getAccessToken()).toBeUndefined();
    });
  });

  describe('app credentials', () => {
    it('should return undefined for non-existent app', () => {
      expect(getAppCredentials('999')).toBeUndefined();
    });

    it('should save and retrieve app credentials by numeric-string ID', () => {
      const cred = {
        clientId: 'client-123',
        clientSecret: 'secret-456',
      };
      saveAppCredentials('1', cred);

      const result = getAppCredentials('1');
      expect(result).toEqual(cred);
    });

    it('should save and retrieve app credentials by UUID', () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      const cred = {
        clientId: 'client-uuid',
        clientSecret: 'secret-uuid',
      };
      saveAppCredentials(uuid, cred);

      const result = getAppCredentials(uuid);
      expect(result).toEqual(cred);
    });

    it('deleteAppCredentials removes only the targeted app', () => {
      const { deleteAppCredentials } = require('../../lib/config');
      saveAppCredentials('1', { clientId: 'c1', clientSecret: 's1' });
      saveAppCredentials('2', { clientId: 'c2', clientSecret: 's2' });

      deleteAppCredentials('1');

      expect(getAppCredentials('1')).toBeUndefined();
      expect(getAppCredentials('2')).toEqual({ clientId: 'c2', clientSecret: 's2' });
    });

    it('deleteAppCredentials is a no-op for unknown appId', () => {
      const { deleteAppCredentials } = require('../../lib/config');
      saveAppCredentials('1', { clientId: 'c1', clientSecret: 's1' });

      expect(() => deleteAppCredentials('does-not-exist')).not.toThrow();
      expect(getAppCredentials('1')).toEqual({ clientId: 'c1', clientSecret: 's1' });
    });

    it('clearAppsCache wipes apps and appNames but preserves auth/account', () => {
      const { clearAppsCache, saveAppName, getAppNames } = require('../../lib/config');
      saveCredentials('xkeysib-keep', {
        email: 'keep@example.com',
        organizationId: 'org-keep',
        userId: 42,
      });
      saveAppCredentials('1', { clientId: 'c1', clientSecret: 's1' });
      saveAppCredentials('2', { clientId: 'c2', clientSecret: 's2' });
      saveAppName('1', 'My App');

      clearAppsCache();

      // Auth + account untouched
      expect(getApiKey()).toBe('xkeysib-keep');
      expect(getEmail()).toBe('keep@example.com');
      expect(isAuthenticated()).toBe(true);

      // App credentials and names wiped
      expect(getAppCredentials('1')).toBeUndefined();
      expect(getAppCredentials('2')).toBeUndefined();
      expect(getAppNames()).toEqual({});
    });
  });

  describe('credentials migration', () => {
    it('should migrate old multi-profile format with activeProfile', () => {
      writeRawCredentials({
        profiles: {
          default: { apiKey: 'key-1', accountEmail: 'a@b.com' },
          other: { apiKey: 'key-2', accountEmail: 'c@d.com' },
        },
        activeProfile: 'default',
        apps: { '1': { clientId: 'c1', clientSecret: 's1' } },
      });

      expect(getApiKey()).toBe('key-1');
      expect(getEmail()).toBe('a@b.com');
      expect(getAppCredentials('1')).toEqual({ clientId: 'c1', clientSecret: 's1' });

      // Verify file was rewritten in flat format
      const raw = JSON.parse(fs.readFileSync(getCredentialsPath(), 'utf-8'));
      expect(raw.profiles).toBeUndefined();
      expect(raw.auth).toEqual({ kind: 'api-key', apiKey: 'key-1' });
      expect(raw.apiKey).toBeUndefined();
    });

    it('should migrate when activeProfile is missing by falling back to default', () => {
      writeRawCredentials({
        profiles: {
          default: { apiKey: 'key-default', accountEmail: 'default@test.com' },
        },
      });

      expect(getApiKey()).toBe('key-default');
      expect(getEmail()).toBe('default@test.com');
    });

    it('should migrate using first profile key when activeProfile and default are missing', () => {
      writeRawCredentials({
        profiles: {
          custom: { apiKey: 'key-custom', accountEmail: 'custom@test.com' },
        },
      });

      expect(getApiKey()).toBe('key-custom');
      expect(getEmail()).toBe('custom@test.com');
    });

    it('should strip redirectUris from app credentials during migration', () => {
      writeRawCredentials({
        profiles: { default: { apiKey: 'key-1', accountEmail: 'a@b.com' } },
        activeProfile: 'default',
        apps: {
          '1': {
            clientId: 'c1',
            clientSecret: 's1',
            redirectUris: ['http://localhost:3000'],
          },
        },
      });

      const app = getAppCredentials('1');
      expect(app).toEqual({ clientId: 'c1', clientSecret: 's1' });
      expect((app as unknown as Record<string, unknown>)?.redirectUris).toBeUndefined();
    });

    it('should strip redirectUris from app credentials on normal read', () => {
      writeRawCredentials({
        apiKey: 'key-1',
        accountEmail: 'a@b.com',
        apps: {
          '1': {
            clientId: 'c1',
            clientSecret: 's1',
            redirectUris: ['http://localhost:3000'],
          },
        },
      });

      const app = getAppCredentials('1');
      expect(app).toEqual({ clientId: 'c1', clientSecret: 's1' });
    });

    it('should preserve apps when profiles have no apps field', () => {
      writeRawCredentials({
        profiles: { default: { apiKey: 'key-1', accountEmail: 'a@b.com' } },
        activeProfile: 'default',
      });

      expect(getApiKey()).toBe('key-1');
      expect(getAppCredentials('999')).toBeUndefined();
    });
  });

  describe('readProjectConfig', () => {
    it('should return null when no app-config.json exists', () => {
      expect(readProjectConfig()).toBeNull();
    });

    describe('scope normalization', () => {
      const originalCwd = process.cwd();
      let projectDir: string;

      beforeEach(() => {
        projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brevo-project-'));
        process.chdir(projectDir);
      });

      afterEach(() => {
        process.chdir(originalCwd);
        if (fs.existsSync(projectDir)) {
          fs.rmSync(projectDir, { recursive: true, force: true });
        }
      });

      function writeConfig(config: object): void {
        fs.writeFileSync(path.join(projectDir, 'app-config.json'), JSON.stringify(config));
      }

      it('splits a comma-embedded scope entry into individual tokens', () => {
        writeConfig({
          app_id: '42',
          auth: { scopes: ['crm:read', 'crm:write, campaigns:read'] },
        });
        const cfg = readProjectConfig();
        expect(cfg?.auth?.scopes).toEqual(['crm:read', 'crm:write', 'campaigns:read']);
      });

      // `auth.scopes` is typed as string[], but a user editing app-config.json by
      // hand can leave a bare string there. `splitScopes` has always handled that
      // shape; the call site used to gate on Array.isArray and drop it, so the
      // string reached the upload validator and was iterated character by
      // character ("Invalid scope: \":\"").
      it('splits a bare comma-separated scope string into individual tokens', () => {
        writeConfig({
          app_id: '42',
          auth: { scopes: 'crm:read, campaigns:read' },
        });
        const cfg = readProjectConfig();
        expect(cfg?.auth?.scopes).toEqual(['crm:read', 'campaigns:read']);
      });

      it('leaves well-formed scope arrays untouched', () => {
        writeConfig({
          app_id: '42',
          auth: { scopes: ['crm:read', 'crm:write'] },
        });
        const cfg = readProjectConfig();
        expect(cfg?.auth?.scopes).toEqual(['crm:read', 'crm:write']);
      });

      it('deduplicates scopes', () => {
        writeConfig({
          app_id: '42',
          auth: { scopes: ['crm:read', 'crm:read', 'crm:write'] },
        });
        const cfg = readProjectConfig();
        expect(cfg?.auth?.scopes).toEqual(['crm:read', 'crm:write']);
      });

      it('does not throw on malformed scope chars (charset is enforced later, at update time)', () => {
        writeConfig({
          app_id: '42',
          auth: { scopes: ['crm;read'] },
        });
        expect(() => readProjectConfig()).not.toThrow();
      });
    });

    describe('version field', () => {
      const originalCwd = process.cwd();
      let projectDir: string;

      beforeEach(() => {
        projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brevo-project-'));
        process.chdir(projectDir);
      });

      afterEach(() => {
        process.chdir(originalCwd);
        if (fs.existsSync(projectDir)) {
          fs.rmSync(projectDir, { recursive: true, force: true });
        }
      });

      function writeConfig(config: object): void {
        fs.writeFileSync(path.join(projectDir, 'app-config.json'), JSON.stringify(config));
      }

      it('round-trips the version field when present', () => {
        writeConfig({
          app_id: '42',
          version: '0.0.1',
          auth: { scopes: ['crm:read'] },
        });
        const cfg = readProjectConfig();
        expect(cfg?.version).toBe('0.0.1');
      });

      it('leaves version undefined for a legacy config that predates the field', () => {
        writeConfig({
          app_id: '42',
          auth: { scopes: ['crm:read'] },
        });
        const cfg = readProjectConfig();
        expect(cfg?.version).toBeUndefined();
      });
    });

    describe('distribution_type backward compatibility', () => {
      // distribution_type has moved twice: originally a top-level `distribution`
      // key (still the shape of every currently-published scaffold), briefly
      // `auth.type` (an interim design that never shipped), now a top-level
      // `distribution_type` key.
      const originalCwd = process.cwd();
      let projectDir: string;

      beforeEach(() => {
        projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brevo-project-'));
        process.chdir(projectDir);
      });

      afterEach(() => {
        process.chdir(originalCwd);
        if (fs.existsSync(projectDir)) {
          fs.rmSync(projectDir, { recursive: true, force: true });
        }
      });

      function writeConfig(config: object): void {
        fs.writeFileSync(path.join(projectDir, 'app-config.json'), JSON.stringify(config));
      }

      it('backfills distribution_type from the oldest legacy top-level distribution key', () => {
        writeConfig({
          app_id: '42',
          auth: { scopes: ['crm:read'], redirect_uris: [] },
          distribution: 'public',
        });
        const cfg = readProjectConfig();
        expect(cfg?.distribution_type).toBe('public');
      });

      it('backfills distribution_type from the interim auth.type key', () => {
        writeConfig({
          app_id: '42',
          auth: { type: 'public', scopes: ['crm:read'] },
        });
        const cfg = readProjectConfig();
        expect(cfg?.distribution_type).toBe('public');
      });

      it('prefers top-level distribution_type over both legacy shapes when all are present', () => {
        writeConfig({
          app_id: '42',
          distribution_type: 'public',
          auth: { type: 'private', scopes: ['crm:read'] },
          distribution: 'private',
        });
        const cfg = readProjectConfig();
        expect(cfg?.distribution_type).toBe('public');
      });

      it('prefers the interim auth.type over the oldest legacy distribution key', () => {
        writeConfig({
          app_id: '42',
          auth: { type: 'public', scopes: ['crm:read'] },
          distribution: 'private',
        });
        const cfg = readProjectConfig();
        expect(cfg?.distribution_type).toBe('public');
      });

      it('defaults distribution_type to private when no shape is present', () => {
        writeConfig({
          app_id: '42',
          auth: { scopes: ['crm:read'] },
        });
        const cfg = readProjectConfig();
        expect(cfg?.distribution_type).toBe('private');
      });

      it('reads a new-format config with a top-level distribution_type directly', () => {
        writeConfig({
          app_id: '42',
          distribution_type: 'private',
          auth: { scopes: ['crm:read'] },
        });
        const cfg = readProjectConfig();
        expect(cfg?.distribution_type).toBe('private');
      });

      it('does not carry the legacy distribution key forward in the returned config', () => {
        writeConfig({
          app_id: '42',
          auth: { scopes: ['crm:read'] },
          distribution: 'public',
        });
        const cfg = readProjectConfig();
        expect(cfg).not.toHaveProperty('distribution');
      });

      // `auth.type: "none"` was the dev-era UI-app auth marker. It is dropped
      // on read (a UI app's auth is now the empty object) but must never be
      // misread as a distribution value.
      it('drops auth.type none and does not treat it as a distribution', () => {
        writeConfig({
          app_id: '42',
          auth: { type: 'none' },
          ui_app: { extension_type: 'actionLink' },
        });
        const cfg = readProjectConfig();
        expect(cfg?.auth).toEqual({});
        expect(cfg?.distribution_type).toBe('private');
      });

      // permittedUrls/support were scaffolded into every config but never read;
      // the read path drops them so the next write migrates old files.
      it('drops the removed permittedUrls and support sections', () => {
        writeConfig({
          app_id: '42',
          auth: { scopes: ['crm:read'] },
          permittedUrls: { fetch: [], img: [], iframe: [], js: [], css: [] },
          support: { supportEmail: 'user@example.com' },
        });
        const cfg = readProjectConfig();
        expect(cfg).not.toHaveProperty('permittedUrls');
        expect(cfg).not.toHaveProperty('support');
      });

      // auth.redirectUrls → auth.redirectUris (renamed to track the wire key
      // redirect_uris). The legacy key is read when the new one is absent and
      // dropped from the returned config, so any write-back migrates the file.
      it('reads redirect URLs from the legacy auth.redirectUrls key', () => {
        writeConfig({
          app_id: '42',
          distribution_type: 'private',
          auth: { scopes: ['crm:read'], redirectUrls: ['https://example.com/cb'] },
        });
        const cfg = readProjectConfig();
        expect(cfg?.auth.redirect_uris).toEqual(['https://example.com/cb']);
        expect(cfg?.auth).not.toHaveProperty('redirectUrls');
      });

      it('prefers the newer legacy auth.redirectUris over auth.redirectUrls when both are present', () => {
        writeConfig({
          app_id: '42',
          distribution_type: 'private',
          auth: {
            scopes: ['crm:read'],
            redirectUris: ['https://new.example.com/cb'],
            redirectUrls: ['https://old.example.com/cb'],
          },
        });
        const cfg = readProjectConfig();
        expect(cfg?.auth.redirect_uris).toEqual(['https://new.example.com/cb']);
        expect(cfg?.auth).not.toHaveProperty('redirectUrls');
      });

      it('migrates the legacy redirect key on write-back (writeProjectConfig round-trip)', () => {
        writeConfig({
          app_id: '42',
          distribution_type: 'private',
          auth: { scopes: ['crm:read'], redirectUrls: ['https://example.com/cb'] },
        });
        const cfg = readProjectConfig();
        expect(cfg).not.toBeNull();
        writeProjectConfig(cfg as NonNullable<typeof cfg>);
        const onDisk = JSON.parse(
          fs.readFileSync(path.join(projectDir, 'app-config.json'), 'utf-8'),
        );
        expect(onDisk.auth.redirect_uris).toEqual(['https://example.com/cb']);
        expect(onDisk.auth).not.toHaveProperty('redirectUrls');
      });

      it('does not carry the interim auth.type key forward in the returned config', () => {
        writeConfig({
          app_id: '42',
          auth: { type: 'public', scopes: ['crm:read'] },
        });
        const cfg = readProjectConfig();
        expect(cfg?.auth).not.toHaveProperty('type');
      });

      it('migrates the oldest legacy config to the new shape on the next write', () => {
        writeConfig({
          app_id: '42',
          auth: { scopes: ['crm:read'] },
          distribution: 'public',
        });
        const cfg = readProjectConfig();
        writeProjectConfig(cfg!);
        const onDisk = JSON.parse(
          fs.readFileSync(path.join(projectDir, 'app-config.json'), 'utf-8'),
        );
        expect(onDisk).not.toHaveProperty('distribution');
        expect(onDisk.auth).not.toHaveProperty('type');
        expect(onDisk.distribution_type).toBe('public');
      });

      it('migrates an interim auth.type config to the new shape on the next write', () => {
        writeConfig({
          app_id: '42',
          auth: { type: 'public', scopes: ['crm:read'] },
        });
        const cfg = readProjectConfig();
        writeProjectConfig(cfg!);
        const onDisk = JSON.parse(
          fs.readFileSync(path.join(projectDir, 'app-config.json'), 'utf-8'),
        );
        expect(onDisk.auth).not.toHaveProperty('type');
        expect(onDisk.distribution_type).toBe('public');
      });
    });
  });

  describe('backfillProjectConfigFromServer', () => {
    const originalCwd = process.cwd();
    let projectDir: string;

    beforeEach(() => {
      projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brevo-project-'));
      process.chdir(projectDir);
    });

    afterEach(() => {
      process.chdir(originalCwd);
      if (fs.existsSync(projectDir)) {
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
    });

    function writeConfig(config: object): void {
      fs.writeFileSync(path.join(projectDir, 'app-config.json'), JSON.stringify(config));
    }

    function readOnDisk(): Record<string, unknown> {
      return JSON.parse(fs.readFileSync(path.join(projectDir, 'app-config.json'), 'utf-8'));
    }

    it('backfills a missing version from the server value', () => {
      writeConfig({ app_id: '42', distribution_type: 'private', auth: { scopes: [] } });
      const changed = backfillProjectConfigFromServer('42', { version: '1.4.0' });
      expect(changed).toEqual(['version']);
      expect(readOnDisk().version).toBe('1.4.0');
    });

    it('backfills a missing distribution_type from the server value', () => {
      writeConfig({ app_id: '42', version: '1.0.0', auth: { scopes: [] } });
      const changed = backfillProjectConfigFromServer('42', { distribution_type: 'public' });
      expect(changed).toEqual(['distribution_type']);
      expect(readOnDisk().distribution_type).toBe('public');
    });

    it('backfills both missing fields at once', () => {
      writeConfig({ app_id: '42', auth: { scopes: [] } });
      const changed = backfillProjectConfigFromServer('42', {
        version: '2.0.0',
        distribution_type: 'public',
      });
      expect(changed).toEqual(['version', 'distribution_type']);
      const onDisk = readOnDisk();
      expect(onDisk.version).toBe('2.0.0');
      expect(onDisk.distribution_type).toBe('public');
    });

    it('defaults distribution_type to private when both file and server lack it', () => {
      writeConfig({ app_id: '42', version: '1.0.0', auth: { scopes: [] } });
      const changed = backfillProjectConfigFromServer('42', {});
      expect(changed).toEqual(['distribution_type']);
      expect(readOnDisk().distribution_type).toBe('private');
    });

    it('does not overwrite an existing version (fill only when missing)', () => {
      writeConfig({
        app_id: '42',
        version: '1.2.0',
        distribution_type: 'private',
        auth: { scopes: [] },
      });
      const changed = backfillProjectConfigFromServer('42', { version: '1.5.0' });
      expect(changed).toEqual([]);
      expect(readOnDisk().version).toBe('1.2.0');
    });

    it('does not overwrite an existing distribution_type (fill only when missing)', () => {
      writeConfig({
        app_id: '42',
        version: '1.0.0',
        distribution_type: 'private',
        auth: { scopes: [] },
      });
      const changed = backfillProjectConfigFromServer('42', { distribution_type: 'public' });
      expect(changed).toEqual([]);
      expect(readOnDisk().distribution_type).toBe('private');
    });

    it('treats a legacy distribution key as present and preserves its value, migrating shape only when another field triggers a write', () => {
      writeConfig({ app_id: '42', distribution: 'public', auth: { scopes: [] } });
      // version is missing → a write is triggered; server says the app is
      // private, but the legacy local value must win (never overwritten).
      const changed = backfillProjectConfigFromServer('42', {
        version: '1.0.0',
        distribution_type: 'private',
      });
      expect(changed).toEqual(['version']);
      const onDisk = readOnDisk();
      expect(onDisk).not.toHaveProperty('distribution');
      expect(onDisk.distribution_type).toBe('public');
      expect(onDisk.version).toBe('1.0.0');
    });

    it('does not backfill version when the server has none', () => {
      writeConfig({ app_id: '42', distribution_type: 'private', auth: { scopes: [] } });
      const changed = backfillProjectConfigFromServer('42', {});
      expect(changed).toEqual([]);
      expect(readOnDisk()).not.toHaveProperty('version');
    });

    it('returns [] and writes nothing when the appId does not match', () => {
      writeConfig({ app_id: '42', auth: { scopes: [] } });
      const before = fs.readFileSync(path.join(projectDir, 'app-config.json'), 'utf-8');
      const changed = backfillProjectConfigFromServer('99', {
        version: '1.0.0',
        distribution_type: 'public',
      });
      expect(changed).toEqual([]);
      expect(fs.readFileSync(path.join(projectDir, 'app-config.json'), 'utf-8')).toBe(before);
    });

    it('returns [] when no app-config.json exists', () => {
      const changed = backfillProjectConfigFromServer('42', {
        version: '1.0.0',
        distribution_type: 'public',
      });
      expect(changed).toEqual([]);
      expect(fs.existsSync(path.join(projectDir, 'app-config.json'))).toBe(false);
    });

    it('returns [] and leaves the file untouched when nothing is missing', () => {
      writeConfig({
        app_id: '42',
        version: '1.0.0',
        distribution_type: 'public',
        auth: { scopes: [] },
      });
      const before = fs.readFileSync(path.join(projectDir, 'app-config.json'), 'utf-8');
      const changed = backfillProjectConfigFromServer('42', {
        version: '9.9.9',
        distribution_type: 'private',
      });
      expect(changed).toEqual([]);
      expect(fs.readFileSync(path.join(projectDir, 'app-config.json'), 'utf-8')).toBe(before);
    });
  });

  describe('hasLocalApp', () => {
    it('should return false when no project config exists', () => {
      expect(hasLocalApp()).toBe(false);
    });
  });

  // ──────────────── app_type (informational) ────────────────
  // `app_type` is informational metadata written to new configs. It must never
  // break legacy configs that lack it, and it must never leak into the wire
  // payloads (`UploadAppPayload` / `createApp`). These tests encode that contract.
  describe('app_type backward compatibility', () => {
    const originalCwd = process.cwd();
    let projectDir: string;

    beforeEach(() => {
      projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brevo-apptype-'));
      process.chdir(projectDir);
    });

    afterEach(() => {
      process.chdir(originalCwd);
      if (fs.existsSync(projectDir)) {
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
    });

    function writeConfig(config: object): void {
      fs.writeFileSync(path.join(projectDir, 'app-config.json'), JSON.stringify(config));
    }

    it('reads a config without app_type — field is undefined, not an error', () => {
      writeConfig({
        app_id: '42',
        app_name: 'Legacy App',
        distribution_type: 'private',
        auth: { scopes: ['contacts:read'], redirect_uris: ['http://localhost:3009/auth/callback'] },
      });
      const cfg = readProjectConfig();
      expect(cfg).not.toBeNull();
      expect(cfg!.app_id).toBe('42');
      expect(cfg!.app_type).toBeUndefined();
    });

    it.each(['oauth', 'ui', 'function'] as const)(
      'reads a config with app_type: "%s" and preserves it',
      (appType) => {
        writeConfig({
          app_id: '43',
          app_type: appType,
          ...(appType === 'ui'
            ? { ui_app: { extension_type: 'actionLink', surface_point_list: [] }, auth: {} }
            : {}),
          ...(appType === 'function' ? { brevo_function: {} } : {}),
          ...(appType === 'oauth' ? { auth: { scopes: [] } } : {}),
        });
        const cfg = readProjectConfig();
        expect(cfg!.app_type).toBe(appType);
      },
    );

    it('round-trips app_type through writeProjectConfig', () => {
      writeConfig({
        app_id: '46',
        app_name: 'Round Trip',
        distribution_type: 'private',
        app_type: 'function',
        auth: {},
      });
      const cfg = readProjectConfig()!;
      writeProjectConfig(cfg);
      const reread = readProjectConfig();
      expect(reread!.app_type).toBe('function');
    });

    it('round-trips a config without app_type — field stays absent', () => {
      writeConfig({
        app_id: '47',
        app_name: 'Legacy Round Trip',
        distribution_type: 'private',
        auth: { scopes: [] },
      });
      const cfg = readProjectConfig()!;
      writeProjectConfig(cfg);
      const raw = JSON.parse(fs.readFileSync(path.join(projectDir, 'app-config.json'), 'utf-8'));
      expect(raw).not.toHaveProperty('app_type');
    });

    it('migrates legacy camelCase appType to snake_case app_type on read', () => {
      writeConfig({
        appId: '48',
        appType: 'function',
        brevo_function: {},
      });
      const cfg = readProjectConfig();
      expect(cfg!.app_type).toBe('function');
    });

    it('drops the legacy appType key on write-back after migration', () => {
      writeConfig({
        appId: '49',
        appName: 'Migrate Me',
        distribution_type: 'private',
        appType: 'oauth',
        auth: { scopes: [] },
      });
      const cfg = readProjectConfig()!;
      writeProjectConfig(cfg);
      const raw = JSON.parse(fs.readFileSync(path.join(projectDir, 'app-config.json'), 'utf-8'));
      expect(raw.app_type).toBe('oauth');
      expect(raw).not.toHaveProperty('appType');
    });

    it('prefers existing app_type over legacy appType when both are present', () => {
      writeConfig({
        appId: '50',
        app_type: 'ui',
        appType: 'oauth',
        auth: {},
      });
      const cfg = readProjectConfig();
      expect(cfg!.app_type).toBe('ui');
    });
  });

  // ──────────────── legacy camelCase keys ────────────────
  // Every key in app-config.json is snake_case. Releases before the rename wrote
  // `appId` / `appName` / `logoUri` / `appType` / `auth.redirectUris`; the read
  // path folds those into the snake_case fields and drops them, so any write-back
  // migrates the file. These tests are the compatibility contract: the camelCase
  // fixtures here are deliberate and must stay camelCase.
  describe('legacy camelCase keys', () => {
    const originalCwd = process.cwd();
    let projectDir: string;
    let stderrSpy: jest.SpyInstance;

    const LEGACY_CONFIG = {
      appId: 'legacy-app',
      appName: 'Legacy Name',
      logoUri: 'https://example.com/logo.png',
      appType: 'oauth',
      version: '1.2.3',
      distribution_type: 'private',
      auth: { scopes: ['crm:read'], redirectUris: ['https://example.com/cb'] },
    };

    const CURRENT_CONFIG = {
      app_id: 'current-app',
      app_name: 'Current Name',
      logo_uri: 'https://example.com/logo.png',
      app_type: 'oauth',
      version: '1.2.3',
      distribution_type: 'private',
      auth: { scopes: ['crm:read'], redirect_uris: ['https://example.com/cb'] },
    };

    beforeEach(() => {
      projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brevo-legacy-keys-'));
      process.chdir(projectDir);
      stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    });

    afterEach(() => {
      stderrSpy.mockRestore();
      process.chdir(originalCwd);
      if (fs.existsSync(projectDir)) {
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
    });

    function writeConfig(config: object): void {
      fs.writeFileSync(path.join(projectDir, 'app-config.json'), JSON.stringify(config));
    }

    function readOnDisk(): Record<string, unknown> {
      return JSON.parse(fs.readFileSync(path.join(projectDir, 'app-config.json'), 'utf-8'));
    }

    it('reads a camelCase-only config into the snake_case fields', () => {
      writeConfig(LEGACY_CONFIG);
      const cfg = readProjectConfig();
      expect(cfg).toEqual({
        app_id: 'legacy-app',
        app_name: 'Legacy Name',
        logo_uri: 'https://example.com/logo.png',
        app_type: 'oauth',
        version: '1.2.3',
        distribution_type: 'private',
        auth: { scopes: ['crm:read'], redirect_uris: ['https://example.com/cb'] },
      });
      expect(cfg).not.toHaveProperty('appId');
      expect(cfg).not.toHaveProperty('appName');
      expect(cfg).not.toHaveProperty('logoUri');
      expect(cfg).not.toHaveProperty('appType');
      expect(cfg?.auth).not.toHaveProperty('redirectUris');
    });

    it('reads a snake_case-only config unchanged', () => {
      writeConfig(CURRENT_CONFIG);
      expect(readProjectConfig()).toEqual(CURRENT_CONFIG);
      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('accepts a numeric legacy appId', () => {
      writeConfig({ appId: 42, auth: { scopes: [] } });
      expect(readProjectConfig()?.app_id).toBe('42');
    });

    it('prefers the snake_case key when both spellings are present and warns once', () => {
      writeConfig({
        ...CURRENT_CONFIG,
        appId: 'legacy-app',
        appName: 'Legacy Name',
        auth: {
          scopes: ['crm:read'],
          redirect_uris: ['https://new.example.com/cb'],
          redirectUris: ['https://old.example.com/cb'],
        },
      });
      const cfg = readProjectConfig();
      expect(cfg?.app_id).toBe('current-app');
      expect(cfg?.app_name).toBe('Current Name');
      expect(cfg?.auth.redirect_uris).toEqual(['https://new.example.com/cb']);
      expect(cfg).not.toHaveProperty('appId');
      expect(cfg?.auth).not.toHaveProperty('redirectUris');

      // One stderr line naming the conflicting keys — never stdout, which `--json`
      // owns — and only once per process however often the file is re-read.
      expect(stderrSpy).toHaveBeenCalledTimes(1);
      const line = String(stderrSpy.mock.calls[0]?.[0]);
      expect(line).toContain('appId/app_id');
      expect(line).toContain('appName/app_name');
      expect(line).toContain('redirectUris/redirect_uris');
      readProjectConfig();
      expect(stderrSpy).toHaveBeenCalledTimes(1);
    });

    it('does not warn when both spellings carry the same value', () => {
      writeConfig({ ...CURRENT_CONFIG, appId: 'current-app' });
      expect(readProjectConfig()?.app_id).toBe('current-app');
      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('migrates a camelCase config to snake_case on write-back', () => {
      writeConfig(LEGACY_CONFIG);
      writeProjectConfig(readProjectConfig()!);
      const onDisk = readOnDisk();
      expect(onDisk).toEqual({
        app_id: 'legacy-app',
        app_name: 'Legacy Name',
        logo_uri: 'https://example.com/logo.png',
        app_type: 'oauth',
        version: '1.2.3',
        distribution_type: 'private',
        auth: { scopes: ['crm:read'], redirect_uris: ['https://example.com/cb'] },
      });
    });

    it('migrates a camelCase UI-app config without touching its ui_app block', () => {
      const uiApp = {
        extension_type: 'actionLink',
        surface_point_list: [
          {
            surface_point_name: 'contactDetails.header.menu',
            label: 'Open',
            redirect_link: 'https://example.com',
          },
        ],
      };
      writeConfig({
        appId: 'ui-1',
        appName: 'UI',
        appType: 'ui',
        distribution_type: 'private',
        auth: {},
        ui_app: uiApp,
      });
      writeProjectConfig(readProjectConfig()!);
      const onDisk = readOnDisk();
      expect(onDisk.app_id).toBe('ui-1');
      expect(onDisk.app_type).toBe('ui');
      expect(onDisk.ui_app).toEqual(uiApp);
      expect(onDisk.auth).toEqual({});
    });

    it('migrates a camelCase Function-app config without touching brevo_function', () => {
      writeConfig({
        appId: 'fn-1',
        appName: 'Fn',
        appType: 'function',
        distribution_type: 'private',
        brevo_function: {},
      });
      writeProjectConfig(readProjectConfig()!);
      const onDisk = readOnDisk();
      expect(onDisk.app_id).toBe('fn-1');
      expect(onDisk.app_type).toBe('function');
      expect(onDisk.brevo_function).toEqual({});
    });

    describe('hasLegacyProjectConfigKeys / migrateProjectConfigKeys', () => {
      it('reports false and writes nothing for a snake_case config', () => {
        writeConfig(CURRENT_CONFIG);
        const before = fs.readFileSync(path.join(projectDir, 'app-config.json'), 'utf-8');
        expect(hasLegacyProjectConfigKeys()).toBe(false);
        expect(migrateProjectConfigKeys()).toBe(false);
        expect(fs.readFileSync(path.join(projectDir, 'app-config.json'), 'utf-8')).toBe(before);
      });

      it.each([
        ['appId', { appId: 'x', auth: {} }],
        ['appName', { app_id: 'x', appName: 'n', auth: {} }],
        ['logoUri', { app_id: 'x', logoUri: '', auth: {} }],
        ['appType', { app_id: 'x', appType: 'oauth', auth: {} }],
        ['auth.redirectUris', { app_id: 'x', auth: { redirectUris: [] } }],
        ['auth.redirectUrls', { app_id: 'x', auth: { redirectUrls: [] } }],
        ['auth.type', { app_id: 'x', auth: { type: 'private' } }],
        ['distribution', { app_id: 'x', distribution: 'private', auth: {} }],
        ['permittedUrls', { app_id: 'x', permittedUrls: {}, auth: {} }],
        ['support', { app_id: 'x', support: {}, auth: {} }],
      ])('reports true for a file still carrying %s', (_key, config) => {
        writeConfig(config);
        expect(hasLegacyProjectConfigKeys()).toBe(true);
      });

      it('rewrites a camelCase config in place, values unchanged', () => {
        writeConfig(LEGACY_CONFIG);
        expect(migrateProjectConfigKeys()).toBe(true);
        const onDisk = readOnDisk();
        expect(onDisk.app_id).toBe('legacy-app');
        expect(onDisk.app_name).toBe('Legacy Name');
        expect(onDisk.logo_uri).toBe('https://example.com/logo.png');
        expect(onDisk.app_type).toBe('oauth');
        expect((onDisk.auth as Record<string, unknown>).redirect_uris).toEqual([
          'https://example.com/cb',
        ]);
        expect(onDisk).not.toHaveProperty('appId');
        expect(onDisk.auth).not.toHaveProperty('redirectUris');
        // Second run: nothing left to do.
        expect(hasLegacyProjectConfigKeys()).toBe(false);
        expect(migrateProjectConfigKeys()).toBe(false);
      });

      it('reports false for a missing or unparseable file', () => {
        expect(hasLegacyProjectConfigKeys()).toBe(false);
        expect(migrateProjectConfigKeys()).toBe(false);
        fs.writeFileSync(path.join(projectDir, 'app-config.json'), '{ not json');
        expect(hasLegacyProjectConfigKeys()).toBe(false);
        expect(migrateProjectConfigKeys()).toBe(false);
      });

      it('does not write a legacy file that has no usable app id', () => {
        writeConfig({ appName: 'no id', auth: {} });
        const before = fs.readFileSync(path.join(projectDir, 'app-config.json'), 'utf-8');
        expect(migrateProjectConfigKeys()).toBe(false);
        expect(fs.readFileSync(path.join(projectDir, 'app-config.json'), 'utf-8')).toBe(before);
      });
    });
  });

  // The guard behind `brevo app scaffold`'s no-config branch. `readProjectConfig`
  // deliberately does not walk up, so without this a scaffold run one directory
  // below a real project would silently offer to create a SECOND project nested
  // inside it — and the next `app upload` from there would push the wrong app.
  describe('findEnclosingProjectDir', () => {
    const originalCwd = process.cwd();
    let projectDir: string;

    beforeEach(() => {
      projectDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'brevo-enclosing-')));
    });

    afterEach(() => {
      process.chdir(originalCwd);
      if (fs.existsSync(projectDir)) {
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
    });

    function writeConfigAt(dir: string, config: object): void {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'app-config.json'), JSON.stringify(config));
    }

    it('returns null when no ancestor holds an app-config.json', () => {
      const nested = path.join(projectDir, 'src', 'oauth');
      fs.mkdirSync(nested, { recursive: true });
      process.chdir(nested);
      expect(findEnclosingProjectDir()).toBeNull();
    });

    it('returns the ancestor directory that holds the project config', () => {
      writeConfigAt(projectDir, { app_id: '42', auth: { scopes: [] } });
      const nested = path.join(projectDir, 'src', 'oauth');
      fs.mkdirSync(nested, { recursive: true });
      process.chdir(nested);
      expect(findEnclosingProjectDir()).toBe(projectDir);
    });

    it('finds the nearest ancestor when several are nested', () => {
      const inner = path.join(projectDir, 'inner');
      writeConfigAt(projectDir, { app_id: '42', auth: { scopes: [] } });
      writeConfigAt(inner, { app_id: '99', auth: { scopes: [] } });
      const nested = path.join(inner, 'src');
      fs.mkdirSync(nested, { recursive: true });
      process.chdir(nested);
      expect(findEnclosingProjectDir()).toBe(inner);
    });

    // cwd is the caller's own case: it only asks this question once it already
    // knows cwd has no usable config. Counting cwd would make every ordinary
    // in-project run look like a nested one.
    it('ignores a config in the current directory', () => {
      writeConfigAt(projectDir, { app_id: '42', auth: { scopes: [] } });
      process.chdir(projectDir);
      expect(findEnclosingProjectDir()).toBeNull();
    });

    // An ancestor file that readProjectConfig would reject (no appId, or
    // unparseable) is not a project — walking must continue past it rather
    // than refuse on a file nothing else in the CLI would honour.
    it('walks past an ancestor config that carries no appId', () => {
      const inner = path.join(projectDir, 'inner');
      writeConfigAt(projectDir, { app_id: '42', auth: { scopes: [] } });
      writeConfigAt(inner, { auth: { scopes: [] } });
      const nested = path.join(inner, 'src');
      fs.mkdirSync(nested, { recursive: true });
      process.chdir(nested);
      expect(findEnclosingProjectDir()).toBe(projectDir);
    });

    it('walks past an ancestor config that is not valid JSON', () => {
      const inner = path.join(projectDir, 'inner');
      writeConfigAt(projectDir, { app_id: '42', auth: { scopes: [] } });
      fs.mkdirSync(inner, { recursive: true });
      fs.writeFileSync(path.join(inner, 'app-config.json'), '{ not json');
      process.chdir(inner);
      expect(findEnclosingProjectDir()).toBe(projectDir);
    });
  });
});
