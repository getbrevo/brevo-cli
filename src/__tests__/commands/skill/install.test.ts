jest.mock('../../../services/skill', () => ({
  skillService: {
    install: jest.fn(),
    installAll: jest.fn(),
  },
}));

import { installCommand } from '../../../commands/skill/install';
import { skillService } from '../../../services/skill';
import { CliError } from '../../../lib/errors';

describe('skill/install', () => {
  let stdoutSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    jest.clearAllMocks();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it('throws when neither name nor --all is provided', async () => {
    await expect(installCommand({})).rejects.toThrow(CliError);
  });

  it('installs a single skill by name', async () => {
    (skillService.install as jest.Mock).mockReturnValue({
      name: 'brevo-cli',
      version: '1.0.0',
      status: 'installed',
      path: '/tmp/skills/brevo-cli',
    });

    await installCommand({ name: 'brevo-cli' });

    expect(skillService.install).toHaveBeenCalledWith('brevo-cli', { force: false });
    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('Installed brevo-cli@1.0.0');
  });

  it('passes --force through to the service', async () => {
    (skillService.install as jest.Mock).mockReturnValue({
      name: 'brevo-cli',
      version: '1.0.0',
      status: 'overwritten',
      path: '/tmp/skills/brevo-cli',
    });

    await installCommand({ name: 'brevo-cli', force: true });

    expect(skillService.install).toHaveBeenCalledWith('brevo-cli', { force: true });
    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('Reinstalled brevo-cli@1.0.0');
  });

  it('reports "already installed" without overwriting', async () => {
    (skillService.install as jest.Mock).mockReturnValue({
      name: 'brevo-cli',
      version: '1.0.0',
      status: 'already-installed',
      path: '/tmp/skills/brevo-cli',
    });

    await installCommand({ name: 'brevo-cli' });

    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('already installed');
    expect(output).toContain('--force');
  });

  it('installs all skills with --all', async () => {
    (skillService.installAll as jest.Mock).mockReturnValue([
      { name: 'brevo-cli', version: '1.0.0', status: 'installed', path: '/x' },
      { name: 'second', version: '0.1.0', status: 'installed', path: '/y' },
    ]);

    await installCommand({ all: true });

    expect(skillService.installAll).toHaveBeenCalledWith({ force: false });
    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('Installed 2 skills');
  });

  it('outputs JSON when --json', async () => {
    (skillService.install as jest.Mock).mockReturnValue({
      name: 'brevo-cli',
      version: '1.0.0',
      status: 'installed',
      path: '/tmp/skills/brevo-cli',
    });

    await installCommand({ name: 'brevo-cli', json: true });

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
