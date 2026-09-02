import { appCommandGroup, functionCommandGroup } from '../../commands/definitions';

describe('appCommandGroup', () => {
  it('registers the available-scopes command', () => {
    const names = appCommandGroup.commands.map((c) => c.name);
    expect(names).toContain('available-scopes');
  });

  it('available-scopes command supports --json', () => {
    const cmd = appCommandGroup.commands.find((c) => c.name === 'available-scopes');
    expect(cmd).toBeDefined();
    const flags = (cmd!.options ?? []).map((o) => o.flags);
    expect(flags).toContain('--json');
  });
});

// Brevo Functions are GA — functionCommandGroup is always defined in every build.
describe('functionCommandGroup', () => {
  it('is always defined', () => {
    expect(functionCommandGroup).toBeDefined();
  });

  it('registers list, get, activate, deactivate and delete subcommands', () => {
    const names = functionCommandGroup.commands.map((c) => c.name);
    expect(names).toContain('list');
    expect(names).toContain('get');
    expect(names).toContain('activate');
    expect(names).toContain('deactivate');
    expect(names).toContain('delete');
  });

  it.each([
    { command: 'list', expectedFlags: ['--json', '--draft'] },
    { command: 'get', expectedFlags: ['--id <id>', '--json'] },
    { command: 'activate', expectedFlags: ['--id <id>', '--json'] },
    { command: 'deactivate', expectedFlags: ['--id <id>', '--json'] },
    { command: 'delete', expectedFlags: ['--id <id>', '--force', '--json'] },
  ])('$command command supports expected flags', ({ command, expectedFlags }) => {
    const cmd = functionCommandGroup.commands.find((c) => c.name === command);
    expect(cmd).toBeDefined();
    const flags = (cmd!.options ?? []).map((o) => o.flags);
    for (const flag of expectedFlags) {
      expect(flags).toContain(flag);
    }
  });
});
