import { deleteCommand } from '../../../commands/app/delete';

const mockRmSync = jest.fn();
const mockExistsSync = jest.fn().mockReturnValue(true);
jest.mock('node:fs', () => ({
  ...jest.requireActual('node:fs'),
  rmSync: (...args: unknown[]) => mockRmSync(...args),
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
}));

jest.mock('inquirer', () => ({
  prompt: jest.fn(),
}));

jest.mock('../../../container', () => ({
  appService: {
    fetchAppsList: jest.fn(),
    fetchApp: jest.fn(),
    pickApp: jest.fn(),
    createApp: jest.fn(),
    updateApp: jest.fn(),
    deleteApp: jest.fn(),
  },
  accountService: {
    validateApiKey: jest.fn(),
    getAccount: jest.fn(),
  },
  client: {},
}));

jest.mock('../../../lib/config', () => ({
  ...jest.requireActual('../../../lib/config'),
  readProjectConfig: jest.fn(),
}));

import inquirer from 'inquirer';
import { appService } from '../../../container';
import { readProjectConfig } from '../../../lib/config';

const mockPrompt = inquirer.prompt as unknown as jest.Mock;
const mockReadProjectConfig = readProjectConfig as jest.Mock;

describe('app/delete', () => {
  let stdoutSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    jest.clearAllMocks();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it('should delete app with --force and --appId', async () => {
    (appService.deleteApp as jest.Mock).mockResolvedValue(undefined);

    await deleteCommand({ appId: '42', force: true });

    expect(appService.deleteApp).toHaveBeenCalledWith('42');
    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('42');
    expect(output).toContain('deleted');
  });

  it('should delete by UUID app-id', async () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    (appService.deleteApp as jest.Mock).mockResolvedValue(undefined);

    await deleteCommand({ appId: uuid, force: true });

    expect(appService.deleteApp).toHaveBeenCalledWith(uuid);
  });

  it('should output JSON when --json flag is used', async () => {
    (appService.deleteApp as jest.Mock).mockResolvedValue(undefined);

    await deleteCommand({ appId: '42', force: true, json: true });

    const output = stdoutSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed).toEqual({ deleted: true, appId: '42' });
  });

  it('should cancel when user declines confirmation', async () => {
    mockPrompt.mockResolvedValueOnce({ confirmed: false });

    await deleteCommand({ appId: '42' });

    expect(appService.deleteApp).not.toHaveBeenCalled();
    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('cancelled');
  });

  it('should delete when user confirms', async () => {
    mockPrompt.mockResolvedValueOnce({ confirmed: true });
    (appService.deleteApp as jest.Mock).mockResolvedValue(undefined);

    await deleteCommand({ appId: '42' });

    expect(appService.deleteApp).toHaveBeenCalledWith('42');
  });

  it('should prompt app picker when no appId provided', async () => {
    (appService.fetchAppsList as jest.Mock).mockResolvedValue([
      { app_id: '1', client_id: 'cli-123' },
      { app_id: '2', client_id: 'cli-456' },
    ]);
    mockPrompt
      .mockResolvedValueOnce({ selectedApp: '1' }) // app picker
      .mockResolvedValueOnce({ confirmed: true }); // confirmation
    (appService.deleteApp as jest.Mock).mockResolvedValue(undefined);

    await deleteCommand({});

    expect(appService.fetchAppsList).toHaveBeenCalled();
    expect(appService.deleteApp).toHaveBeenCalledWith('1');
  });

  it('should throw when no apps exist and no appId provided', async () => {
    (appService.fetchAppsList as jest.Mock).mockResolvedValue([]);

    await expect(deleteCommand({})).rejects.toThrow('No apps found');
  });

  it('should prompt to delete folder when app-config.json matches deleted app', async () => {
    mockReadProjectConfig.mockReturnValue({ appId: '42' });
    mockPrompt
      .mockResolvedValueOnce({ confirmed: true }) // delete confirmation
      .mockResolvedValueOnce({ deleteFolder: true }); // folder deletion confirmation
    (appService.deleteApp as jest.Mock).mockResolvedValue(undefined);

    await deleteCommand({ appId: '42' });

    expect(mockRmSync).toHaveBeenCalledWith(process.cwd(), { recursive: true, force: true });
  });

  it('should not delete folder when user declines folder prompt', async () => {
    mockReadProjectConfig.mockReturnValue({ appId: '42' });
    mockPrompt
      .mockResolvedValueOnce({ confirmed: true })
      .mockResolvedValueOnce({ deleteFolder: false });
    (appService.deleteApp as jest.Mock).mockResolvedValue(undefined);

    await deleteCommand({ appId: '42' });

    expect(mockRmSync).not.toHaveBeenCalled();
  });

  it('should not prompt for folder deletion when app-config.json does not match', async () => {
    mockReadProjectConfig.mockReturnValue({ appId: '99' });
    mockPrompt.mockResolvedValueOnce({ confirmed: true });
    (appService.deleteApp as jest.Mock).mockResolvedValue(undefined);

    await deleteCommand({ appId: '42' });

    // Only one prompt call (the delete confirmation), no folder prompt
    expect(mockPrompt).toHaveBeenCalledTimes(1);
  });

  it('should not prompt for folder deletion when no app-config.json exists', async () => {
    mockReadProjectConfig.mockReturnValue(null);
    mockPrompt.mockResolvedValueOnce({ confirmed: true });
    (appService.deleteApp as jest.Mock).mockResolvedValue(undefined);

    await deleteCommand({ appId: '42' });

    expect(mockPrompt).toHaveBeenCalledTimes(1);
  });

  it('should skip folder deletion in --force mode', async () => {
    mockReadProjectConfig.mockReturnValue({ appId: '42' });
    (appService.deleteApp as jest.Mock).mockResolvedValue(undefined);

    await deleteCommand({ appId: '42', force: true });

    // No prompts at all in force mode
    expect(mockPrompt).not.toHaveBeenCalled();
  });

  it('should warn when folder deletion fails', async () => {
    mockReadProjectConfig.mockReturnValue({ appId: '42' });
    mockPrompt
      .mockResolvedValueOnce({ confirmed: true })
      .mockResolvedValueOnce({ deleteFolder: true });
    (appService.deleteApp as jest.Mock).mockResolvedValue(undefined);
    mockRmSync.mockImplementationOnce(() => {
      throw new Error('EPERM');
    });

    await deleteCommand({ appId: '42' });

    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('Could not delete folder');
  });
});
