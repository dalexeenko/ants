/**
 * React Native Filesystem Implementation
 * 
 * Uses expo-file-system for file operations.
 * Updated for expo-file-system v19+ which uses a class-based API.
 */

import { Paths, Directory, File } from 'expo-file-system';
import type { PlatformFilesystem, FileEntry } from '@ants/ui';
import { createLogger } from '@ants/ui';

const log = createLogger('ReactNativeFilesystem');

/**
 * React Native filesystem implementation using expo-file-system.
 */
export class ReactNativeFilesystem implements PlatformFilesystem {
  private dataDirectory: string;

  constructor() {
    // Use the document directory as the data directory
    this.dataDirectory = Paths.document.uri;
  }

  async readDirectory(path: string): Promise<FileEntry[]> {
    try {
      const directory = new Directory(this.toFileUri(path));
      
      if (!directory.exists) {
        return [];
      }

      const entries = directory.list();
      const result: FileEntry[] = [];

      for (const entry of entries) {
        if (entry instanceof File) {
          try {
            const info = entry.info();
            result.push({
              name: entry.name,
              path: this.fromFileUri(entry.uri),
              isDirectory: false,
              size: info?.size,
              modifiedAt: info?.modificationTime ? info.modificationTime * 1000 : undefined,
            });
          } catch {
            // If we can't get info, still include with minimal data
            result.push({
              name: entry.name,
              path: this.fromFileUri(entry.uri),
              isDirectory: false,
            });
          }
        } else if (entry instanceof Directory) {
          result.push({
            name: entry.name,
            path: this.fromFileUri(entry.uri),
            isDirectory: true,
          });
        }
      }

      return result;
    } catch (error) {
      log.error(`Failed to read directory ${path}:`, error);
      return [];
    }
  }

  async readFile(path: string): Promise<string> {
    const file = new File(this.toFileUri(path));
    try {
      if (!file.exists) {
        throw new Error(`File does not exist: ${path}`);
      }
      return await file.text();
    } catch (error) {
      throw new Error(`Failed to read file ${path}: ${error}`);
    }
  }

  async writeFile(path: string, content: string): Promise<void> {
    const file = new File(this.toFileUri(path));
    try {
      file.write(content);
    } catch (error) {
      throw new Error(`Failed to write file ${path}: ${error}`);
    }
  }

  async pathExists(path: string): Promise<boolean> {
    try {
      const uri = this.toFileUri(path);
      // Try as file first
      const file = new File(uri);
      if (file.exists) return true;
      
      // Try as directory
      const dir = new Directory(uri);
      return dir.exists;
    } catch {
      return false;
    }
  }

  getDataDirectory(): string {
    return this.fromFileUri(this.dataDirectory);
  }

  /**
   * Convert a path to a file:// URI if needed.
   */
  private toFileUri(path: string): string {
    if (path.startsWith('file://')) {
      return path;
    }
    if (path.startsWith('/')) {
      return `file://${path}`;
    }
    // Relative path - combine with data directory
    return `${this.dataDirectory}${this.dataDirectory.endsWith('/') ? '' : '/'}${path}`;
  }

  /**
   * Convert a file:// URI back to a regular path.
   */
  private fromFileUri(uri: string): string {
    if (uri.startsWith('file://')) {
      return uri.replace('file://', '');
    }
    return uri;
  }
}

/**
 * Create a React Native filesystem instance.
 */
export function createReactNativeFilesystem(): ReactNativeFilesystem {
  return new ReactNativeFilesystem();
}
