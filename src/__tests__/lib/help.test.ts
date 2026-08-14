import { Command } from 'commander';
import { createHelpFormatter } from '../../lib/help';
import { registerAll } from '../../lib/command-registry';
import {
  topLevelCommands,
  appCommandGroup,
  skillCommandGroup,
  functionCommandGroup,
} from '../../commands/definitions';

// Build the real command tree the same way bin/index.ts does, so these assertions
// run against the actual registered options rather than a stand-in.
function buildProgram(): Command {
  const program = new Command();
  program
    .name('brevo')
    .description('Brevo Developer CLI — create, manage, and test OAuth integrations')
    .version('0.0.0-test')
    .option('--debug', 'Enable debug logging')
    .configureHelp({ formatHelp: createHelpFormatter(program) });
  registerAll(program, topLevelCommands, [
    appCommandGroup,
    skillCommandGroup,
    functionCommandGroup,
  ]);
  return program;
}

function findCommand(program: Command, path: string[]): Command {
  let cursor: Command = program;
  for (const name of path) {
    const next = cursor.commands.find((c) => c.name() === name);
    if (!next) throw new Error(`command not found: ${path.join(' ')} (missing "${name}")`);
    cursor = next;
  }
  return cursor;
}

/**
 * Render help the way the binary does.
 *
 * `helpInformation()` returns only the `formatHelp` output; the per-command
 * `Examples:` blocks are registered with `addHelpText('after', …)` and are
 * appended by `outputHelp()`. Going through `outputHelp` keeps these assertions
 * matched to what a user actually sees.
 */
function renderHelp(cmd: Command): string {
  let captured = '';
  cmd.configureOutput({ writeOut: (str) => (captured += str) });
  cmd.outputHelp();
  return captured;
}

describe('help formatting', () => {
  describe('root', () => {
    it('renders the hand-aligned grouped screen', () => {
      const out = renderHelp(buildProgram());

      expect(out).toContain('Usage: brevo [options] [command]');
      expect(out).toContain('App commands:');
      expect(out).toContain('App-deployment commands (UI apps only):');
      expect(out).toContain('App-review commands (public apps only):');
      expect(out).toContain('Skill commands:');
      expect(out).toContain('Function commands:');
      expect(out).toContain('Run `brevo <command> --help` for details on a specific command.');
    });

    it('shows the package description, not a subcommand description', () => {
      expect(renderHelp(buildProgram())).toContain(
        'Brevo Developer CLI — create, manage, and test OAuth integrations',
      );
    });
  });

  // Regression: a single `formatHelp` on the root program is copied down to every
  // subcommand by Commander's copyInheritedSettings, so `brevo app create --help`
  // used to print the root screen — repeating the whole command list and never
  // naming --name/--redirect-uri/etc. The root screen tells users to run
  // `brevo <command> --help` for exactly those details.
  describe('subcommands', () => {
    it('shows app create its own flags, not the root screen', () => {
      const out = renderHelp(findCommand(buildProgram(), ['app', 'create']));

      expect(out).toContain('Usage: brevo app create [options]');
      expect(out).toContain('--name');
      expect(out).toContain('--distribution');
      expect(out).toContain('--redirect-uri');
      expect(out).toContain('--logo-uri');
      expect(out).toContain('--json');

      // None of the root screen's grouping headers may leak in.
      expect(out).not.toContain('App commands:');
      expect(out).not.toContain('App-review commands (public apps only):');
      expect(out).not.toContain('Run `brevo <command> --help`');
    });

    it('documents positional arguments', () => {
      const out = renderHelp(findCommand(buildProgram(), ['app', 'deploy']));

      expect(out).toContain('Usage: brevo app deploy [options] [account-id]');
      expect(out).toContain('Arguments:');
      expect(out).toContain('account-id');
    });

    it('keeps per-command examples registered via addHelpText', () => {
      const out = renderHelp(findCommand(buildProgram(), ['app', 'create']));
      expect(out).toContain('Examples:');
      expect(out).toContain('$ brevo app create');
    });

    it('gives every registered subcommand its own usage line', () => {
      const program = buildProgram();
      const groups = [appCommandGroup, skillCommandGroup, functionCommandGroup];

      for (const group of groups) {
        for (const cmd of group.commands) {
          const out = renderHelp(findCommand(program, [group.name, cmd.name]));
          expect(out).toContain(`Usage: brevo ${group.name} ${cmd.name}`);
          expect(out).not.toContain('App-review commands (public apps only):');
        }
      }

      for (const cmd of topLevelCommands) {
        const out = renderHelp(findCommand(program, [cmd.name]));
        expect(out).toContain(`Usage: brevo ${cmd.name}`);
        expect(out).not.toContain('App-review commands (public apps only):');
      }
    });

    it('lists every option the command declares', () => {
      const program = buildProgram();

      for (const cmd of appCommandGroup.commands) {
        const out = renderHelp(findCommand(program, ['app', cmd.name]));
        for (const opt of cmd.options ?? []) {
          // `opt.flags` is e.g. '--app-id <id>'; the long flag alone is enough
          // to prove the option reached the rendered help.
          const longFlag = opt.flags.split(/[ ,]/)[0];
          expect(out).toContain(longFlag);
        }
      }
    });
  });
});
