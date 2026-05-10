/**
 * Cross-platform utility functions.
 * These provide platform-independent alternatives to Node.js-specific APIs.
 */

/**
 * Generate a UUID v4 string.
 * Uses the native crypto.randomUUID() when available for better performance and randomness.
 * Falls back to a polyfill implementation for environments that don't support it.
 */
export function generateId(): string {
  // Check for native crypto.randomUUID (Node.js 19+, modern browsers)
  if (
    typeof globalThis !== "undefined" &&
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }

  // Fallback: Generate UUID v4 using Math.random()
  // This is less cryptographically secure but works in all environments
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Get the parent directory of a path.
 * Cross-platform alternative to path.dirname().
 * Works with both forward slashes (Unix) and backslashes (Windows).
 */
export function getParentDir(filePath: string): string {
  // Normalize to forward slashes for processing
  const normalized = filePath.replace(/\\/g, "/");
  
  // Remove trailing slash if present
  const trimmed = normalized.endsWith("/") 
    ? normalized.slice(0, -1) 
    : normalized;
  
  // Find the last separator
  const lastSlash = trimmed.lastIndexOf("/");
  
  if (lastSlash === -1) {
    return ".";
  }
  
  if (lastSlash === 0) {
    return "/";
  }
  
  return trimmed.slice(0, lastSlash);
}
