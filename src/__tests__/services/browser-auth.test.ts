import * as http from 'node:http';
import { runBrowserLoginFlow } from '../../services/browser-auth';
import { CliError } from '../../lib/errors';

async function postTokens(port: number, origin: string, body: object): Promise<number> {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/callback',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data.length,
          Origin: origin,
        },
      },
      (res) => resolve(res.statusCode ?? 0),
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function optionsPreflight(port: number, origin: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/callback',
        method: 'OPTIONS',
        headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' },
      },
      (res) => resolve(res.statusCode ?? 0),
    );
    req.on('error', reject);
    req.end();
  });
}

describe('runBrowserLoginFlow', () => {
  const proxyUrl = 'https://worker.example.com';

  it('returns tokens from a well-formed POST', async () => {
    let assignedPort = 0;
    const flow = runBrowserLoginFlow({
      proxyUrl,
      timeoutMs: 5000,
      openBrowser: (url) => {
        assignedPort = Number(new URL(url).searchParams.get('port'));
      },
    });
    await new Promise((r) => setTimeout(r, 50));
    const status = await postTokens(assignedPort, proxyUrl, {
      access_token: 'at',
      refresh_token: 'rt',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'all',
    });
    expect(status).toBe(204);
    const tokens = await flow;
    expect(tokens).toEqual({
      accessToken: 'at',
      refreshToken: 'rt',
      expiresIn: 3600,
      tokenType: 'Bearer',
      scope: 'all',
    });
  });

  it('rejects POSTs from the wrong origin with 403', async () => {
    let assignedPort = 0;
    const flow = runBrowserLoginFlow({
      proxyUrl,
      timeoutMs: 1500,
      openBrowser: (url) => {
        assignedPort = Number(new URL(url).searchParams.get('port'));
      },
    });
    await new Promise((r) => setTimeout(r, 50));
    const status = await postTokens(assignedPort, 'https://evil.example.com', {
      access_token: 'at',
      refresh_token: 'rt',
      expires_in: 3600,
      token_type: 'Bearer',
    });
    expect(status).toBe(403);
    const ok = await postTokens(assignedPort, proxyUrl, {
      access_token: 'at',
      refresh_token: 'rt',
      expires_in: 3600,
      token_type: 'Bearer',
    });
    expect(ok).toBe(204);
    await flow;
  });

  it('responds 204 to a CORS preflight from the Worker origin', async () => {
    let assignedPort = 0;
    const flow = runBrowserLoginFlow({
      proxyUrl,
      timeoutMs: 1500,
      openBrowser: (url) => {
        assignedPort = Number(new URL(url).searchParams.get('port'));
      },
    });
    await new Promise((r) => setTimeout(r, 50));
    const status = await optionsPreflight(assignedPort, proxyUrl);
    expect(status).toBe(204);
    await postTokens(assignedPort, proxyUrl, {
      access_token: 'at',
      refresh_token: 'rt',
      expires_in: 3600,
      token_type: 'Bearer',
    });
    await flow;
  });

  it('appends a unique cache-buster to the login URL on each attempt', async () => {
    const urls: string[] = [];
    const start = (): Promise<unknown> =>
      runBrowserLoginFlow({
        proxyUrl,
        timeoutMs: 1000,
        openBrowser: (url) => urls.push(url),
      }).catch(() => undefined);
    await start();
    await start();
    expect(urls).toHaveLength(2);
    const parsedUrls = urls.map((url) => new URL(url));
    for (const parsed of parsedUrls) {
      expect(parsed.searchParams.get('port')).toMatch(/^\d+$/);
      expect(parsed.searchParams.get('t')).toBeTruthy();
    }
    const [first, second] = parsedUrls;
    expect(first!.searchParams.get('t')).not.toBe(second!.searchParams.get('t'));
  });

  it('rejects with a timeout when no callback arrives', async () => {
    const flow = runBrowserLoginFlow({
      proxyUrl,
      timeoutMs: 200,
      openBrowser: () => {},
    });
    // Timeout must be a CliError so bin/index.ts surfaces the friendly
    // AUTH_BROWSER_TIMEOUT message and the proper exit code instead of
    // falling through to the unexpected-error branch.
    await expect(flow).rejects.toBeInstanceOf(CliError);
    await expect(flow).rejects.toThrow(/time.*out/i);
  });

  it.each([
    [
      'NaN expires_in',
      { access_token: 'at', refresh_token: 'rt', expires_in: NaN, token_type: 'Bearer' },
    ],
    [
      'Infinity expires_in',
      { access_token: 'at', refresh_token: 'rt', expires_in: Infinity, token_type: 'Bearer' },
    ],
    [
      'negative expires_in',
      { access_token: 'at', refresh_token: 'rt', expires_in: -1, token_type: 'Bearer' },
    ],
    [
      'zero expires_in',
      { access_token: 'at', refresh_token: 'rt', expires_in: 0, token_type: 'Bearer' },
    ],
    [
      'empty access_token',
      { access_token: '', refresh_token: 'rt', expires_in: 3600, token_type: 'Bearer' },
    ],
    [
      'empty refresh_token',
      { access_token: 'at', refresh_token: '', expires_in: 3600, token_type: 'Bearer' },
    ],
    [
      'empty token_type',
      { access_token: 'at', refresh_token: 'rt', expires_in: 3600, token_type: '' },
    ],
  ])('rejects 400 on bad token shape: %s', async (_name, payload) => {
    let assignedPort = 0;
    const flow = runBrowserLoginFlow({
      proxyUrl,
      timeoutMs: 1500,
      openBrowser: (url) => {
        assignedPort = Number(new URL(url).searchParams.get('port'));
      },
    }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 50));
    const status = await postTokens(assignedPort, proxyUrl, payload);
    expect(status).toBe(400);
    // Then send a good payload to settle the flow cleanly.
    await postTokens(assignedPort, proxyUrl, {
      access_token: 'at',
      refresh_token: 'rt',
      expires_in: 3600,
      token_type: 'Bearer',
    });
    await flow;
  });

  it('rejects 400 when the POST payload is missing required fields', async () => {
    let assignedPort = 0;
    let flowError: unknown;
    const flow = runBrowserLoginFlow({
      proxyUrl,
      timeoutMs: 1500,
      openBrowser: (url) => {
        assignedPort = Number(new URL(url).searchParams.get('port'));
      },
    }).catch((err) => {
      flowError = err;
    });
    await new Promise((r) => setTimeout(r, 50));
    const bad = await postTokens(assignedPort, proxyUrl, { access_token: 'only-access' });
    expect(bad).toBe(400);
    await postTokens(assignedPort, proxyUrl, {
      access_token: 'at',
      refresh_token: 'rt',
      expires_in: 3600,
      token_type: 'Bearer',
    });
    await flow;
    expect(flowError).toBeUndefined();
  });
});
