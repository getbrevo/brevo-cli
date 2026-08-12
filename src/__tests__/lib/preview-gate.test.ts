/**
 * The gate as a user meets it (BEX-405): what `--help` shows, and what happens when
 * a hidden command is invoked anyway.
 *
 * These build the real command tree the way `bin/index.ts` does, rather than testing
 * `isFeatureAvailable` again — the unit coverage in `preview.test.ts` already owns
 * the decision. What is worth asserting here is the wiring: that the decision reaches
 * two independent renderers (the hand-aligned root screen and Commander's generated
 * subcommand screen) and the parser, and that it reaches nothing else.
 */
import { Command } from 'commander';
import { messages } from '../../lang/en';
import { PREVIEW_ENV_VAR } from '../../lib/preview';

jest.mock('../../lib/config', () => ({
  ...jest.requireActual('../../lib/config'),
  getEmail: jest.fn(() => undefined),
}));

type Tree = {
  program: Command;
  rootHelp: string;
  appHelp: string;
};

/**
 * Build the command tree with the gate in a known state.
 *
 * `isolateModules` matters: `commands/definitions.ts` resolves `app create`'s
 * description, its `--distribution` values and its example list at module load, so a
 * cached module would carry the previous run's answer.
 */
function buildTree(unlocked: boolean): Tree {
  if (unlocked) {
    process.env[PREVIEW_ENV_VAR] = '1';
  } else {
    delete process.env[PREVIEW_ENV_VAR];
  }

  let tree: Tree | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createHelpFormatter } = require('../../lib/help');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { registerAll } = require('../../lib/command-registry');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const defs = require('../../commands/definitions');

    const program = new Command();
    program
      .name('brevo')
      .description('Brevo Developer CLI — create, manage, and test OAuth integrations')
      .version('0.0.0-test')
      .configureHelp({ formatHelp: createHelpFormatter(program) });
    registerAll(program, defs.topLevelCommands, [defs.appCommandGroup, defs.skillCommandGroup]);

    tree = {
      program,
      rootHelp: render(program),
      appHelp: render(program.commands.find((c) => c.name() === 'app')!),
    };
  });
  return tree!;
}

function render(cmd: Command): string {
  let captured = '';
  cmd.configureOutput({ writeOut: (s) => (captured += s), writeErr: (s) => (captured += s) });
  cmd.outputHelp();
  return captured;
}

/** Every command the pre-GA gate covers, and the section heading it sits under. */
const GATED = ['deploy', 'rollback', 'submit', 'status', 'withdraw'];
const GATED_HEADINGS = ['App-deployment commands', 'App-review commands'];

/** A representative ungated command per section, to prove the filter is not too wide. */
const UNGATED = ['init', 'create', 'list', 'credentials', 'upload', 'delete', 'scaffold', 'start'];

describe('the pre-GA gate, end to end', () => {
  const originalEnv = process.env[PREVIEW_ENV_VAR];
  afterAll(() => {
    process.env[PREVIEW_ENV_VAR] = originalEnv ?? '1';
  });

  describe('locked (logged out, or a non-Brevo account)', () => {
    let tree: Tree;
    beforeAll(() => {
      tree = buildTree(false);
    });

    it.each(GATED)('hides `app %s` from `brevo app --help`', (name) => {
      expect(tree.appHelp).not.toContain(` ${name} `);
    });

    it.each(GATED_HEADINGS)('drops the "%s" section from the root help', (heading) => {
      expect(tree.rootHelp).not.toContain(heading);
    });

    it.each(UNGATED)('still lists `app %s`', (name) => {
      expect(tree.appHelp).toContain(name);
    });

    // The flag is GA; only the `public` value is gated. Dropping the flag would be
    // wrong — `--distribution private` is the documented default path.
    it('keeps --distribution but narrows its advertised values', () => {
      expect(tree.rootHelp).toContain('--distribution private]');
      expect(tree.rootHelp).not.toContain('private|public');
    });

    it('stops advertising UI apps in the create description', () => {
      expect(tree.rootHelp).toContain('Create a new OAuth app');
      expect(tree.rootHelp).not.toMatch(/UI app/i);
    });

    it('drops the --distribution public example from `app create --help`', () => {
      const createHelp = render(
        tree.program.commands
          .find((c) => c.name() === 'app')!
          .commands.find((c) => c.name() === 'create')!,
      );
      expect(createHelp).toContain('--distribution private');
      expect(createHelp).not.toContain('--distribution public');
    });

    // Hidden, not unregistered. An unregistered command would answer `unknown
    // command`, telling the user the CLI has no such command when in fact it has one
    // that isn't released — and it would lose the typed exit code.
    it.each(GATED)('still parses `app %s` and refuses it with a typed message', async (name) => {
      await expect(tree.program.parseAsync(['app', name], { from: 'user' })).rejects.toThrow(
        messages.PREVIEW_FEATURE_UNAVAILABLE,
      );
    });
  });

  describe('unlocked (internal account, or the opt-in env var)', () => {
    let tree: Tree;
    beforeAll(() => {
      tree = buildTree(true);
    });

    it.each(GATED)('lists `app %s`', (name) => {
      expect(tree.appHelp).toContain(name);
    });

    it.each(GATED_HEADINGS)('restores the "%s" section', (heading) => {
      expect(tree.rootHelp).toContain(heading);
    });

    it('advertises both distribution values and the UI-app choice', () => {
      expect(tree.rootHelp).toContain('private|public');
      expect(tree.rootHelp).toMatch(/UI app/i);
    });
  });
});
