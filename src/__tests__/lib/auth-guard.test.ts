import { Command } from 'commander';
import { installAuthGuard } from '../../lib/auth-guard';
import * as config from '../../lib/config';
import { CliError } from '../../lib/errors';

jest.mock('../../lib/config');

describe('auth-guard', () => {
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    jest.clearAllMocks();
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it('should allow unauthenticated commands through', async () => {
    const program = new Command();
    installAuthGuard(program);

    program.command('login').action(() => {});
    (config.isAuthenticated as jest.Mock).mockReturnValue(false);

    // Simulate preAction hook for login command
    const hooks = (program as any)._lifeCycleHooks?.preAction;
    if (hooks && hooks.length > 0) {
      const mockActionCommand = { name: () => 'login' } as unknown as Command;
      // Should not throw
      await hooks[0](program, mockActionCommand);
    }
  });

  it('should block authenticated-only commands when not logged in', async () => {
    const program = new Command();
    installAuthGuard(program);

    (config.isAuthenticated as jest.Mock).mockReturnValue(false);

    const hooks = (program as any)._lifeCycleHooks?.preAction;
    if (hooks && hooks.length > 0) {
      const originalArgv = process.argv;
      process.argv = ['node', 'brevo', 'app', 'list'];

      const mockActionCommand = { name: () => 'list' } as unknown as Command;
      expect(() => hooks[0](program, mockActionCommand)).toThrow(CliError);

      process.argv = originalArgv;
    }
  });

  it('should allow commands through when authenticated', async () => {
    const program = new Command();
    installAuthGuard(program);

    (config.isAuthenticated as jest.Mock).mockReturnValue(true);

    const hooks = (program as any)._lifeCycleHooks?.preAction;
    if (hooks && hooks.length > 0) {
      const originalArgv = process.argv;
      process.argv = ['node', 'brevo', 'app', 'list'];

      const mockActionCommand = { name: () => 'list' } as unknown as Command;
      await hooks[0](program, mockActionCommand);

      process.argv = originalArgv;
    }
  });

  it('should allow skill subcommands through without auth', async () => {
    const program = new Command();
    installAuthGuard(program);

    (config.isAuthenticated as jest.Mock).mockReturnValue(false);

    const hooks = (program as any)._lifeCycleHooks?.preAction;
    if (hooks && hooks.length > 0) {
      const originalArgv = process.argv;
      process.argv = ['node', 'brevo', 'skill:cli', 'install'];

      // Same leaf name as `app list` but parented under `skill:cli` — must bypass auth.
      const mockActionCommand = {
        name: () => 'install',
        parent: { name: () => 'skill:cli' },
      } as unknown as Command;
      await hooks[0](program, mockActionCommand);

      process.argv = originalArgv;
    }
  });
});
