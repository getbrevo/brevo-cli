import { AbortError } from './errors';

export function isAbortError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;

  // Check error name/constructor first (more reliable than message strings)
  const name = err.name?.toLowerCase() ?? '';
  if (name === 'exitprompterror') return true;

  const msg = err.message.toLowerCase();
  return (
    msg.includes('readline was closed') ||
    msg.includes('user force closed') ||
    msg.includes('exitprompterror') ||
    msg.includes('prompt was closed')
  );
}

export async function withAbortHandler<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isAbortError(err)) {
      throw new AbortError();
    }
    throw err;
  }
}
