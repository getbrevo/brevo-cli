import {
  getCliOs,
  getCliUserAgent,
  buildCliHeaders,
  sanitizeHeaderValue,
} from '../../lib/telemetry';
import { CLI_VERSION } from '../../lib/cli-version';
import { TELEMETRY_HEADERS } from '../../lib/constants';

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

  describe('getCliUserAgent', () => {
    it('formats as brevo-cli/<version> (<os>)', () => {
      withPlatform('darwin', () => {
        expect(getCliUserAgent()).toBe(`brevo-cli/${CLI_VERSION} (macos)`);
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
    it('returns User-Agent, version, and os headers', () => {
      withPlatform('darwin', () => {
        expect(buildCliHeaders()).toEqual({
          [TELEMETRY_HEADERS.USER_AGENT]: `brevo-cli/${CLI_VERSION} (macos)`,
          [TELEMETRY_HEADERS.CLI_VERSION]: CLI_VERSION,
          [TELEMETRY_HEADERS.CLI_OS]: 'macos',
        });
      });
    });

    it('does not include an auth-method header (derived by the client)', () => {
      expect(Object.keys(buildCliHeaders())).not.toContain(TELEMETRY_HEADERS.CLI_AUTH_METHOD);
    });
  });
});
