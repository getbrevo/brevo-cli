import { withdrawCommand } from '../../../commands/app/withdraw';
import { ApiError } from '../../../lib/errors';

jest.mock('inquirer', () => ({
  prompt: jest.fn(),
}));

jest.mock('../../../container', () => ({
  appService: {
    fetchAppsList: jest.fn(),
    withdrawApp: jest.fn(),
  },
  accountService: {},
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

describe('app/withdraw', () => {
  let stdoutSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    jest.clearAllMocks();
    // Default: not inside a scaffolded project (no app-config.json).
    mockReadProjectConfig.mockReturnValue(null);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  const output = () => stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');

  it('should withdraw app with --force and --appId', async () => {
    (appService.withdrawApp as jest.Mock).mockResolvedValue(undefined);

    await withdrawCommand({ appId: '42', force: true });

    expect(appService.withdrawApp).toHaveBeenCalledWith('42');
    expect(output()).toContain('42');
    expect(output()).toContain('withdrawn');
  });

  it('should withdraw by UUID app-id', async () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    (appService.withdrawApp as jest.Mock).mockResolvedValue(undefined);

    await withdrawCommand({ appId: uuid, force: true });

    expect(appService.withdrawApp).toHaveBeenCalledWith(uuid);
  });

  it('should output JSON when --json flag is used', async () => {
    (appService.withdrawApp as jest.Mock).mockResolvedValue(undefined);

    await withdrawCommand({ appId: '42', force: true, json: true });

    const parsed = JSON.parse(stdoutSpy.mock.calls[0][0]);
    expect(parsed).toEqual({ withdrawn: true, appId: '42' });
  });

  it('should cancel when user declines confirmation', async () => {
    mockPrompt.mockResolvedValueOnce({ confirmed: false });

    await withdrawCommand({ appId: '42' });

    expect(appService.withdrawApp).not.toHaveBeenCalled();
    expect(output()).toContain('cancelled');
  });

  it('should withdraw when user confirms', async () => {
    mockPrompt.mockResolvedValueOnce({ confirmed: true });
    (appService.withdrawApp as jest.Mock).mockResolvedValue(undefined);

    await withdrawCommand({ appId: '42' });

    expect(appService.withdrawApp).toHaveBeenCalledWith('42');
  });

  it('should prompt app picker when no appId provided', async () => {
    (appService.fetchAppsList as jest.Mock).mockResolvedValue([
      { app_id: '1', client_id: 'cli-123' },
      { app_id: '2', client_id: 'cli-456' },
    ]);
    mockPrompt
      .mockResolvedValueOnce({ selectedApp: '1' }) // app picker
      .mockResolvedValueOnce({ confirmed: true }); // confirmation
    (appService.withdrawApp as jest.Mock).mockResolvedValue(undefined);

    await withdrawCommand({});

    expect(appService.fetchAppsList).toHaveBeenCalled();
    expect(appService.withdrawApp).toHaveBeenCalledWith('1');
  });

  it('should throw when no apps exist and no appId provided', async () => {
    (appService.fetchAppsList as jest.Mock).mockResolvedValue([]);

    await expect(withdrawCommand({})).rejects.toThrow('No apps found');
  });

  it('should auto-pick appId from app-config.json when inside a project dir', async () => {
    mockReadProjectConfig.mockReturnValue({ appId: '77', appName: 'Linked App' });
    mockPrompt.mockResolvedValueOnce({ confirmed: true }); // confirmation only, no picker
    (appService.withdrawApp as jest.Mock).mockResolvedValue(undefined);

    await withdrawCommand({});

    expect(appService.fetchAppsList).not.toHaveBeenCalled(); // picker skipped
    expect(appService.withdrawApp).toHaveBeenCalledWith('77');
  });

  it('should auto-pick from app-config.json with --force (no prompts)', async () => {
    mockReadProjectConfig.mockReturnValue({ appId: '77', appName: 'Linked App' });
    (appService.withdrawApp as jest.Mock).mockResolvedValue(undefined);

    await withdrawCommand({ force: true });

    expect(mockPrompt).not.toHaveBeenCalled();
    expect(appService.fetchAppsList).not.toHaveBeenCalled();
    expect(appService.withdrawApp).toHaveBeenCalledWith('77');
  });

  it('should let an explicit --app-id override app-config.json', async () => {
    mockReadProjectConfig.mockReturnValue({ appId: '77', appName: 'Linked App' });
    (appService.withdrawApp as jest.Mock).mockResolvedValue(undefined);

    await withdrawCommand({ appId: '42', force: true });

    expect(mockReadProjectConfig).not.toHaveBeenCalled(); // flag short-circuits resolution
    expect(appService.withdrawApp).toHaveBeenCalledWith('42');
  });

  it('should report "not submitted" and exit 0 (no throw) on HTTP 422', async () => {
    (appService.withdrawApp as jest.Mock).mockRejectedValue(new ApiError('nope', 422));

    await expect(withdrawCommand({ appId: '42', force: true })).resolves.toBeUndefined();

    expect(output()).toContain('has not been submitted');
    expect(output()).toContain('brevo app submit --app-id 42');
  });

  it('should report "not submitted" as JSON on HTTP 422 with --json', async () => {
    (appService.withdrawApp as jest.Mock).mockRejectedValue(new ApiError('nope', 422));

    await withdrawCommand({ appId: '42', force: true, json: true });

    const parsed = JSON.parse(stdoutSpy.mock.calls[0][0]);
    expect(parsed).toMatchObject({
      withdrawn: false,
      appId: '42',
      reason: 'NOT_SUBMITTED',
      submitCommand: 'brevo app submit --app-id 42',
    });
  });

  it('should propagate non-422 errors', async () => {
    (appService.withdrawApp as jest.Mock).mockRejectedValue(new ApiError('boom', 500));

    await expect(withdrawCommand({ appId: '42', force: true })).rejects.toThrow('boom');
  });
});
