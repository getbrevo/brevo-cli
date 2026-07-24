import { statusCommand } from '../../../commands/app/status';

jest.mock('../../../container', () => ({
  appService: {
    fetchAppState: jest.fn(),
    pickApp: jest.fn(),
  },
  accountService: {},
  client: {},
}));

jest.mock('../../../lib/config', () => ({
  ...jest.requireActual('../../../lib/config'),
  readProjectConfig: jest.fn(),
}));

import { appService } from '../../../container';
import { readProjectConfig } from '../../../lib/config';

const mockFetchAppState = appService.fetchAppState as jest.Mock;
const mockPickApp = appService.pickApp as jest.Mock;
const mockReadProjectConfig = readProjectConfig as jest.Mock;

describe('app/status', () => {
  let stdoutSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    jest.clearAllMocks();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  const output = () => stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');

  it('should fetch and print status for an explicit --app-id', async () => {
    mockFetchAppState.mockResolvedValue({ state: 'in_review' });

    await statusCommand({ appId: '42' });

    expect(mockFetchAppState).toHaveBeenCalledWith('42');
    expect(output()).toContain('In Review');
    expect(output()).toContain('currently being reviewed');
  });

  it('should output JSON with state and message', async () => {
    mockFetchAppState.mockResolvedValue({ state: 'approved' });

    await statusCommand({ appId: '42', json: true });

    const parsed = JSON.parse(stdoutSpy.mock.calls[0][0]);
    expect(parsed).toEqual({
      state: 'approved',
      message: 'Your app has been approved.',
    });
  });

  it('should resolve the app id from app-config.json when no flag is given', async () => {
    mockReadProjectConfig.mockReturnValue({ appId: '77' });
    mockFetchAppState.mockResolvedValue({ state: 'submitted' });

    await statusCommand({});

    expect(mockFetchAppState).toHaveBeenCalledWith('77');
    expect(mockPickApp).not.toHaveBeenCalled();
  });

  it('should prompt the app picker when no flag and no config', async () => {
    mockReadProjectConfig.mockReturnValue(null);
    mockPickApp.mockResolvedValue('88');
    mockFetchAppState.mockResolvedValue({ state: 'configured' });

    await statusCommand({});

    expect(mockPickApp).toHaveBeenCalled();
    expect(mockFetchAppState).toHaveBeenCalledWith('88');
  });

  it('should prefer the flag over app-config.json', async () => {
    mockReadProjectConfig.mockReturnValue({ appId: '77' });
    mockFetchAppState.mockResolvedValue({ state: 'rejected' });

    await statusCommand({ appId: '42' });

    expect(mockFetchAppState).toHaveBeenCalledWith('42');
  });

  it('should render the changes_requested canned copy', async () => {
    mockFetchAppState.mockResolvedValue({ state: 'changes_requested' });

    await statusCommand({ appId: '42', json: true });

    const parsed = JSON.parse(stdoutSpy.mock.calls[0][0]);
    expect(parsed.state).toBe('changes_requested');
    expect(parsed.message).toContain('Changes have been requested');
  });

  it('should fall back to a generic message for an unknown state', async () => {
    mockFetchAppState.mockResolvedValue({ state: 'archived' });

    await statusCommand({ appId: '42', json: true });

    const parsed = JSON.parse(stdoutSpy.mock.calls[0][0]);
    expect(parsed.state).toBe('archived');
    expect(parsed.message).toContain('archived');
  });

  it('should tolerate a missing state field', async () => {
    mockFetchAppState.mockResolvedValue({});

    await statusCommand({ appId: '42', json: true });

    const parsed = JSON.parse(stdoutSpy.mock.calls[0][0]);
    expect(parsed.state).toBe('');
  });

  it('should propagate errors from the service', async () => {
    mockFetchAppState.mockRejectedValue(new Error('App 999 not found.'));

    await expect(statusCommand({ appId: '999' })).rejects.toThrow('App 999 not found.');
  });
});
