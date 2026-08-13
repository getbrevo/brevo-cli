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

type Tree = {
  program: Command;
  rootHelp: string;
  appHelp: string;
};

/**
 * Build the command tree as a given build state would produce it.
 *
 * `isolateModules` is what makes this possible at all: `commands/definitions.ts`
 * resolves its command list, `app create`'s description, the `--distribution` values
 * and the example list at module load, all from `__BREVO_PREVIEW__`. Re-importing with
 * the global flipped reproduces what esbuild bakes into each artifact, so both builds
 * are covered by one test run without building twice.
 */
function buildTree(previewBuild: boolean): Tree {
  const original = globalThis.__BREVO_PREVIEW__;
  globalThis.__BREVO_PREVIEW__ = previewBuild;

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
  globalThis.__BREVO_PREVIEW__ = original;
  return tree!;
}

/**
 * Load the `messages` object as a given build state would produce it.
 *
 * Same `isolateModules` trick as {@link buildTree}, for the same reason: `lang/en.ts`
 * decides at module load whether to spread `previewMessages` in, so the only way to see
 * a public build's `messages` from a suite that runs with `__BREVO_PREVIEW__= true`
 * (jest.setup.js, deliberately) is to re-import with the flag flipped.
 */
function loadMessages(previewBuild: boolean): Record<string, unknown> {
  const original = globalThis.__BREVO_PREVIEW__;
  globalThis.__BREVO_PREVIEW__ = previewBuild;

  let loaded: Record<string, unknown> | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    loaded = require('../../lang/en').messages;
  });
  globalThis.__BREVO_PREVIEW__ = original;
  return loaded!;
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

/**
 * The gated commands a preview build actually advertises.
 *
 * `withdraw` is the exception, and for a different reason than the gate: it carries
 * `hidden: true` in `commands/preview-definitions.ts`, which suppresses its help entry
 * without touching the parser. So a preview build registers it and runs it but lists it
 * nowhere — asserted on its own below, since "hidden" and "absent" are different claims
 * and only the gate makes the second one.
 */
const GATED_LISTED = GATED.filter((name) => name !== 'withdraw');

/** A representative ungated command per section, to prove the filter is not too wide. */
const UNGATED = ['init', 'create', 'list', 'credentials', 'upload', 'delete', 'scaffold', 'start'];

describe('the pre-GA gate, end to end', () => {
  describe('a published (public) build', () => {
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

    // Not registered at all, so Commander answers `unknown command` rather than the
    // typed refusal. That is the honest answer here and a deliberate change from the
    // earlier runtime gate: with the modules eliminated at build time the command
    // genuinely does not exist in this artifact, so claiming it exists-but-is-withheld
    // would be the lie. The typed refusal survives only where a value must still be
    // parsed and rejected — see `--distribution public` in create.test.ts.
    it.each(GATED)('does not register `app %s`', (name) => {
      const app = tree.program.commands.find((c) => c.name() === 'app')!;
      expect(app.commands.find((c) => c.name() === name)).toBeUndefined();
    });

    // Regression: the legacy-'all'-scope deprecation (BEX-214) is GA, and its strings are
    // read by `app upload` and `app start`, which ship in every build. BEX-405 moved
    // `_DEPRECATED_BLOCK` into `lang/preview-messages.ts` with the genuinely gated strings,
    // so a public build eliminated the definition while leaving the read — and
    // `new CliError(undefined)` has `message === ''`. `brevo app upload` on any app still
    // holding the 'all' scope printed a bare `✗` and exited 1, telling the one group of
    // users who need the migration text precisely nothing.
    //
    // Asserted on the whole family rather than the one key that broke: they are GA
    // together, and a future tidy-up that sweeps "legacy scope" strings into the gated
    // module would take the others the same way. The suite runs preview-side by design
    // (jest.setup.js), which is why this has to flip the flag to see the bug at all.
    // `scripts/build.mjs` enforces the general rule on the emitted bundle.
    it.each([
      'LEGACY_ALL_SCOPE_DEPRECATED_BLOCK',
      'LEGACY_ALL_SCOPE_START_BLOCK',
      'LEGACY_ALL_SCOPE_LIST_TAG',
      'LEGACY_ALL_SCOPE_SCAFFOLD_SUBSTITUTED',
      'LEGACY_ALL_SCOPE_UPDATE_MIGRATING',
    ])('still defines messages.%s', (key) => {
      const value = loadMessages(false)[key];
      expect(value).toBeDefined();
      expect(typeof value === 'string' ? value : 'fn').not.toBe('');
    });

    // The failure mode above, stated as the user-visible symptom rather than the cause:
    // a CliError built from a missing message renders as an empty line, not an error.
    it('builds a non-empty CliError from the legacy-scope block', () => {
      const messages = loadMessages(false);
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { CliError } = require('../../lib/errors');
      const err = new CliError(messages.LEGACY_ALL_SCOPE_DEPRECATED_BLOCK as string);
      expect(err.message).not.toBe('');
      expect(err.message).toContain("'all'");
    });
  });

  describe('a preview build (PREVIEW=1 yarn link:dev)', () => {
    let tree: Tree;
    beforeAll(() => {
      tree = buildTree(true);
    });

    it.each(GATED_LISTED)('lists `app %s`', (name) => {
      expect(tree.appHelp).toContain(name);
    });

    it.each(GATED_HEADINGS)('restores the "%s" section', (heading) => {
      expect(tree.rootHelp).toContain(heading);
    });

    // Both renderers, because they are independent: Commander's `hidden` filters the
    // generated `brevo app --help`, and the hand-aligned root screen is a string it
    // cannot reach, so that omission is maintained by hand in `lib/help.ts`. A change
    // to one and not the other is exactly what this pair is here to catch.
    it('lists `app withdraw` on neither help screen', () => {
      expect(tree.appHelp).not.toContain('withdraw');
      expect(tree.rootHelp).not.toContain('withdraw');
    });

    // Hidden, not withheld. The section it would sit in is still rendered, and the
    // command itself is registered, parses its flags and reaches its handler — so
    // anyone who types it (QA suite 7, the public-app smoke script, the hint `app
    // upload` prints when an app is under review) gets the command, not a refusal.
    it('still registers `app withdraw` and answers its own --help', () => {
      const app = tree.program.commands.find((c) => c.name() === 'app')!;
      const withdraw = app.commands.find((c) => c.name() === 'withdraw');

      expect(withdraw).toBeDefined();

      const own = render(withdraw!);
      expect(own).toContain('Usage: brevo app withdraw');
      expect(own).toContain('--app-id');
      expect(own).toContain('--force');
    });

    it('advertises both distribution values and the UI-app choice', () => {
      expect(tree.rootHelp).toContain('private|public');
      expect(tree.rootHelp).toMatch(/UI app/i);
    });
  });
});
