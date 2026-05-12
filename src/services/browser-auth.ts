import * as http from 'node:http';
import { randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { logDebug } from '../lib/logger';
import { CliError } from '../lib/errors';
import { messages } from '../lang/en';

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
  scope?: string;
}

export interface RunBrowserLoginOptions {
  proxyUrl: string;
  timeoutMs?: number;
  openBrowser?: (url: string) => void;
  onWaiting?: (loginUrl: string) => void;
}

const MAX_BODY_BYTES = 16 * 1024;
// 5 minutes — accommodates SSO/2FA flows where the user may need to fetch a
// code from another device. 120s was too tight and routinely timed out mid-2FA.
const DEFAULT_TIMEOUT_MS = 300_000;

interface RawTokenPayload {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  token_type?: unknown;
  scope?: unknown;
}

function normalizeTokens(raw: RawTokenPayload): OAuthTokens | null {
  if (
    typeof raw.access_token !== 'string' ||
    !raw.access_token ||
    typeof raw.refresh_token !== 'string' ||
    !raw.refresh_token ||
    typeof raw.expires_in !== 'number' ||
    !Number.isFinite(raw.expires_in) ||
    raw.expires_in <= 0 ||
    typeof raw.token_type !== 'string' ||
    !raw.token_type
  ) {
    return null;
  }
  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token,
    expiresIn: raw.expires_in,
    tokenType: raw.token_type,
    scope: typeof raw.scope === 'string' ? raw.scope : undefined,
  };
}

export async function runBrowserLoginFlow(opts: RunBrowserLoginOptions): Promise<OAuthTokens> {
  const proxyOrigin = new URL(opts.proxyUrl).origin;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const openBrowser = opts.openBrowser ?? (() => {});

  return new Promise<OAuthTokens>((resolve, reject) => {
    let settled = false;
    const claimSettlement = (): boolean => {
      if (settled) return false;
      settled = true;
      return true;
    };

    const server = http.createServer((req, res) => {
      const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
      const origin = req.headers.origin;
      logDebug('loopback request', { method: req.method, url: req.url, pathname, origin });

      if (req.method === 'OPTIONS' && pathname === '/callback') {
        if (origin !== proxyOrigin) {
          logDebug('loopback OPTIONS rejected: origin mismatch', { origin, expected: proxyOrigin });
          res.writeHead(403).end();
          return;
        }
        res
          .writeHead(204, {
            'Access-Control-Allow-Origin': proxyOrigin,
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '600',
          })
          .end();
        return;
      }

      if (req.method === 'POST' && pathname === '/callback') {
        if (origin !== proxyOrigin) {
          logDebug('loopback POST rejected: origin mismatch', { origin, expected: proxyOrigin });
          res.writeHead(403).end();
          return;
        }

        let bytes = 0;
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > MAX_BODY_BYTES) {
            logDebug('loopback POST rejected: body too large', { bytes, max: MAX_BODY_BYTES });
            res.writeHead(413, { Connection: 'close' }).end();
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });
        req.on('end', () => {
          let parsed: RawTokenPayload | null = null;
          try {
            parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as RawTokenPayload;
          } catch {
            parsed = null;
          }
          const tokens = parsed ? normalizeTokens(parsed) : null;
          if (!tokens) {
            logDebug('loopback POST rejected: bad payload shape', {
              hasParsed: parsed !== null,
              keys: parsed ? Object.keys(parsed) : null,
            });
            res
              .writeHead(400, {
                'Access-Control-Allow-Origin': proxyOrigin,
                'Content-Type': 'text/plain',
              })
              .end('Bad payload');
            return;
          }
          logDebug('loopback POST accepted', { hasScope: tokens.scope !== undefined });
          res.writeHead(204, { 'Access-Control-Allow-Origin': proxyOrigin }).end();
          if (claimSettlement()) {
            server.close();
            resolve(tokens);
          }
        });
        return;
      }

      if (req.method === 'GET' && (pathname === '/' || pathname === '/callback')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          '<!doctype html><meta charset="utf-8"><title>Brevo CLI login</title>' +
            '<p>Waiting for login to complete — you can close this tab once the CLI confirms success.</p>',
        );
        return;
      }

      logDebug('loopback request not matched', { method: req.method, pathname });
      res.writeHead(404).end();
    });

    server.on('error', (err) => {
      logDebug('loopback server error', { message: (err as Error).message });
      if (claimSettlement()) reject(err);
    });

    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      // Unique per-attempt token. If a previous attempt timed out mid-flow,
      // the browser may still have a tab open at the proxy showing an error;
      // a unique URL forces a fresh navigation instead of reusing that tab,
      // and prevents the proxy/browser from serving a cached response.
      const attemptToken = randomUUID();
      const loginUrl = `${opts.proxyUrl}/login?port=${port}&t=${attemptToken}`;
      logDebug('loopback listening', { host: '127.0.0.1', port, proxyOrigin });
      opts.onWaiting?.(loginUrl);
      try {
        openBrowser(loginUrl);
      } catch {
        // best-effort — URL already surfaced via onWaiting
      }
    });

    const timer = setTimeout(() => {
      if (claimSettlement()) {
        server.close();
        reject(new CliError(messages.AUTH_BROWSER_TIMEOUT));
      }
    }, timeoutMs);
    timer.unref?.();

    server.on('close', () => clearTimeout(timer));
  });
}
