import { deployFunctionCommand } from '../../../commands/function/deploy';
import { ApiError } from '../../../lib/errors';

jest.mock('inquirer', () => ({
  prompt: jest.fn(),
}));

jest.mock('../../../container', () => ({
  functionService: {
    fetchDraftFunctionList: jest.fn(),
    fetchContacts: jest.fn(),
    executeTemplate: jest.fn(),
    createFunction: jest.fn(),
    linkFunctionToApp: jest.fn(),
  },
  appService: {
    fetchAppsList: jest.fn(),
  },
}));

import inquirer from 'inquirer';
import { functionService, appService } from '../../../container';

const DRAFT = {
  id: 'draft-001',
  description: 'Calculate customer lifetime value',
  explanation: 'Sums all orders',
  formula: 'SUM(orders)',
  created_at: '2026-01-01T00:00:00Z',
  expires_at: '2026-02-01T00:00:00Z',
};

const DRAFT_LIST = { drafts: [DRAFT], total: 1, limit: 50, offset: 0, has_more: false };
const EMPTY_DRAFT_LIST = { drafts: [], total: 0, limit: 50, offset: 0, has_more: false };
const APP = { app_id: 'app-001', name: 'Test App', client_id: 'c1', redirect_uris: [] };
const CREATED = { id: 'fn-001', name: 'My Function', version: 1 };

/** Set up the standard mocks for a successful interactive deploy flow. */
function setupHappyPath(): void {
  (functionService.fetchDraftFunctionList as jest.Mock).mockResolvedValue(DRAFT_LIST);
  (appService.fetchAppsList as jest.Mock).mockResolvedValue([APP]);
  (functionService.fetchContacts as jest.Mock).mockResolvedValue({ contacts: [] });
  (functionService.executeTemplate as jest.Mock).mockResolvedValue({ result: [] });
  (functionService.linkFunctionToApp as jest.Mock).mockResolvedValue({});
  (functionService.createFunction as jest.Mock).mockResolvedValue(CREATED);
}

