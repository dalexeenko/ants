/**
 * Node.js Filesystem Implementation
 * 
 * Implements the Filesystem interface using Node.js fs/promises.
 */

import { readFile, writeFile, stat, readdir, mkdir, unlink, rm } from "fs/promises";
import { resolve, relative, dirname, basename, join } from "path";
import type { Filesystem, FileStat, DirectoryEntry } from "@openmgr/agent-core";

/**
 * Node.js implementation of the Filesystem interface.
 */
export class NodeFilesystem implements Filesystem {
  async readFile(path: string): Promise<string> {
    return readFile(path, "utf-8");
  }

  async writeFile(path: string, content: string): Promise<void> {
    // Ensure parent directory exists
    const dir = dirname(path);
    await mkdir(dir, { recursive: true });
    await writeFile(path, content, "utf-8");
  }

  async stat(path: string): Promise<FileStat> {
    const s = await stat(path);
    return {
      size: s.size,
      isDirectory: s.isDirectory(),
      isFile: s.isFile(),
      modifiedAt: s.mtimeMs,
      createdAt: s.birthtimeMs,
    };
  }

  async exists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }

  async readdir(path: string): Promise<DirectoryEntry[]> {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile(),
    }));
  }

  async mkdir(path: string): Promise<void> {
    await mkdir(path, { recursive: true });
  }

  async unlink(path: string): Promise<void> {
    await unlink(path);
  }

  async rmdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    await rm(path, { recursive: options?.recursive ?? false });
  }

  resolve(base: string, ...paths: string[]): string {
    return resolve(base, ...paths);
  }

  relative(from: string, to: string): string {
    return relative(from, to);
  }

  dirname(path: string): string {
    return dirname(path);
  }

  basename(path: string): string {
    return basename(path);
  }

  join(...paths: string[]): string {
    return join(...paths);
  }
}

/**
 * Singleton instance of the Node.js filesystem.
 */
export const nodeFilesystem = new NodeFilesystem();

/**
 * Get the filesystem from the tool context extensions.
 * Falls back to Node.js filesystem if not provided.
 */
export function getFilesystem(extensions: Record<string, unknown>): Filesystem {
  const fs = extensions.filesystem as Filesystem | undefined;
  return fs ?? nodeFilesystem;
}
