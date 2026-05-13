jest.mock('../../../services/skill', () => ({
  skillService: {
    uninstall: jest.fn(),
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

  it('uninstalls and surfaces the path', async () => {
    (skillService.uninstall as jest.Mock).mockReturnValue({
      name: 'brevo-cli',
      path: '/tmp/skills/brevo-cli',
    });

    await uninstallCommand({ name: 'brevo-cli' });

    expect(skillService.uninstall).toHaveBeenCalledWith('brevo-cli');
    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('Uninstalled brevo-cli');
    expect(output).toContain('/tmp/skills/brevo-cli');
  });

  it('outputs JSON when --json', async () => {
    (skillService.uninstall as jest.Mock).mockReturnValue({
      name: 'brevo-cli',
      path: '/tmp/skills/brevo-cli',
    });

    await uninstallCommand({ name: 'brevo-cli', json: true });

    const parsed = JSON.parse(stdoutSpy.mock.calls[0][0]);
    expect(parsed).toEqual({
      uninstalled: true,
      name: 'brevo-cli',
      path: '/tmp/skills/brevo-cli',
    });
  });
});
