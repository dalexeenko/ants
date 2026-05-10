/**
 * Tests for platform-agnostic file tools
 * 
 * These tools work with any Filesystem implementation via ctx.extensions.filesystem.
 */

import { describe, it, expect, vi } from 'vitest';
import { readTool, writeTool, editTool, listTool, fileToolsPlugin } from './file-tools.js';
import type { Filesystem, FileStat, DirectoryEntry } from '@ants/agent-core';

/**
 * Create a mock filesystem for testing.
 */
function createMockFilesystem(files: Map<string, { content: string; isDirectory: boolean }>): Filesystem {
  return {
    async readFile(path: string): Promise<string> {
      const file = files.get(path);
      if (!file) {
        const error = new Error(`ENOENT: no such file: ${path}`) as Error & { code: string };
        error.code = 'ENOENT';
        throw error;
      }
      if (file.isDirectory) {
        throw new Error(`EISDIR: is a directory: ${path}`);
      }
      return file.content;
    },
    
    async writeFile(path: string, content: string): Promise<void> {
      files.set(path, { content, isDirectory: false });
    },
    
    async stat(path: string): Promise<FileStat> {
      const file = files.get(path);
      if (!file) {
        const error = new Error(`ENOENT: no such file: ${path}`) as Error & { code: string };
        error.code = 'ENOENT';
        throw error;
      }
      return {
        size: file.content.length,
        isDirectory: file.isDirectory,
        isFile: !file.isDirectory,
      };
    },
    
    async exists(path: string): Promise<boolean> {
      return files.has(path);
    },
    
    async readdir(path: string): Promise<DirectoryEntry[]> {
      const entries: DirectoryEntry[] = [];
      const prefix = path.endsWith('/') ? path : path + '/';
      
      for (const [filePath, file] of files.entries()) {
        if (filePath.startsWith(prefix) && filePath !== path) {
          const relative = filePath.substring(prefix.length);
          // Only direct children
          if (!relative.includes('/')) {
            entries.push({
              name: relative,
              isDirectory: file.isDirectory,
              isFile: !file.isDirectory,
            });
          }
        }
      }
      
      return entries;
    },
    
    async mkdir(_path: string): Promise<void> {
      // No-op for tests
    },
    
    async unlink(path: string): Promise<void> {
      files.delete(path);
    },
    
    async rmdir(path: string): Promise<void> {
      // Delete directory and all children
      const prefix = path.endsWith('/') ? path : path + '/';
      for (const key of files.keys()) {
        if (key === path || key.startsWith(prefix)) {
          files.delete(key);
        }
      }
    },
    
    resolve(base: string, ...paths: string[]): string {
      let result = base;
      for (const p of paths) {
        if (p.startsWith('/')) {
          result = p;
        } else {
          result = result.endsWith('/') ? result + p : result + '/' + p;
        }
      }
      // Normalize
      const parts = result.split('/');
      const normalized: string[] = [];
      for (const part of parts) {
        if (part === '..') {
          normalized.pop();
        } else if (part !== '.' && part !== '') {
          normalized.push(part);
        }
      }
      return '/' + normalized.join('/');
    },
    
    relative(from: string, to: string): string {
      const fromParts = from.split('/').filter(Boolean);
      const toParts = to.split('/').filter(Boolean);
      
      let commonLength = 0;
      while (
        commonLength < fromParts.length &&
        commonLength < toParts.length &&
        fromParts[commonLength] === toParts[commonLength]
      ) {
        commonLength++;
      }
      
      const upCount = fromParts.length - commonLength;
      const remaining = toParts.slice(commonLength);
      
      return [...Array(upCount).fill('..'), ...remaining].join('/') || '.';
    },
    
    dirname(path: string): string {
      const lastSlash = path.lastIndexOf('/');
      return lastSlash <= 0 ? '/' : path.substring(0, lastSlash);
    },
    
    basename(path: string): string {
      const lastSlash = path.lastIndexOf('/');
      return path.substring(lastSlash + 1);
    },
    
    join(...paths: string[]): string {
      return this.resolve('/', ...paths);
    },
  };
}

/**
 * Create tool context for testing.
 */
function createContext(filesystem: Filesystem, workingDirectory = '/project') {
  return {
    workingDirectory,
    extensions: { filesystem },
  };
}

