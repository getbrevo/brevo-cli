/**
 * Write JSON data to stdout (for --json flag output).
 * Centralizes the JSON serialization pattern used by all commands.
 */
export function jsonOutput(data: unknown): void {
  process.stdout.write(JSON.stringify(data) + '\n');
}
