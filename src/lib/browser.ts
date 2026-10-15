import { execFile } from 'node:child_process';

// Opening the browser can only fail ASYNCHRONOUSLY: `execFile` without a callback never
// throws on a missing opener (e.g. no `xdg-open` on a headless box) — the ENOENT arrives
// as an `error` event on the child, which Node swallows when nobody listens. A
// `try/catch` around this call is therefore dead code and its fallback copy unreachable.
// Callers that have a "couldn't open a browser" line to print pass it as `onError`; the
// URL should already be on screen by then, since the failure lands after this returns.
export function openBrowser(url: string, onError?: (err: Error) => void): void {
  let child;
  if (process.platform === 'darwin') {
    child = execFile('open', [url]);
  } else if (process.platform === 'win32') {
    child = execFile('cmd', ['/c', 'start', '', url]);
  } else {
    child = execFile('xdg-open', [url]);
  }
  if (onError) {
    child.on('error', onError);
  }
}
