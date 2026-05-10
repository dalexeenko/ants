// Mock node-pty before any imports
import { vi as vitest } from 'vitest';

vitest.mock('node-pty', () => {
  const { EventEmitter } = require('events');
  
  class MockPty extends EventEmitter {
    pid = 1234;
    process = 'bash';
    
    write(data: string) {
      // Simulate writing to terminal
      this.emit('data', `echo: ${data}`);
    }
    
    resize(cols: number, rows: number) {
      // Simulate resize
    }
    
    kill(signal?: string) {
      this.emit('exit', { exitCode: 0, signal });
    }
    
    onData(callback: (data: string) => void) {
      this.on('data', callback);
    }
    
    onExit(callback: (event: { exitCode: number; signal?: string }) => void) {
      this.on('exit', callback);
    }
  }
  
  return {
    spawn: vi.fn(() => new MockPty())
  };
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { createTerminalRoutes } from './terminals.js';
import { ProjectManager } from '../services/project-manager.js';
import { TerminalManager } from '../services/terminal-manager.js';
import { DatabaseService } from '../db/index.js';
import { loadConfig } from '../config.js';
import { mkdirSync, rmSync, existsSync } from 'fs';
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

describe('Terminal Routes', () => {
  let app: Hono;
  let projectManager: ProjectManager;
  let terminalManager: TerminalManager;
  let testDir: string;
  let projectId: string;
  let dbService: DatabaseService;

  beforeEach(async () => {
    // Create temporary test directory with random suffix to avoid conflicts
    testDir = join(tmpdir(), `openmgr-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
    mkdirSync(testDir, { recursive: true });

    // Set up test environment
    process.env.OPENMGR_ENCRYPTION_KEY = 'KbxyC4RoGDtvvE03/h/YyZgK/SjuA3XK6y8Ceyjv1A4=';
    process.env.OPENMGR_DATA_DIR = join(testDir, 'data');

    const config = loadConfig();
    dbService = new DatabaseService({ dataDir: config.dataDir });
    const db = dbService.db;
    
    projectManager = new ProjectManager(config, mockAgentManager as any, db);
    terminalManager = new TerminalManager();
    
    // Create test project
    const project = await projectManager.createProject({
      name: 'test-project',
      workingDirectory: testDir,
    });
    projectId = project.id;

    app = new Hono();
    const terminalRoutes = createTerminalRoutes({ projectManager, terminalManager, upgradeWebSocket: () => {} });
    app.route('/', terminalRoutes);
  });

  afterEach(() => {
    if (terminalManager) {
      terminalManager.shutdown();
    }
    if (dbService) {
      dbService.close();
    }
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('GET /:projectId/terminals', () => {
    it('should list empty terminals initially', async () => {
      const res = await app.request(`/${projectId}/terminals`);
      expect(res.status).toBe(200);
      
      const data = await res.json();
      expect(data.sessions).toBeDefined();
      expect(data.sessions).toHaveLength(0);
    });

    it('should return 404 for non-existent project', async () => {
      const res = await app.request('/non-existent/terminals');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /:projectId/terminals', () => {
    it('should create terminal session', async () => {
      const res = await app.request(`/${projectId}/terminals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
      
      const data = await res.json();
      expect(data.sessionId).toBeDefined();
      expect(data.projectId).toBe(projectId);
      expect(data.workingDirectory).toBe(testDir);
      expect(data.createdAt).toBeDefined();
    });

    it('should create terminal session with custom shell', async () => {
      const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
      const res = await app.request(`/${projectId}/terminals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shell }),
      });
      expect(res.status).toBe(200);
      
      const data = await res.json();
      expect(data.sessionId).toBeDefined();
    });

    it('should create terminal session with custom working directory', async () => {
      const customDir = join(testDir, 'custom');
      mkdirSync(customDir, { recursive: true });
      
      const res = await app.request(`/${projectId}/terminals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workingDirectory: customDir }),
      });
      expect(res.status).toBe(200);
      
      const data = await res.json();
      expect(data.workingDirectory).toBe(customDir);
    });

    it('should return 404 for non-existent project', async () => {
      const res = await app.request('/non-existent/terminals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /:projectId/terminals/:sessionId', () => {
    let sessionId: string;

    beforeEach(async () => {
      const res = await app.request(`/${projectId}/terminals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      sessionId = data.sessionId;
    });

    it('should get terminal session info', async () => {
      const res = await app.request(`/${projectId}/terminals/${sessionId}`);
      expect(res.status).toBe(200);
      
      const data = await res.json();
      expect(data.id).toBe(sessionId);
      expect(data.projectId).toBe(projectId);
      expect(data.workingDirectory).toBe(testDir);
      expect(data.createdAt).toBeDefined();
      expect(data.lastActivity).toBeDefined();
    });

    it('should return 404 for non-existent session', async () => {
      const res = await app.request(`/${projectId}/terminals/non-existent`);
      expect(res.status).toBe(404);
    });

    it('should return 404 for session belonging to different project', async () => {
      // Create another project (use a different directory)
      const project2Dir = join(testDir, 'project2');
      mkdirSync(project2Dir, { recursive: true });
      const project2 = await projectManager.createProject({
        name: 'test-project-2',
        workingDirectory: project2Dir,
      });
      
      const res = await app.request(`/${project2.id}/terminals/${sessionId}`);
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /:projectId/terminals/:sessionId', () => {
    let sessionId: string;

    beforeEach(async () => {
      const res = await app.request(`/${projectId}/terminals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      sessionId = data.sessionId;
    });

    it('should delete terminal session', async () => {
      const res = await app.request(`/${projectId}/terminals/${sessionId}`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
      
      const data = await res.json();
      expect(data.success).toBe(true);
      
      // Verify session is deleted
      const getRes = await app.request(`/${projectId}/terminals/${sessionId}`);
      expect(getRes.status).toBe(404);
    });

    it('should return 404 for non-existent session', async () => {
      const res = await app.request(`/${projectId}/terminals/non-existent`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /:projectId/terminals/:sessionId/resize', () => {
    let sessionId: string;

    beforeEach(async () => {
      const res = await app.request(`/${projectId}/terminals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      sessionId = data.sessionId;
    });

    it('should resize terminal session', async () => {
      const res = await app.request(`/${projectId}/terminals/${sessionId}/resize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cols: 120, rows: 30 }),
      });
      expect(res.status).toBe(200);
      
      const data = await res.json();
      expect(data.success).toBe(true);
    });

    it('should return 400 for invalid dimensions', async () => {
      const res = await app.request(`/${projectId}/terminals/${sessionId}/resize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cols: 'invalid', rows: 30 }),
      });
      expect(res.status).toBe(400);
    });

    it('should return 404 for non-existent session', async () => {
      const res = await app.request(`/${projectId}/terminals/non-existent/resize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cols: 120, rows: 30 }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('Terminal listing after creation', () => {
    it('should list created terminal sessions', async () => {
      // Create a terminal session
      const createRes = await app.request(`/${projectId}/terminals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(createRes.status).toBe(200);
      
      // List terminals
      const listRes = await app.request(`/${projectId}/terminals`);
      expect(listRes.status).toBe(200);
      
      const data = await listRes.json();
      expect(data.sessions).toHaveLength(1);
      expect(data.sessions[0].projectId).toBe(projectId);
      expect(data.sessions[0].workingDirectory).toBe(testDir);
    });

    it('should list multiple terminal sessions', async () => {
      // Create multiple terminal sessions
      await app.request(`/${projectId}/terminals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      await app.request(`/${projectId}/terminals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      
      // List terminals
      const listRes = await app.request(`/${projectId}/terminals`);
      expect(listRes.status).toBe(200);
      
      const data = await listRes.json();
      expect(data.sessions).toHaveLength(2);
    });
  });
});
