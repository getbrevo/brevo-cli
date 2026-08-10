// Update notices are now driven entirely by the API (see lib/version-signal.ts):
// the backend reports the caller's status on responses the CLI already makes.
// The npm registry is no longer contacted from any code path — it was an extra
// network call on nearly every invocation, and "npm has a newer major" was the
// wrong authority for whether a version is still supported.
//
// What remains here is shared presentation and opt-out logic.

export interface PkgInfo {
  name: string;
  version: string;
}

export interface UpdateNotifierOptions {
  pkg: PkgInfo;
  argv?: readonly string[];
  env?: NodeJS.ProcessEnv;
  isTTY?: boolean;
}

// Contexts where an informational notice is unwanted: CI logs, piped output,
// or an explicit opt-out. Applies to the soft notice only — a hard block is
// never suppressed by these.
export function shouldSkipCheck(opts: UpdateNotifierOptions): boolean {
  const env = opts.env ?? process.env;
  const argv = opts.argv ?? process.argv;
  const isTTY = opts.isTTY ?? Boolean(process.stdout.isTTY);

  if (env.CI === 'true' || env.CI === '1') return true;
  if (!isTTY) return true;
  if (env.NO_UPDATE_NOTIFIER === '1' || env.NO_UPDATE_NOTIFIER === 'true') return true;
  if (env.BREVO_NO_UPDATE_NOTIFIER === '1' || env.BREVO_NO_UPDATE_NOTIFIER === 'true') return true;
  if (argv.includes('--no-update-notifier')) return true;

  return false;
}

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string;
}

function parseVersion(v: string): ParsedVersion | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(v.trim());
  if (!match?.[1] || !match?.[2] || !match?.[3]) return undefined;
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
    prerelease: match[4] ?? '',
  };
}

// Numeric identifiers are compared numerically and always rank below
// non-numeric ones (semver §11.4).
function comparePrereleaseIdentifiers(ai: string, bi: string): number {
  if (ai === bi) return 0;
  const aNum = /^\d+$/.test(ai);
  const bNum = /^\d+$/.test(bi);
  if (aNum && bNum) {
    const diff = Number.parseInt(ai, 10) - Number.parseInt(bi, 10);
    if (diff === 0) return 0;
    return diff > 0 ? 1 : -1;
  }
  if (aNum) return -1;
  if (bNum) return 1;
  return ai > bi ? 1 : -1;
}

// Per semver §11.4: split on '.', compare identifiers; a longer prerelease
// set outranks a shorter one when the leading identifiers match.
function comparePrerelease(a: string, b: string): number {
  if (a === b) return 0;
  const aParts = a.split('.');
  const bParts = b.split('.');
  const len = Math.min(aParts.length, bParts.length);
  for (let i = 0; i < len; i++) {
    const cmp = comparePrereleaseIdentifiers(aParts[i] ?? '', bParts[i] ?? '');
    if (cmp !== 0) return cmp;
  }
  if (aParts.length === bParts.length) return 0;
  return aParts.length > bParts.length ? 1 : -1;
}

export function compareVersions(current: string, latest: string): number {
  const c = parseVersion(current);
  const l = parseVersion(latest);
  if (!c || !l) return 0;
  if (l.major !== c.major) return l.major - c.major;
  if (l.minor !== c.minor) return l.minor - c.minor;
  if (l.patch !== c.patch) return l.patch - c.patch;
  if (c.prerelease && !l.prerelease) return 1;
  if (!c.prerelease && l.prerelease) return -1;
  return comparePrerelease(l.prerelease, c.prerelease);
}

export function isNewer(current: string, latest: string): boolean {
  return compareVersions(current, latest) > 0;
}

// Renders the lines into a bordered box, auto-sized to the longest line.
export function renderBox(lines: string[]): string {
  const inner = Math.max(...lines.map((l) => l.length)) + 4;
  const top = '╭' + '─'.repeat(inner) + '╮';
  const bot = '╰' + '─'.repeat(inner) + '╯';
  const pad = (s: string): string => '  ' + s + ' '.repeat(inner - s.length - 2);
  return ['', `  ${top}`, ...lines.map((l) => `  │${pad(l)}│`), `  ${bot}`, ''].join('\n');
}
