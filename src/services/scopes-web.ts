import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import type { ScopeEntry } from './oauth-metadata';
import { renderScopesHtml } from './scopes-html';
import { logDebug } from '../lib/logger';

export interface ScopesWebServer {
  url: string;
  close: () => Promise<void>;
}

export interface ScopesWebOptions {
  /** Called by GET /scopes.json to re-fetch scopes on demand. Optional —
   *  when omitted, the refresh button returns the initial entries unchanged. */
  refetch?: () => Promise<ScopeEntry[]>;
}

export function startScopesWebServer(
  initialEntries: ScopeEntry[],
  options: ScopesWebOptions = {},
): Promise<ScopesWebServer> {
  const html = renderScopesHtml(initialEntries);
  const refetch = options.refetch;

  return new Promise<ScopesWebServer>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
      logDebug('scopes-web request', { method: req.method, pathname });

      if (req.method === 'GET' && pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }

      if (req.method === 'GET' && pathname === '/scopes.json') {
        const respond = (entries: ScopeEntry[]): void => {
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
          });
          res.end(JSON.stringify({ scopes: entries }));
        };

        if (!refetch) {
          respond(initialEntries);
          return;
        }

        refetch()
          .then(respond)
          .catch((err: unknown) => {
            logDebug('scopes-web refetch failed', { message: (err as Error).message });
            res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'refetch_failed' }));
          });
        return;
      }

      res.writeHead(404).end();
    });

    server.once('error', (err) => {
      logDebug('scopes-web server error', { message: (err as Error).message });
      reject(err);
    });

    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      const url = `http://127.0.0.1:${port}/`;
      logDebug('scopes-web listening', { host: '127.0.0.1', port });
      resolve({
        url,
        close: () =>
          new Promise<void>((resolveClose) => {
            server.close(() => resolveClose());
          }),
      });
    });
  });
}
