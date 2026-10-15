jest.mock('../../../services/skill', () => {
  const actual = jest.requireActual('../../../services/skill');
  return { ...actual, skillService: { update: jest.fn() } };
});

import { updateCommand } from '../../../commands/skill/update';
import { skillService } from '../../../services/skill';
import { resetJsonOutputState } from '../../../lib/json-output';

describe('skill/update', () => {
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

  it('updates the installed skills for the given agents', async () => {
    (skillService.update as jest.Mock).mockResolvedValue({
      results: [
        {
          name: 'brevo',
          version: '1.1.0',
          previousVersion: '1.0.0',
          status: 'updated',
          path: '/p/brevo',
          agents: ['claude'],
        },
        {
          name: 'brevo-cli',
          version: '1.1.0',
          status: 'already-installed',
          path: '/p/brevo-cli',
          agents: ['claude'],
        },
      ],
      release: '0.2.0',
      source: 'network',
      dryRun: false,
      failed: false,
      warnings: [],
    });

    await updateCommand({ names: ['brevo', 'brevo-cli'], agent: 'claude', pin: 'latest' });

    expect(skillService.update).toHaveBeenCalledWith(['brevo', 'brevo-cli'], {
      agents: ['claude'],
      pin: 'latest',
      force: undefined,
      dryRun: undefined,
    });
    expect(output()).toContain('Updated brevo 1.0.0 → 1.1.0 for claude → /p/brevo');
    expect(output()).toContain('brevo-cli@1.1.0 is already up to date');
    // No catalog mcp block: nothing printed about MCP.
    expect(output()).not.toContain('mcp add');
  });

  it('says so when nothing is installed', async () => {
    (skillService.update as jest.Mock).mockResolvedValue({
      results: [],
      source: 'network',
      dryRun: false,
      failed: false,
      warnings: [],
    });

    await updateCommand({});
    expect(output()).toContain('No installed skills to update');

    await updateCommand({ json: true });
    expect(JSON.parse(stdoutSpy.mock.calls.at(-1)![0]).results).toEqual([]);
  });

  it('passes --force and --dry-run through and exits 1 on a failed run', async () => {
    (skillService.update as jest.Mock).mockResolvedValue({
      results: [
        {
          name: 'brevo',
          version: '1.1.0',
          status: 'skipped',
          reason: 'hash-mismatch',
          detail: 'x',
          path: '/p',
          agents: ['claude'],
        },
      ],
      release: '0.2.0',
      source: 'network',
      dryRun: false,
      failed: true,
      warnings: [],
    });

    await expect(updateCommand({ force: true, dryRun: true })).rejects.toThrow(
      /could not be installed/,
    );
    expect(skillService.update).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ force: true, dryRun: true }),
    );
  });
});
