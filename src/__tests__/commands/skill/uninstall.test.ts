jest.mock('../../../services/skill', () => ({
  skillService: {
    uninstallAll: jest.fn(),
  },
}));

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
    (skillService.uninstallAll as jest.Mock).mockReturnValue([
      { name: 'brevo-cli', path: fakeSkillPath },
    ]);

    await uninstallCommand({});

    expect(skillService.uninstallAll).toHaveBeenCalledWith();
    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('Uninstalled brevo-cli');
    expect(output).toContain(fakeSkillPath);
  });

  it('reports a friendly no-op when nothing is installed', async () => {
    (skillService.uninstallAll as jest.Mock).mockReturnValue([]);

    await uninstallCommand({});

    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('No Brevo skills installed');
  });

  it('outputs JSON when --json', async () => {
    (skillService.uninstallAll as jest.Mock).mockReturnValue([
      { name: 'brevo-cli', path: fakeSkillPath },
    ]);

    await uninstallCommand({ json: true });

    const parsed = JSON.parse(stdoutSpy.mock.calls[0][0]);
    expect(parsed).toEqual([
      {
        uninstalled: true,
        name: 'brevo-cli',
        path: fakeSkillPath,
      },
    ]);
  });
});
