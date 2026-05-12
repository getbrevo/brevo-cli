import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Set a temp config dir BEFORE importing config module
const TEST_CONFIG_DIR = path.join(
  os.tmpdir(),
  `brevo-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
);
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
  hasLocalApp,
} from '../../lib/config';

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
      const path = require('path');
      const fs = require('fs');
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
      const pathMod = require('path');
      const fsMod = require('fs');
      fsMod.mkdirSync(TEST_CONFIG_DIR, { recursive: true, mode: 0o700 });
      fsMod.writeFileSync(
        pathMod.join(TEST_CONFIG_DIR, 'credentials.json'),
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
    function writeRawCredentials(data: object): void {
      fs.mkdirSync(TEST_CONFIG_DIR, { recursive: true, mode: 0o700 });
      fs.writeFileSync(
        path.join(TEST_CONFIG_DIR, 'credentials.json'),
        JSON.stringify(data, null, 2),
        { mode: 0o600 },
      );
    }

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

    it('should strip redirectUrls from app credentials during migration', () => {
      writeRawCredentials({
        profiles: { default: { apiKey: 'key-1', accountEmail: 'a@b.com' } },
        activeProfile: 'default',
        apps: {
          '1': {
            clientId: 'c1',
            clientSecret: 's1',
            redirectUrls: ['http://localhost:3000'],
          },
        },
      });

      const app = getAppCredentials('1');
      expect(app).toEqual({ clientId: 'c1', clientSecret: 's1' });
      expect((app as unknown as Record<string, unknown>)?.redirectUrls).toBeUndefined();
    });

    it('should strip redirectUrls from app credentials on normal read', () => {
      writeRawCredentials({
        apiKey: 'key-1',
        accountEmail: 'a@b.com',
        apps: {
          '1': {
            clientId: 'c1',
            clientSecret: 's1',
            redirectUrls: ['http://localhost:3000'],
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
  });

  describe('hasLocalApp', () => {
    it('should return false when no project config exists', () => {
      expect(hasLocalApp()).toBe(false);
    });
  });
});