describe('function/deploy', () => {
  let stdoutSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    jest.clearAllMocks();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it('should deploy with --id and success', async () => {
    setupHappyPath();
    (inquirer.prompt as unknown as jest.Mock)
      .mockResolvedValueOnce({ selected: 'app-001' }) // app picker
      .mockResolvedValueOnce({ functionName: 'My Function' })
      .mockResolvedValueOnce({ confirmDeploy: true });

    await deployFunctionCommand({ id: 'draft-001' });

    expect(functionService.createFunction).toHaveBeenCalledWith(
      expect.objectContaining({
        draft_id: 'draft-001',
        code: 'SUM(orders)',
        name: 'My Function',
      }),
    );
    expect(functionService.linkFunctionToApp).toHaveBeenCalledWith({
      app_id: 'app-001',
      function_id: 'fn-001',
    });
    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('Function deployed');
    expect(output).toContain('My Function');
  });

  it('should output JSON with --json and report linked/app_id', async () => {
    setupHappyPath();

    await deployFunctionCommand({ id: 'draft-001', json: true, appId: 'app-001' });

    expect(inquirer.prompt).not.toHaveBeenCalled();
    const output = stdoutSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.deployed).toBe(true);
    expect(parsed.id).toBe('fn-001');
    expect(parsed.name).toBe('My Function');
    expect(parsed.version).toBe(1);
    expect(parsed.linked).toBe(true);
    expect(parsed.app_id).toBe('app-001');
  });

  it('should output JSON without --app-id and report linked: false', async () => {
    setupHappyPath();

    await deployFunctionCommand({ id: 'draft-001', json: true });

    const output = stdoutSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.deployed).toBe(true);
    expect(parsed.linked).toBe(false);
    expect(parsed.app_id).toBeUndefined();
    expect(functionService.linkFunctionToApp).not.toHaveBeenCalled();
  });

  it('should report linked: false in JSON when link fails', async () => {
    setupHappyPath();
    (functionService.linkFunctionToApp as jest.Mock).mockRejectedValue(new Error('403 Forbidden'));

    await deployFunctionCommand({ id: 'draft-001', json: true, appId: 'app-001' });

    const output = stdoutSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.deployed).toBe(true);
    expect(parsed.linked).toBe(false);
    expect(parsed.app_id).toBe('app-001');
    // No warning text on stdout — silent mode
    const allOutput = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(allOutput).not.toContain('failed to link');
  });

  it('should use picker flow when no --id', async () => {
    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });

    setupHappyPath();
    (inquirer.prompt as unknown as jest.Mock)
      .mockResolvedValueOnce({ selected: 'draft-001' }) // draft picker
      .mockResolvedValueOnce({ selected: 'app-001' }) // app picker
      .mockResolvedValueOnce({ functionName: 'Picked Function' }) // name
      .mockResolvedValueOnce({ confirmDeploy: true }); // confirm
    (functionService.createFunction as jest.Mock).mockResolvedValue(CREATED);

    await deployFunctionCommand({});

    expect(functionService.createFunction).toHaveBeenCalledWith(
      expect.objectContaining({ draft_id: 'draft-001', name: 'Picked Function' }),
    );

    Object.defineProperty(process.stdin, 'isTTY', { value: origIsTTY, configurable: true });
  });

  it('should throw when draft not found', async () => {
    (functionService.fetchDraftFunctionList as jest.Mock).mockResolvedValue(EMPTY_DRAFT_LIST);

    await expect(deployFunctionCommand({ id: 'draft-999' })).rejects.toThrow(
      'Draft "draft-999" not found',
    );
  });

  it('should retry on duplicate name (409)', async () => {
    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });

    setupHappyPath();
    (functionService.createFunction as jest.Mock)
      .mockRejectedValueOnce(new ApiError('Conflict', 409))
      .mockResolvedValueOnce(CREATED);
    (inquirer.prompt as unknown as jest.Mock)
      .mockResolvedValueOnce({ selected: 'app-001' }) // app picker
      .mockResolvedValueOnce({ functionName: 'Duplicate Name' }) // first name
      .mockResolvedValueOnce({ confirmDeploy: true }) // first confirm
      .mockResolvedValueOnce({ functionName: 'Unique Name' }) // retry name
      .mockResolvedValueOnce({ confirmDeploy: true }); // retry confirm

    await deployFunctionCommand({ id: 'draft-001' });

    expect(functionService.createFunction).toHaveBeenCalledTimes(2);
    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('already exists');
    expect(output).toContain('Function deployed');

    Object.defineProperty(process.stdin, 'isTTY', { value: origIsTTY, configurable: true });
  });

  it('should cancel when user declines confirmation', async () => {
    setupHappyPath();
    (inquirer.prompt as unknown as jest.Mock)
      .mockResolvedValueOnce({ selected: 'app-001' }) // app picker
      .mockResolvedValueOnce({ functionName: 'My Function' })
      .mockResolvedValueOnce({ confirmDeploy: false });

    await deployFunctionCommand({ id: 'draft-001' });

    expect(functionService.createFunction).not.toHaveBeenCalled();
    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('Deployment cancelled');
  });

  it('should throw on empty draft list when using picker', async () => {
    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });

    (functionService.fetchDraftFunctionList as jest.Mock).mockResolvedValue(EMPTY_DRAFT_LIST);

    await expect(deployFunctionCommand({})).rejects.toThrow('No draft functions found');

    Object.defineProperty(process.stdin, 'isTTY', { value: origIsTTY, configurable: true });
  });

  it('should refuse picker in non-interactive mode', async () => {
    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });

    await expect(deployFunctionCommand({})).rejects.toThrow(
      'Cannot show the draft picker in non-interactive mode',
    );

    Object.defineProperty(process.stdin, 'isTTY', { value: origIsTTY, configurable: true });
  });

  it('should propagate non-409 API errors', async () => {
    setupHappyPath();
    (inquirer.prompt as unknown as jest.Mock)
      .mockResolvedValueOnce({ selected: 'app-001' }) // app picker
      .mockResolvedValueOnce({ functionName: 'My Function' })
      .mockResolvedValueOnce({ confirmDeploy: true });
    (functionService.createFunction as jest.Mock).mockRejectedValue(
      new ApiError('Server error', 500),
    );

    await expect(deployFunctionCommand({ id: 'draft-001' })).rejects.toThrow('Server error');
  });

  it('should treat network preview failure as non-fatal', async () => {
    setupHappyPath();
    (functionService.fetchContacts as jest.Mock).mockRejectedValue(new Error('Network error'));
    (inquirer.prompt as unknown as jest.Mock)
      .mockResolvedValueOnce({ selected: 'app-001' }) // app picker
      .mockResolvedValueOnce({ functionName: 'My Function' })
      .mockResolvedValueOnce({ confirmDeploy: true });
    (functionService.createFunction as jest.Mock).mockResolvedValue(CREATED);

    await deployFunctionCommand({ id: 'draft-001' });

    expect(functionService.createFunction).toHaveBeenCalled();
    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('Failed to preview');
    expect(output).toContain('Function deployed');
  });

  it('should stop the flow when preview returns __error data', async () => {
    setupHappyPath();
    (functionService.executeTemplate as jest.Mock).mockResolvedValue({
      result: [{ __error: 'MCP tool error: query failed' }],
    });
    // No app picker prompt needed — preview fails before app selection (point 4)

    await expect(deployFunctionCommand({ id: 'draft-001' })).rejects.toThrow(
      'Unable to deploy function',
    );
    expect(functionService.createFunction).not.toHaveBeenCalled();
  });

  it('should use --app-id directly without showing the app picker', async () => {
    setupHappyPath();
    (inquirer.prompt as unknown as jest.Mock)
      .mockResolvedValueOnce({ functionName: 'My Function' })
      .mockResolvedValueOnce({ confirmDeploy: true });

    await deployFunctionCommand({ id: 'draft-001', appId: 'explicit-app' });

    // App picker should NOT have been called
    expect(appService.fetchAppsList).not.toHaveBeenCalled();
    expect(functionService.linkFunctionToApp).toHaveBeenCalledWith({
      app_id: 'explicit-app',
      function_id: 'fn-001',
    });
  });

  it('should throw when no function apps exist', async () => {
    setupHappyPath();
    (appService.fetchAppsList as jest.Mock).mockResolvedValue([]);

    await expect(deployFunctionCommand({ id: 'draft-001' })).rejects.toThrow(
      'No Brevo Function apps found',
    );
  });

  it('should show warning on link failure in interactive mode', async () => {
    setupHappyPath();
    (functionService.linkFunctionToApp as jest.Mock).mockRejectedValue(new Error('500 Internal'));
    (inquirer.prompt as unknown as jest.Mock)
      .mockResolvedValueOnce({ selected: 'app-001' }) // app picker
      .mockResolvedValueOnce({ functionName: 'My Function' })
      .mockResolvedValueOnce({ confirmDeploy: true });

    await deployFunctionCommand({ id: 'draft-001' });

    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('failed to link');
    // Deploy still succeeds
    expect(output).toContain('Function deployed');
  });
});
