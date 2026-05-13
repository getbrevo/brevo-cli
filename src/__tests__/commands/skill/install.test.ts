jest.mock('../../../services/skill', () => ({
  skillService: {
    installAll: jest.fn(),
  },
}));

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

  it('installs every catalog skill', async () => {
    (skillService.installAll as jest.Mock).mockReturnValue([
      {
        name: 'brevo-cli',
        version: '1.0.0',
        status: 'installed',
        path: '/tmp/skills/brevo-cli',
      },
    ]);

    await installCommand({});

    expect(skillService.installAll).toHaveBeenCalledWith();
    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('Installed brevo-cli@1.0.0');
  });

  it('reports "already up to date" without overwriting', async () => {
    (skillService.installAll as jest.Mock).mockReturnValue([
      {
        name: 'brevo-cli',
        version: '1.0.0',
        status: 'already-installed',
        path: '/tmp/skills/brevo-cli',
      },
    ]);

    await installCommand({});

    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('already up to date');
  });

  it('outputs JSON when --json', async () => {
    (skillService.installAll as jest.Mock).mockReturnValue([
      {
        name: 'brevo-cli',
        version: '1.0.0',
        status: 'installed',
        path: '/tmp/skills/brevo-cli',
      },
    ]);

    await installCommand({ json: true });

    const parsed = JSON.parse(stdoutSpy.mock.calls[0][0]);
    expect(parsed).toEqual([
      {
        name: 'brevo-cli',
        version: '1.0.0',
        status: 'installed',
        path: '/tmp/skills/brevo-cli',
      },
    ]);
  });
});