describe('file-tools', () => {
  describe('readTool', () => {
    it('should read file with line numbers', async () => {
      const files = new Map([
        ['/project/test.txt', { content: 'Line 1\nLine 2\nLine 3', isDirectory: false }],
      ]);
      const fs = createMockFilesystem(files);
      const ctx = createContext(fs);
      
      const result = await readTool.execute({ path: 'test.txt' }, ctx);
      
      expect(result.output).toContain('Line 1');
      expect(result.output).toContain('Line 2');
      expect(result.output).toContain('Line 3');
      expect(result.metadata).toMatchObject({
        path: 'test.txt',
        totalLines: 3,
      });
    });

    it('should support offset and limit', async () => {
      const lines = Array.from({ length: 10 }, (_, i) => `Line ${i + 1}`);
      const files = new Map([
        ['/project/large.txt', { content: lines.join('\n'), isDirectory: false }],
      ]);
      const fs = createMockFilesystem(files);
      const ctx = createContext(fs);
      
      const result = await readTool.execute({ path: 'large.txt', offset: 3, limit: 3 }, ctx);
      
      expect(result.output).toContain('Line 4');
      expect(result.output).toContain('Line 5');
      expect(result.output).toContain('Line 6');
      expect(result.output).not.toContain('Line 1');
      expect(result.output).not.toContain('Line 7');
    });

    it('should return error for non-existent file', async () => {
      const fs = createMockFilesystem(new Map());
      const ctx = createContext(fs);
      
      const result = await readTool.execute({ path: 'nonexistent.txt' }, ctx);
      
      expect(result.output).toContain('Error');
      expect(result.output).toContain('not found');
      expect(result.metadata?.error).toBe(true);
    });

    it('should return error for directory', async () => {
      const files = new Map([
        ['/project/mydir', { content: '', isDirectory: true }],
      ]);
      const fs = createMockFilesystem(files);
      const ctx = createContext(fs);
      
      const result = await readTool.execute({ path: 'mydir' }, ctx);
      
      expect(result.output).toContain('directory');
      expect(result.metadata?.error).toBe(true);
    });

    it('should reject paths outside working directory', async () => {
      const files = new Map([
        ['/other/secret.txt', { content: 'secret', isDirectory: false }],
      ]);
      const fs = createMockFilesystem(files);
      const ctx = createContext(fs);
      
      const result = await readTool.execute({ path: '../other/secret.txt' }, ctx);
      
      expect(result.output).toContain('outside the working directory');
      expect(result.metadata?.error).toBe(true);
    });

    it('should throw when no filesystem provided', async () => {
      const ctx = { workingDirectory: '/project', extensions: {} };
      
      await expect(readTool.execute({ path: 'test.txt' }, ctx)).rejects.toThrow('No filesystem provided');
    });
  });

  describe('writeTool', () => {
    it('should write content to a new file', async () => {
      const files = new Map<string, { content: string; isDirectory: boolean }>();
      const fs = createMockFilesystem(files);
      const ctx = createContext(fs);
      
      const result = await writeTool.execute({ path: 'new.txt', content: 'Hello World' }, ctx);
      
      expect(result.output).toContain('Successfully wrote');
      expect(files.get('/project/new.txt')?.content).toBe('Hello World');
    });

    it('should overwrite existing file', async () => {
      const files = new Map([
        ['/project/existing.txt', { content: 'Old content', isDirectory: false }],
      ]);
      const fs = createMockFilesystem(files);
      const ctx = createContext(fs);
      
      const result = await writeTool.execute({ path: 'existing.txt', content: 'New content' }, ctx);
      
      expect(result.output).toContain('Successfully wrote');
      expect(files.get('/project/existing.txt')?.content).toBe('New content');
    });

    it('should reject paths outside working directory', async () => {
      const files = new Map<string, { content: string; isDirectory: boolean }>();
      const fs = createMockFilesystem(files);
      const ctx = createContext(fs);
      
      const result = await writeTool.execute({ path: '/etc/passwd', content: 'bad' }, ctx);
      
      expect(result.output).toContain('outside the working directory');
      expect(result.metadata?.error).toBe(true);
    });
  });

  describe('editTool', () => {
    it('should replace text in file', async () => {
      const files = new Map([
        ['/project/code.js', { content: 'const foo = 1;\nconst bar = 2;', isDirectory: false }],
      ]);
      const fs = createMockFilesystem(files);
      const ctx = createContext(fs);
      
      const result = await editTool.execute({
        path: 'code.js',
        oldString: 'foo',
        newString: 'baz',
      }, ctx);
      
      expect(result.output).toContain('Successfully replaced');
      expect(files.get('/project/code.js')?.content).toBe('const baz = 1;\nconst bar = 2;');
    });

    it('should replace all occurrences with replaceAll', async () => {
      const files = new Map([
        ['/project/code.js', { content: 'foo foo foo', isDirectory: false }],
      ]);
      const fs = createMockFilesystem(files);
      const ctx = createContext(fs);
      
      const result = await editTool.execute({
        path: 'code.js',
        oldString: 'foo',
        newString: 'bar',
        replaceAll: true,
      }, ctx);
      
      expect(result.output).toContain('3 occurrence');
      expect(files.get('/project/code.js')?.content).toBe('bar bar bar');
    });

    it('should error when oldString not found', async () => {
      const files = new Map([
        ['/project/code.js', { content: 'const x = 1;', isDirectory: false }],
      ]);
      const fs = createMockFilesystem(files);
      const ctx = createContext(fs);
      
      const result = await editTool.execute({
        path: 'code.js',
        oldString: 'notfound',
        newString: 'replacement',
      }, ctx);
      
      expect(result.output).toContain('not found');
      expect(result.metadata?.error).toBe(true);
    });

    it('should error when multiple matches without replaceAll', async () => {
      const files = new Map([
        ['/project/code.js', { content: 'foo foo', isDirectory: false }],
      ]);
      const fs = createMockFilesystem(files);
      const ctx = createContext(fs);
      
      const result = await editTool.execute({
        path: 'code.js',
        oldString: 'foo',
        newString: 'bar',
      }, ctx);
      
      expect(result.output).toContain('found 2 times');
      expect(result.metadata?.error).toBe(true);
    });

    it('should error when oldString equals newString', async () => {
      const files = new Map([
        ['/project/code.js', { content: 'const foo = 1;', isDirectory: false }],
      ]);
      const fs = createMockFilesystem(files);
      const ctx = createContext(fs);
      
      const result = await editTool.execute({
        path: 'code.js',
        oldString: 'foo',
        newString: 'foo',
      }, ctx);
      
      expect(result.output).toContain('identical');
      expect(result.metadata?.error).toBe(true);
    });
  });

  describe('listTool', () => {
    it('should list directory contents', async () => {
      const files = new Map([
        ['/project', { content: '', isDirectory: true }],
        ['/project/file.txt', { content: 'content', isDirectory: false }],
        ['/project/subdir', { content: '', isDirectory: true }],
        ['/project/another.js', { content: 'code', isDirectory: false }],
      ]);
      const fs = createMockFilesystem(files);
      const ctx = createContext(fs);
      
      const result = await listTool.execute({ path: '.' }, ctx);
      
      expect(result.output).toContain('[dir]');
      expect(result.output).toContain('[file]');
      expect(result.output).toContain('subdir');
      expect(result.output).toContain('file.txt');
      expect(result.metadata).toMatchObject({
        count: 3,
      });
    });

    it('should handle empty directory', async () => {
      const files = new Map([
        ['/project', { content: '', isDirectory: true }],
      ]);
      const fs = createMockFilesystem(files);
      const ctx = createContext(fs);
      
      const result = await listTool.execute({}, ctx);
      
      expect(result.output).toContain('empty');
    });

    it('should sort directories first', async () => {
      const files = new Map([
        ['/project', { content: '', isDirectory: true }],
        ['/project/a-file.txt', { content: '', isDirectory: false }],
        ['/project/z-dir', { content: '', isDirectory: true }],
        ['/project/b-file.txt', { content: '', isDirectory: false }],
      ]);
      const fs = createMockFilesystem(files);
      const ctx = createContext(fs);
      
      const result = await listTool.execute({}, ctx);
      const lines = (result.output as string).split('\n');
      
      // First entry should be a directory
      expect(lines[0]).toContain('[dir]');
      expect(lines[0]).toContain('z-dir');
    });
  });

  describe('fileToolsPlugin', () => {
    it('should export all tools', () => {
      expect(fileToolsPlugin.name).toBe('@ants/agent-react-native/file-tools');
      expect(fileToolsPlugin.tools).toHaveLength(4);
      
      const toolNames = fileToolsPlugin.tools!.map((t: { name: string }) => t.name);
      expect(toolNames).toContain('read');
      expect(toolNames).toContain('write');
      expect(toolNames).toContain('edit');
      expect(toolNames).toContain('ls');
    });
  });
});
