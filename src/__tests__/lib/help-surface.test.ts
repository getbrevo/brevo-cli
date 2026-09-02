/**
 * The command surface as a user meets it: what `--help` shows, and what the parser
 * registers.
 *
 * These build the real command tree the way `bin/index.ts` does, and exist because the
 * CLI has **two independent help renderers** and nothing propagates between them:
 * Commander generates `brevo app --help` from the definitions, while `lib/help.ts`'s
 * `formatRootHelp` is a hand-aligned string that `hidden`, `description` and the option
 * list cannot reach. A command added, removed or hidden in one has to be changed in the
 * other by hand — and they have silently disagreed before, which is what this file is
 * here to catch.
 *
 * Descended from `preview-gate.test.ts`, which asserted the same surface twice, once per
 * build state, while the pre-GA gate could remove commands from a published build. That
 * gate is gone (BEX-405) and there is one artifact again, so the per-build
 * parametrization and the `jest.isolateModules` re-imports it needed went with it. The
 * surface assertions did not: they were never really about the gate.
 */
import { Command } from 'commander';
import { createHelpFormatter } from '../../lib/help';
import { registerAll } from '../../lib/command-registry';
import { appCommandGroup, skillCommandGroup, topLevelCommands } from '../../commands/definitions';

function render(cmd: Command): string {
  let captured = '';
  cmd.configureOutput({ writeOut: (s) => (captured += s), writeErr: (s) => (captured += s) });
  cmd.outputHelp();
  return captured;
}

function buildTree(): { program: Command; rootHelp: string; appHelp: string } {
  const program = new Command();
  program
    .name('brevo')
    .description('Brevo Developer CLI — create, manage, and test OAuth integrations')
    .version('0.0.0-test')
    .configureHelp({ formatHelp: createHelpFormatter(program) });
  registerAll(program, topLevelCommands, [appCommandGroup, skillCommandGroup]);

  return {
    program,
    rootHelp: render(program),
    appHelp: render(program.commands.find((c) => c.name() === 'app')!),
  };
}

/**
 * Every `brevo app` subcommand.
 *
 * Padded matches throughout: a bare `toContain('install')` is satisfied by `uninstall`'s
 * help entry, so the one test proving `app install` is listed would stay green if only
 * `install` were dropped. Same trap for `status` against `start`.
 */
const APP_COMMANDS = [
  'init',
  'create',
  'list',
  'credentials',
  'upload',
  'delete',
  'scaffold',
  'start',
  'install',
  'uninstall',
  'submit',
  'status',
  'withdraw',
];

/** The two `requires`-derived groupings, stated as prose on the root screen. */
const SECTION_HEADINGS = ['App-review commands', 'App-install commands'];

/** The review lifecycle — the three commands whose `requires` is `review-lifecycle`. */
const REVIEW_LIFECYCLE = ['submit', 'status', 'withdraw'];

describe('the command surface', () => {
  let tree: ReturnType<typeof buildTree>;
  beforeAll(() => {
    tree = buildTree();
  });

  it.each(APP_COMMANDS)('lists `app %s` on `brevo app --help`', (name) => {
    expect(tree.appHelp).toContain(` ${name} `);
  });

  it.each(REVIEW_LIFECYCLE)('registers `app %s` on the parser', (name) => {
    const app = tree.program.commands.find((c) => c.name() === 'app')!;
    expect(app.commands.find((c) => c.name() === name)).toBeDefined();
  });

  it.each(SECTION_HEADINGS)('renders the "%s" section on the root help', (heading) => {
    expect(tree.rootHelp).toContain(heading);
  });

  // The two-renderer trap, as a worked example. `withdraw` was marked `hidden` while the
  // review lifecycle was being finished — which suppressed its Commander help entry and
  // did nothing at all to the hand-aligned root screen, where the same omission had to be
  // made and then undone by hand. A change to one and not the other is what this pair
  // catches.
  it('lists `app withdraw` on both help screens', () => {
    expect(tree.appHelp).toContain(' withdraw ');
    expect(tree.rootHelp).toContain('brevo app withdraw');
    expect(tree.rootHelp).toContain('Withdraw an app from submission');
  });

  it('answers `app withdraw --help` with its own usage', () => {
    const app = tree.program.commands.find((c) => c.name() === 'app')!;
    const withdraw = app.commands.find((c) => c.name() === 'withdraw')!;
    const own = render(withdraw);
    expect(own).toContain('Usage: brevo app withdraw');
    expect(own).toContain('--app-id');
    expect(own).toContain('--force');
  });

  it('keeps the "App-install commands" section on the root help', () => {
    expect(tree.rootHelp).toContain('App-install commands (UI apps only):');
    expect(tree.rootHelp).toContain('brevo app install');
    expect(tree.rootHelp).toContain('brevo app uninstall');
  });

  // `--distribution`'s value list and `app create`'s description are each written twice —
  // once in `definitions.ts` for Commander, once inline in `formatRootHelp`. Both spellings
  // are asserted so a change to one is not mistaken for a change to both.
  describe('--distribution and the create description, in both renderers', () => {
    it('advertises both distribution values on the root help', () => {
      expect(tree.rootHelp).toContain('private|public');
    });

    it('offers both --distribution values in `app create --help`', () => {
      const createHelp = render(
        tree.program.commands
          .find((c) => c.name() === 'app')!
          .commands.find((c) => c.name() === 'create')!,
      );
      expect(createHelp).toContain('Distribution type (private|public)');
      expect(createHelp).toContain('--distribution private');
      expect(createHelp).toContain('--distribution public');
    });

    // The `app --help` copy is compared whitespace-normalized: Commander wraps a long
    // description across its two-column layout, so the string is present but broken over
    // lines. The root screen is hand-aligned onto one line and is matched verbatim.
    it('advertises UI apps in the create description on both screens', () => {
      const expected = 'Create a new app (OAuth, or a UI app via the prompts)';
      expect(tree.rootHelp).toContain(expected);
      expect(tree.appHelp.replace(/\s+/g, ' ')).toContain(expected);
    });
  });
});
