import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';

// The opener binaries are resolved from fixed absolute candidates rather than PATH
// (Sonar S4036) — same reasoning as the pty pipeline in `scripts/smoke/core.ts`: a
// writable PATH entry must not be able to decide what runs. Deliberately NO bare-name
// fallback — that would hand the decision back to PATH on precisely the machine where
// the absolute lookup failed. A machine with no candidate present is treated exactly
// like a failed spawn: the caller's `onError` fires, and the URL is already on screen.
const DARWIN_OPENERS = ['/usr/bin/open'];
const WIN32_SHELLS = ['C:\\Windows\\System32\\cmd.exe'];
const LINUX_OPENERS = ['/usr/bin/xdg-open', '/usr/local/bin/xdg-open', '/bin/xdg-open'];

function resolveOpener(url: string): { bin: string; args: string[] } | null {
  const candidates =
    process.platform === 'darwin'
      ? DARWIN_OPENERS
      : process.platform === 'win32'
        ? WIN32_SHELLS
        : LINUX_OPENERS;
  const bin = candidates.find((candidate) => existsSync(candidate));
  if (!bin) return null;
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  return { bin, args };
}

// Opening the browser can only fail ASYNCHRONOUSLY: `execFile` without a callback never
// throws on a missing opener (e.g. no `xdg-open` on a headless box) — the ENOENT arrives
// as an `error` event on the child, which Node swallows when nobody listens. A
// `try/catch` around this call is therefore dead code and its fallback copy unreachable.
// Callers that have a "couldn't open a browser" line to print pass it as `onError`; the
// URL should already be on screen by then, since the failure lands after this returns.
export function openBrowser(url: string, onError?: (err: Error) => void): void {
  const opener = resolveOpener(url);
  if (!opener) {
    // Deferred so this failure keeps the same shape as a spawn error — the contract
    // above is that a failure always lands AFTER this returns.
    if (onError) {
      setImmediate(() =>
        onError(new Error('no browser opener found at its known absolute locations')),
      );
    }
    return;
  }
  const child = execFile(opener.bin, opener.args);
  if (onError) {
    child.on('error', onError);
  }
}
