import { warnIfCliBelowMinVersion } from '../../lib/min-version-check';
import * as config from '../../lib/config';
import { ProjectConfig } from '../../lib/config';

jest.mock('../../lib/config');

const baseConfig: ProjectConfig = {
  appId: '1',
  appName: 'Test App',
  auth: { type: 'private', scopes: ['all'], redirectUrls: [] },
  distribution: 'private',
  permittedUrls: { fetch: [], img: [], iframe: [], js: [], css: [] },
  support: { supportEmail: '', documentationUrl: '', supportUrl: '', supportPhone: '' },
};

describe('warnIfCliBelowMinVersion', () => {
  let stdoutSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    jest.clearAllMocks();
  });

  it('warns when current CLI is older than minCliVersion', () => {
    (config.readProjectConfig as jest.Mock).mockReturnValue({
      ...baseConfig,
      minCliVersion: '1.5.0',
    });

    warnIfCliBelowMinVersion({ currentVersion: '1.2.0', argv: ['node', 'brevo'] });

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('1.5.0');
    expect(output).toContain('1.2.0');
  });

  it('does not warn when current CLI matches minCliVersion', () => {
    (config.readProjectConfig as jest.Mock).mockReturnValue({
      ...baseConfig,
      minCliVersion: '1.5.0',
    });

    warnIfCliBelowMinVersion({ currentVersion: '1.5.0', argv: ['node', 'brevo'] });

    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('does not warn when current CLI is newer than minCliVersion', () => {
    (config.readProjectConfig as jest.Mock).mockReturnValue({
      ...baseConfig,
      minCliVersion: '1.5.0',
    });

    warnIfCliBelowMinVersion({ currentVersion: '2.0.0', argv: ['node', 'brevo'] });

    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('does nothing when there is no project config', () => {
    (config.readProjectConfig as jest.Mock).mockReturnValue(null);

    warnIfCliBelowMinVersion({ currentVersion: '1.0.0', argv: ['node', 'brevo'] });

    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('does nothing when minCliVersion is missing from config', () => {
    (config.readProjectConfig as jest.Mock).mockReturnValue(baseConfig);

    warnIfCliBelowMinVersion({ currentVersion: '1.0.0', argv: ['node', 'brevo'] });

    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('skips the check for unpublished local builds (0.0.0)', () => {
    (config.readProjectConfig as jest.Mock).mockReturnValue({
      ...baseConfig,
      minCliVersion: '1.5.0',
    });

    warnIfCliBelowMinVersion({ currentVersion: '0.0.0', argv: ['node', 'brevo'] });

    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('skips the warning when --json is passed', () => {
    (config.readProjectConfig as jest.Mock).mockReturnValue({
      ...baseConfig,
      minCliVersion: '1.5.0',
    });

    warnIfCliBelowMinVersion({
      currentVersion: '1.2.0',
      argv: ['node', 'brevo', 'app', 'list', '--json'],
    });

    expect(stdoutSpy).not.toHaveBeenCalled();
  });
});
