/**
 * Local Filesystem Provider for React Native
 * 
 * Implements FilesystemProvider interface using expo-file-system
 * for browsing and creating directories on the device.
 */

import { Paths, Directory } from 'expo-file-system';
import type { FilesystemProvider, DirectoryEntry } from '@openmgr/ui';
import { createLogger } from '@openmgr/ui';

const log = createLogger('LocalFilesystemProvider');

/**
 * Get the document directory path without file:// prefix
 */
function getDocumentDirectory(): string {
  const docDir = Paths.document.uri || '';
  // Remove file:// prefix and trailing slash
  return docDir.replace(/^file:\/\//, '').replace(/\/$/, '');
}

/**
 * Get the default projects directory.
 * Creates an "OpenMgr Projects" folder in the document directory.
 */
export function getDefaultProjectsDirectory(): string {
  const docDir = getDocumentDirectory();
  return `${docDir}/OpenMgr Projects`;
}

/**
 * Ensure the default projects directory exists.
 */
export function ensureDefaultProjectsDirectory(): string {
  const projectsPath = getDefaultProjectsDirectory();
  const projectsUri = `file://${projectsPath}`;
  
  try {
    // Check if it already exists using Paths.info
    const info = Paths.info(projectsUri);
    if (!info.exists) {
      const dir = new Directory(projectsUri);
      dir.create();
      log.info('Created default projects directory:', projectsPath);
    } else {
      log.debug('Default projects directory already exists:', projectsPath);
    }
  } catch (error) {
    log.error('Failed to create default projects directory:', error);
  }
  
  return projectsPath;
}

/**
 * Ensure a specific directory exists, creating it if necessary.
 */
export function ensureDirectoryExists(path: string): void {
  const uri = `file://${path}`;
  
  try {
    const info = Paths.info(uri);
    if (!info.exists) {
      const dir = new Directory(uri);
      dir.create();
      log.info('Created directory:', path);
    }
  } catch (error) {
    log.error('Failed to create directory:', path, error);
    throw error;
  }
}

/**
 * Convert a path to a file:// URI
 */
function toFileUri(path: string): string {
  if (path.startsWith('file://')) {
    return path;
  }
  return `file://${path}`;
}

/**
 * Create a local filesystem provider for React Native.
 * Uses expo-file-system to browse and create directories.
 */
export function createLocalFilesystemProvider(): FilesystemProvider {
  const documentDirectory = getDocumentDirectory();
  
  return {
    async listDirectory(path: string): Promise<DirectoryEntry[]> {
      const uri = toFileUri(path);
      // Normalize the path to avoid trailing slashes
      const normalizedPath = path.replace(/\/$/, '');
      
      try {
        // Create a Directory instance and list contents
        const dir = new Directory(uri);
        const items = dir.list();
        
        // Use a Set to track seen paths and avoid duplicates
        const seenPaths = new Set<string>();
        
        // Convert to DirectoryEntry format
        const entries: DirectoryEntry[] = [];
        for (const item of items) {
          // Extract name from URI
          const itemUri = item.uri;
          const name = itemUri.split('/').pop() || '';
          
          // Skip empty names
          if (!name) continue;
          
          const itemPath = `${normalizedPath}/${name}`;
          
          // Skip duplicates
          if (seenPaths.has(itemPath)) {
            log.warn('Skipping duplicate path', itemPath);
            continue;
          }
          seenPaths.add(itemPath);
          
          // Check if it's a directory by checking if it's a Directory instance
          const isDirectory = item instanceof Directory;
          
          entries.push({
            name,
            path: itemPath,
            isDirectory,
          });
        }
        
        return entries;
      } catch (error) {
        log.error('Failed to list directory', error);
        throw error;
      }
    },
    
    async getHomePath(): Promise<string> {
      // On React Native, return the document directory as "home"
      return documentDirectory;
    },
    
    getParentPath(path: string): string {
      // Remove file:// prefix if present
      const cleanPath = path.replace(/^file:\/\//, '');
      const normalized = cleanPath.replace(/\/$/, '');
      const lastSlash = normalized.lastIndexOf('/');
      
      // Don't go above the document directory
      if (lastSlash <= 0 || normalized === documentDirectory) {
        return documentDirectory;
      }
      
      const parent = normalized.substring(0, lastSlash);
      
      // Ensure we don't go above document directory
      if (!parent.startsWith(documentDirectory)) {
        return documentDirectory;
      }
      
      return parent;
    },
    
    isRoot(path: string): boolean {
      const cleanPath = path.replace(/^file:\/\//, '').replace(/\/$/, '');
      // Consider document directory as root
      return cleanPath === documentDirectory || cleanPath === '' || cleanPath === '/';
    },
    
    async createDirectory(parentPath: string, name: string): Promise<string> {
      const parentUri = toFileUri(parentPath);
      const newUri = `${parentUri}/${name}`;
      const newPath = `${parentPath}/${name}`;
      
      try {
        // Check if it already exists using Paths.info
        const info = Paths.info(newUri);
        if (info.exists) {
          if (info.isDirectory) {
            // Directory already exists, just return the path
            log.debug('Directory already exists, returning existing path');
            return newPath;
          } else {
            throw new Error('A file with that name already exists');
          }
        }
        
        // Create the directory
        const newDir = new Directory(newUri);
        newDir.create();
        
        return newPath;
      } catch (error) {
        log.error('Failed to create directory', error);
        throw error;
      }
    },
  };
}
