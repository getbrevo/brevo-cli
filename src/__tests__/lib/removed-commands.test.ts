/**
 * `brevo app update` after BEX-250 removed it.
 *
 * Built against the real command tree the way `bin/index.ts` assembles it, including the
 * auth guard, because every property worth asserting here is a wiring property: the old
 * name still parses, its old flags don't derail the answer, `--help` doesn't escape to a
 * usage screen, and the credential check doesn't get there first. Unit-testing
 * `isRemovedCommand` alone would prove none of that.
 */
import { Command } from 'commander';
import { messages } from '../../lang/en';
import { isRemovedCommand, removedCommandsIn } from '../../lib/removed-commands';

// Logged out, so the auth guard would fire on any command that is not exempt.
jest.mock('../../lib/config', () => ({
  ...jest.requireActual('../../lib/config'),
  isAuthenticated: jest.fn(() => false),
  getEmail: jest.fn(() => undefined),
}));

function buildProgram(): Command {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createHelpFormatter } = require('../../lib/help');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { registerAll } = require('../../lib/command-registry');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { installAuthGuard } = require('../../lib/auth-guard');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const defs = require('../../commands/definitions');

  const program = new Command();
  program
    .name('brevo')
    .description('Brevo Developer CLI — create, manage, and test OAuth integrations')
    .version('0.0.0-test')
    .configureHelp({ formatHelp: createHelpFormatter(program) });
  // Before registerAll, so every subcommand inherits it: a Commander parse error
  // (unknown option, excess argument) must surface as a thrown CommanderError the
  // assertions can see, not as a process.exit that takes the test runner with it.
  program.exitOverride();
  installAuthGuard(program);
  registerAll(program, defs.topLevelCommands, [defs.appCommandGroup, defs.skillCommandGroup]);
  return program;
}

/**
 * Parse an invocation with `process.argv` set to match it.
 *
 * The auth guard reads `process.argv` directly — for `--help`/`--version` and for the
 * bare-`brevo` case — and under Jest's worker processes argv is only two entries long,
 * which the guard reads as "no command given" and waves through. Without this the auth
 * assertions below would pass vacuously in a full-suite run and only bite when this file
 * is run on its own.
 */
async function parse(program: Command, argv: string[]): Promise<void> {
  const originalArgv = process.argv;
  process.argv = ['/usr/bin/node', '/usr/local/bin/brevo', ...argv];
  try {
    await program.parseAsync(argv, { from: 'user' });
  } finally {
    process.argv = originalArgv;
  }
}

function render(cmd: Command): string {
  let captured = '';
  cmd.configureOutput({ writeOut: (s) => (captured += s), writeErr: (s) => (captured += s) });
  cmd.outputHelp();
  return captured;
}

/** Every flag the removed `app update` accepted, as a user might still type them. */
const OLD_INVOCATIONS: Array<[string, string[]]> = [
  ['bare', ['app', 'update']],
  ['--name', ['app', 'update', '--name', 'My App']],
  ['--redirect-uri', ['app', 'update', '--redirect-uri', 'http://localhost:3009/auth/callback']],
  ['--scope', ['app', 'update', '--scope', 'contacts:read']],
  ['--logo-uri', ['app', 'update', '--logo-uri', 'https://example.com/logo.png']],
  ['--app-id', ['app', 'update', '--app-id', '42']],
  ['--yes', ['app', 'update', '--yes']],
  ['--json', ['app', 'update', '--json']],
  ['several at once', ['app', 'update', '--name', 'My App', '--app-id', '42', '--json']],
  // `--help` on a hidden command must reach the message too, not Commander's usage
  // screen (which would exit 0 and tell a script the command succeeded).
  ['--help', ['app', 'update', '--help']],
  ['-h', ['app', 'update', '-h']],
  // Commander's help command calls the target's `help()` directly and does not skip
  // hidden commands, so this route bypasses both the action and the help option.
  ['via the help command', ['app', 'help', 'update']],
  ['a stray operand', ['app', 'update', 'my-app']],
];

describe('`brevo app update` after its removal', () => {
  let program: Command;
  beforeEach(() => {
    program = buildProgram();
  });

  it.each(OLD_INVOCATIONS)('answers with the migration message (%s)', async (_label, argv) => {
    await expect(parse(program, argv)).rejects.toThrow(messages.APP_UPDATE_REMOVED);
  });

  it('names `brevo app upload` as the replacement, and no other command', () => {
    expect(messages.APP_UPDATE_REMOVED).toContain('brevo app upload');
    // Commander's own answer guessed `create` from string distance. Naming it here
    // would resurrect exactly the wrong advice this message exists to replace.
    expect(messages.APP_UPDATE_REMOVED).not.toContain('brevo app create');
  });

  it('tells the user to edit app-config.json instead of reaching for a flag', () => {
    expect(messages.APP_UPDATE_REMOVED).toContain('app-config.json');
    for (const flag of ['--name', '--redirect-uri', '--scope', '--logo-uri', '--app-id']) {
      expect(messages.APP_UPDATE_REMOVED).toContain(flag);
    }
  });

  it('exits 1 — a removed command is a failure, not a no-op', async () => {
    await expect(parse(program, ['app', 'update'])).rejects.toMatchObject({
      name: 'CliError',
      exitCode: 1,
    });
  });

  // The message is the whole point of registering the name; an auth prompt in front of
  // it would send a logged-out user to `brevo login` to read it.
  it('does not require authentication to reach', async () => {
    await expect(parse(program, ['app', 'update'])).rejects.not.toThrow(/Not authenticated/);
  });

  it('stays hidden from `brevo app --help` and the root screen', () => {
    const appHelp = render(program.commands.find((c) => c.name() === 'app')!);
    expect(appHelp).not.toMatch(/\bupdate\b/);
    expect(appHelp).toContain('upload');
    expect(render(program)).not.toMatch(/brevo app update/);
  });

  it('leaves `app upload` a real command', async () => {
    const upload = program.commands
      .find((c) => c.name() === 'app')!
      .commands.find((c) => c.name() === 'upload');
    expect(upload).toBeDefined();
    // Registered normally, so it still demands credentials — proof the auth-guard
    // exemption is scoped to the removed name and nothing else.
    await expect(parse(program, ['app', 'upload'])).rejects.toThrow(/Not authenticated/);
  });
});

describe('the removed-command table', () => {
  it('claims `app update` and nothing that still exists', () => {
    expect(isRemovedCommand('update', 'app')).toBe(true);
    expect(isRemovedCommand('upload', 'app')).toBe(false);
    expect(isRemovedCommand('create', 'app')).toBe(false);
  });

  it('is scoped by group — a top-level `brevo update` is not a removed command', () => {
    expect(isRemovedCommand('update', 'brevo')).toBe(false);
    expect(isRemovedCommand('update')).toBe(false);
  });

  it('has no top-level entries to register', () => {
    expect(removedCommandsIn()).toHaveLength(0);
    expect(removedCommandsIn('app').map((c) => c.name)).toEqual(['update']);
  });
});
