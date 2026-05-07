import { logoutCommand } from '../../commands/logout';
import * as config from '../../lib/config';
import inquirer from 'inquirer';

jest.mock('../../lib/config');
jest.mock('inquirer');

describe('logoutCommand', () => {
  let stdoutSpy: jest.SpyInstance;
  const originalIsTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    jest.clearAllMocks();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    if (originalIsTTYDescriptor) {
      Object.defineProperty(process.stdin, 'isTTY', originalIsTTYDescriptor);
    } else {
      Reflect.deleteProperty(process.stdin, 'isTTY');
    }
  });

  it('should show not-authenticated message when not logged in', async () => {
    (config.isAuthenticated as jest.Mock).mockReturnValue(false);

    await logoutCommand({});

    expect(config.deleteCredentialsFile).not.toHaveBeenCalled();
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Not currently authenticated'));
  });

  it('should delete credentials file when logged in and no app credentials', async () => {
    (config.isAuthenticated as jest.Mock).mockReturnValue(true);
    (config.hasAppCredentials as jest.Mock).mockReturnValue(false);
    (config.countAppCredentials as jest.Mock).mockReturnValue(0);

    await logoutCommand({});

    expect(config.deleteCredentialsFile).toHaveBeenCalled();
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Credentials cleared'));
  });

  it('should prompt for confirmation when app credentials exist', async () => {
    Object.defineProperty(process.stdin, 'isTTY', {
      value: true,
      writable: true,
      configurable: true,
    });
    (config.isAuthenticated as jest.Mock).mockReturnValue(true);
    (config.hasAppCredentials as jest.Mock).mockReturnValue(true);
    (config.countAppCredentials as jest.Mock).mockReturnValue(2);
    (inquirer.prompt as unknown as jest.Mock).mockResolvedValue({ confirmed: true });

    await logoutCommand({});

    expect(inquirer.prompt).toHaveBeenCalled();
    expect(config.deleteCredentialsFile).toHaveBeenCalled();
    expect(stdoutSpy).toHaveBeenCalledWith(
      expect.stringContaining('including cached credentials for 2 apps'),
    );
  });

  it('should abort when user declines confirmation', async () => {
    Object.defineProperty(process.stdin, 'isTTY', {
      value: true,
      writable: true,
      configurable: true,
    });
    (config.isAuthenticated as jest.Mock).mockReturnValue(true);
    (config.hasAppCredentials as jest.Mock).mockReturnValue(true);
    (inquirer.prompt as unknown as jest.Mock).mockResolvedValue({ confirmed: false });

    await logoutCommand({});

    expect(config.deleteCredentialsFile).not.toHaveBeenCalled();
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Aborted'));
  });

  it('should skip confirmation with --force flag', async () => {
    (config.isAuthenticated as jest.Mock).mockReturnValue(true);
    (config.hasAppCredentials as jest.Mock).mockReturnValue(true);
    (config.countAppCredentials as jest.Mock).mockReturnValue(3);

    await logoutCommand({ force: true });

    expect(inquirer.prompt).not.toHaveBeenCalled();
    expect(config.deleteCredentialsFile).toHaveBeenCalled();
    expect(stdoutSpy).toHaveBeenCalledWith(
      expect.stringContaining('including cached credentials for 3 apps'),
    );
  });

  it('should show warning message before confirmation prompt', async () => {
    Object.defineProperty(process.stdin, 'isTTY', {
      value: true,
      writable: true,
      configurable: true,
    });
    (config.isAuthenticated as jest.Mock).mockReturnValue(true);
    (config.hasAppCredentials as jest.Mock).mockReturnValue(true);
    (inquirer.prompt as unknown as jest.Mock).mockResolvedValue({ confirmed: true });

    await logoutCommand({});

    expect(stdoutSpy).toHaveBeenCalledWith(
      expect.stringContaining('app credentials (clientId/clientSecret)'),
    );
  });

  it('should throw in non-interactive mode without --force when app credentials exist', async () => {
    Object.defineProperty(process.stdin, 'isTTY', {
      value: undefined,
      writable: true,
      configurable: true,
    });
    (config.isAuthenticated as jest.Mock).mockReturnValue(true);
    (config.hasAppCredentials as jest.Mock).mockReturnValue(true);

    await expect(logoutCommand({})).rejects.toThrow('non-interactive mode');
  });

  it('should output JSON when --json flag is set and not logged in', async () => {
    (config.isAuthenticated as jest.Mock).mockReturnValue(false);

    await logoutCommand({ json: true });

    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('"loggedOut":false'));
  });

  it('should output JSON when --json flag is set and logged in', async () => {
    (config.isAuthenticated as jest.Mock).mockReturnValue(true);
    (config.hasAppCredentials as jest.Mock).mockReturnValue(false);
    (config.countAppCredentials as jest.Mock).mockReturnValue(0);

    await logoutCommand({ json: true });

    expect(config.deleteCredentialsFile).toHaveBeenCalled();
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('"loggedOut":true'));
  });
});
