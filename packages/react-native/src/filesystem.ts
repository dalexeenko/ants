/**
 * React Native Filesystem Implementation
 * 
 * Implements the Filesystem interface using expo-file-system's new class-based API.
 * This allows terminal tools (read, write, edit) to work in React Native.
 */

import type { Filesystem, FileStat, DirectoryEntry } from "@openmgr/agent-core";

/**
 * File class instance from expo-file-system
 */
export interface ExpoFileInstance {
  readonly uri: string;
  exists: boolean;
  size: number;
  modificationTime: number | null;
  text(): Promise<string>;
  write(content: string): void;
  delete(): void;
  create(): void;
}

/**
 * Directory class instance from expo-file-system
 */
export interface ExpoDirectoryInstance {
  readonly uri: string;
  exists: boolean;
  list(): Array<ExpoFileInstance | ExpoDirectoryInstance>;
  create(): void;
  delete(): void;
}

/**
 * PathInfo from expo-file-system Paths.info()
 */
export interface ExpoPathInfo {
  exists: boolean;
  isDirectory: boolean | null;
}

/**
 * Expo file system module interface (new class-based API)
 * 
 * @example
 * ```typescript
 * import * as FileSystem from 'expo-file-system';
 * const fs = createReactNativeFilesystem(FileSystem);
 * ```
 */
export interface ExpoFileSystemModule {
  File: new (...uris: Array<string | ExpoFileInstance | ExpoDirectoryInstance>) => ExpoFileInstance;
  Directory: new (...uris: Array<string | ExpoFileInstance | ExpoDirectoryInstance>) => ExpoDirectoryInstance;
  Paths: {
    document: ExpoDirectoryInstance;
    cache: ExpoDirectoryInstance;
    info(...uris: string[]): ExpoPathInfo;
  };
}

/**
 * React Native implementation of the Filesystem interface using expo-file-system.
 */
export class ReactNativeFilesystem implements Filesystem {
  private fs: ExpoFileSystemModule;
  private documentDirectory: string;

  constructor(expoFileSystem: ExpoFileSystemModule) {
    this.fs = expoFileSystem;
    // Get the document directory path (remove trailing slash for consistency)
    this.documentDirectory = expoFileSystem.Paths.document.uri.replace(/\/$/, "");
    // Remove file:// prefix if present for internal path handling
    if (this.documentDirectory.startsWith("file://")) {
      this.documentDirectory = this.documentDirectory.substring(7);
    }
  }

  async readFile(path: string): Promise<string> {
    const file = this.createFile(path);
    return file.text();
  }

  async writeFile(path: string, content: string): Promise<void> {
    const file = this.createFile(path);
    // Ensure parent directory exists
    const dir = this.dirname(path);
    await this.mkdir(dir);
    file.write(content);
  }

  async stat(path: string): Promise<FileStat> {
    const file = this.createFile(path);
    
    if (!file.exists) {
      const error = new Error(`ENOENT: no such file or directory, stat '${path}'`) as Error & { code: string };
      error.code = "ENOENT";
      throw error;
    }
    
    // Check if it's a directory
    const uri = this.toUri(path);
    const info = this.fs.Paths.info(uri);
    const isDirectory = info.isDirectory === true;
    
    return {
      size: file.size,
      isDirectory,
      isFile: !isDirectory,
      modifiedAt: file.modificationTime ?? undefined,
    };
  }

  async exists(path: string): Promise<boolean> {
    try {
      const file = this.createFile(path);
      return file.exists;
    } catch {
      return false;
    }
  }

  async readdir(path: string): Promise<DirectoryEntry[]> {
    const dir = this.createDirectory(path);
    const contents = dir.list();
    
    return contents.map((item) => {
      // Extract name from URI
      const uri = item.uri;
      const name = uri.split("/").pop() || "";
      const info = this.fs.Paths.info(uri);
      const isDirectory = info.isDirectory === true;
      
      return {
        name,
        isDirectory,
        isFile: !isDirectory,
      };
    });
  }

