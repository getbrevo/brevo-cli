import * as net from 'node:net';

/**
 * Try to bind a fresh listener to `port` on `host`. Resolves true if the
 * bind succeeds (port free), false on EADDRINUSE, rejects on other errors.
 */
function tryBind(port: number, host: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        reject(err);
      }
    });
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    try {
      server.listen(port, host);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Check whether a TCP port is available.
 * Resolves true if the port is free, false if in use.
 * Rejects on unexpected errors (e.g. EACCES, invalid port).
 *
 * Probes 0.0.0.0 (IPv4 wildcard) and 127.0.0.1 (loopback) sequentially.
 * A single-host probe misses real conflicts: a loopback-only probe doesn't
 * catch wildcard owners (e.g. Mockoon on `*:3009`), and a wildcard-only
 * probe doesn't catch loopback-bound owners. Reporting "in use" if either
 * probe sees EADDRINUSE matches what an OAuth server bound to 127.0.0.1
 * would actually hit at start time or runtime.
 *
 * Probes run sequentially (not Promise.all) because parallel binds to
 * 0.0.0.0:N and 127.0.0.1:N race against each other — whichever the
 * kernel grants first triggers EADDRINUSE on the other, even when the
 * port is genuinely free. Sequential probes with proper close-between
 * avoid the self-collision.
 */
export async function isPortAvailable(port: number): Promise<boolean> {
  if (!(await tryBind(port, '0.0.0.0'))) return false;
  if (!(await tryBind(port, '127.0.0.1'))) return false;
  return true;
}

/** Maximum number of ports to scan before giving up. */
const MAX_SCAN = 20;

/**
 * Find the first available port starting from `startPort`.
 * Scans up to MAX_SCAN ports. Returns `null` if no free port is found.
 */
export async function findAvailablePort(startPort: number): Promise<number | null> {
  for (let port = startPort; port < startPort + MAX_SCAN; port++) {
    if (await isPortAvailable(port)) return port;
  }
  return null;
}
