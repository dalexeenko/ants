import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { ServerHarness, type ServerInfo } from './server-harness.js';

describe('Filesystem Routes', () => {
  let harness: ServerHarness;
  let server: ServerInfo;

  beforeAll(async () => {
    harness = new ServerHarness();
    server = await harness.start();
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  describe('GET /filesystem/home', () => {
    it('should return home directory and common paths', async () => {
      const response = await harness.fetch('/filesystem/home');
      
      expect(response.ok).toBe(true);
      
      const data = await response.json();
      expect(data.home).toBeDefined();
      expect(data.home).toBe(homedir());
      expect(data.workspaces).toBeDefined();
      expect(data.common).toBeDefined();
      expect(Array.isArray(data.common)).toBe(true);
    });

    it('should include home in common paths', async () => {
      const response = await harness.fetch('/filesystem/home');
      const data = await response.json();
      
      const homeEntry = data.common.find((p: { path: string }) => p.path === data.home);
      expect(homeEntry).toBeDefined();
      expect(homeEntry.name).toBe('Home');
    });

    it('should include workspaces in common paths', async () => {
      const response = await harness.fetch('/filesystem/home');
      const data = await response.json();
      
      const workspacesEntry = data.common.find((p: { path: string }) => p.path === data.workspaces);
      expect(workspacesEntry).toBeDefined();
      expect(workspacesEntry.name).toBe('Workspaces');
    });
  });

  describe('GET /filesystem/list', () => {
    it('should list directory contents', async () => {
      // List the workspaces directory which exists
      const response = await harness.fetch(`/filesystem/list?path=${encodeURIComponent(server.workspacesDir)}`);
      
      expect(response.ok).toBe(true);
      
      const data = await response.json();
      expect(data.entries).toBeDefined();
      expect(Array.isArray(data.entries)).toBe(true);
      expect(data.path).toBe(server.workspacesDir);
    });

    it('should list home directory when no path provided', async () => {
      const response = await harness.fetch('/filesystem/list');
      
      expect(response.ok).toBe(true);
      
      const data = await response.json();
      expect(data.entries).toBeDefined();
      expect(data.path).toBe(homedir());
    });

    it('should hide hidden files by default', async () => {
      // Create a hidden file in workspaces dir
      const hiddenFile = join(server.workspacesDir, '.hidden-test-file');
      writeFileSync(hiddenFile, 'hidden');
      
      const response = await harness.fetch(`/filesystem/list?path=${encodeURIComponent(server.workspacesDir)}`);
      const data = await response.json();
      
      const hasHidden = data.entries.some((e: { name: string }) => e.name.startsWith('.'));
      expect(hasHidden).toBe(false);
    });

    it('should show hidden files when showHidden=true', async () => {
      // Create a hidden file in workspaces dir
      const hiddenFile = join(server.workspacesDir, '.hidden-visible-file');
      writeFileSync(hiddenFile, 'hidden');
      
      const response = await harness.fetch(
        `/filesystem/list?path=${encodeURIComponent(server.workspacesDir)}&showHidden=true`
      );
      const data = await response.json();
      
      const hiddenEntry = data.entries.find((e: { name: string }) => e.name === '.hidden-visible-file');
      expect(hiddenEntry).toBeDefined();
    });

    it('should sort directories before files', async () => {
      // Create a file and directory
      mkdirSync(join(server.workspacesDir, 'z-directory'), { recursive: true });
      writeFileSync(join(server.workspacesDir, 'a-file.txt'), 'content');
      
      const response = await harness.fetch(`/filesystem/list?path=${encodeURIComponent(server.workspacesDir)}`);
      const data = await response.json();
      
      // Find indices of directory and file
      const dirIndex = data.entries.findIndex((e: { name: string }) => e.name === 'z-directory');
      const fileIndex = data.entries.findIndex((e: { name: string }) => e.name === 'a-file.txt');
      
      // Directory should come before file even though 'z' > 'a' alphabetically
      expect(dirIndex).toBeLessThan(fileIndex);
    });

    it('should return count information', async () => {
      const response = await harness.fetch(`/filesystem/list?path=${encodeURIComponent(server.workspacesDir)}`);
      const data = await response.json();
      
      expect(data.count).toBeDefined();
      expect(data.count.total).toBeDefined();
      expect(data.count.directories).toBeDefined();
      expect(data.count.files).toBeDefined();
    });

    it('should return 404 for non-existent path', async () => {
      const response = await harness.fetch(`/filesystem/list?path=${encodeURIComponent('/nonexistent/path/xyz')}`);
      expect(response.status).toBe(404);
    });

    it('should return parent directory info', async () => {
      const subdir = join(server.workspacesDir, 'list-parent-test');
      mkdirSync(subdir, { recursive: true });
      
      const response = await harness.fetch(`/filesystem/list?path=${encodeURIComponent(subdir)}`);
      const data = await response.json();
      
      expect(data.parent).toBe(server.workspacesDir);
      expect(data.isRoot).toBe(false);
    });

    it('should indicate root directory correctly', async () => {
      const response = await harness.fetch(`/filesystem/list?path=${encodeURIComponent('/')}`);
      const data = await response.json();
      
      expect(data.isRoot).toBe(true);
      expect(data.parent).toBeNull();
    });
  });

  describe('GET /filesystem/stat', () => {
    it('should return stats for a file', async () => {
      const testFile = join(server.workspacesDir, 'stat-test-file.txt');
      writeFileSync(testFile, 'test content');
      
      const response = await harness.fetch(`/filesystem/stat?path=${encodeURIComponent(testFile)}`);
      
      expect(response.ok).toBe(true);
      
      const data = await response.json();
      expect(data.exists).toBe(true);
      expect(data.isDirectory).toBe(false);
      expect(data.isFile).toBe(true);
      expect(data.size).toBeDefined();
      expect(data.size).toBeGreaterThan(0);
    });

    it('should return stats for a directory', async () => {
      const testDir = join(server.workspacesDir, 'stat-test-dir');
      mkdirSync(testDir, { recursive: true });
      
      const response = await harness.fetch(`/filesystem/stat?path=${encodeURIComponent(testDir)}`);
      
      expect(response.ok).toBe(true);
      
      const data = await response.json();
      expect(data.exists).toBe(true);
      expect(data.isDirectory).toBe(true);
      expect(data.isFile).toBe(false);
    });

    it('should return exists=false for non-existent path', async () => {
      const response = await harness.fetch(`/filesystem/stat?path=${encodeURIComponent('/nonexistent/file.txt')}`);
      expect(response.ok).toBe(true);
      
      const data = await response.json();
      expect(data.exists).toBe(false);
    });

    it('should return 400 when path is missing', async () => {
      const response = await harness.fetch('/filesystem/stat');
      expect(response.status).toBe(400);
    });
  });

  describe('GET /filesystem/resolve', () => {
    it('should resolve relative paths', async () => {
      const response = await harness.fetch(
        `/filesystem/resolve?path=subdir`
      );
      
      expect(response.ok).toBe(true);
      
      const data = await response.json();
      expect(data.resolved).toBeDefined();
      expect(data.original).toBe('subdir');
    });

    it('should resolve ~ to home directory', async () => {
      const response = await harness.fetch(
        `/filesystem/resolve?path=~`
      );
      
      expect(response.ok).toBe(true);
      
      const data = await response.json();
      expect(data.resolved).toBe(homedir());
    });

    it('should resolve ~/subpath to home subpath', async () => {
      const response = await harness.fetch(
        `/filesystem/resolve?path=~/Documents`
      );
      
      expect(response.ok).toBe(true);
      
      const data = await response.json();
      expect(data.resolved).toBe(join(homedir(), 'Documents'));
    });

    it('should include exists flag', async () => {
      const response = await harness.fetch(
        `/filesystem/resolve?path=~`
      );
      
      const data = await response.json();
      expect(data.exists).toBe(true);
      
      // Non-existent path
      const response2 = await harness.fetch(
        `/filesystem/resolve?path=/nonexistent/path`
      );
      const data2 = await response2.json();
      expect(data2.exists).toBe(false);
    });

    it('should return 400 when path is missing', async () => {
      const response = await harness.fetch('/filesystem/resolve');
      expect(response.status).toBe(400);
    });
  });

  describe('POST /filesystem/mkdir', () => {
    it('should create a new directory', async () => {
      const newDir = join(server.workspacesDir, 'new-mkdir-test');
      
      const response = await harness.fetch('/filesystem/mkdir', {
        method: 'POST',
        body: JSON.stringify({ parentPath: server.workspacesDir, name: 'new-mkdir-test' }),
      });
      
      expect(response.status).toBe(201);
      
      const data = await response.json();
      expect(data.path).toBe(newDir);
      expect(data.isDirectory).toBe(true);
      
      // Verify it exists
      const statResponse = await harness.fetch(`/filesystem/stat?path=${encodeURIComponent(newDir)}`);
      const statData = await statResponse.json();
      expect(statData.exists).toBe(true);
    });

    it('should handle directory names with spaces', async () => {
      const response = await harness.fetch('/filesystem/mkdir', {
        method: 'POST',
        body: JSON.stringify({ parentPath: server.workspacesDir, name: 'my new folder' }),
      });
      
      expect(response.status).toBe(201);
      
      const data = await response.json();
      expect(data.path).toBe(join(server.workspacesDir, 'my new folder'));
    });

    it('should reject invalid directory names with path separators', async () => {
      const response = await harness.fetch('/filesystem/mkdir', {
        method: 'POST',
        body: JSON.stringify({ parentPath: server.workspacesDir, name: '../escape-attempt' }),
      });
      
      expect(response.status).toBe(400);
    });

    it('should reject . as directory name', async () => {
      const response = await harness.fetch('/filesystem/mkdir', {
        method: 'POST',
        body: JSON.stringify({ parentPath: server.workspacesDir, name: '.' }),
      });
      
      expect(response.status).toBe(400);
    });

    it('should reject .. as directory name', async () => {
      const response = await harness.fetch('/filesystem/mkdir', {
        method: 'POST',
        body: JSON.stringify({ parentPath: server.workspacesDir, name: '..' }),
      });
      
      expect(response.status).toBe(400);
    });

    it('should reject empty directory names', async () => {
      const response = await harness.fetch('/filesystem/mkdir', {
        method: 'POST',
        body: JSON.stringify({ parentPath: server.workspacesDir, name: '' }),
      });
      
      expect(response.status).toBe(400);
    });

    it('should return 409 if directory already exists', async () => {
      const existingDir = join(server.workspacesDir, 'already-exists');
      mkdirSync(existingDir, { recursive: true });
      
      const response = await harness.fetch('/filesystem/mkdir', {
        method: 'POST',
        body: JSON.stringify({ parentPath: server.workspacesDir, name: 'already-exists' }),
      });
      
      expect(response.status).toBe(409);
    });

    it('should return 404 if parent directory does not exist', async () => {
      const response = await harness.fetch('/filesystem/mkdir', {
        method: 'POST',
        body: JSON.stringify({ parentPath: '/nonexistent/parent', name: 'new-folder' }),
      });
      
      expect(response.status).toBe(404);
    });

    it('should return 400 if parentPath is missing', async () => {
      const response = await harness.fetch('/filesystem/mkdir', {
        method: 'POST',
        body: JSON.stringify({ name: 'test' }),
      });
      
      expect(response.status).toBe(400);
    });

    it('should return 400 if name is missing', async () => {
      const response = await harness.fetch('/filesystem/mkdir', {
        method: 'POST',
        body: JSON.stringify({ parentPath: server.workspacesDir }),
      });
      
      expect(response.status).toBe(400);
    });
  });
});
