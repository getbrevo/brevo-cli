jest.mock('../../../services/skill', () => ({
  skillService: {
    update: jest.fn(),
  },
}));

import { updateCommand } from '../../../commands/skill/update';
import { skillService } from '../../../services/skill';

describe('skill/update', () => {
  let stdoutSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    jest.clearAllMocks();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it('updates a single skill', async () => {
    (skillService.update as jest.Mock).mockReturnValue([
      { name: 'brevo-cli', version: '1.0.0', status: 'updated', path: '/x' },
    ]);

    await updateCommand({ name: 'brevo-cli' });

    expect(skillService.update).toHaveBeenCalledWith('brevo-cli');
    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('Updated brevo-cli');
  });

  it('reports nothing-to-update when no installs exist', async () => {
    (skillService.update as jest.Mock).mockReturnValue([]);

    await updateCommand({});

    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('Nothing to update');
  });

  it('updates all installed skills when no name given', async () => {
    (skillService.update as jest.Mock).mockReturnValue([
      { name: 'a', version: '1.0.0', status: 'updated', path: '/x' },
      { name: 'b', version: '2.0.0', status: 'updated', path: '/y' },
    ]);

    await updateCommand({});

    expect(skillService.update).toHaveBeenCalledWith(undefined);
    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('Updated 2 skills');
  });

  it('outputs JSON when --json', async () => {
    (skillService.update as jest.Mock).mockReturnValue([
      { name: 'brevo-cli', version: '1.0.0', status: 'updated', path: '/x' },
    ]);

    await updateCommand({ json: true });

    const parsed = JSON.parse(stdoutSpy.mock.calls[0][0]);
    expect(parsed).toEqual([
      { name: 'brevo-cli', version: '1.0.0', status: 'updated', path: '/x' },
    ]);
  });
});
