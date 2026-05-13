import { initCommand } from '../../commands/init';

jest.mock('inquirer', () => ({
  prompt: jest.fn(),
}));

jest.mock('../../lib/config', () => ({
  getApiKey: jest.fn().mockReturnValue('test-key'),
  isAuthenticated: jest.fn(),
  readProjectConfig: jest.fn(),
}));

jest.mock('../../commands/login', () => ({
  loginCommand: jest.fn(),
}));

jest.mock('../../commands/app/create', () => ({
  createCommand: jest.fn(),
}));

jest.mock('../../commands/app/scaffold', () => ({
  scaffoldCommand: jest.fn(),
}));

jest.mock('../../lib/skill-notifier', () => ({
  offerSkillInstall: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../container', () => ({
  appService: {
    fetchApp: jest.fn(),
    fetchAppsList: jest.fn(),
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

import inquirer from 'inquirer';
import { isAuthenticated, readProjectConfig } from '../../lib/config';
import { loginCommand } from '../../commands/login';
import { createCommand } from '../../commands/app/create';
import { scaffoldCommand } from '../../commands/app/scaffold';
import { appService } from '../../container';

const mockPrompt = inquirer.prompt as unknown as jest.Mock;

describe('initCommand', () => {
  let stdoutSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    jest.clearAllMocks();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it('should skip login if already authenticated and create app', async () => {
    (isAuthenticated as jest.Mock).mockReturnValue(true);
    (readProjectConfig as jest.Mock).mockReturnValue(null);
    (createCommand as jest.Mock).mockResolvedValue(undefined);

    await initCommand({});

    expect(loginCommand).not.toHaveBeenCalled();
    expect(createCommand).toHaveBeenCalled();
  });

  it('should login if not authenticated', async () => {
    (isAuthenticated as jest.Mock)
      .mockReturnValueOnce(false) // initial check
      .mockReturnValueOnce(true); // after login check
    (readProjectConfig as jest.Mock).mockReturnValue(null);
    (loginCommand as jest.Mock).mockResolvedValue(undefined);
    (createCommand as jest.Mock).mockResolvedValue(undefined);

    await initCommand({});

    expect(loginCommand).toHaveBeenCalledWith({ suppressNextSteps: true });
  });

  it('should throw if login fails', async () => {
    (isAuthenticated as jest.Mock)
      .mockReturnValueOnce(false) // initial check
      .mockReturnValueOnce(false); // after login — still not authenticated
    (loginCommand as jest.Mock).mockResolvedValue(undefined);

    await expect(initCommand({})).rejects.toThrow('Login failed');
  });

  it('should scaffold existing app when user chooses scaffold', async () => {
    (isAuthenticated as jest.Mock).mockReturnValue(true);
    (readProjectConfig as jest.Mock).mockReturnValue({ appId: '42', appName: 'My App' });
    (appService.fetchApp as jest.Mock).mockResolvedValue({ app_id: '42', name: 'My App' });
    mockPrompt.mockResolvedValueOnce({ action: 'scaffold' });
    (scaffoldCommand as jest.Mock).mockResolvedValue(undefined);

    await initCommand({});

    expect(appService.fetchApp).toHaveBeenCalledWith('42');
    expect(scaffoldCommand).toHaveBeenCalledWith({ appId: '42' });
    expect(createCommand).not.toHaveBeenCalled();
  });

  it('should skip when user chooses skip', async () => {
    (isAuthenticated as jest.Mock).mockReturnValue(true);
    (readProjectConfig as jest.Mock).mockReturnValue({ appId: '42', appName: 'My App' });
    (appService.fetchApp as jest.Mock).mockResolvedValue({ app_id: '42', name: 'My App' });
    mockPrompt.mockResolvedValueOnce({ action: 'skip' });

    await initCommand({});

    expect(createCommand).not.toHaveBeenCalled();
    expect(scaffoldCommand).not.toHaveBeenCalled();
  });

  it('should create new app when user chooses create despite existing config', async () => {
    (isAuthenticated as jest.Mock).mockReturnValue(true);
    (readProjectConfig as jest.Mock).mockReturnValue({ appId: '42', appName: 'My App' });
    (appService.fetchApp as jest.Mock).mockResolvedValue({ app_id: '42', name: 'My App' });
    mockPrompt.mockResolvedValueOnce({ action: 'create' });
    (createCommand as jest.Mock).mockResolvedValue(undefined);

    await initCommand({});

    expect(createCommand).toHaveBeenCalled();
  });

  it('should fall through to create when app no longer exists on server', async () => {
    (isAuthenticated as jest.Mock).mockReturnValue(true);
    (readProjectConfig as jest.Mock).mockReturnValue({ appId: '42', appName: 'Deleted App' });
    (appService.fetchApp as jest.Mock).mockResolvedValue(null);
    (createCommand as jest.Mock).mockResolvedValue(undefined);

    await initCommand({});

    expect(createCommand).toHaveBeenCalled();
  });

  it('should fall through to create when app ID is empty', async () => {
    (isAuthenticated as jest.Mock).mockReturnValue(true);
    (readProjectConfig as jest.Mock).mockReturnValue({ appId: '', appName: 'Bad' });
    (createCommand as jest.Mock).mockResolvedValue(undefined);

    await initCommand({});

    expect(createCommand).toHaveBeenCalled();
  });

  it('should accept a UUID app ID from config and verify it on the server', async () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    (isAuthenticated as jest.Mock).mockReturnValue(true);
    (readProjectConfig as jest.Mock).mockReturnValue({ appId: uuid, appName: 'My App' });
    (appService.fetchApp as jest.Mock).mockResolvedValue({ app_id: uuid, name: 'My App' });
    mockPrompt.mockResolvedValueOnce({ action: 'scaffold' });
    (scaffoldCommand as jest.Mock).mockResolvedValue(undefined);

    await initCommand({});

    expect(appService.fetchApp).toHaveBeenCalledWith(uuid);
    expect(scaffoldCommand).toHaveBeenCalledWith({ appId: uuid });
  });
});
