jest.mock('../../../services/skill', () => {
  const actual = jest.requireActual('../../../services/skill');
  return { ...actual, skillService: { list: jest.fn() } };
});

import { listCommand } from '../../../commands/skill/list';
import { skillService } from '../../../services/skill';

describe('skill/list', () => {
  let stdoutSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;
  const output = () =>
    stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('') +
    stderrSpy.mock.calls.map((c: [string]) => c[0]).join('');

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    jest.clearAllMocks();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  const result = {
    installed: [
      {
        name: 'brevo',
        version: '1.0.0',
        release: '0.1.0',
        source: 'brevo-skills',
        path: '/p/brevo',
        agents: ['claude'],
        latestVersion: '1.1.0',
        outdated: true,
        pin: '0.1.0',
      },
      {
        name: 'brevo-cli',
        version: '2.4.0',
        source: 'brevo-cli',
        path: '/a/brevo-cli',
        agents: ['codex', 'gemini'],
        latestVersion: '1.1.0',
        outdated: true,
      },
    ],
    available: [
      {
        name: 'brevo',
        version: '1.1.0',
        summary: 'Router.',
        platforms: ['claude', 'openai'],
        default: true,
      },
      {
        name: 'brevo-cli',
        version: '1.1.0',
        summary: 'CLI.',
        platforms: ['claude'],
        default: false,
      },
    ],
    catalog: { release: '0.2.0', source: 'cache', error: 'HTTP 500' },
  };

  it('prints installed skills with flags and the available catalog', async () => {
    (skillService.list as jest.Mock).mockResolvedValue(result);

    await listCommand({});

    const text = output();
    expect(text).toContain('Installed skills:');
    expect(text).toContain(
      'brevo@1.0.0  claude  /p/brevo  (update available: 1.1.0, pinned to 0.1.0)',
    );
    expect(text).toContain(
      'brevo-cli@2.4.0  codex, gemini  /a/brevo-cli  (update available: 1.1.0, bundled copy)',
    );
    expect(text).toContain('Available in catalog 0.2.0 (cached):');
    expect(text).toContain('brevo@1.1.0  (default, claude/openai)  Router.');
    expect(text).toContain('brevo-cli@1.1.0  (claude)  CLI.');
  });

  it('reports nothing installed and an unavailable catalog', async () => {
    (skillService.list as jest.Mock).mockResolvedValue({
      installed: [],
      available: [],
      catalog: { source: 'none', error: 'timed out' },
    });

    await listCommand({});

    expect(output()).toContain('No Brevo skills installed. Run `brevo skill install`');
    expect(output()).toContain('Catalog unavailable: timed out');
  });

  it('outputs JSON when --json', async () => {
    (skillService.list as jest.Mock).mockResolvedValue(result);

    await listCommand({ json: true });

    const parsed = JSON.parse(stdoutSpy.mock.calls[0][0]);
    expect(parsed.installed).toHaveLength(2);
    expect(parsed.catalog.release).toBe('0.2.0');
  });
});
