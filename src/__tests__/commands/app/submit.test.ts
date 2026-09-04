import { submitCommand } from '../../../commands/app/submit';
import { EXIT_CODES } from '../../../lib/exit-codes';

jest.mock('inquirer', () => ({
  prompt: jest.fn(),
}));

jest.mock('../../../container', () => ({
  appService: {
    fetchAppsList: jest.fn(),
    fetchApp: jest.fn(),
    fetchAppState: jest.fn(),
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

import inquirer from 'inquirer';
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
  app_id: '42',
  app_name: 'My Test App',
  distribution_type: 'public',
  version: '0.0.2',
  auth: {
    scopes: ['crm:read'],
    redirect_uris: ['http://localhost:3009/auth/callback', 'https://example.com/callback'],
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
    // The status preflight must pass by default so flow tests reach the submit
    // logic; the preflight-failure test overrides this. (clearAllMocks resets
    // call data but not implementations, so re-establish it each test.)
    (appService.fetchAppState as jest.Mock).mockResolvedValue({ state: 'configured' });
    // Interactive runs now confirm before opening the form — accept by default
    // so pre-existing flow tests exercise the full path.
    (inquirer.prompt as unknown as jest.Mock).mockResolvedValue({ confirmed: true });
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

  // ── Status preflight ──

  it('runs the status check before opening the submission form', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(MATCHING_CONFIG);
    (appService.fetchAppState as jest.Mock).mockResolvedValue({ state: 'configured' });
    (appService.fetchApp as jest.Mock).mockResolvedValue(PUBLIC_APP);

    await submitCommand({ appId: '42' });

    expect(appService.fetchAppState).toHaveBeenCalledWith('42');
    expect(openBrowser).toHaveBeenCalledWith(FORM_URL);
  });

  it('aborts before submitting when the status check fails', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(MATCHING_CONFIG);
    (appService.fetchAppState as jest.Mock).mockRejectedValue(new Error('network unreachable'));
    (appService.fetchApp as jest.Mock).mockResolvedValue(PUBLIC_APP);

    await expect(submitCommand({ appId: '42' })).rejects.toThrow('network unreachable');
    // The preflight runs first, so a failed status read stops the flow before
    // fetching the app or opening the form.
    expect(appService.fetchApp).not.toHaveBeenCalled();
    expect(openBrowser).not.toHaveBeenCalled();
  });

  // ── Happy paths ──

  it('opens the submission form when the app is public and in sync', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(MATCHING_CONFIG);
    (appService.fetchApp as jest.Mock).mockResolvedValue(PUBLIC_APP);

    await submitCommand({});

    expect(appService.fetchApp).toHaveBeenCalledWith('42');
    expect(openBrowser).toHaveBeenCalledWith(FORM_URL);
    expect(output()).toContain(FORM_URL);
    expect(output()).toContain('check its status anytime with `brevo app status`');
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
    expect(stderr).toContain('check its status anytime with `brevo app status`');
    stderrSpy.mockRestore();
  });

  it('uses the --app-id flag over a config describing a different app', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue({ ...MATCHING_CONFIG, app_id: '7' });
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
    expect(output()).toContain("couldn't open a browser automatically");
  });

  // ── Confirmation prompt ──

  it('shows the full app object and asks for confirmation before opening the form', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue({
      ...MATCHING_CONFIG,
      logo_uri: 'https://example.com/logo.png',
    });
    (appService.fetchApp as jest.Mock).mockResolvedValue({
      ...PUBLIC_APP,
      logo_uri: 'https://example.com/logo.png',
    });

    await submitCommand({});

    expect(inquirer.prompt).toHaveBeenCalledTimes(1);
    const out = output();
    expect(out).toContain('No configuration mismatch detected');
    expect(out).toContain('You are about to submit this app for review:');
    expect(out).toContain('App ID:        42');
    expect(out).toContain('Name:          My Test App');
    expect(out).toContain('Distribution:  public');
    expect(out).toContain('Redirect URLs: http://localhost:3009/auth/callback');
    expect(out).toContain('Scopes:        crm:read');
    expect(out).toContain('Logo URL:      https://example.com/logo.png');
    expect(out).toContain('Version:       0.0.2');
    expect(openBrowser).toHaveBeenCalledWith(FORM_URL);
  });

  it('cancels cleanly when the confirmation is declined', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(MATCHING_CONFIG);
    (appService.fetchApp as jest.Mock).mockResolvedValue(PUBLIC_APP);
    (inquirer.prompt as unknown as jest.Mock).mockResolvedValue({ confirmed: false });

    await submitCommand({});

    expect(output()).toContain('Submission cancelled.');
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it('never prompts in --json mode', async () => {
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    (readProjectConfig as jest.Mock).mockReturnValue(MATCHING_CONFIG);
    (appService.fetchApp as jest.Mock).mockResolvedValue(PUBLIC_APP);

    await submitCommand({ appId: '42', json: true });

    expect(inquirer.prompt).not.toHaveBeenCalled();
    stderrSpy.mockRestore();
  });

  it('skips the prompt when non-interactive and proceeds to open the form', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(MATCHING_CONFIG);
    (appService.fetchApp as jest.Mock).mockResolvedValue(PUBLIC_APP);
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: false });

    await submitCommand({});

    expect(inquirer.prompt).not.toHaveBeenCalled();
    expect(openBrowser).toHaveBeenCalledWith(FORM_URL);
  });

  // ── Google-Form gate note ──

  it('explains that submission only completes with the Google Form', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(MATCHING_CONFIG);
    (appService.fetchApp as jest.Mock).mockResolvedValue(PUBLIC_APP);

    await submitCommand({});

    expect(output()).toContain(
      'Note: Your app will be submitted for review only after you complete and submit the Google Form.',
    );
  });

  it('prints the Google-Form gate note on stderr in --json mode', async () => {
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    (readProjectConfig as jest.Mock).mockReturnValue(MATCHING_CONFIG);
    (appService.fetchApp as jest.Mock).mockResolvedValue(PUBLIC_APP);

    await submitCommand({ appId: '42', json: true });

    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(stderr).toContain('submitted for review only after you complete and submit');
    // stdout must stay pure parseable JSON.
    expect(JSON.parse(output())).toEqual({ app_id: '42', form_url: FORM_URL });
    stderrSpy.mockRestore();
  });

  // ── Distribution gate ──

  it('rejects a private app as ineligible for review', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(null);
    (appService.fetchApp as jest.Mock).mockResolvedValue({
      ...PUBLIC_APP,
      distribution_type: 'private',
    });

    const error = await submitCommand({ appId: '42' }).catch((e: Error) => e);
    expect((error as Error).message).toContain('cannot be submitted for review');
    expect((error as Error).message).toContain('Only public apps are eligible');
    expect((error as Error).message).toContain('make your app public');
    // BEX-327: distribution can't be flipped after creation — never suggest
    // `app upload --distribution public` as a remedy.
    expect((error as Error).message).not.toContain('app upload --distribution');
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it('treats a missing distribution_type as not public', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue(null);
    (appService.fetchApp as jest.Mock).mockResolvedValue({
      ...PUBLIC_APP,
      distribution_type: undefined,
    });

    await expect(submitCommand({ appId: '42' })).rejects.toThrow('cannot be submitted for review');
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
    // Remedy covers both directions: pull server values locally, or upload.
    expect((error as Error).message).toContain(
      'Please update your local configuration with the latest server values, or run `brevo app upload`',
    );
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
      auth: { ...MATCHING_CONFIG.auth, redirect_uris: ['https://example.com/callback'] },
    });
    (appService.fetchApp as jest.Mock).mockResolvedValue(PUBLIC_APP);

    const error = await submitCommand({}).catch((e: Error) => e);
    expect((error as Error).message).toContain('http://localhost:3009/auth/callback (server only)');
  });

  it('keeps the compact field-name drift message in --json mode', async () => {
    (readProjectConfig as jest.Mock).mockReturnValue({
      ...MATCHING_CONFIG,
      app_name: 'Renamed App',
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
      logo_uri: '',
      auth: {
        scopes: [],
        redirect_uris: ['https://example.com/callback', 'http://localhost:3009/auth/callback'],
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

    await expect(submitCommand({})).rejects.toThrow('Review submission is currently unavailable');
    expect(openBrowser).not.toHaveBeenCalled();
  });
});
