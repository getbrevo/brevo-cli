const isDebug = (): boolean => process.env.BREVO_DEBUG === '1' || process.argv.includes('--debug');

const isTTY = (): boolean => process.stdout.isTTY === true;

const useColor = (): boolean =>
  process.env.NO_COLOR === undefined && (process.env.FORCE_COLOR !== undefined || isTTY());

function color(code: string, text: string): string {
  return useColor() ? `\x1b[${code}m${text}\x1b[0m` : text;
}

const SENSITIVE_KEYS = new Set([
  'api-key',
  'api_key',
  'apikey',
  'access_token',
  'refresh_token',
  'client_secret',
  'token',
  'password',
  'secret',
  'authorization',
]);

function redactSensitiveFields(data: unknown): unknown {
  if (data === null || data === undefined) return data;
  if (typeof data !== 'object') return data;
  if (Array.isArray(data)) return data.map(redactSensitiveFields);

  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      redacted[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      redacted[key] = redactSensitiveFields(value);
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

export function logHttp(method: string, path: string): void {
  if (isDebug()) {
    process.stderr.write(`  ${color('90', `→ ${method} ${path}`)}\n`);
  }
}

export function logHttpResponse(status: number, path: string): void {
  if (isDebug()) {
    const code = status >= 200 && status < 300 ? '32' : '31';
    process.stderr.write(`  ${color(code, `← ${status} ${path}`)}\n`);
  }
}

export function logDebug(context: string, data: unknown): void {
  if (isDebug()) {
    const safe = redactSensitiveFields(data);
    process.stderr.write(`  ${color('90', `[debug] ${context}: ${JSON.stringify(safe)}`)}\n`);
  }
}

export function logError(message: string, error?: unknown): void {
  process.stderr.write(`\n  ${color('31', '✗')} ${message}\n`);
  if (isDebug() && error) {
    process.stderr.write(
      `  ${color('90', error instanceof Error ? error.stack || error.message : String(error))}\n`,
    );
  } else if (error) {
    process.stderr.write(`  ${color('90', 'Run with --debug for full details')}\n`);
  }
}

export function logSuccess(message: string): void {
  process.stdout.write(`\n  ${color('32', '✓')} ${message}\n`);
}

export function logInfo(message: string): void {
  process.stdout.write(`  ${message}\n`);
}

export function logWarn(message: string): void {
  process.stdout.write(`  ${color('33', '⚠')} ${message}\n`);
}

export { isDebug, isTTY };
