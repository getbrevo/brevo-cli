jest.mock('../../../services/skill', () => {
  const actual = jest.requireActual('../../../services/skill');
  return {
    parseSkillAgents: actual.parseSkillAgents,
    skillService: {
      installAll: jest.fn(),
    },
  };
});

import { installCommand } from '../../../commands/skill/install';
import { skillService } from '../../../services/skill';

describe('skill/install', () => {
  let stdoutSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    jest.clearAllMocks();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  const fakeSkillPath = '/home/user/.claude/skills/brevo-cli';

  it('installs every catalog skill', async () => {
    (skillService.installAll as jest.Mock).mockReturnValue([
      {
        name: 'brevo-cli',
        version: '1.0.0',
        status: 'installed',
        path: fakeSkillPath,
        agents: ['claude'],
      },
    ]);

    await installCommand({});

    expect(skillService.installAll).toHaveBeenCalledWith({ agents: ['claude'] });
    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('Installed brevo-cli@1.0.0 for claude');
    expect(output).toContain('--agent codex,gemini');
  });

  it('installs for the agents given with --agent, without the other-agents hint', async () => {
    (skillService.installAll as jest.Mock).mockReturnValue([
      {
        name: 'brevo-cli',
        version: '1.0.0',
        status: 'installed',
        path: '/home/user/.agents/skills/brevo-cli',
        agents: ['codex', 'gemini'],
      },
    ]);

    await installCommand({ agent: 'codex,gemini' });

    expect(skillService.installAll).toHaveBeenCalledWith({ agents: ['codex', 'gemini'] });
    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('for codex, gemini → /home/user/.agents/skills/brevo-cli');
    expect(output).not.toContain('--agent codex,gemini');
  });

  it('rejects an unknown agent before installing anything', async () => {
    await expect(installCommand({ agent: 'cursor' })).rejects.toThrow(/Unknown agent "cursor"/);
    expect(skillService.installAll).not.toHaveBeenCalled();
  });
});
