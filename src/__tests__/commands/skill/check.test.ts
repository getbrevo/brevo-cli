jest.mock('../../../services/skill', () => {
  const actual = jest.requireActual('../../../services/skill');
  return { ...actual, skillService: { check: jest.fn() } };
});

import { checkCommand } from '../../../commands/skill/check';
import { skillService } from '../../../services/skill';
import { resetJsonOutputState } from '../../../lib/json-output';

describe('skill/check', () => {
  let stdoutSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;
  const output = () =>
    stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('') +
    stderrSpy.mock.calls.map((c: [string]) => c[0]).join('');

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    jest.clearAllMocks();
    resetJsonOutputState();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  const current = {
    name: 'brevo',
    version: '1.0.0',
    source: 'brevo-skills',
    path: '/p/brevo',
    agents: ['claude'],
    latestVersion: '1.0.0',
    outdated: false,
    tampered: false,
    unverified: false,
  };

  it('passes when everything is current and unmodified', async () => {
    (skillService.check as jest.Mock).mockResolvedValue({
      results: [current],
      catalog: { release: '0.1.0', source: 'network' },
      ok: true,
    });

    await checkCommand({});

    expect(output()).toContain('brevo@1.0.0: current → /p/brevo');
    expect(output()).toContain('1 skill installed, all current and unmodified.');
  });

  it('reports outdated, modified and unverifiable skills and exits 1', async () => {
    (skillService.check as jest.Mock).mockResolvedValue({
      results: [
        { ...current, outdated: true, latestVersion: '1.1.0' },
        { ...current, name: 'brevo-cli', path: '/p/brevo-cli', tampered: true },
        { ...current, name: 'old', path: '/p/old', unverified: true },
      ],
      catalog: { source: 'none', error: 'timed out' },
      ok: false,
    });

    await expect(checkCommand({})).rejects.toThrow(
      '1 outdated, 1 modified. Run `brevo skill update`',
    );

    const text = output();
    expect(text).toContain('Catalog unavailable: timed out');
    expect(text).toContain('brevo: outdated (1.0.0 installed, 1.1.0 in catalog) → /p/brevo');
    expect(text).toContain('brevo-cli: modified on disk since it was installed → /p/brevo-cli');
    expect(text).toContain('old: installed before hashes were recorded; cannot verify → /p/old');
  });

  it('outputs one JSON document with --json and still exits 1 when something is off', async () => {
    (skillService.check as jest.Mock).mockResolvedValue({
      results: [{ ...current, tampered: true }],
      catalog: { release: '0.1.0', source: 'network' },
      ok: false,
    });

    await expect(checkCommand({ json: true })).rejects.toThrow();

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(stdoutSpy.mock.calls[0][0]);
    expect(parsed.ok).toBe(false);
    expect(parsed.results[0].tampered).toBe(true);
  });
});
