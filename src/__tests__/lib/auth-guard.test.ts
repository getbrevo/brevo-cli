import { Command } from 'commander';
import { installAuthGuard } from '../../lib/auth-guard';
import * as config from '../../lib/config';
import { CliError } from '../../lib/errors';

jest.mock('../../lib/config');

/** Minimal commander Command stub with an optional parent, as seen by the preAction hook. */
function mockCommand(name: string, parentName?: string): Command {
  return {
    name: () => name,
    ...(parentName ? { parent: { name: () => parentName } } : {}),
  } as unknown as Command;
}

/** Install the guard on a fresh program and run its preAction hook under the given argv. */
async function runAuthGuard(argv: string[], actionCommand: Command): Promise<void> {
  const program = new Command();
  installAuthGuard(program);

  const hooks = (program as any)._lifeCycleHooks?.preAction;
  if (!hooks || hooks.length === 0) return;

  const originalArgv = process.argv;
  process.argv = argv;
  try {
    await hooks[0](program, actionCommand);
  } finally {
    process.argv = originalArgv;
  }
}

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
    (config.isAuthenticated as jest.Mock).mockReturnValue(false);

    await expect(
      runAuthGuard(['node', 'brevo', 'login'], mockCommand('login')),
    ).resolves.toBeUndefined();
  });

  it('should block authenticated-only commands when not logged in', async () => {
    (config.isAuthenticated as jest.Mock).mockReturnValue(false);

    await expect(
      runAuthGuard(['node', 'brevo', 'app', 'list'], mockCommand('list')),
    ).rejects.toThrow(CliError);
  });

  it('should allow commands through when authenticated', async () => {
    (config.isAuthenticated as jest.Mock).mockReturnValue(true);

    await expect(
      runAuthGuard(['node', 'brevo', 'app', 'list'], mockCommand('list')),
    ).resolves.toBeUndefined();
  });

  it('should allow app available-scopes through without auth (public IdP catalog)', async () => {
    (config.isAuthenticated as jest.Mock).mockReturnValue(false);

    await expect(
      runAuthGuard(
        ['node', 'brevo', 'app', 'available-scopes'],
        mockCommand('available-scopes', 'app'),
      ),
    ).resolves.toBeUndefined();
  });

  it('should allow skill subcommands through without auth', async () => {
    (config.isAuthenticated as jest.Mock).mockReturnValue(false);

    // Same leaf name as `app list` but parented under `skill:cli` — must bypass auth.
    await expect(
      runAuthGuard(['node', 'brevo', 'skill:cli', 'install'], mockCommand('install', 'skill:cli')),
    ).resolves.toBeUndefined();
  });
});
