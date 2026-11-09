/**
 * The gate as a user meets it (BEX-405): what `--help` shows, and what the parser
 * registers, in each build.
 *
 * These build the real command tree the way `bin/index.ts` does, rather than testing
 * `isFeatureAvailable` again — the unit coverage in `preview.test.ts` already owns
 * the decision. What is worth asserting here is the wiring: that the decision reaches
 * two independent renderers (the hand-aligned root screen and Commander's generated
 * subcommand screen) and the parser, and that it reaches nothing else.
 *
 * **Nothing is gated today.** Public distribution and the review lifecycle were the last
 * two features behind the gate and shipped at public-apps GA; UI apps went GA before
 * them. So the load-bearing assertion in this file is now the *equality* of the two
 * trees — a published build and a preview build must render and register exactly the
 * same surface. That is a stronger claim than "the gated commands are listed", and it is
 * the one that fails if someone re-gates a shipped feature by accident (a stray
 * `__BREVO_PREVIEW__` wrapper, a definition moved back into a preview module).
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
 * Same `isolateModules` trick as {@link buildTree}. It used to be the only way to see a
 * public build's `messages`, because `lang/en.ts` decided at module load whether to
 * spread `previewMessages` in. That module emptied and was deleted at public-apps GA, so
 * both flags now yield the same object — kept because the regression below is about a
 * *definition surviving elimination*, and re-arming it only takes a gated strings module
 * coming back. `scripts/build.mjs`'s `orphanedPreviewMessageKeys` is the live enforcement
 * either way, and it asserts on the emitted bundle rather than on a re-import.
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

/**
 * The review-lifecycle commands, GA at BEX-405.
 *
 * They were the last entries in this file's `GATED` list and are now asserted the
 * opposite way round: present in both builds, listed on both help screens. `withdraw` is
 * in the same list as the other two, which is the point — it additionally carried
 * `hidden: true` while the lifecycle was being finished, suppressing its Commander help
 * entry without touching the parser, and the matching omission had to be maintained by
 * hand in the hand-aligned root screen. Both were undone at GA; a `GATED_LISTED`
 * exception list is what used to encode the difference and is deliberately gone.
 */
const REVIEW_LIFECYCLE = ['submit', 'status', 'withdraw'];

/** Section headings that must render in every build. */
const SECTION_HEADINGS = ['App-review commands', 'App-install commands'];

/**
 * Every `brevo app` subcommand, all of them GA.
 *
 * Padded matches throughout: a bare `toContain('install')` is satisfied by `uninstall`'s
 * help entry, so the one test proving `app install` survived would stay green if only
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

describe('the pre-GA gate, end to end', () => {
  // The invariant that replaces every "is it hidden in a public build?" assertion this
  // file used to carry. With `FEATURE_STAGE` all-GA, the two artifacts must be the same
  // surface — so re-gating a shipped feature fails here regardless of *how* it was
  // re-gated, which a per-command list could never promise.
  describe('with nothing gated, both builds are the same surface', () => {
    it('renders identical root and `app` help screens', () => {
      const published = buildTree(false);
      const preview = buildTree(true);
      expect(published.rootHelp).toBe(preview.rootHelp);
      expect(published.appHelp).toBe(preview.appHelp);
    });

    it('registers the same `brevo app` subcommands', () => {
      const names = (tree: Tree) =>
        tree.program.commands
          .find((c) => c.name() === 'app')!
          .commands.map((c) => c.name())
          .sort();
      expect(names(buildTree(false))).toEqual(names(buildTree(true)));
    });
  });

  describe.each([
    ['a published (public) build', false],
    ['a preview build (PREVIEW=1 yarn link:dev)', true],
  ])('%s', (_label, previewBuild) => {
    let tree: Tree;
    beforeAll(() => {
      tree = buildTree(previewBuild as boolean);
    });

    it.each(APP_COMMANDS)('lists `app %s` on `brevo app --help`', (name) => {
      expect(tree.appHelp).toContain(` ${name} `);
    });

    it.each(REVIEW_LIFECYCLE)('registers `app %s`', (name) => {
      const app = tree.program.commands.find((c) => c.name() === 'app')!;
      expect(app.commands.find((c) => c.name() === name)).toBeDefined();
    });

    it.each(SECTION_HEADINGS)('renders the "%s" section on the root help', (heading) => {
      expect(tree.rootHelp).toContain(heading);
    });

    // Both renderers, because they are independent: Commander's `hidden` filters the
    // generated `brevo app --help`, and the hand-aligned root screen is a string it
    // cannot reach. `withdraw` was suppressed in both while the review lifecycle was
    // being finished, each by its own mechanism, and un-hidden in both at GA — a change
    // to one and not the other is exactly what this pair is here to catch.
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

    // The flag was always GA; only the `public` value was gated, and it shipped at
    // BEX-405. Dropping the flag would be wrong either way — `--distribution private`
    // is the documented default path.
    it('advertises both distribution values', () => {
      expect(tree.rootHelp).toContain('private|public');
    });

    it('advertises UI apps in the create description', () => {
      expect(tree.rootHelp).toContain('Create a new app (OAuth, or a UI app via the prompts)');
      expect(tree.rootHelp).toMatch(/UI app/i);
    });

    it('keeps the "App-install commands" section on the root help', () => {
      expect(tree.rootHelp).toContain('App-install commands (UI apps only):');
      expect(tree.rootHelp).toContain('brevo app install');
      expect(tree.rootHelp).toContain('brevo app uninstall');
    });

    it('offers both --distribution values in `app create --help`', () => {
      const createHelp = render(
        tree.program.commands
          .find((c) => c.name() === 'app')!
          .commands.find((c) => c.name() === 'create')!,
      );
      expect(createHelp).toContain('--distribution private');
      expect(createHelp).toContain('--distribution public');
    });
  });

  describe('GA strings survive in a published build', () => {
    // Regression: the legacy-'all'-scope deprecation (BEX-214) is GA, and its strings are
    // read by `app upload` and `app start`, which ship in every build. BEX-405 moved
    // `_DEPRECATED_BLOCK` into `lang/preview-messages.ts` with the genuinely gated strings,
    // so a public build eliminated the definition while leaving the read — and
    // `new CliError(undefined)` has `message === ''`. `brevo app upload` on any app still
    // holding the 'all' scope printed a bare `✗` and exited 1, telling the one group of
    // users who need the migration text precisely nothing.
    //
    // Asserted on the whole family rather than the one key that broke: they are GA
    // together, and a future tidy-up that sweeps "legacy scope" strings into a gated
    // module would take the others the same way. Now that no gated strings module exists
    // these pass trivially, which is the correct state, not a reason to delete them — the
    // failure they describe returns the moment one comes back, and `scripts/build.mjs`
    // enforces the general rule on the emitted bundle.
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

    // The review-lifecycle strings made the same trip in the other direction at
    // public-apps GA: out of `preview-messages.ts` and into `en.ts`. A public build that
    // registers `app submit` while its copy was left behind is the same silent failure.
    it.each([
      'APP_SUBMIT_FORM_GATE',
      'APP_SUBMIT_NEXT_STEPS',
      'APP_SUBMIT_NOT_PUBLIC',
      'APP_STATUS_MESSAGE',
      'APP_WITHDRAW_SUCCESS',
      'APP_WITHDRAW_NOT_SUBMITTED',
    ])('defines the review-lifecycle string messages.%s', (key) => {
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
});
