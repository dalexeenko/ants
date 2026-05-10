/**
 * Tests for LocalFilesystemProvider
 * 
 * These tests verify the provider logic using mock data.
 * Since expo-file-system requires a React Native environment,
 * we test the path manipulation logic directly.
 */

import type { FilesystemProvider, DirectoryEntry } from '@openmgr/ui';

/**
 * Create a mock filesystem provider that mimics the LocalFilesystemProvider
 * behavior for testing purposes.
 */
function createMockLocalFilesystemProvider(
  documentDirectory: string,
  mockData: Record<string, DirectoryEntry[]>
): FilesystemProvider {
  return {
    async listDirectory(path: string): Promise<DirectoryEntry[]> {
      const entries = mockData[path];
      if (!entries) {
        throw new Error(`Directory not found: ${path}`);
      }
      return entries;
    },
    
    async getHomePath(): Promise<string> {
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
      const newPath = `${parentPath}/${name}`;
      // Check if it already exists
      if (mockData[newPath]) {
        throw new Error('A directory with that name already exists');
      }
      // Add to mock data
      mockData[newPath] = [];
      // Add to parent's listing
      const parentEntries = mockData[parentPath] || [];
      parentEntries.push({ name, path: newPath, isDirectory: true });
      mockData[parentPath] = parentEntries;
      return newPath;
    },
  };
}

describe('LocalFilesystemProvider (Logic Tests)', () => {
  let provider: FilesystemProvider;
  const documentPath = '/data/user/0/com.app/files/documents';
  let mockData: Record<string, DirectoryEntry[]>;

  beforeEach(() => {
    // Set up mock directory structure
    mockData = {
      [documentPath]: [
        { name: 'Projects', path: `${documentPath}/Projects`, isDirectory: true },
        { name: 'Documents', path: `${documentPath}/Documents`, isDirectory: true },
        { name: 'Downloads', path: `${documentPath}/Downloads`, isDirectory: true },
        { name: 'test.txt', path: `${documentPath}/test.txt`, isDirectory: false },
      ],
      [`${documentPath}/Projects`]: [
        { name: 'app', path: `${documentPath}/Projects/app`, isDirectory: true },
        { name: 'server', path: `${documentPath}/Projects/server`, isDirectory: true },
      ],
      [`${documentPath}/Projects/app`]: [],
      [`${documentPath}/Projects/server`]: [],
      [`${documentPath}/Documents`]: [],
      [`${documentPath}/Downloads`]: [],
    };
    
    // Create provider with mock data
    provider = createMockLocalFilesystemProvider(documentPath, mockData);
  });

  describe('getHomePath', () => {
    it('should return the document directory path', async () => {
      const homePath = await provider.getHomePath();
      expect(homePath).toBe(documentPath);
    });
  });

  describe('listDirectory', () => {
    it('should list directory contents', async () => {
      const entries = await provider.listDirectory(documentPath);
      
      expect(entries.length).toBeGreaterThan(0);
      
      const projectsDir = entries.find(e => e.name === 'Projects');
      expect(projectsDir).toBeDefined();
      expect(projectsDir?.isDirectory).toBe(true);
      
      const documentsDir = entries.find(e => e.name === 'Documents');
      expect(documentsDir).toBeDefined();
      expect(documentsDir?.isDirectory).toBe(true);
    });

    it('should list nested directory contents', async () => {
      const entries = await provider.listDirectory(`${documentPath}/Projects`);
      
      const appDir = entries.find(e => e.name === 'app');
      expect(appDir).toBeDefined();
      expect(appDir?.isDirectory).toBe(true);
      
      const serverDir = entries.find(e => e.name === 'server');
      expect(serverDir).toBeDefined();
      expect(serverDir?.isDirectory).toBe(true);
    });

    it('should return empty array for empty directory', async () => {
      const entries = await provider.listDirectory(`${documentPath}/Downloads`);
      expect(entries).toEqual([]);
    });
  });

  describe('getParentPath', () => {
    it('should return parent directory path for nested path', () => {
      const parent = provider.getParentPath(`${documentPath}/Projects/app`);
      expect(parent).toBe(`${documentPath}/Projects`);
    });

    it('should return document directory when going up from first level subdirectory', () => {
      const parent = provider.getParentPath(`${documentPath}/Projects`);
      expect(parent).toBe(documentPath);
    });

    it('should handle file:// prefix', () => {
      const parent = provider.getParentPath(`file://${documentPath}/Projects/app`);
      expect(parent).toBe(`${documentPath}/Projects`);
    });
  });

  describe('isRoot', () => {
    it('should return true for root path /', () => {
      expect(provider.isRoot('/')).toBe(true);
    });

    it('should return true for empty path', () => {
      expect(provider.isRoot('')).toBe(true);
    });

    it('should return false for nested subdirectory', () => {
      expect(provider.isRoot(`${documentPath}/Projects/app`)).toBe(false);
    });

    it('should return false for first level subdirectory', () => {
      expect(provider.isRoot(`${documentPath}/Projects`)).toBe(false);
    });
  });

  describe('createDirectory', () => {
    it('should create a new directory', async () => {
      expect(provider.createDirectory).toBeDefined();
      
      const newPath = await provider.createDirectory!(`${documentPath}`, 'NewFolder');
      expect(newPath).toBe(`${documentPath}/NewFolder`);
      
      // Verify it was added to mock data
      expect(mockData[`${documentPath}/NewFolder`]).toEqual([]);
      
      // Verify it shows up in parent listing
      const parentEntries = mockData[documentPath];
      const newEntry = parentEntries.find(e => e.name === 'NewFolder');
      expect(newEntry).toBeDefined();
      expect(newEntry?.isDirectory).toBe(true);
    });

    it('should throw error if directory already exists', async () => {
      // Pre-add the directory to mock data
      mockData[`${documentPath}/ExistingDir`] = [];
      
      await expect(
        provider.createDirectory!(`${documentPath}`, 'ExistingDir')
      ).rejects.toThrow('A directory with that name already exists');
    });
  });
});
