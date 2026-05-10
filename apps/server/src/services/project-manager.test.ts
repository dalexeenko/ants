import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { ProjectManager } from './project-manager.js';
import type { ServerConfig } from '../config.js';
import { createTestDatabase, type TestDB } from '../test-utils/db.js';

// Mock the git utility so tests don't need real git repos
vi.mock('../utils/git.js', () => ({
  isGitRepo: vi.fn().mockResolvedValue(false),
}));

const mockAgentManager = {
  getServerPort: vi.fn().mockReturnValue(undefined),
  writeAgentConfig: vi.fn(),
  readAgentConfig: vi.fn().mockReturnValue(null),
  stopServer: vi.fn().mockResolvedValue(undefined),
  ensureServerRunning: vi.fn().mockResolvedValue(null),
  restartServer: vi.fn().mockResolvedValue(null),
};

describe('ProjectManager', () => {
  let testDir: string;
  let config: ServerConfig;
  let manager: ProjectManager;
  let db: TestDB;
  let sqlite: Database.Database;

  beforeEach(() => {
    testDir = join(tmpdir(), `openmgr-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    
    config = {
      secret: 'test-secret',
      encryptionKey: 'dGVzdC1lbmNyeXB0aW9uLWtleS0xMjM0NTY3ODkw',
      port: 6647,
      host: '127.0.0.1',
      dataDir: testDir,
      workspacesDir: join(testDir, 'workspaces'),
      autoInstallAgent: false,
      mockAgent: false,
      corsOrigins: [],
      multiUser: false,
      cfAccessSetIdentity: true,
      webApp: false,
      allowedHosts: [],
    };
    
    ({ sqlite, db } = createTestDatabase());
    
    manager = new ProjectManager(config, mockAgentManager as any, db);
    vi.clearAllMocks();
  });

  afterEach(() => {
    sqlite.close();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('createProject', () => {
    it('should create an project with auto-generated workspace', async () => {
      const project = await manager.createProject({ name: 'Test Project' });
      
      expect(project.id).toBeDefined();
      expect(project.name).toBe('Test Project');
      expect(project.workingDirectory).toBe(join(config.workspacesDir, 'test-project'));
      expect(project.createdAt).toBeDefined();
      expect(existsSync(project.workingDirectory)).toBe(true);
    });

    it('should create an project with custom workspace', async () => {
      const customDir = join(testDir, 'custom-workspace');
      const project = await manager.createProject({ 
        name: 'Custom Project',
        workingDirectory: customDir,
      });
      
      expect(project.workingDirectory).toBe(customDir);
      expect(existsSync(customDir)).toBe(true);
    });

    it('should sanitize project name for workspace directory', async () => {
      const project = await manager.createProject({ name: 'My Project! @#$% Test' });
      
      expect(project.workingDirectory).toBe(join(config.workspacesDir, 'my-project-test'));
    });

    it('should use default workspace when empty string provided', async () => {
      const project = await manager.createProject({ 
        name: 'Empty WD Project',
        workingDirectory: '',
      });
      
      expect(project.workingDirectory).toBe(join(config.workspacesDir, 'empty-wd-project'));
    });

    it('should persist project to database', async () => {
      const project = await manager.createProject({ name: 'Persisted Project' });
      
      const retrieved = await manager.getProject(project.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe('Persisted Project');
    });

    it('should set autoStart to true by default', async () => {
      const project = await manager.createProject({ name: 'Auto Start Test' });
      expect(project.autoStart).toBe(true);
    });

    it('should respect autoStart when provided', async () => {
      const project = await manager.createProject({ 
        name: 'No Auto Start',
        autoStart: false,
      });
      expect(project.autoStart).toBe(false);
    });
  });

  describe('getProject', () => {
    it('should return null for non-existent project', async () => {
      const project = await manager.getProject('non-existent-id');
      expect(project).toBeNull();
    });

    it('should retrieve a created project', async () => {
      const created = await manager.createProject({ name: 'Get Test' });
      const retrieved = await manager.getProject(created.id);
      
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.name).toBe('Get Test');
    });
  });

  describe('listProjects', () => {
    it('should return empty array when no projects', async () => {
      const projects = await manager.listProjects();
      expect(projects).toEqual([]);
    });

    it('should return all projects sorted by name', async () => {
      await manager.createProject({ name: 'Zebra' });
      await manager.createProject({ name: 'Alpha' });
      await manager.createProject({ name: 'Middle' });
      
      const projects = await manager.listProjects();
      
      expect(projects).toHaveLength(3);
      expect(projects[0].name).toBe('Alpha');
      expect(projects[1].name).toBe('Middle');
      expect(projects[2].name).toBe('Zebra');
    });
  });

  describe('updateProject', () => {
    it('should return null for non-existent project', async () => {
      const result = await manager.updateProject('non-existent', { name: 'New Name' });
      expect(result).toBeNull();
    });

    it('should update project name', async () => {
      const project = await manager.createProject({ name: 'Original' });
      const updated = await manager.updateProject(project.id, { name: 'Updated' });
      
      expect(updated!.name).toBe('Updated');
      
      const retrieved = await manager.getProject(project.id);
      expect(retrieved!.name).toBe('Updated');
    });

    it('should update default model', async () => {
      const project = await manager.createProject({ name: 'Model Test' });
      const updated = await manager.updateProject(project.id, { 
        defaultModel: 'anthropic/claude-sonnet-4-20250514' 
      });
      
      expect(updated!.defaultModel).toBe('anthropic/claude-sonnet-4-20250514');
    });

    it('should update autoStart', async () => {
      const project = await manager.createProject({ name: 'Auto Test', autoStart: true });
      const updated = await manager.updateProject(project.id, { autoStart: false });
      
      expect(updated!.autoStart).toBe(false);
    });
  });

  describe('deleteProject', () => {
    it('should return false for non-existent project', async () => {
      const result = await manager.deleteProject('non-existent');
      expect(result).toBe(false);
    });

    it('should delete an existing project', async () => {
      const project = await manager.createProject({ name: 'To Delete' });
      
      const result = await manager.deleteProject(project.id);
      expect(result).toBe(true);
      
      const retrieved = await manager.getProject(project.id);
      expect(retrieved).toBeNull();
    });

    it('should stop the agent server when deleting', async () => {
      const project = await manager.createProject({ name: 'Server Stop Test' });
      
      await manager.deleteProject(project.id);
      
      expect(mockAgentManager.stopServer).toHaveBeenCalledWith(project.workingDirectory);
    });
  });

  describe('worktreeEnabled', () => {
    it('should default worktreeEnabled to undefined', async () => {
      const project = await manager.createProject({ name: 'No Worktree' });
      expect(project.worktreeEnabled).toBeUndefined();
    });

    it('should update worktreeEnabled to true', async () => {
      const project = await manager.createProject({ name: 'Worktree Test' });
      const updated = await manager.updateProject(project.id, { worktreeEnabled: true });

      expect(updated!.worktreeEnabled).toBe(true);
    });

    it('should update worktreeEnabled to false', async () => {
      const project = await manager.createProject({ name: 'Worktree Test' });
      await manager.updateProject(project.id, { worktreeEnabled: true });
      const updated = await manager.updateProject(project.id, { worktreeEnabled: false });

      expect(updated!.worktreeEnabled).toBe(false);
    });

    it('should persist worktreeEnabled across retrieval', async () => {
      const project = await manager.createProject({ name: 'Persist Test' });
      await manager.updateProject(project.id, { worktreeEnabled: true });

      const retrieved = await manager.getProject(project.id);
      expect(retrieved!.worktreeEnabled).toBe(true);
    });

    it('should include worktreeEnabled in listed projects', async () => {
      const project = await manager.createProject({ name: 'List Test' });
      await manager.updateProject(project.id, { worktreeEnabled: true });

      const projects = await manager.listProjects();
      const found = projects.find(p => p.id === project.id);
      expect(found!.worktreeEnabled).toBe(true);
    });
  });

  describe('isGitRepo detection', () => {
    it('should include isGitRepo in listed projects', async () => {
      await manager.createProject({ name: 'Git Test' });

      const projects = await manager.listProjects();
      expect(projects[0].isGitRepo).toBe(false);
    });

    it('should include isGitRepo when getting a project', async () => {
      const project = await manager.createProject({ name: 'Git Test' });
      const retrieved = await manager.getProject(project.id);
      expect(retrieved!.isGitRepo).toBe(false);
    });

    it('should detect git repos when isGitRepo returns true', async () => {
      const { isGitRepo } = await import('../utils/git.js');
      (isGitRepo as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      const project = await manager.createProject({ name: 'Real Git' });
      const retrieved = await manager.getProject(project.id);
      expect(retrieved!.isGitRepo).toBe(true);

      // Reset mock
      (isGitRepo as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    });

    it('should default isGitRepo to false on error', async () => {
      const { isGitRepo } = await import('../utils/git.js');
      (isGitRepo as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('git not found'));

      const project = await manager.createProject({ name: 'No Git' });
      const retrieved = await manager.getProject(project.id);
      expect(retrieved!.isGitRepo).toBe(false);

      // Reset mock
      (isGitRepo as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    });
  });

  describe('agentConfig', () => {
    it('should write agent config on create', async () => {
      const agentConfig = { provider: 'anthropic', model: 'claude-sonnet-4-20250514' };
      await manager.createProject({ 
        name: 'Config Test',
        agentConfig,
      });
      
      expect(mockAgentManager.writeAgentConfig).toHaveBeenCalled();
    });

    it('should update agent config', async () => {
      const project = await manager.createProject({ name: 'Update Config Test' });
      
      await manager.updateAgentConfig(project.id, { provider: 'openai', model: 'gpt-4o' });
      
      expect(mockAgentManager.writeAgentConfig).toHaveBeenCalledWith(
        project.workingDirectory,
        { provider: 'openai', model: 'gpt-4o' }
      );
    });
  });
});
