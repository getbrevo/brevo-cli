import { submitCommand } from '../../../commands/app/submit';
import { EXIT_CODES } from '../../../lib/exit-codes';

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
  readProjectConfig: jest.fn(),
  getApiKey: jest.fn().mockReturnValue('test-key'),
}));

jest.mock('../../../lib/browser', () => ({
  openBrowser: jest.fn(),
}));

import { appService } from '../../../container';
import { readProjectConfig } from '../../../lib/config';
import { openBrowser } from '../../../lib/browser';

const FORM_URL = 'https://docs.google.com/forms/d/e/test-form/viewform?entry.1=42';

const PUBLIC_APP = {
  app_id: '42',
  name: 'My Test App',
  client_id: 'test-client-id',
  distribution_type: 'public',
  redirect_uris: ['http://localhost:3009/auth/callback', 'https://example.com/callback'],
  scopes: ['crm:read'],
  version: '0.0.2',
  google_form_link: FORM_URL,
};

const MATCHING_CONFIG = {
  appId: '42',
  appName: 'My Test App',
  distribution_type: 'public',
  version: '0.0.2',
  auth: {
    scopes: ['crm:read'],
    redirectUrls: ['http://localhost:3009/auth/callback', 'https://example.com/callback'],
  },
};

describe('app/submit', () => {
  let stdoutSpy: jest.SpyInstance;
  const originalIsTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      writable: true,
      value: true,
    });
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

  const output = () => stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');

  // ── Happy paths ──

  it('opens the submission form when the app is public and in sync', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(MATCHING_CONFIG);
    (appService.fetchApp as jest.Mock).mockResolvedValue(PUBLIC_APP);

    await submitCommand({});

    expect(appService.fetchApp).toHaveBeenCalledWith('42');
    expect(openBrowser).toHaveBeenCalledWith(FORM_URL);
    expect(output()).toContain(FORM_URL);
    expect(output()).toContain('Check status anytime with `brevo app status`');
  });

  it('prints JSON and does not open a browser with --json', async () => {
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    (readProjectConfig as jest.Mock).mockReturnValue(MATCHING_CONFIG);
    (appService.fetchApp as jest.Mock).mockResolvedValue(PUBLIC_APP);

    await submitCommand({ appId: '42', json: true });

    expect(openBrowser).not.toHaveBeenCalled();
    // stdout must stay pure parseable JSON — the next-steps note goes to stderr.
    expect(JSON.parse(output())).toEqual({ app_id: '42', form_url: FORM_URL });
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(stderr).toContain('Check status anytime with `brevo app status`');
    stderrSpy.mockRestore();
  });

  it('uses the --app-id flag over a config describing a different app', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue({ ...MATCHING_CONFIG, appId: '7' });
    (appService.fetchApp as jest.Mock).mockResolvedValue({ ...PUBLIC_APP, app_id: '42' });

    await submitCommand({ appId: '42' });

    expect(appService.fetchApp).toHaveBeenCalledWith('42');
    // The unrelated local config must not trigger a drift error.
    expect(output()).not.toContain('differs from the app on Brevo');
    expect(openBrowser).toHaveBeenCalledWith(FORM_URL);
  });

  it('succeeds and keeps the URL visible when the browser fails to open', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(MATCHING_CONFIG);
    (appService.fetchApp as jest.Mock).mockResolvedValue(PUBLIC_APP);
    (openBrowser as jest.Mock).mockImplementation(() => {
      throw new Error('no display');
    });

    await submitCommand({});

    expect(output()).toContain(FORM_URL);
    expect(output()).toContain('Could not open your browser');
  });

  // ── Distribution gate ──

  it('rejects a private app and points at creating a new public app', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(null);
    (appService.fetchApp as jest.Mock).mockResolvedValue({
      ...PUBLIC_APP,
      distribution_type: 'private',
    });

    const error = await submitCommand({ appId: '42' }).catch((e: Error) => e);
    expect((error as Error).message).toContain('cannot be submitted for public review');
    // BEX-327: distribution can't be flipped after creation — the remedy is a
    // new app, never `app upload --distribution public`.
    expect((error as Error).message).toContain('brevo app create --distribution public');
    expect((error as Error).message).not.toContain('app upload --distribution');
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it('treats a missing distribution_type as not public', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(null);
    (appService.fetchApp as jest.Mock).mockResolvedValue({
      ...PUBLIC_APP,
      distribution_type: undefined,
    });

    await expect(submitCommand({ appId: '42' })).rejects.toThrow(
      'cannot be submitted for public review',
    );
  });

  // ── Sync check ──

  it('blocks submission and shows a value-level diff when local config drifted', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue({
      ...MATCHING_CONFIG,
      auth: { ...MATCHING_CONFIG.auth, scopes: ['crm:read', 'contacts:read'] },
    });
    (appService.fetchApp as jest.Mock).mockResolvedValue(PUBLIC_APP);

    const error = await submitCommand({}).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('differs from the app on Brevo');
    expect((error as Error).message).toContain('Scopes:');
    // Value shared by both sides prints plain; the drifted one is tagged.
    expect((error as Error).message).toContain('crm:read');
    expect((error as Error).message).toContain('contacts:read (local only)');
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it('blocks submission when the local version was bumped but not uploaded', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue({ ...MATCHING_CONFIG, version: '0.0.3' });
    (appService.fetchApp as jest.Mock).mockResolvedValue(PUBLIC_APP);

    const error = await submitCommand({}).catch((e: Error) => e);
    expect((error as Error).message).toContain('Version:');
    expect((error as Error).message).toContain('0.0.3 (local only)');
    expect((error as Error).message).toContain('0.0.2 (server only)');
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it('tags values missing locally as server only in the drift diff', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue({
      ...MATCHING_CONFIG,
      auth: { ...MATCHING_CONFIG.auth, redirectUrls: ['https://example.com/callback'] },
    });
    (appService.fetchApp as jest.Mock).mockResolvedValue(PUBLIC_APP);

    const error = await submitCommand({}).catch((e: Error) => e);
    expect((error as Error).message).toContain('http://localhost:3009/auth/callback (server only)');
  });

  it('keeps the compact field-name drift message in --json mode', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue({
      ...MATCHING_CONFIG,
      appName: 'Renamed App',
      auth: { ...MATCHING_CONFIG.auth, scopes: ['crm:read', 'contacts:read'] },
    });
    (appService.fetchApp as jest.Mock).mockResolvedValue(PUBLIC_APP);

    const error = await submitCommand({ json: true }).catch((e: Error) => e);
    expect((error as Error).message).toContain('(name, scopes)');
    expect((error as Error).message).not.toContain('(local only)');
  });

  it('ignores ordering differences and empty-vs-undefined fields', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue({
      ...MATCHING_CONFIG,
      logoUri: '',
      auth: {
        scopes: [],
        redirectUrls: ['https://example.com/callback', 'http://localhost:3009/auth/callback'],
      },
    });
    (appService.fetchApp as jest.Mock).mockResolvedValue({
      ...PUBLIC_APP,
      scopes: undefined,
      logo_uri: undefined,
    });

    await submitCommand({});

    expect(openBrowser).toHaveBeenCalledWith(FORM_URL);
  });

  // ── App resolution ──

  it('errors with exit code 5 when the app is not found', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(null);
    (appService.fetchApp as jest.Mock).mockResolvedValue(null);

    await expect(submitCommand({ appId: '999' })).rejects.toMatchObject({
      message: 'App 999 not found.',
      exitCode: EXIT_CODES.NOT_FOUND,
    });
  });

  it('errors in --json mode when no app can be resolved', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(null);

    await expect(submitCommand({ json: true })).rejects.toThrow(
      'Cannot determine which app to submit',
    );
    expect(appService.pickApp).not.toHaveBeenCalled();
  });

  it('errors without prompting when non-interactive and no app resolvable', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(null);
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: false });

    await expect(submitCommand({})).rejects.toThrow('Cannot determine which app to submit');
    expect(appService.pickApp).not.toHaveBeenCalled();
  });

  it('falls back to the interactive picker when no app id or config', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(null);
    (appService.pickApp as jest.Mock).mockResolvedValue('42');
    (appService.fetchApp as jest.Mock).mockResolvedValue(PUBLIC_APP);

    await submitCommand({});

    expect(appService.pickApp).toHaveBeenCalledWith('Which app do you want to submit for review?');
    expect(appService.fetchApp).toHaveBeenCalledWith('42');
    expect(openBrowser).toHaveBeenCalledWith(FORM_URL);
  });

  // ── Missing form link ──

  it('errors when the app payload has no google_form_link', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(MATCHING_CONFIG);
    (appService.fetchApp as jest.Mock).mockResolvedValue({
      ...PUBLIC_APP,
      google_form_link: undefined,
    });

    await expect(submitCommand({})).rejects.toThrow('did not return a submission form URL');
    expect(openBrowser).not.toHaveBeenCalled();
  });
});
