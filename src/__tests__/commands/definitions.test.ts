import { appCommandGroup } from '../../commands/definitions';

describe('appCommandGroup', () => {
  it('registers the scopes command', () => {
    const names = appCommandGroup.commands.map((c) => c.name);
    expect(names).toContain('scopes');
  });

  it('scopes command supports --json', () => {
    const cmd = appCommandGroup.commands.find((c) => c.name === 'scopes');
    expect(cmd).toBeDefined();
    const flags = (cmd!.options ?? []).map((o) => o.flags);
    expect(flags).toContain('--json');
  });
});
