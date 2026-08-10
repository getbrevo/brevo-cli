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
function readPkg(): { version?: unknown; name?: unknown } {
  try {
    const pkgPath = path.resolve(__dirname, '..', '..', 'package.json');
    return JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version?: unknown; name?: unknown };
  } catch {
    return {};
  }
}

const pkg = readPkg();

export const CLI_VERSION = typeof pkg.version === 'string' ? pkg.version : '0.0.0';

/** Package name, used in the `npm install -g <name>` upgrade lines. */
export const CLI_NAME = typeof pkg.name === 'string' ? pkg.name : '@getbrevo/cli';
