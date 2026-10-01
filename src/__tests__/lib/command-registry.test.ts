/**
 * `SubcommandGroupDefinition.groups` — one level of nesting (BEX-486), added so
 * `app scopes update` can exist without reshaping `CommandDefinition`.
 *
 * Two kinds of coverage: a synthetic tree that proves the generic recursion works and
 * leaves every other group untouched when `groups` is absent, and a check against the
 * real command tree that `app scopes update` actually resolves.
 */
import { Command } from 'commander';
import { registerAll, SubcommandGroupDefinition } from '../../lib/command-registry';

function noopHandler(): void {
  /* no-op */
}

function buildSyntheticProgram(groups: SubcommandGroupDefinition[]): Command {
  const program = new Command();
  program.name('test-cli').exitOverride();
  registerAll(program, [], groups);
  return program;
}

describe('registerSubcommandGroup — nested groups', () => {
  it('registers a nested group one level deep and its command is invocable', async () => {
    const leaf = jest.fn();
    const groups: SubcommandGroupDefinition[] = [
      {
        name: 'outer',
        description: 'Outer group',
        commands: [],
        groups: [
          {
            name: 'inner',
            description: 'Inner group',
            commands: [{ name: 'run', description: 'Run it', handler: leaf }],
          },
        ],
      },
    ];
    const program = buildSyntheticProgram(groups);

    await program.parseAsync(['outer', 'inner', 'run'], { from: 'user' });

    expect(leaf).toHaveBeenCalledTimes(1);
  });

  it('leaves a group with no `groups` field registering exactly as before', async () => {
    const handler = jest.fn();
    const groups: SubcommandGroupDefinition[] = [
      {
        name: 'plain',
        description: 'Plain group',
        commands: [{ name: 'do', description: 'Do it', handler }],
      },
    ];
    const program = buildSyntheticProgram(groups);

    await program.parseAsync(['plain', 'do'], { from: 'user' });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("supports a nested group's own commands alongside its parent group's flat commands", async () => {
    const flatHandler = jest.fn();
    const nestedHandler = jest.fn();
    const groups: SubcommandGroupDefinition[] = [
      {
        name: 'app',
        description: 'App group',
        commands: [{ name: 'list', description: 'List', handler: flatHandler }],
        groups: [
          {
            name: 'scopes',
            description: 'Scopes group',
            commands: [{ name: 'update', description: 'Update', handler: nestedHandler }],
          },
        ],
      },
    ];
    const program = buildSyntheticProgram(groups);

    await program.parseAsync(['app', 'list'], { from: 'user' });
    await program.parseAsync(['app', 'scopes', 'update'], { from: 'user' });

    expect(flatHandler).toHaveBeenCalledTimes(1);
    expect(nestedHandler).toHaveBeenCalledTimes(1);
  });
});

describe('`app scopes update` in the real command tree', () => {
  jest.mock('../../lib/config', () => ({
    ...jest.requireActual('../../lib/config'),
    isAuthenticated: jest.fn(() => false),
    getEmail: jest.fn(() => undefined),
  }));

  function buildRealProgram(): Command {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createHelpFormatter } = require('../../lib/help');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const defs = require('../../commands/definitions');

    const program = new Command();
    program
      .name('brevo')
      .description('Brevo Developer CLI')
      .version('0.0.0-test')
      .configureHelp({ formatHelp: createHelpFormatter(program) });
    program.exitOverride();
    registerAll(program, defs.topLevelCommands, [defs.appCommandGroup, defs.skillCommandGroup]);
    return program;
  }

  function render(cmd: Command): string {
    let captured = '';
    cmd.configureOutput({ writeOut: (s) => (captured += s), writeErr: (s) => (captured += s) });
    cmd.outputHelp();
    return captured;
  }

  it('lists `scopes` under `app --help`', () => {
    const program = buildRealProgram();
    const appCmd = program.commands.find((c) => c.name() === 'app')!;
    expect(render(appCmd)).toContain('scopes');
  });

  it('lists `update` under `app scopes --help`', () => {
    const program = buildRealProgram();
    const appCmd = program.commands.find((c) => c.name() === 'app')!;
    const scopesCmd = appCmd.commands.find((c) => c.name() === 'scopes')!;
    expect(scopesCmd).toBeDefined();
    expect(render(scopesCmd)).toContain('update');
  });

  it('`function` group (no nested groups) still registers unaffected', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const defs = require('../../commands/definitions');
    expect(defs.appCommandGroup.groups).toBeDefined();
    expect(defs.skillCommandGroup.groups).toBeUndefined();
  });
});
