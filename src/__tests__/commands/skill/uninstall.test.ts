jest.mock('../../../services/skill', () => {
  const actual = jest.requireActual('../../../services/skill');
  return { ...actual, skillService: { uninstall: jest.fn() } };
});

import { uninstallCommand } from '../../../commands/skill/uninstall';
import { skillService } from '../../../services/skill';

describe('skill/uninstall', () => {
  let stdoutSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    jest.clearAllMocks();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  const fakeSkillPath = '/home/user/.claude/skills/brevo-cli';

  it('uninstalls every installed Brevo skill', async () => {
    (skillService.uninstall as jest.Mock).mockReturnValue([
      { name: 'brevo-cli', path: fakeSkillPath, agents: ['claude'], status: 'removed' },
    ]);

    await uninstallCommand({});

    expect(skillService.uninstall).toHaveBeenCalledWith([], { agents: undefined });
    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('Uninstalled brevo-cli for claude');
    expect(output).toContain(fakeSkillPath);
  });

  it('passes the names and agents given', async () => {
    (skillService.uninstall as jest.Mock).mockReturnValue([
      { name: 'brevo', path: '/p/brevo', agents: ['gemini'], status: 'not-installed' },
    ]);

    await uninstallCommand({ names: ['brevo'], agent: 'gemini' });

    expect(skillService.uninstall).toHaveBeenCalledWith(['brevo'], { agents: ['gemini'] });
    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('brevo is not installed by the CLI at /p/brevo');
  });

  it('reports a friendly no-op when nothing is installed', async () => {
    (skillService.uninstall as jest.Mock).mockReturnValue([]);

    await uninstallCommand({});

    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('No Brevo skills installed');
  });

  it('outputs JSON when --json', async () => {
    (skillService.uninstall as jest.Mock).mockReturnValue([
      { name: 'brevo-cli', path: fakeSkillPath, agents: ['claude'], status: 'removed' },
    ]);

    await uninstallCommand({ json: true });

    const parsed = JSON.parse(stdoutSpy.mock.calls[0][0]);
    expect(parsed).toEqual([
      {
        uninstalled: true,
        name: 'brevo-cli',
        path: fakeSkillPath,
        agents: ['claude'],
        status: 'removed',
      },
    ]);
  });
});
