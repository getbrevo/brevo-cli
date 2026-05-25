import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * CLI version pulled from the bundled `package.json` at module-init.
 *
 * Resolved relative to this file so the same lookup works under ts-jest
 * (`src/lib/` → repo root) and the published tarball
 * (`node_modules/@getbrevo/cli/dist/lib/` → package root). Falls back to
 * `'0.0.0'` if the file is missing or malformed — safe default for any
 * consumer that uses this for telemetry or skill-version stamping.
 */
function readCliVersion(): string {
  try {
    const pkgPath = path.resolve(__dirname, '..', '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const CLI_VERSION = readCliVersion();
