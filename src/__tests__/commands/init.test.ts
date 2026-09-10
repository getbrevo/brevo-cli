import { initCommand } from '../../commands/init';

jest.mock('inquirer', () => ({
  prompt: jest.fn(),
}));

jest.mock('../../lib/config', () => ({
  getApiKey: jest.fn().mockReturnValue('test-key'),
  isAuthenticated: jest.fn(),
  readProjectConfig: jest.fn(),
  // Real implementation, not a stub: the closing line branches on it, and the whole
  // point of the branch is that it reads what `create`/`scaffold` left behind.
  isUiAppConfig: (config: { ui_app?: unknown } | null | undefined) => !!config?.ui_app,
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
import { ApiError, AuthExpiredError, ErrorCode } from '../../lib/errors';
import { isAuthenticated, readProjectConfig } from '../../lib/config';
import { loginCommand } from '../../commands/login';
import { createCommand } from '../../commands/app/create';
import { scaffoldCommand } from '../../commands/app/scaffold';
import { appService, accountService } from '../../container';

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
    (accountService.getAccount as jest.Mock).mockResolvedValue({
      email: 'user@example.com',
      organization_id: 'org-1',
      user_id: 1,
    });
    (readProjectConfig as jest.Mock).mockReturnValue(null);
    (createCommand as jest.Mock).mockResolvedValue(undefined);

    await initCommand({});

    expect(accountService.getAccount).toHaveBeenCalled();
    expect(loginCommand).not.toHaveBeenCalled();
    expect(createCommand).toHaveBeenCalled();
  });

  it('should proceed without a login prompt when an expired access token is refreshed', async () => {
    // The refresh (proactive hook or reactive 401 retry) is transparent to
    // init — all it sees is a probe that succeeds.
    (isAuthenticated as jest.Mock).mockReturnValue(true);
    (accountService.getAccount as jest.Mock).mockResolvedValue({
      email: 'user@example.com',
      organization_id: 'org-1',
      user_id: 1,
    });
    (readProjectConfig as jest.Mock).mockReturnValue(null);
    (createCommand as jest.Mock).mockResolvedValue(undefined);

    await initCommand({});

    expect(loginCommand).not.toHaveBeenCalled();
    expect(createCommand).toHaveBeenCalled();
  });

  it.each([
    ['401', new ApiError('Unauthorized', 401, ErrorCode.AUTH_EXPIRED)],
    ['403', new ApiError('Forbidden', 403, ErrorCode.ACCESS_DENIED)],
    ['a cleared session', new AuthExpiredError()],
  ])('should fall through to login when the probe returns %s', async (_label, err) => {
    (isAuthenticated as jest.Mock)
      .mockReturnValueOnce(true) // local creds exist
      .mockReturnValueOnce(true); // after login — authenticated
    (accountService.getAccount as jest.Mock).mockRejectedValue(err);
    (readProjectConfig as jest.Mock).mockReturnValue(null);
    (loginCommand as jest.Mock).mockResolvedValue(undefined);
    (createCommand as jest.Mock).mockResolvedValue(undefined);

    await initCommand({});

    expect(accountService.getAccount).toHaveBeenCalled();
    expect(loginCommand).toHaveBeenCalledWith({ suppressNextSteps: true });
    expect(createCommand).toHaveBeenCalled();
  });

  it.each([
    ['a network error', new ApiError('Network error', 0, ErrorCode.NETWORK_ERROR)],
    ['a server error', new ApiError('Internal server error', 500)],
    ['an unexpected throw', new Error('boom')],
    // An auth gateway (Cloudflare Access etc.) answers with its own 401/403.
    // `brevo login` cannot clear that, so it must not trigger a login prompt.
    ['a 403 auth gateway', new ApiError('Auth gateway', 403, ErrorCode.AUTH_GATEWAY)],
    ['a 401 auth gateway', new ApiError('Auth gateway', 401, ErrorCode.AUTH_GATEWAY)],
  ])('should keep the stored session when the probe fails with %s', async (_label, err) => {
    (isAuthenticated as jest.Mock).mockReturnValue(true);
    (accountService.getAccount as jest.Mock).mockRejectedValue(err);
    (readProjectConfig as jest.Mock).mockReturnValue(null);
    (createCommand as jest.Mock).mockResolvedValue(undefined);

    await initCommand({});

    expect(accountService.getAccount).toHaveBeenCalled();
    expect(loginCommand).not.toHaveBeenCalled();
    expect(createCommand).toHaveBeenCalled();
  });

  it('should ask the user to log in before any prompt when the session is dead', async () => {
    const callOrder: string[] = [];
    (isAuthenticated as jest.Mock).mockReturnValueOnce(true).mockReturnValueOnce(true);
    (accountService.getAccount as jest.Mock).mockRejectedValue(new AuthExpiredError());
    (readProjectConfig as jest.Mock).mockReturnValue({ app_id: '42', app_name: 'My App' });
    (appService.fetchApp as jest.Mock).mockImplementation(() => {
      callOrder.push('fetchApp');
      return Promise.resolve({ app_id: '42', name: 'My App' });
    });
    (loginCommand as jest.Mock).mockImplementation(() => {
      callOrder.push('login');
      return Promise.resolve(undefined);
    });
    mockPrompt.mockImplementation(() => {
      callOrder.push('prompt');
      return Promise.resolve({ action: 'skip' });
    });

    await initCommand({});

    expect(callOrder[0]).toBe('login');
    expect(callOrder).toContain('prompt');
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
    (readProjectConfig as jest.Mock).mockReturnValue({ app_id: '42', app_name: 'My App' });
    (appService.fetchApp as jest.Mock).mockResolvedValue({ app_id: '42', name: 'My App' });
    mockPrompt.mockResolvedValueOnce({ action: 'scaffold' });
    (scaffoldCommand as jest.Mock).mockResolvedValue(undefined);

    await initCommand({});

    expect(appService.fetchApp).toHaveBeenCalledWith('42');
    // scaffold now reads the linked app from cwd's app-config.json itself.
    expect(scaffoldCommand).toHaveBeenCalledWith({});
    expect(createCommand).not.toHaveBeenCalled();
  });

  it('should skip when user chooses skip', async () => {
    (isAuthenticated as jest.Mock).mockReturnValue(true);
    (readProjectConfig as jest.Mock).mockReturnValue({ app_id: '42', app_name: 'My App' });
    (appService.fetchApp as jest.Mock).mockResolvedValue({ app_id: '42', name: 'My App' });
    mockPrompt.mockResolvedValueOnce({ action: 'skip' });

    await initCommand({});

    expect(createCommand).not.toHaveBeenCalled();
    expect(scaffoldCommand).not.toHaveBeenCalled();
  });

  it('should create new app when user chooses create despite existing config', async () => {
    (isAuthenticated as jest.Mock).mockReturnValue(true);
    (readProjectConfig as jest.Mock).mockReturnValue({ app_id: '42', app_name: 'My App' });
    (appService.fetchApp as jest.Mock).mockResolvedValue({ app_id: '42', name: 'My App' });
    mockPrompt.mockResolvedValueOnce({ action: 'create' });
    (createCommand as jest.Mock).mockResolvedValue(undefined);

    await initCommand({});

    expect(createCommand).toHaveBeenCalled();
  });

  it('should fall through to create when app no longer exists on server', async () => {
    (isAuthenticated as jest.Mock).mockReturnValue(true);
    (readProjectConfig as jest.Mock).mockReturnValue({ app_id: '42', app_name: 'Deleted App' });
    (appService.fetchApp as jest.Mock).mockResolvedValue(null);
    (createCommand as jest.Mock).mockResolvedValue(undefined);

    await initCommand({});

    expect(createCommand).toHaveBeenCalled();
  });

  it('should fall through to create when app ID is empty', async () => {
    (isAuthenticated as jest.Mock).mockReturnValue(true);
    (readProjectConfig as jest.Mock).mockReturnValue({ app_id: '', app_name: 'Bad' });
    (createCommand as jest.Mock).mockResolvedValue(undefined);

    await initCommand({});

    expect(createCommand).toHaveBeenCalled();
  });

  it('should accept a UUID app ID from config and verify it on the server', async () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    (isAuthenticated as jest.Mock).mockReturnValue(true);
    (readProjectConfig as jest.Mock).mockReturnValue({ app_id: uuid, app_name: 'My App' });
    (appService.fetchApp as jest.Mock).mockResolvedValue({ app_id: uuid, name: 'My App' });
    mockPrompt.mockResolvedValueOnce({ action: 'scaffold' });
    (scaffoldCommand as jest.Mock).mockResolvedValue(undefined);

    await initCommand({});

    expect(appService.fetchApp).toHaveBeenCalledWith(uuid);
    expect(scaffoldCommand).toHaveBeenCalledWith({});
  });
});
