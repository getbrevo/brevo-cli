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

// Tests run with __BREVO_PREVIEW__ = true (jest.setup.js), so functionCommandGroup
// is defined. The conditional export is tested by the preview-gate suite.
describe('functionCommandGroup', () => {
  it('is defined in a preview build', () => {
    expect(functionCommandGroup).toBeDefined();
  });

  it('registers list, get, activate, deactivate and delete subcommands', () => {
    const names = functionCommandGroup!.commands.map((c) => c.name);
    expect(names).toContain('list');
    expect(names).toContain('get');
    expect(names).toContain('activate');
    expect(names).toContain('deactivate');
    expect(names).toContain('delete');
  });

  it('list command supports --json and --draft', () => {
    const cmd = functionCommandGroup!.commands.find((c) => c.name === 'list');
    expect(cmd).toBeDefined();
    const flags = (cmd!.options ?? []).map((o) => o.flags);
    expect(flags).toContain('--json');
    expect(flags).toContain('--draft');
  });

  it('get command supports --id and --json', () => {
    const cmd = functionCommandGroup!.commands.find((c) => c.name === 'get');
    expect(cmd).toBeDefined();
    const flags = (cmd!.options ?? []).map((o) => o.flags);
    expect(flags).toContain('--id [id]');
    expect(flags).toContain('--json');
  });

  it('activate command supports --id and --json', () => {
    const cmd = functionCommandGroup!.commands.find((c) => c.name === 'activate');
    expect(cmd).toBeDefined();
    const flags = (cmd!.options ?? []).map((o) => o.flags);
    expect(flags).toContain('--id [id]');
    expect(flags).toContain('--json');
  });

  it('deactivate command supports --id and --json', () => {
    const cmd = functionCommandGroup!.commands.find((c) => c.name === 'deactivate');
    expect(cmd).toBeDefined();
    const flags = (cmd!.options ?? []).map((o) => o.flags);
    expect(flags).toContain('--id [id]');
    expect(flags).toContain('--json');
  });

  it('delete command supports --id, --force and --json', () => {
    const cmd = functionCommandGroup!.commands.find((c) => c.name === 'delete');
    expect(cmd).toBeDefined();
    const flags = (cmd!.options ?? []).map((o) => o.flags);
    expect(flags).toContain('--id [id]');
    expect(flags).toContain('--force');
    expect(flags).toContain('--json');
  });
});
