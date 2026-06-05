import {
  getCliOs,
  getCliUserAgent,
  getAuthMethod,
  buildCliHeaders,
  sanitizeHeaderValue,
} from '../../lib/telemetry';
import { CLI_VERSION } from '../../lib/cli-version';
import { USER_AGENT_HEADER } from '../../lib/constants';

function withPlatform(platform: string, fn: () => void): void {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { value: platform });
  try {
    fn();
  } finally {
    Object.defineProperty(process, 'platform', original);
  }
}

describe('telemetry', () => {
  describe('getCliOs', () => {
    it('maps darwin to macos', () => {
      withPlatform('darwin', () => expect(getCliOs()).toBe('macos'));
    });

    it('maps win32 to windows', () => {
      withPlatform('win32', () => expect(getCliOs()).toBe('windows'));
    });

    it('maps linux to linux', () => {
      withPlatform('linux', () => expect(getCliOs()).toBe('linux'));
    });

    it('falls back to other for unknown platforms', () => {
      withPlatform('freebsd', () => expect(getCliOs()).toBe('other'));
      withPlatform('aix', () => expect(getCliOs()).toBe('other'));
    });
  });

  describe('getAuthMethod', () => {
    it('returns api_key for an api-key header', () => {
      expect(getAuthMethod({ 'api-key': 'xkeysib-test-key' })).toBe('api_key');
    });

    it('returns oauth for an Authorization header', () => {
      expect(getAuthMethod({ Authorization: 'Bearer token' })).toBe('oauth');
    });

    it('returns undefined without an auth header', () => {
      expect(getAuthMethod(undefined)).toBeUndefined();
      expect(getAuthMethod({})).toBeUndefined();
    });
  });

  describe('getCliUserAgent', () => {
    it('formats as brevo-cli/<version> (<os>) without credentials', () => {
      withPlatform('darwin', () => {
        expect(getCliUserAgent()).toBe(`brevo-cli/${CLI_VERSION} (macos)`);
      });
    });

    it('appends auth=api_key when an api-key header is about to be sent', () => {
      withPlatform('darwin', () => {
        expect(getCliUserAgent({ 'api-key': 'xkeysib-test-key' })).toBe(
          `brevo-cli/${CLI_VERSION} (macos; auth=api_key)`,
        );
      });
    });

    it('appends auth=oauth when an Authorization header is about to be sent', () => {
      withPlatform('linux', () => {
        expect(getCliUserAgent({ Authorization: 'Bearer token' })).toBe(
          `brevo-cli/${CLI_VERSION} (linux; auth=oauth)`,
        );
      });
    });
  });

  describe('sanitizeHeaderValue', () => {
    it('passes through plain printable ASCII', () => {
      expect(sanitizeHeaderValue('1.2.3', 'fallback')).toBe('1.2.3');
    });

    it('strips control characters and newlines', () => {
      expect(sanitizeHeaderValue('1.2\r\n.3\x00', 'fallback')).toBe('1.2.3');
    });

    it('strips non-ASCII characters', () => {
      expect(sanitizeHeaderValue('1.2.3-béta', 'fallback')).toBe('1.2.3-bta');
    });

    it('returns the fallback when nothing printable remains', () => {
      expect(sanitizeHeaderValue('\x00\x1B', 'fallback')).toBe('fallback');
      expect(sanitizeHeaderValue('', 'fallback')).toBe('fallback');
    });
  });

  describe('buildCliHeaders', () => {
    it('returns only the User-Agent header', () => {
      withPlatform('darwin', () => {
        expect(buildCliHeaders()).toEqual({
          [USER_AGENT_HEADER]: `brevo-cli/${CLI_VERSION} (macos)`,
        });
      });
    });

    it('folds the auth method into the User-Agent', () => {
      withPlatform('darwin', () => {
        expect(buildCliHeaders({ 'api-key': 'xkeysib-test-key' })).toEqual({
          [USER_AGENT_HEADER]: `brevo-cli/${CLI_VERSION} (macos; auth=api_key)`,
        });
      });
    });
  });
});