  async mkdir(path: string): Promise<void> {
    try {
      const dir = this.createDirectory(path);
      if (!dir.exists) {
        dir.create();
      }
    } catch {
      // Ignore errors (directory might already exist)
    }
  }

  async unlink(path: string): Promise<void> {
    const file = this.createFile(path);
    if (file.exists) {
      file.delete();
    }
  }

  async rmdir(path: string, _options?: { recursive?: boolean }): Promise<void> {
    const dir = this.createDirectory(path);
    if (dir.exists) {
      // expo-file-system delete is always recursive
      dir.delete();
    }
  }

  resolve(base: string, ...paths: string[]): string {
    // Simple path resolution - normalize and join
    let result = base;
    
    for (const p of paths) {
      if (p.startsWith("/")) {
        // Absolute path replaces everything
        result = p;
      } else {
        // Relative path - join
        result = this.join(result, p);
      }
    }
    
    // Normalize the path (resolve . and ..)
    return this.normalizePath(result);
  }

  relative(from: string, to: string): string {
    const fromParts = this.normalizePath(from).split("/").filter(Boolean);
    const toParts = this.normalizePath(to).split("/").filter(Boolean);
    
    // Find common prefix
    let commonLength = 0;
    while (
      commonLength < fromParts.length &&
      commonLength < toParts.length &&
      fromParts[commonLength] === toParts[commonLength]
    ) {
      commonLength++;
    }
    
    // Build relative path
    const upCount = fromParts.length - commonLength;
    const remainingParts = toParts.slice(commonLength);
    
    const relativeParts = [
      ...Array(upCount).fill(".."),
      ...remainingParts,
    ];
    
    return relativeParts.join("/") || ".";
  }

  dirname(path: string): string {
    const normalized = this.normalizePath(path);
    const lastSlash = normalized.lastIndexOf("/");
    if (lastSlash <= 0) return "/";
    return normalized.substring(0, lastSlash);
  }

  basename(path: string): string {
    const normalized = this.normalizePath(path);
    const lastSlash = normalized.lastIndexOf("/");
    return normalized.substring(lastSlash + 1);
  }

  join(...paths: string[]): string {
    return this.normalizePath(paths.filter(Boolean).join("/"));
  }

  // Internal helpers

  private createFile(path: string): ExpoFileInstance {
    const uri = this.toUri(path);
    return new this.fs.File(uri);
  }

  private createDirectory(path: string): ExpoDirectoryInstance {
    const uri = this.toUri(path);
    return new this.fs.Directory(uri);
  }

  private toUri(path: string): string {
    // If already a file:// URI, return as-is
    if (path.startsWith("file://")) {
      return path;
    }
    
    // If absolute path, convert to file URI
    if (path.startsWith("/")) {
      return `file://${path}`;
    }
    
    // Relative path - resolve against document directory
    return `file://${this.documentDirectory}/${path}`;
  }

  private normalizePath(path: string): string {
    // Remove file:// prefix if present
    if (path.startsWith("file://")) {
      path = path.substring(7);
    }
    
    // Split into parts and resolve . and ..
    const parts = path.split("/");
    const result: string[] = [];
    
    for (const part of parts) {
      if (part === "." || part === "") {
        continue;
      } else if (part === "..") {
        result.pop();
      } else {
        result.push(part);
      }
    }
    
    // Preserve leading slash for absolute paths
    const prefix = path.startsWith("/") ? "/" : "";
    return prefix + result.join("/");
  }
}

/**
 * Create a React Native filesystem instance.
 * 
 * @param expoFileSystem - The expo-file-system module (import * as FileSystem from 'expo-file-system')
 * @example
 * ```typescript
 * import * as FileSystem from 'expo-file-system';
 * const fs = createReactNativeFilesystem(FileSystem);
 * ```
 */
export function createReactNativeFilesystem(
  expoFileSystem: ExpoFileSystemModule
): ReactNativeFilesystem {
  return new ReactNativeFilesystem(expoFileSystem);
}
