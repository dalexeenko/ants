import { existsSync, mkdirSync, readFileSync } from 'fs';
import { mkdir, readFile, access, stat, writeFile } from 'fs/promises';

/**
 * Ensure a directory exists, creating it recursively if needed.
 * Synchronous version — use for startup code only.
 */
export function ensureDirectory(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Ensure a directory exists, creating it recursively if needed.
 * Async version — use in request handlers.
 */
export async function ensureDirectoryAsync(dirPath: string): Promise<void> {
  try {
    await access(dirPath);
  } catch {
    await mkdir(dirPath, { recursive: true });
  }
}

/**
 * Read and parse a JSON file, returning a default value if the file
 * doesn't exist or can't be parsed.
 * Synchronous version — use for startup code only.
 */
export function readJsonFile<T>(filePath: string, defaultValue: T): T {
  if (!existsSync(filePath)) {
    return defaultValue;
  }
  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return defaultValue;
  }
}

/**
 * Read and parse a JSON file, returning a default value if the file
 * doesn't exist or can't be parsed.
 * Async version — use in request handlers.
 */
export async function readJsonFileAsync<T>(filePath: string, defaultValue: T): Promise<T> {
  try {
    await access(filePath);
  } catch {
    return defaultValue;
  }
  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return defaultValue;
  }
}

/**
 * Check if a path exists. Async version of existsSync.
 */
export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
