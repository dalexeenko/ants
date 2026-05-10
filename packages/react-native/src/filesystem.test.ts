/**
 * Tests for ReactNativeFilesystem
 * 
 * Tests the filesystem abstraction logic by mocking the expo-file-system classes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReactNativeFilesystem, type ExpoFileSystemModule, type ExpoFileInstance, type ExpoDirectoryInstance } from './filesystem.js';

/**
 * Create a mock expo-file-system module with controllable behavior.
 */
function createMockExpoModule(options?: {
  documentUri?: string;
  files?: Map<string, { content?: string; exists: boolean; isDirectory: boolean }>;
}): ExpoFileSystemModule {
  const documentUri = options?.documentUri ?? 'file:///data/documents';
  const files = options?.files ?? new Map();
  
  // Helper to get file data
  const getFileData = (uri: string) => files.get(uri) ?? { exists: false, isDirectory: false };
  
  // Mock File class
  class MockFile implements ExpoFileInstance {
    uri: string;
    
    constructor(...uris: Array<string | ExpoFileInstance | ExpoDirectoryInstance>) {
      // Combine URIs (simple implementation for tests)
      this.uri = typeof uris[0] === 'string' ? uris[0] : (uris[0] as ExpoFileInstance).uri;
    }
    
    get exists(): boolean {
      return getFileData(this.uri).exists;
    }
    
    get size(): number {
      const data = getFileData(this.uri);
      return data.content?.length ?? 0;
    }
    
    get modificationTime(): number | null {
      return getFileData(this.uri).exists ? Date.now() : null;
    }
    
    text(): Promise<string> {
      const data = getFileData(this.uri);
      return Promise.resolve(data.content ?? '');
    }
    
    write(content: string): void {
      files.set(this.uri, { content, exists: true, isDirectory: false });
    }
    
    delete(): void {
      files.delete(this.uri);
    }
    
    create(): void {
      files.set(this.uri, { content: '', exists: true, isDirectory: false });
    }
  }
  
  // Mock Directory class
  class MockDirectory implements ExpoDirectoryInstance {
    uri: string;
    
    constructor(...uris: Array<string | ExpoFileInstance | ExpoDirectoryInstance>) {
      this.uri = typeof uris[0] === 'string' ? uris[0] : (uris[0] as ExpoFileInstance).uri;
    }
    
    get exists(): boolean {
      return getFileData(this.uri).exists && getFileData(this.uri).isDirectory;
    }
    
    list(): Array<ExpoFileInstance | ExpoDirectoryInstance> {
      const prefix = this.uri.endsWith('/') ? this.uri : this.uri + '/';
      const result: Array<ExpoFileInstance | ExpoDirectoryInstance> = [];
      
      for (const [uri, data] of files.entries()) {
        if (uri.startsWith(prefix) && uri !== this.uri) {
          // Check if it's a direct child
          const relative = uri.substring(prefix.length);
          if (!relative.includes('/')) {
            if (data.isDirectory) {
              result.push(new MockDirectory(uri));
            } else {
              result.push(new MockFile(uri));
            }
          }
        }
      }
      
      return result;
    }
    
    create(): void {
      files.set(this.uri, { exists: true, isDirectory: true });
    }
    
    delete(): void {
      const prefix = this.uri.endsWith('/') ? this.uri : this.uri + '/';
      for (const uri of files.keys()) {
        if (uri === this.uri || uri.startsWith(prefix)) {
          files.delete(uri);
        }
      }
    }
  }
  
  return {
    File: MockFile as unknown as ExpoFileSystemModule['File'],
    Directory: MockDirectory as unknown as ExpoFileSystemModule['Directory'],
    Paths: {
      document: new MockDirectory(documentUri),
      cache: new MockDirectory('file:///data/cache'),
      info: (...uris: string[]) => {
        const uri = uris[0] ?? '';
        const data = getFileData(uri);
        return {
          exists: data.exists,
          isDirectory: data.isDirectory ? true : null,
        };
      },
    },
  };
}

