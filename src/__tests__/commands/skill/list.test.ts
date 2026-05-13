jest.mock('../../../services/skill', () => ({
  skillService: {
    list: jest.fn(),
  },
}));

import { listCommand } from '../../../commands/skill/list';
import { skillService } from '../../../services/skill';

describe('skill/list', () => {
  let stdoutSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    jest.clearAllMocks();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it('renders the catalog with install state in human mode', async () => {
    (skillService.list as jest.Mock).mockReturnValue([
      {
        name: 'brevo-cli',
        description: 'Brevo CLI agent primer.',
        version: '1.0.0',
        files: ['SKILL.md'],
        installed: false,
      },
    ]);

    await listCommand({ json: false });

    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('brevo-cli');
    expect(output).toContain('v1.0.0');
    expect(output).toContain('not installed');
    expect(output).toContain('Install one with');
  });

  it('marks installed skills with their version', async () => {
    (skillService.list as jest.Mock).mockReturnValue([
      {
        name: 'brevo-cli',
        description: 'd',
        version: '1.0.0',
        files: ['SKILL.md'],
        installed: true,
        installedVersion: '1.0.0',
        upgradable: false,
        path: '/tmp/.claude/skills/brevo-cli',
      },
    ]);

    await listCommand({ json: false });

    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('installed (v1.0.0)');
  });

  it('flags upgradable skills', async () => {
    (skillService.list as jest.Mock).mockReturnValue([
      {
        name: 'brevo-cli',
        description: 'd',
        version: '2.0.0',
        files: ['SKILL.md'],
        installed: true,
        installedVersion: '1.0.0',
        upgradable: true,
        path: '/tmp/.claude/skills/brevo-cli',
      },
    ]);

    await listCommand({ json: false });

    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('update available');
  });

  it('outputs JSON when --json', async () => {
    (skillService.list as jest.Mock).mockReturnValue([
      {
        name: 'brevo-cli',
        description: 'd',
        version: '1.0.0',
        files: ['SKILL.md'],
        installed: true,
        installedVersion: '1.0.0',
        upgradable: false,
        path: '/tmp/skills/brevo-cli',
      },
    ]);

    await listCommand({ json: true });

    const parsed = JSON.parse(stdoutSpy.mock.calls[0][0]);
    expect(parsed).toEqual([
      {
        name: 'brevo-cli',
        description: 'd',
        version: '1.0.0',
        installed: true,
        installedVersion: '1.0.0',
        upgradable: false,
        path: '/tmp/skills/brevo-cli',
      },
    ]);
  });
});
