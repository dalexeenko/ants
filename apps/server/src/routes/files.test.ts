import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { createFileRoutes } from './files.js';
import { ProjectManager } from '../services/project-manager.js';
import { DatabaseService } from '../db/index.js';
import { loadConfig } from '../config.js';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const mockAgentManager = {
  getServerPort: vi.fn().mockReturnValue(undefined),
  writeAgentConfig: vi.fn(),
  readAgentConfig: vi.fn().mockReturnValue(null),
  stopServer: vi.fn().mockResolvedValue(undefined),
  ensureServerRunning: vi.fn().mockResolvedValue(null),
  restartServer: vi.fn().mockResolvedValue(null),
  isInstalled: vi.fn().mockResolvedValue(true),
  getVersion: vi.fn().mockResolvedValue('1.0.0'),
};

describe('File Routes', () => {
  let app: Hono;
  let projectManager: ProjectManager;
  let testDir: string;
  let projectId: string;
  let dbService: DatabaseService;

  beforeEach(async () => {
    // Create temporary test directory
    testDir = join(tmpdir(), `ants-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
    mkdirSync(testDir, { recursive: true });

    // Create test files
    writeFileSync(join(testDir, 'test.txt'), 'Hello World');
    mkdirSync(join(testDir, 'subdir'));
    writeFileSync(join(testDir, 'subdir', 'nested.txt'), 'Nested content');

    // Set up test environment
    process.env.ANTS_ENCRYPTION_KEY = 'KbxyC4RoGDtvvE03/h/YyZgK/SjuA3XK6y8Ceyjv1A4=';
    process.env.ANTS_DATA_DIR = join(testDir, 'data');

    const config = loadConfig();
    dbService = new DatabaseService({ dataDir: config.dataDir });
    const db = dbService.db;
    
    projectManager = new ProjectManager(config, mockAgentManager as any, db);
    
    // Create test project
    const project = await projectManager.createProject({
      name: 'test-project',
      workingDirectory: testDir,
    });
    projectId = project.id;

    app = new Hono();
    const fileRoutes = createFileRoutes(projectManager);
    app.route('/', fileRoutes);
  });

  afterEach(() => {
    if (dbService) {
      dbService.close();
    }
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('GET /:projectId/files', () => {
    it('should list files in working directory', async () => {
      const res = await app.request(`/${projectId}/files`);
      expect(res.status).toBe(200);
      
      const data = await res.json();
      expect(data.files).toBeDefined();
      expect(data.files.length).toBeGreaterThan(0);
      
      const testFile = data.files.find((f: any) => f.name === 'test.txt');
      expect(testFile).toBeDefined();
      expect(testFile.isFile).toBe(true);
      
      const subdir = data.files.find((f: any) => f.name === 'subdir');
      expect(subdir).toBeDefined();
      expect(subdir.isDirectory).toBe(true);
    });

    it('should list files in subdirectory', async () => {
      const res = await app.request(`/${projectId}/files?path=subdir`);
      expect(res.status).toBe(200);
      
      const data = await res.json();
      expect(data.files).toBeDefined();
      
      const nestedFile = data.files.find((f: any) => f.name === 'nested.txt');
      expect(nestedFile).toBeDefined();
      expect(nestedFile.isFile).toBe(true);
    });

    it('should return 404 for non-existent project', async () => {
      const res = await app.request('/non-existent/files');
      expect(res.status).toBe(404);
    });

    it('should return 404 for non-existent path', async () => {
      const res = await app.request(`/${projectId}/files?path=non-existent`);
      expect(res.status).toBe(404);
    });
  });

  describe('GET /:projectId/files/content', () => {
    it('should read file content', async () => {
      const res = await app.request(`/${projectId}/files/content?path=test.txt`);
      expect(res.status).toBe(200);
      
      const data = await res.json();
      expect(data.content).toBe('Hello World');
      expect(data.path).toBe('test.txt');
      expect(data.name).toBe('test.txt');
    });

    it('should read nested file content', async () => {
      const res = await app.request(`/${projectId}/files/content?path=subdir/nested.txt`);
      expect(res.status).toBe(200);
      
      const data = await res.json();
      expect(data.content).toBe('Nested content');
    });

    it('should return 400 when path is missing', async () => {
      const res = await app.request(`/${projectId}/files/content`);
      expect(res.status).toBe(400);
    });

    it('should return 404 for non-existent file', async () => {
      const res = await app.request(`/${projectId}/files/content?path=non-existent.txt`);
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /:projectId/files/content', () => {
    it('should write file content', async () => {
      const res = await app.request(`/${projectId}/files/content?path=new-file.txt`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'New content' }),
      });
      expect(res.status).toBe(200);
      
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.path).toBe('new-file.txt');
      
      // Verify file was created
      const readRes = await app.request(`/${projectId}/files/content?path=new-file.txt`);
      const readData = await readRes.json();
      expect(readData.content).toBe('New content');
    });

    it('should overwrite existing file', async () => {
      const res = await app.request(`/${projectId}/files/content?path=test.txt`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Updated content' }),
      });
      expect(res.status).toBe(200);
      
      // Verify file was updated
      const readRes = await app.request(`/${projectId}/files/content?path=test.txt`);
      const readData = await readRes.json();
      expect(readData.content).toBe('Updated content');
    });

    it('should return 400 when content is missing', async () => {
      const res = await app.request(`/${projectId}/files/content?path=test.txt`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /:projectId/files/directory', () => {
    it('should create directory', async () => {
      const res = await app.request(`/${projectId}/files/directory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'new-dir' }),
      });
      expect(res.status).toBe(200);
      
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.path).toBe('new-dir');
      
      // Verify directory was created
      const listRes = await app.request(`/${projectId}/files`);
      const listData = await listRes.json();
      const newDir = listData.files.find((f: any) => f.name === 'new-dir');
      expect(newDir).toBeDefined();
      expect(newDir.isDirectory).toBe(true);
    });

    it('should create nested directory with recursive option', async () => {
      const res = await app.request(`/${projectId}/files/directory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'deep/nested/dir', recursive: true }),
      });
      expect(res.status).toBe(200);
      
      // Verify nested directory was created
      const listRes = await app.request(`/${projectId}/files?path=deep/nested`);
      expect(listRes.status).toBe(200);
      const listData = await listRes.json();
      const dir = listData.files.find((f: any) => f.name === 'dir');
      expect(dir).toBeDefined();
      expect(dir.isDirectory).toBe(true);
    });
  });

  describe('DELETE /:projectId/files', () => {
    it('should delete file', async () => {
      const res = await app.request(`/${projectId}/files?path=test.txt`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
      
      const data = await res.json();
      expect(data.success).toBe(true);
      
      // Verify file was deleted
      const readRes = await app.request(`/${projectId}/files/content?path=test.txt`);
      expect(readRes.status).toBe(404);
    });

    it('should delete directory recursively', async () => {
      const res = await app.request(`/${projectId}/files?path=subdir&recursive=true`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
      
      // Verify directory was deleted
      const listRes = await app.request(`/${projectId}/files?path=subdir`);
      expect(listRes.status).toBe(404);
    });
  });

  describe('GET /:projectId/files/stat', () => {
    it('should return file stats', async () => {
      const res = await app.request(`/${projectId}/files/stat?path=test.txt`);
      expect(res.status).toBe(200);
      
      const data = await res.json();
      expect(data.name).toBe('test.txt');
      expect(data.isFile).toBe(true);
      expect(data.isDirectory).toBe(false);
      expect(data.size).toBeGreaterThan(0);
      expect(data.extension).toBe('.txt');
    });

    it('should return directory stats', async () => {
      const res = await app.request(`/${projectId}/files/stat?path=subdir`);
      expect(res.status).toBe(200);
      
      const data = await res.json();
      expect(data.name).toBe('subdir');
      expect(data.isFile).toBe(false);
      expect(data.isDirectory).toBe(true);
      expect(data.extension).toBe(null);
    });
  });
});
