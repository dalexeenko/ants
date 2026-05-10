/**
 * Extract a human-readable error message from an unknown error value.
 */
export function getErrorMessage(error: unknown, fallback?: string): string {
  if (error instanceof Error) {
    return error.message;
  }
  return fallback ?? String(error);
}
