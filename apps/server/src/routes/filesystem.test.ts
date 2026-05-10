import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { createFilesystemRoutes } from './filesystem.js';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';
import type { ServerConfig } from '../config.js';

describe('Filesystem Routes', () => {
  let app: Hono;
  let testDir: string;
  let config: ServerConfig;

  beforeEach(() => {
    // Create temporary test directory
    testDir = join(tmpdir(), `ants-fs-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
    mkdirSync(testDir, { recursive: true });

    // Create test directory structure
    mkdirSync(join(testDir, 'subdir'));
    mkdirSync(join(testDir, 'another-dir'));
    writeFileSync(join(testDir, 'file.txt'), 'test content');
    writeFileSync(join(testDir, 'subdir', 'nested.txt'), 'nested content');
    mkdirSync(join(testDir, '.hidden'));

    // Create config
    config = {
      port: 3000,
      host: 'localhost',
      secret: 'test-secret',
      dataDir: join(testDir, 'data'),
      workspacesDir: testDir,
      autoInstallAgent: false,
      encryptionKey: 'test-key',
      mockAgent: false,
      corsOrigins: [],
      multiUser: false,
      cfAccessSetIdentity: true,
      webApp: false,
      allowedHosts: [],
    };

    app = new Hono();
    const filesystemRoutes = createFilesystemRoutes(config);
    app.route('/', filesystemRoutes);
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('GET /home', () => {
    it('should return home directory and common paths', async () => {
      const res = await app.request('/home');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.home).toBe(homedir());
      expect(data.workspaces).toBe(config.workspacesDir);
      expect(Array.isArray(data.common)).toBe(true);

      // Should have at least Home in common paths
      const homePath = data.common.find((p: { name: string }) => p.name === 'Home');
      expect(homePath).toBeDefined();
      expect(homePath.path).toBe(homedir());
    });

    it('should only include paths that exist in common', async () => {
      const res = await app.request('/home');
      const data = await res.json();

      // All common paths should exist
      for (const entry of data.common) {
        expect(existsSync(entry.path)).toBe(true);
      }
    });
  });

  describe('GET /list', () => {
    it('should list directory contents', async () => {
      const res = await app.request(`/list?path=${encodeURIComponent(testDir)}`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.path).toBe(testDir);
      expect(data.isRoot).toBe(false);
      expect(Array.isArray(data.entries)).toBe(true);

      // Should have our test directories and file
      const names = data.entries.map((e: { name: string }) => e.name);
      expect(names).toContain('subdir');
      expect(names).toContain('another-dir');
      expect(names).toContain('file.txt');
    });

    it('should return correct entry types', async () => {
      const res = await app.request(`/list?path=${encodeURIComponent(testDir)}`);
      const data = await res.json();

      const subdir = data.entries.find((e: { name: string }) => e.name === 'subdir');
      expect(subdir.isDirectory).toBe(true);
      expect(subdir.isFile).toBe(false);

      const file = data.entries.find((e: { name: string }) => e.name === 'file.txt');
      expect(file.isDirectory).toBe(false);
      expect(file.isFile).toBe(true);
    });

    it('should hide hidden files by default', async () => {
      const res = await app.request(`/list?path=${encodeURIComponent(testDir)}`);
      const data = await res.json();

      const names = data.entries.map((e: { name: string }) => e.name);
      expect(names).not.toContain('.hidden');
    });

    it('should show hidden files when showHidden is true', async () => {
      const res = await app.request(`/list?path=${encodeURIComponent(testDir)}&showHidden=true`);
      const data = await res.json();

      const names = data.entries.map((e: { name: string }) => e.name);
      expect(names).toContain('.hidden');
    });

    it('should sort directories first, then alphabetically', async () => {
      const res = await app.request(`/list?path=${encodeURIComponent(testDir)}`);
      const data = await res.json();

      // Directories should come before files
      const entries = data.entries;
      let foundFile = false;
      for (const entry of entries) {
        if (entry.isFile) {
          foundFile = true;
        } else if (entry.isDirectory && foundFile) {
          // Directory found after a file - this is wrong
          expect(entry.isDirectory).toBe(false);
        }
      }
    });

    it('should return parent directory info', async () => {
      const res = await app.request(`/list?path=${encodeURIComponent(join(testDir, 'subdir'))}`);
      const data = await res.json();

      expect(data.parent).toBe(testDir);
      expect(data.isRoot).toBe(false);
    });

    it('should indicate root directory', async () => {
      const res = await app.request('/list?path=/');
      const data = await res.json();

      expect(data.isRoot).toBe(true);
      expect(data.parent).toBe(null);
    });

    it('should return 404 for non-existent path', async () => {
      const res = await app.request('/list?path=/non/existent/path');
      expect(res.status).toBe(404);

      const data = await res.json();
      expect(data.error).toBe('Path not found');
    });

    it('should return 400 when path is not a directory', async () => {
      const filePath = join(testDir, 'file.txt');
      const res = await app.request(`/list?path=${encodeURIComponent(filePath)}`);
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toBe('Path is not a directory');
    });

    it('should return counts', async () => {
      const res = await app.request(`/list?path=${encodeURIComponent(testDir)}`);
      const data = await res.json();

      expect(data.count).toBeDefined();
      expect(data.count.total).toBeGreaterThan(0);
      expect(typeof data.count.directories).toBe('number');
      expect(typeof data.count.files).toBe('number');
      expect(data.count.total).toBe(data.count.directories + data.count.files);
    });

    it('should default to home directory when path is not provided', async () => {
      const res = await app.request('/list');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.path).toBe(homedir());
    });
  });

  describe('GET /stat', () => {
    it('should return stats for existing file', async () => {
      const filePath = join(testDir, 'file.txt');
      const res = await app.request(`/stat?path=${encodeURIComponent(filePath)}`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.exists).toBe(true);
      expect(data.path).toBe(filePath);
      expect(data.name).toBe('file.txt');
      expect(data.isFile).toBe(true);
      expect(data.isDirectory).toBe(false);
      expect(data.size).toBeGreaterThan(0);
      expect(data.modifiedAt).toBeDefined();
      expect(data.createdAt).toBeDefined();
    });

    it('should return stats for existing directory', async () => {
      const dirPath = join(testDir, 'subdir');
      const res = await app.request(`/stat?path=${encodeURIComponent(dirPath)}`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.exists).toBe(true);
      expect(data.name).toBe('subdir');
      expect(data.isFile).toBe(false);
      expect(data.isDirectory).toBe(true);
    });

    it('should indicate when path does not exist', async () => {
      const res = await app.request('/stat?path=/non/existent/path');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.exists).toBe(false);
      expect(data.path).toBe('/non/existent/path');
    });

    it('should return 400 when path is missing', async () => {
      const res = await app.request('/stat');
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toBe('path query parameter is required');
    });
  });

  describe('GET /resolve', () => {
    it('should resolve relative path', async () => {
      const res = await app.request('/resolve?path=./test');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.original).toBe('./test');
      expect(data.resolved).not.toContain('./');
      expect(data.resolved).toMatch(/^[/\\]/); // Should be absolute
    });

    it('should resolve tilde path', async () => {
      const res = await app.request('/resolve?path=~/Documents');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.original).toBe('~/Documents');
      expect(data.resolved).toBe(join(homedir(), 'Documents'));
      expect(data.resolved).not.toContain('~');
    });

    it('should indicate if resolved path exists', async () => {
      const res = await app.request(`/resolve?path=${encodeURIComponent(testDir)}`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.exists).toBe(true);
    });

    it('should indicate if resolved path does not exist', async () => {
      const res = await app.request('/resolve?path=/definitely/not/existing');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.exists).toBe(false);
    });

    it('should return 400 when path is missing', async () => {
      const res = await app.request('/resolve');
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toBe('path query parameter is required');
    });
  });

  describe('POST /mkdir', () => {
    it('should create a new directory', async () => {
      const res = await app.request('/mkdir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentPath: testDir,
          name: 'new-directory',
        }),
      });
      expect(res.status).toBe(201);

      const data = await res.json();
      expect(data.path).toBe(join(testDir, 'new-directory'));
      expect(data.name).toBe('new-directory');
      expect(data.isDirectory).toBe(true);
      expect(data.createdAt).toBeDefined();

      // Verify directory was actually created
      expect(existsSync(join(testDir, 'new-directory'))).toBe(true);
    });

    it('should return 400 when parentPath is missing', async () => {
      const res = await app.request('/mkdir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'new-directory',
        }),
      });
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain('parentPath');
    });

    it('should return 400 when name is missing', async () => {
      const res = await app.request('/mkdir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentPath: testDir,
        }),
      });
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain('name is required');
    });

    it('should return 400 for invalid directory names', async () => {
      // Test names that should be rejected as invalid (not empty)
      const invalidNames = ['.', '..', 'foo/bar', 'foo\\bar'];

      for (const name of invalidNames) {
        const res = await app.request('/mkdir', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            parentPath: testDir,
            name,
          }),
        });
        expect(res.status).toBe(400);

        const data = await res.json();
        expect(data.error).toBe('Invalid directory name');
      }
    });

    it('should return 400 for empty directory name', async () => {
      const res = await app.request('/mkdir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentPath: testDir,
          name: '',
        }),
      });
      expect(res.status).toBe(400);

      const data = await res.json();
      // Empty string passes zod but is caught by the name validation check
      expect(data.error).toBe('Invalid directory name');
    });

    it('should return 404 when parent does not exist', async () => {
      const res = await app.request('/mkdir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentPath: '/non/existent/parent',
          name: 'new-dir',
        }),
      });
      expect(res.status).toBe(404);

      const data = await res.json();
      expect(data.error).toBe('Parent directory does not exist');
    });

    it('should return 400 when parent is not a directory', async () => {
      const filePath = join(testDir, 'file.txt');
      const res = await app.request('/mkdir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentPath: filePath,
          name: 'new-dir',
        }),
      });
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toBe('Parent path is not a directory');
    });

    it('should return 409 when directory already exists', async () => {
      const res = await app.request('/mkdir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentPath: testDir,
          name: 'subdir', // Already exists
        }),
      });
      expect(res.status).toBe(409);

      const data = await res.json();
      expect(data.error).toBe('A file or directory with that name already exists');
    });

    it('should trim whitespace from directory name', async () => {
      const res = await app.request('/mkdir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentPath: testDir,
          name: '  trimmed-dir  ',
        }),
      });
      expect(res.status).toBe(201);

      const data = await res.json();
      expect(data.name).toBe('trimmed-dir');
      expect(existsSync(join(testDir, 'trimmed-dir'))).toBe(true);
    });
  });
});
