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

describe('functionCommandGroup', () => {
  it('registers list and get subcommands', () => {
    const names = functionCommandGroup.commands.map((c) => c.name);
    expect(names).toContain('list');
    expect(names).toContain('get');
  });

  it('list command supports --json and --draft', () => {
    const cmd = functionCommandGroup.commands.find((c) => c.name === 'list');
    expect(cmd).toBeDefined();
    const flags = (cmd!.options ?? []).map((o) => o.flags);
    expect(flags).toContain('--json');
    expect(flags).toContain('--draft');
  });

  it('get command supports --json', () => {
    const cmd = functionCommandGroup.commands.find((c) => c.name === 'get');
    expect(cmd).toBeDefined();
    const flags = (cmd!.options ?? []).map((o) => o.flags);
    expect(flags).toContain('--json');
  });

  it('get command takes an <id> argument', () => {
    const cmd = functionCommandGroup.commands.find((c) => c.name === 'get');
    expect(cmd).toBeDefined();
    expect(cmd!.arguments).toBeDefined();
    expect(cmd!.arguments!.some((a) => a.name.includes('id'))).toBe(true);
  });
});