describe('ReactNativeFilesystem', () => {
  let mockModule: ExpoFileSystemModule;
  let fs: ReactNativeFilesystem;
  let testFiles: Map<string, { content?: string; exists: boolean; isDirectory: boolean }>;

  beforeEach(() => {
    testFiles = new Map([
      ['file:///data/documents', { exists: true, isDirectory: true }],
      ['file:///data/documents/Projects', { exists: true, isDirectory: true }],
      ['file:///data/documents/Projects/app', { exists: true, isDirectory: true }],
      ['file:///data/documents/test.txt', { content: 'Hello World', exists: true, isDirectory: false }],
      ['file:///data/documents/Projects/file.js', { content: 'const x = 1;', exists: true, isDirectory: false }],
    ]);
    
    mockModule = createMockExpoModule({
      documentUri: 'file:///data/documents',
      files: testFiles,
    });
    
    fs = new ReactNativeFilesystem(mockModule);
  });

  describe('readFile', () => {
    it('should read file contents', async () => {
      const content = await fs.readFile('/data/documents/test.txt');
      expect(content).toBe('Hello World');
    });

    it('should read file from nested path', async () => {
      const content = await fs.readFile('/data/documents/Projects/file.js');
      expect(content).toBe('const x = 1;');
    });
  });

  describe('writeFile', () => {
    it('should write file contents', async () => {
      await fs.writeFile('/data/documents/new.txt', 'New content');
      
      // Verify by reading back
      const content = await fs.readFile('/data/documents/new.txt');
      expect(content).toBe('New content');
    });

    it('should overwrite existing file', async () => {
      await fs.writeFile('/data/documents/test.txt', 'Updated content');
      
      const content = await fs.readFile('/data/documents/test.txt');
      expect(content).toBe('Updated content');
    });
  });

  describe('stat', () => {
    it('should return file stats', async () => {
      const stat = await fs.stat('/data/documents/test.txt');
      
      expect(stat.isFile).toBe(true);
      expect(stat.isDirectory).toBe(false);
      expect(stat.size).toBeGreaterThan(0);
    });

    it('should return directory stats', async () => {
      const stat = await fs.stat('/data/documents/Projects');
      
      expect(stat.isFile).toBe(false);
      expect(stat.isDirectory).toBe(true);
    });

    it('should throw for non-existent path', async () => {
      await expect(fs.stat('/data/documents/nonexistent')).rejects.toThrow('ENOENT');
    });
  });

  describe('exists', () => {
    it('should return true for existing file', async () => {
      const exists = await fs.exists('/data/documents/test.txt');
      expect(exists).toBe(true);
    });

    it('should return true for existing directory', async () => {
      const exists = await fs.exists('/data/documents/Projects');
      expect(exists).toBe(true);
    });

    it('should return false for non-existent path', async () => {
      const exists = await fs.exists('/data/documents/nonexistent');
      expect(exists).toBe(false);
    });
  });

  describe('readdir', () => {
    it('should list directory contents', async () => {
      const entries = await fs.readdir('/data/documents');
      
      expect(entries.length).toBeGreaterThan(0);
      
      const projectsDir = entries.find(e => e.name === 'Projects');
      expect(projectsDir).toBeDefined();
      expect(projectsDir?.isDirectory).toBe(true);
      
      const testFile = entries.find(e => e.name === 'test.txt');
      expect(testFile).toBeDefined();
      expect(testFile?.isFile).toBe(true);
    });

    it('should list nested directory contents', async () => {
      const entries = await fs.readdir('/data/documents/Projects');
      
      const appDir = entries.find(e => e.name === 'app');
      expect(appDir).toBeDefined();
      expect(appDir?.isDirectory).toBe(true);
      
      const fileJs = entries.find(e => e.name === 'file.js');
      expect(fileJs).toBeDefined();
      expect(fileJs?.isFile).toBe(true);
    });
  });

  describe('mkdir', () => {
    it('should create a new directory', async () => {
      await fs.mkdir('/data/documents/NewDir');
      
      const exists = await fs.exists('/data/documents/NewDir');
      expect(exists).toBe(true);
    });
  });

  describe('unlink', () => {
    it('should delete a file', async () => {
      // First verify it exists
      expect(await fs.exists('/data/documents/test.txt')).toBe(true);
      
      await fs.unlink('/data/documents/test.txt');
      
      expect(await fs.exists('/data/documents/test.txt')).toBe(false);
    });
  });

  describe('path operations', () => {
    describe('resolve', () => {
      it('should resolve relative paths', () => {
        const resolved = fs.resolve('/data/documents', 'Projects/app');
        expect(resolved).toBe('/data/documents/Projects/app');
      });

      it('should handle absolute paths', () => {
        const resolved = fs.resolve('/data/documents', '/other/path');
        expect(resolved).toBe('/other/path');
      });

      it('should normalize . and ..', () => {
        const resolved = fs.resolve('/data/documents/Projects', '../test.txt');
        expect(resolved).toBe('/data/documents/test.txt');
      });
    });

    describe('relative', () => {
      it('should compute relative path', () => {
        const relative = fs.relative('/data/documents', '/data/documents/Projects/app');
        expect(relative).toBe('Projects/app');
      });

      it('should handle same path', () => {
        const relative = fs.relative('/data/documents', '/data/documents');
        expect(relative).toBe('.');
      });

      it('should handle going up directories', () => {
        const relative = fs.relative('/data/documents/Projects', '/data/documents');
        expect(relative).toBe('..');
      });
    });

    describe('dirname', () => {
      it('should return parent directory', () => {
        expect(fs.dirname('/data/documents/test.txt')).toBe('/data/documents');
        expect(fs.dirname('/data/documents/Projects/app')).toBe('/data/documents/Projects');
      });

      it('should return / for root level', () => {
        expect(fs.dirname('/data')).toBe('/');
      });
    });

    describe('basename', () => {
      it('should return file name', () => {
        expect(fs.basename('/data/documents/test.txt')).toBe('test.txt');
        expect(fs.basename('/data/documents/Projects')).toBe('Projects');
      });
    });

    describe('join', () => {
      it('should join path segments', () => {
        expect(fs.join('/data', 'documents', 'test.txt')).toBe('/data/documents/test.txt');
      });

      it('should normalize joined paths', () => {
        expect(fs.join('/data', 'documents', '..', 'other')).toBe('/data/other');
      });
    });
  });
});
